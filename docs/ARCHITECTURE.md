# LocalAI Workspace architecture

The Electron main process owns application data, SQLite chat history, Ollama requests,
LanceDB, MCP subprocesses, credentials, and the controlled agent runtime. The React
renderer has no Node access. A sandboxed CommonJS preload exposes an explicit,
validated IPC API and filtered progress events. Remote navigation is disabled.

## Implementation sequence

1. Electron / React / Vite / Tailwind / TypeScript foundation and secure IPC.
2. Ollama discovery and abortable streaming chat.
3. SQLite conversations, persisted messages and history search.
4. Atomic Markdown saved-text files.
5. Markdown skills and accordion editor.
6. JSON MCP definitions and real SDK stdio transport.
7. Local files/folders, chunking, embeddings and LanceDB retrieval.
8. URL normalization, replacement sync and previews.
9. File-backed agents and bounded model/tool loop.
10. Workspace-constrained tools, hash checks, diffs and approvals.
11. Credentials, settings, import/export, tests, documentation and packaging.

Each phase is checked before the next. No simulated application data or model replies.

## Data

All runtime data lives beneath Electron `app.getPath('userData')` (a test-only
environment override permits isolated smoke tests). `database/app.sqlite` stores
conversations and messages. `saved-text/*.md`, `skills/*/SKILL.md`, `agents/*.md`,
and `mcp/*.json` remain portable files. Knowledge metadata and previews are files;
vectors live in `rag/lancedb`. Settings and OS-encrypted credentials are separate.

## Boundaries

Zod validates IPC inputs. Native dialogs grant local source and project paths.
Agent tools resolve real paths inside the chosen workspace, reject symlinks and
sensitive/ignored paths, limit reads and search, and never use a shell interpreter.
Writes require an original-content hash, a reviewable diff, and approval by default.
Commands use a fixed executable/argument allowlist, timeouts and bounded output.
MCP tools require approval because external tools can have arbitrary side effects.
Secrets resolve only in main and never appear in API responses or logs.

## Providers and UI

Provider interfaces separate chat and embeddings from Ollama. Network I/O is async,
indexing batches yield between files, and native LanceDB operations run asynchronously.
Chat, settings, file libraries, knowledge, MCP and agent UI state are separate Zustand
stores. Markdown renders without raw HTML. Dark/light/system color schemes use native
`color-scheme`. Desktop targets are macOS, Windows and Linux.
