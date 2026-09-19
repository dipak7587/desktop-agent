# Agent runtime and contributor rules

## Agents sidebar menu

Create an agent with instructions, a model, enabled skills, tools, and knowledge sources.
Select a project folder and submit a task. Inspect the run's output and review each proposed
file change before approving or rejecting it. Execution is bounded by the configured limits.
Definitions can be edited, imported, exported, or deleted.

Agents can also run from Chat: type `/agent `, select an agent, enter the task, and choose a
project folder when sending. Progress, diffs, approvals, and the result appear in Chat.
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
content. No permanent hidden memory is created. Current-session run history is visible in the
Agents screen. A fresh run reads its explicit definition, skills, knowledge and project files.

Read [SECURITY.md](SECURITY.md) before enabling automatic approvals or MCP tools.

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
