# LocalAI Workspace architecture

The Electron main process owns application data, SQLite chat/run history, Ollama requests,
LanceDB, custom Tool execution, MCP subprocesses, credentials, and the controlled agent runtime. The React
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
12. Custom Tools, optional run folders, per-agent iteration limits, persistent run history,
    MCP auto-start/dependency checks, and bulk agent deletion.

Each phase is checked before the next. No simulated application data or model replies.

## Data

All runtime data lives beneath Electron `app.getPath('userData')` (a test-only
environment override permits isolated smoke tests). `database/app.sqlite` stores
conversations and messages. `database/agent-runs.sqlite` stores execution history.
`database/memory.sqlite` stores scoped long-term agent memory and
`database/checkpoints.sqlite` stores LangGraph checkpoints, both with the same
built-in SQLite engine. `saved-text/*.md`, `skills/*/SKILL.md`, `agents/*.md`,
`tools/*.md`, and `mcp/*.json` remain portable files. Knowledge metadata and previews are files;
vectors live in `rag/lancedb`. Settings and OS-encrypted credentials are separate.

## AI stack layers

Model calls flow through the existing `LLMProvider` adapters
(`services/ollama/provider.ts`). `AppChatModel` (`services/ai/langchain-model.ts`) is a
LangChain chat model over that abstraction, so LangChain, LangGraph and Deep Agents
invoke the same configured providers, models and main-process credentials as Chat.
Provider-specific behavior stays inside the adapters; capability-driven configuration
remains in Settings.

LangGraph is the execution engine: chat turns run as a compiled `StateGraph`
(`services/ai/chat-graph.ts`; capability routing → knowledge retrieval → memory →
streaming model → persistence) with the conversation id as the `thread_id`, and the
classic agent loop runs as a `plan ⇄ act` graph (`services/ai/agent-graph.ts`) over the
existing capability router and approval flow. Thread state persists in
`database/checkpoints.sqlite` through `CheckpointDatabase`. Opted-in agents with a
selected folder can run through Deep Agents (`services/ai/deep-agents.ts`), which maps
existing agent definitions and permissions onto the harness and executes every tool via
the existing `AgentTools` permission and approval layer. Long-term memory
(`services/ai/memory.ts`, [Memory](MEMORY.md)) is scoped, bounded and retrieved by the
chat graph before prompts; it is distinct from RAG and from SQLite chat history. No AI
framework code runs in the renderer.

## Boundaries

Zod validates IPC inputs. Native dialogs grant local source and project paths.
Built-in agent tools resolve real paths inside the chosen workspace, reject symlinks and
sensitive/ignored paths, limit reads and search, and never use a shell interpreter.
Writes require an original-content hash, a reviewable diff, and approval by default.
Built-in commands use a fixed executable/argument allowlist, timeouts and bounded output.
MCP and custom Tool calls require approval by default because they can have arbitrary side
effects. Per-capability permissions can explicitly allow or deny them. Their main-process service
validates input and executes either an HTTP(S) request or a separate Node.js process with
bounded output, timeout and cancellation. These user-authored programs are not constrained by
the built-in command allowlist or workspace paths. API header secrets resolve only in main;
known secret values are redacted from results/errors and persisted run activity.

Folder context is optional and temporary in the renderer. Supplied paths still require native
picker authorization at the IPC boundary; folderless runs cannot use built-in project tools.
The same `FolderSelection` component serves Chat and Run Agent. The run stores the selected
path for history without turning it into a default for future requests.

The agent runtime snapshots the configured iteration maximum, counts model turns, and persists
status, timestamps, request, tool/MCP activity and results through `AgentRunDatabase`. It emits
safe progress labels rather than model planning fields. Interrupted persisted runs become
Cancelled when loaded. Native `details` elements provide the history accordion.

At startup `MCPService.autoStart` starts enabled opted-in definitions and records individual
failures. `LibraryService.assertRemovable` checks agent references before Skill, Tool or MCP deletion;
the IPC handler checks before stopping an MCP. These checks also cover disabled agents.

## Providers and UI

Provider interfaces separate chat and embeddings from Ollama. Network I/O is async,
indexing batches yield between files, and native LanceDB operations run asynchronously.
Chat, settings, file libraries, knowledge, MCP and agent UI state are separate Zustand
stores. Markdown renders without raw HTML. Dark/light/system color schemes use native
`color-scheme`. Desktop targets are macOS, Windows and Linux.

See [Capability decisions](CAPABILITIES.md) for Auto/Selected/None modes, restrictions,
permissions, relevance checks and decision traces.
