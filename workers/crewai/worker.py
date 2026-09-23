"""Application-owned, text-only CrewAI worker. stdout is a private JSONL protocol."""
import json
import os
import sys
import uuid
from importlib.metadata import version

PROTOCOL = 1
PIN = "1.15.22"
wire = sys.stdout
# Framework diagnostics may contain prompts/reasoning. Never forward them as progress.
sys.stdout = open(os.devnull, "w")
sys.stderr = sys.stdout
os.environ["OTEL_SDK_DISABLED"] = "true"
os.environ["CREWAI_TELEMETRY_ENABLED"] = "false"
os.environ["CREWAI_TRACING_ENABLED"] = "false"


def send(kind, **data):
    wire.write(json.dumps({"v": PROTOCOL, "type": kind, **data}) + "\n")
    wire.flush()


def receive():
    line = sys.stdin.readline(2_000_001)
    if not line or len(line) > 2_000_000 or not line.endswith("\n"):
        raise RuntimeError("Worker input closed or exceeded size limit")
    value = json.loads(line)
    if value.get("v") != PROTOCOL:
        raise RuntimeError("Unsupported worker protocol")
    return value


def main():
    if not (3, 10) <= sys.version_info[:2] < (3, 14):
        raise RuntimeError("Use Python 3.10–3.13")
    installed = version("crewai")
    if installed != PIN:
        raise RuntimeError(f"Install crewai=={PIN}; found {installed}")
    from crewai import BaseLLM
    # -I disables ambient import paths; only this application-owned directory is added.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from crew_builder import build_crew
    from tool_factory import make_tool

    send("ready", version=installed, python=sys.version.split()[0])
    start = receive()
    if start["type"] == "check":
        return
    if start["type"] != "start":
        raise RuntimeError("Expected start request")
    run_id = start["runId"]

    class HostLLM(BaseLLM):
        def __init__(self, agent, task):
            super().__init__(model=agent["model"])
            self.task = task

        def supports_function_calling(self):
            return False

        def supports_stop_words(self):
            return False

        def get_context_window_size(self):
            return start["contextSize"]

        def call(self, messages, tools=None, callbacks=None, available_functions=None, **kwargs):
            if tools or available_functions:
                raise RuntimeError("Native function calling is unavailable; use the supplied CrewAI tools")
            if isinstance(messages, str):
                messages = [{"role": "user", "content": messages}]
            request_id = str(uuid.uuid4())
            send("model_request", runId=run_id, requestId=request_id,
                 nodeId=self.task["id"], messages=[
                     {"role": m["role"], "content": m.get("content") or ""}
                     for m in messages
                 ])
            reply = receive()
            if reply.get("runId") != run_id or reply.get("requestId") != request_id:
                raise RuntimeError("Mismatched host reply")
            if reply["type"] != "model_result":
                raise RuntimeError("Expected model result")
            return reply["content"]

    def tool_factory(tool_id, task):
        def execute(selected, args):
            request_id = str(uuid.uuid4())
            send("tool_request", runId=run_id, requestId=request_id,
                 nodeId=task["id"], tool=selected, args=args)
            reply = receive()
            if (reply.get("runId") != run_id or reply.get("requestId") != request_id
                    or reply.get("type") != "tool_result"):
                raise RuntimeError("Mismatched tool reply")
            return reply["content"]
        return make_tool(tool_id, execute, start["project"].get("customTools", []))

    crew = build_crew(start["project"], HostLLM, tool_factory, start["input"],
                      lambda task_id, result: send("node_completed", runId=run_id,
                                                   nodeId=task_id, result=result))
    try:
        crew.kickoff()
    except Exception as error:
        # Framework parser errors can include raw model reasoning or prompts.
        raise RuntimeError(f"CrewAI execution failed ({type(error).__name__}). Check agent instructions and model compatibility.") from None
    send("completed", runId=run_id)


if __name__ == "__main__":
    try:
        main()
    except BaseException as error:
        send("failed", error=str(error)[:4000])
        sys.exit(1)
