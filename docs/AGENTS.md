# Agent runtime and contributor rules

## Agents sidebar menu

Create an agent with instructions, a model, enabled skills, tools, and knowledge sources.
Optionally select a project folder and submit a task. Leave the task empty to run the configured instructions. Inspect the run's output and review each proposed
file change before approving or rejecting it. Execution is bounded by the configured limits.
Definitions can be edited, imported, exported, or deleted after confirmation. Select individual
agents or **Select all Agents**, then **Delete Selected** to confirm a bulk deletion. Cancel
leaves the definitions intact. Deleting a definition does not delete its execution history.

Agents can also run from Chat: type `/agent ` and select an agent, or enter `/agent <name>`.
The task and project folder are optional. Progress, diffs, approvals, and the result appear in Chat.
The same configured tools, model, knowledge, execution limits, and approval rules apply.

To let an agent retrieve saved notes, select the **Saved Text** knowledge source in its editor
and ensure that source is ready in [Knowledge Base](KNOWLEDGE_BASE.md). Agent knowledge choices
are separate from Chat's knowledge selector. See [Settings](SETTINGS.md) for execution settings.

## Reusable agent definitions

Agents live in `<userData>/agents/<id>.md`, with YAML metadata and a Markdown instruction body:

```md
---
name: Project reviewer
description: Review a selected project
model: qwen3-coder:latest
skills: []
tools:
  - project.detect
  - filesystem.read
  - filesystem.search
  - git.diff
knowledgeSources: []
maxIterations: 5
enabled: true
---

Inspect relevant files, explain findings, and state which checks you ran.
```

The model name is illustrative; choose an installed model. The runtime loads enabled skills,
retrieves selected knowledge, and sends a bounded history to Ollama. Each turn returns one
validated JSON action or a final report. Only explicitly enabled tools can execute. Tools
return their real output; errors are fed back so the model can recover. A maximum iteration
count, a 15-minute deadline and cancellation bound every run.

Filesystem read returns content plus a SHA-256 hash. Write/edit checks that hash, displays a
unified diff, waits for approval by default, checks again, writes atomically and verifies the
content. A fresh run reads its explicit definition, skills, knowledge and any selected project
files; previous execution history is not automatically included in its model context.

## Optional folder context

Chat and Run Agent use the same folder selector. **Select Folder** opens the native picker;
the selected full path is shown with **Change Folder** and **Remove Folder**. Changing it
replaces the selection; removing it clears the current context. Cancelling the picker keeps
the previous selection. These are temporary selections, not saved agent defaults. Chat clears
its selection after sending or changing conversations; reopening Run Agent starts without one.
The path used for a run is retained in history.

Without a folder, the agent can use its configured instructions, skills, knowledge, custom
Tools and MCPs. Built-in filesystem, project, Git and package-script tools are unavailable.
A selected folder scopes built-in tools; it does not sandbox custom code or MCP servers.

## Tools and execution limits

Select built-in tools, discovered MCP tools (`mcp:<server-id>:<tool-name>`), or enabled
[custom Tools](TOOLS.md) (`custom:<tool-id>`) in the editor. Only selected tools are allowed.
Custom Tool and MCP calls always require approval, including in full-auto mode. Inputs,
outputs and failures are recorded in the run; tool errors are returned to the model so it
can recover. Referenced Tools and MCPs cannot be deleted until all agent references are removed,
including references in disabled agents.

**Maximum execution iterations** accepts 1–50 and is saved as `maxIterations`. New agents
start with the global Settings value. Older definitions without this field inherit the global
limit when run. An iteration is one model turn, including invalid actions and the final report;
it is not a count of tool calls. Runs stop on completion, the limit, a fatal error, cancellation,
or the 15-minute deadline. A reached limit has its own status rather than being reported as success.
There is no separate agent-generation workflow or generation-iteration setting in this release.

## Execution history

Expand a run in the **Execution history** accordion to inspect its request, folder, start/end
times, duration, iterations used/maximum, actual MCP calls, tool inputs/outputs/errors,
execution events and final result. Status is **Running**, **Completed**, **Failed**,
**Cancelled**, or **Max iterations reached**. For example, `2 / 5` means two model turns
were used out of five allowed. Active runs can be stopped and pending operations approved
or rejected from the expanded entry.

History persists in `<userData>/database/agent-runs.sqlite`, separately from Markdown agent
definitions. Runs interrupted by application shutdown are marked Cancelled on restart.
Progress shows application-generated Thinking/Planning, tool activity and approval states.
Raw model planning fields are neither displayed nor stored in history; there is no empty
numbered planning list.

Read [SECURITY.md](SECURITY.md) before enabling automatic approvals, custom Tools or MCP tools.

## Repository changes

- Preserve the file-vs-database storage boundary from `desing.md`.
- Keep privileged behavior in main services and validate every IPC request.
- Keep secrets out of API results, logs and portable exports.
- Add relevant service/boundary tests for new privileged operations.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` after changes.
- For UI changes, run `pnpm test:ui` against the new build; live tests are opt-in.
- Use TypeScript, provider interfaces, small service modules and formatted source.
- Electron's bundled Chromium is the only renderer browser target.
- Do not substitute simulated production responses for unavailable services.
