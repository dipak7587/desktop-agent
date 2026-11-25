# LocalAI Workspace

A local-first desktop app that brings AI chat, project assistance, document knowledge and reusable automation into one place. Talk to a model, ask questions about your own documents, build specialist agents, connect tools, and chain agents into workflows.

Built with Electron, React and TypeScript. Your data stays on your machine. Use a local model through [Ollama](https://ollama.com) or connect a hosted provider (OpenAI, Anthropic, Google, OpenRouter, Groq, custom endpoints). No cloud account is required for local use.

> **Status:** development stage, not a signed public release. macOS is the verified platform; Windows and Linux need native QA.

## What you can do

| Goal                                   | Start in                       |
| -------------------------------------- | ------------------------------ |
| Ask questions, draft or explain text   | **Chat**                       |
| Ask questions about your own documents | **Knowledge Base**, then Chat  |
| Explain or change a local project      | **Code**                       |
| Reuse instructions or call APIs        | **Skills**, **Tools**, **MCP** |
| Create a specialist assistant          | **Agents**                     |
| Run several agents as one process      | **Workflows**                  |

## How it fits together

```text
        ┌──────────────── Renderer (React UI) ────────────────┐
        │ Chat · Code · Agents · Workflows · Knowledge · ...   │
        └───────────────────────┬──────────────────────────────┘
                     validated IPC (preload bridge)
        ┌───────────────────────▼──────────────────────────────┐
        │ Main process: capability checks, approvals, history  │
        │ LangChain / LangGraph / DeepAgents orchestration      │
        └──┬───────────┬───────────┬───────────┬───────────────┘
        Models      Tools/MCP   SQLite     LanceDB (RAG)
   (Ollama, cloud)  (guarded)  (history)   (knowledge)
```

The renderer never touches Node.js directly. Everything privileged (files, credentials, model calls, tools) runs in the main process behind permission checks.

## Quick start

Requires Node.js 22.16+ and pnpm 11. Install with pnpm so dependency patches apply.

```sh
pnpm install
pnpm dev
```

For a local model:

```sh
ollama serve                    # skip if already running
ollama pull qwen3-coder:latest  # example chat model
ollama pull nomic-embed-text    # optional, for document search
```

Then open **Settings → AI Providers**, discover your models and pick a default. Open **Chat**, send a message, and you're running. The [user guide](docs/USER_GUIDE.md) walks through the rest.

## Project layout

```text
src/main/       Electron lifecycle, services, databases, IPC, credentials
src/preload/    Restricted bridge between the UI and main process
src/renderer/   React UI (features/, components/, stores/)
src/shared/     Types, schemas and contracts used by both sides
built-in/       Content and defaults bundled with the app
examples/       Example agents, tools, MCP configs and workflows
docs/           Guides and references (start at docs/README.md)
tests/          Service, integration and Electron UI tests
```

## Common commands

| Command          | Purpose                         |
| ---------------- | ------------------------------- |
| `pnpm dev`       | Run the app in development      |
| `pnpm typecheck` | Check types                     |
| `pnpm lint`      | Run ESLint                      |
| `pnpm test`      | Unit and service tests          |
| `pnpm build`     | Compile main, preload, renderer |
| `pnpm test:ui`   | Electron UI tests (build first) |
| `pnpm package`   | Unpacked app build              |
| `pnpm dist`      | Installer for the current OS    |

Live tests, packaging notes and isolated data directories are covered in [Development](docs/DEVELOPMENT.md).

## Documentation

| Read                                                                             | For                                                              |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [User guide](docs/USER_GUIDE.md)                                                 | Install, first chat, every section, troubleshooting, limitations |
| [Documentation index](docs/README.md)                                            | All guides by topic                                              |
| [Workflows](docs/WORKFLOW.md)                                                    | Multi-agent automation                                           |
| [Architecture](docs/ARCHITECTURE.md), [Execution flows](docs/EXECUTION_FLOWS.md) | How requests flow through the system                             |
| [Security](docs/SECURITY.md)                                                     | Permissions, approvals, trust boundaries                         |
| [Examples](examples/README.md)                                                   | Importable agents, tools and workflows                           |

## License

MIT, as declared in `package.json`.
