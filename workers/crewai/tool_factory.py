"""Supported CrewAI BaseTool wrappers. Execution stays in the host (or export runner)."""
from typing import Type
from crewai.tools import BaseTool
from pydantic import BaseModel, Field, create_model, ConfigDict


class PathInput(BaseModel):
    path: str = Field(default=".", description="Path relative to the selected project folder")


class SearchInput(BaseModel):
    query: str = Field(description="Literal text to find")


NAMES = {
    "filesystem.read": ("read_project_file", "Read a text file in the selected folder. Never read secrets."),
    "filesystem.list": ("list_project_files", "List files in a directory in the selected folder."),
    "filesystem.search": ("search_project_text", "Search project files for literal text."),
}


def make_tool(tool_id, execute, custom_tools=None):
    schema = SearchInput if tool_id == "filesystem.search" else PathInput
    if tool_id.startswith("custom."):
        definition = next(t for t in (custom_tools or []) if "custom." + t["id"] == tool_id)
        label, help_text = definition["name"], definition["description"]
        types = {"string": str, "number": float, "boolean": bool, "object": dict, "array": list}
        fields = {}
        for field in definition["inputs"]:
            kind = types[field["type"]]
            fields[field["name"]] = (kind if field["required"] else kind | None,
                Field(default=... if field["required"] else None, description=field["description"]))
        schema = create_model(label + "Input", __config__=ConfigDict(extra="forbid", strict=True), **fields)
    else:
        label, help_text = NAMES[tool_id]
    class HostTool(BaseTool):
        name: str = label
        description: str = help_text
        args_schema: Type[BaseModel] = schema

        def _run(self, **kwargs):
            return execute(tool_id, {k: v for k, v in kwargs.items() if v is not None})

    return HostTool()
