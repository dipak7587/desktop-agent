# Example definitions

This folder contains a small, matching example set for a release-review
workflow:

1. `mcp/project-files.json` describes a local stdio MCP server.
2. `tools/release-summary.md` defines a custom JavaScript Tool.
3. `skills/release-review/SKILL.md` provides reusable review instructions.
4. `agents/release-reviewer.md` combines the Skill, Tool, and MCP server.
5. `workflows/release-review.json` runs two configured agents sequentially.

Import or recreate the definitions from the app's **MCP**, **Tools**, **Skills**,
**Agents**, and **Workflows** sections. Replace the example model with one
installed in your provider settings, and replace the project path in the MCP
definition before starting it.

The workflow references the IDs in these files:

```text
MCP server: project-files
Tool: release-summary
Skill: release-review
Agent: release-reviewer
Agent: release-review-summarizer
Workflow: release-review
```

The MCP example uses the official filesystem server. Starting it downloads and
executes the configured package, so review the command and path before use.
