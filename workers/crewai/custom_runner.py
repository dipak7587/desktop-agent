"""Execute one explicitly approved Python tool. This is not an OS sandbox."""
import contextlib
import io
import json
import math
import sys


def validate_input(definition, args):
    if not isinstance(args, dict):
        raise ValueError("Tool input must be an object")
    fields = {field["name"]: field for field in definition["inputs"]}
    if set(args) - set(fields):
        raise ValueError("Unknown tool input field")
    types = {"string": str, "number": (int, float), "boolean": bool, "object": dict, "array": list}
    for name, field in fields.items():
        if name not in args:
            if field["required"]:
                raise ValueError(f"Missing input: {name}")
            continue
        value = args[name]
        if not isinstance(value, types[field["type"]]) or (field["type"] == "number" and (isinstance(value, bool) or not math.isfinite(value))):
            raise ValueError(f"Invalid input type: {name}")
    return args


class BoundedOutput(io.TextIOBase):
    def __init__(self):
        self.value = ""

    def write(self, text):
        self.value += text[:max(0, 20000 - len(self.value))]
        return len(text)


def main():
    output = BoundedOutput()
    wire = sys.stdout
    try:
        raw = sys.stdin.readline(200001)
        if len(raw) > 200000 or not raw.endswith("\n"):
            raise ValueError("Tool request exceeds size limit")
        payload = json.loads(raw)
        args = validate_input(payload["tool"], payload["args"])
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            namespace = {"__name__": "custom_tool"}
            exec(compile(payload["tool"]["code"], "custom_tool.py", "exec"), namespace)
            handler = namespace.get("run")
            if not callable(handler):
                raise ValueError("Define a synchronous run(input) function")
            result = handler(args)
            encoded = json.dumps(result, allow_nan=False, ensure_ascii=False)
            if len(encoded) > 200000:
                raise ValueError("Tool result exceeds 200,000 characters")
        response = {"ok": True, "result": result, "stdout": output.value}
    except BaseException as error:
        response = {"ok": False, "error": f"{type(error).__name__}: {str(error)[:4000]}", "stdout": output.value}
    wire.write(json.dumps(response, allow_nan=False, ensure_ascii=False) + "\n")
    wire.flush()


if __name__ == "__main__":
    main()
