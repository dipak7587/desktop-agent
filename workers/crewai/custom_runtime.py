"""Run approved exported custom tools separately from the CrewAI/model process."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
from custom_runner import validate_input


def run_custom_tool(tool, args):
    validate_input(tool, args)
    with tempfile.TemporaryDirectory(prefix="crewai-tool-") as directory:
        env = {key: os.environ[key] for key in ("PATH", "SYSTEMROOT") if key in os.environ}
        env.update(HOME=directory, USERPROFILE=directory, TEMP=directory, TMP=directory)
        # A file bounds memory usage; custom code still has ordinary user permissions.
        with tempfile.TemporaryFile() as output:
            process = subprocess.Popen(
                [sys.executable, "-I", "-u", str(Path(__file__).with_name("custom_runner.py"))],
                stdin=subprocess.PIPE, stdout=output, stderr=subprocess.DEVNULL,
                cwd=directory, env=env, start_new_session=os.name != "nt")
            try:
                process.communicate((json.dumps({"tool": tool, "args": args}) + "\n").encode(),
                                    timeout=tool.get("timeoutSeconds", 30))
                if process.returncode != 0:
                    raise RuntimeError(f"Custom tool exited ({process.returncode})")
                output.seek(0)
                raw = output.read(1500001)
                if len(raw) > 1500000:
                    raise ValueError("Custom tool output exceeds size limit")
                result = json.loads(raw)
                if not result["ok"]:
                    raise RuntimeError(result["error"])
                return json.dumps({"result": result["result"], "stdout": result["stdout"]})
            except (ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
                return str(error)
            finally:
                if os.name != "nt":
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                else:
                    subprocess.run(["taskkill", "/pid", str(process.pid), "/T", "/F"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
                process.wait()
