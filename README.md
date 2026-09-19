# LocalAI Workspace

A runnable local-first Electron workspace for Ollama chat, documentation, reusable skills,
MCP servers, and project agents. Core features use local files, SQLite and LanceDB; no cloud
account or backend is required.

## Run

Requires Node.js 22.16+ and pnpm 11. On this machine dependencies are already installed.

```sh
pnpm install
pnpm dev
```

Start Ollama, install a chat model of your choice, and optionally install the recommended
embedding model:

```sh
ollama serve
ollama pull nomic-embed-text
```

If Ollama is already running, do not start a second server. The app discovers installed
models and lets you change them in Settings. The default endpoint is
`http://127.0.0.1:11434`. Notes, skills, MCP configuration and settings work while Ollama
is offline. This build was exercised with the machine's installed `qwen3-coder:latest`.
`nomic-embed-text:latest` was installed during implementation for real RAG verification.

## Workflows

Each sidebar menu has a dedicated guide:

| Sidebar menu | Guide |
| --- | --- |
| Chat | [CHAT.md](docs/CHAT.md) |
| MCP | [MCP.md](docs/MCP.md) |
| Skills | [SKILLS.md](docs/SKILLS.md) |
| Saved Text | [SAVED_TEXT.md](docs/SAVED_TEXT.md) |
| Agents | [AGENTS.md](docs/AGENTS.md) |
| Knowledge Base | [KNOWLEDGE_BASE.md](docs/KNOWLEDGE_BASE.md) |
| Settings | [SETTINGS.md](docs/SETTINGS.md) |

Saved Text is automatically indexed into RAG. To answer questions using it, choose
**Collection: Saved Text** or **All knowledge** in Chat. The default **No knowledge context**
does not retrieve saved notes.

- **Chat:** select a model, send with the arrow or Cmd/Ctrl+Enter, stop, regenerate, copy,
  search history, rename, delete and continue conversations after restarting.
  Type `/skills `, `/agent `, or `/mcp ` to select an enabled item and run it from Chat;
  inspect activity and approve operations inline. See [CHAT.md](docs/CHAT.md).
- **Saved Text:** create a title and Markdown/plain-text body; edit, copy, export,
  import or send it to a new chat. Notes automatically update the Saved Text RAG collection.
- **Skills:** create reusable Markdown instructions; expand the accordion to inspect them.
  Enable/disable in the editor, and select skills when configuring an agent.
- **MCP:** define an executable, arguments and environment references. Start, stop,
  restart or test a server; inspect discovered tools and redacted logs.
- **Knowledge Base:** add .md/.txt files, a folder containing .md/.txt files, or a URL, then click Sync / Re-index.
  Preview normalized content, perform semantic or keyword search, or select sources and
  collections in Chat. Changes replace old vectors; unchanged local documents skip embedding.
- **Agents:** configure a model, skills, tools and knowledge sources; select a project folder
  and run a task. Read the proposed diff and approve or reject changes. Results include
  tool output and verification. Model capability determines task quality.
- **Settings:** configure models, chunking, ignore patterns, theme, execution bounds,
  OS-encrypted credentials, and an explicitly selected `.env` file.

Cmd/Ctrl+K opens global search. Cmd/Ctrl+N creates a chat. Escape cancels active chat/agent
work. The main sidebar collapses; the conversation sidebar can be resized from its corner.

## Commands

| Command                            | Purpose                                                 |
| ---------------------------------- | ------------------------------------------------------- |
| `pnpm dev`                         | Vite + Electron development app                         |
| `pnpm typecheck`                   | Strict TypeScript checking                              |
| `pnpm lint`                        | ESLint                                                  |
| `pnpm test`                        | Unit/service integration tests; no Ollama required      |
| `LOCALAI_LIVE_TEST=1 pnpm test`    | Also verify real Ollama, embeddings and agent execution |
| `pnpm build`                       | Compile main, preload and renderer                      |
| `pnpm test:ui`                     | Electron UI tests against the compiled build            |
| `LOCALAI_LIVE_TEST=1 pnpm test:ui` | Also run live chat, RAG and agent UI workflows          |
| `pnpm package`                     | Build an unpacked desktop application                   |
| `pnpm dist`                        | Build distributable installers for the current platform |
| `pnpm format`                      | Format source, tests and documentation                  |

If an IDE exports `ELECTRON_RUN_AS_NODE=1`, clear that variable when launching Electron:
`env -u ELECTRON_RUN_AS_NODE pnpm dev` (macOS/Linux). Normal terminals do not need this.

## Data and privacy

The exact data directory is shown at the bottom of Settings. It is Electron's `userData`
directory, never the project repository. Definitions are portable Markdown/JSON files.
Chat uses SQLite; vectors use local LanceDB. Export does not include credential values.
OS-encrypted keys are rejected when a secure encryption backend is unavailable.
MCP starts programs you configure: use trusted servers. URL sources fetch only the selected
page; there is no automatic crawler or JavaScript browser execution.

## Release status and practical limits

This is a functional initial desktop implementation, not a signed public release. macOS is
the verified platform; Windows/Linux packaging targets are configured but need native QA.
English is the current UI language. MCP supports stdio transports. Agents use a bounded
JSON-action loop, approve changes individually, and do literal content search rather than
AST/symbol indexing. Destructive commands are blocked, not exposed behind a confirmation.

Text files are capped at 2 MB, URLs at 5 MB, folder traversal at 10,000 eligible files,
previews at 600 KB, agent reads at 200 KB, and runs at 15 minutes plus the configured
iteration limit. These are explicit errors/limits rather than silently indexing whole
repositories. Narrow the source or add ignore patterns for larger projects. Chat context
uses a bounded recent-history window, not automatic conversation summarization.

See [ARCHITECTURE.md](docs/ARCHITECTURE.md), [DEVELOPMENT.md](docs/DEVELOPMENT.md),
[RAG.md](docs/RAG.md), [AGENTS.md](docs/AGENTS.md), [MCP.md](docs/MCP.md), [SKILLS.md](docs/SKILLS.md),
[SECURITY.md](docs/SECURITY.md), and [IMPLEMENTATION.md](docs/IMPLEMENTATION.md).
