"""Standalone entry point exported by the desktop CrewAI project builder."""
import argparse
import json
import os
from pathlib import Path

os.environ["OTEL_SDK_DISABLED"] = "true"
os.environ["CREWAI_TELEMETRY_ENABLED"] = "false"
os.environ["CREWAI_TRACING_ENABLED"] = "false"

from dotenv import load_dotenv
from crewai import BaseLLM, LLM
from crew_builder import build_crew
from tool_factory import make_tool
from custom_runtime import run_custom_tool

PROTECTED = {".git", ".ssh", ".aws", ".gnupg", ".venv", "node_modules", "dist", "build", "coverage"}


def protected(path):
    return any(p in PROTECTED or p == ".env" or p.startswith(".env.")
               or p.lower().endswith((".pem", ".key", ".p12", ".pfx")) for p in path.parts)


def read_text(path):
    if not path.is_file() or path.stat().st_size > 200000:
        raise ValueError("Choose a text file smaller than 200,000 bytes")
    data = path.read_bytes()
    if b"\0" in data:
        raise ValueError("Binary files are not supported")
    return data.decode("utf-8")


def run():
    parser = argparse.ArgumentParser(description="Run an exported CrewAI project")
    parser.add_argument("--input", default="")
    parser.add_argument("--folder", type=Path)
    args = parser.parse_args()
    project = json.loads(Path(__file__).with_name("project.json").read_text())
    load_dotenv(Path(__file__).with_name(".env"))
    model = os.environ.get("CREWAI_MODEL")
    if not model:
        raise SystemExit("Set CREWAI_MODEL and your provider credentials. See README.md.")
    folder = args.folder.resolve() if args.folder else None
    calls = {"total": 0}

    class BudgetLLM(BaseLLM):
        def __init__(self, agent):
            super().__init__(model=model)
            self.agent = agent
            endpoint = os.environ.get("CREWAI_BASE_URL")
            self.delegate = LLM(model=model, **({"base_url": endpoint} if endpoint else {}))

        def supports_function_calling(self):
            return False

        def call(self, messages, **kwargs):
            used = calls.get(self.agent["id"], 0)
            if used >= self.agent["maxIterations"] or calls["total"] >= project["maxModelCalls"]:
                raise RuntimeError("Maximum model calls reached")
            calls[self.agent["id"]] = used + 1
            calls["total"] += 1
            return self.delegate.call(messages)

    def factory(tool_id, task):
        def execute(selected, data):
            if selected.startswith("custom."):
                tool = next(t for t in project.get("customTools", []) if "custom." + t["id"] == selected)
                print("Custom Python runs with your user permissions, outside the folder boundary.")
                print(tool["code"])
                if input(f"Allow {tool['name']} {json.dumps(data)}? [y/N] ").lower() != "y":
                    return "User denied this request."
                return run_custom_tool(tool, data)
            if folder is None:
                return "A --folder is required for project tools."
            if input(f"Allow {selected} {json.dumps(data)} in {folder}? [y/N] ").lower() != "y":
                return "User denied this request."
            try:
                if selected == "filesystem.search":
                    query = data["query"]
                    if not isinstance(query, str) or not 1 <= len(query) <= 300:
                        raise ValueError("Search query must be 1–300 characters")
                    results, visited = [], 0
                    for directory, dirs, files in os.walk(folder, followlinks=False):
                        base = Path(directory)
                        dirs[:] = [d for d in dirs if not protected((base / d).relative_to(folder)) and not (base / d).is_symlink()]
                        for name in files:
                            path = base / name
                            if protected(path.relative_to(folder)) or path.is_symlink():
                                continue
                            visited += 1
                            if visited > 10000:
                                return json.dumps(results)
                            try:
                                for number, line in enumerate(read_text(path).splitlines(), 1):
                                    if query.lower() in line.lower():
                                        results.append({"path": str(path.relative_to(folder)), "line": number, "content": line[:500]})
                                        if len(results) >= 60:
                                            return json.dumps(results)
                            except (OSError, ValueError, UnicodeError):
                                continue
                    return json.dumps(results)
                raw = Path(data.get("path", "."))
                target = folder / raw
                relative = target.relative_to(folder)
                if raw.is_absolute() or ".." in relative.parts or protected(relative):
                    raise ValueError("Path is outside the folder or protected")
                current = folder
                for part in relative.parts:
                    current = current / part
                    if current.is_symlink():
                        raise ValueError("Symbolic links are not allowed")
                if selected == "filesystem.read":
                    return read_text(target)
                return json.dumps([p.name for p in target.iterdir() if not p.is_symlink() and not protected(p.relative_to(folder))][:500])
            except (OSError, ValueError, UnicodeError) as error:
                return str(error)
        return make_tool(tool_id, execute, project.get("customTools", []))

    crew = build_crew(project, lambda agent, task: BudgetLLM(agent), factory, args.input)
    print(crew.kickoff().raw)


if __name__ == "__main__":
    run()
