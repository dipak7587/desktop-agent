# Example definitions

For recurring video creation, see [Video Story Studio](video-story-studio/README.md):
live story discovery, your selection, six specialist agents, configurable clip timing,
and versioned Google Flow prompt packs. Both workflows can be run from the desktop UI.

For an end-to-end example you can run immediately with local Ollama, see
[Order support](order-support/README.md): one MCP server, one custom Tool, one
agent, and a two-stage workflow, with desktop definitions and a smoke test.

```sh
node examples/order-support/workflow.mjs "Where is my order ORD-123?"
```

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
