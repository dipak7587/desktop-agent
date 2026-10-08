# Implementation and verification record

The original specification is preserved in `desing.md`.

| Phase | Completed implementation                                                           | Principal files                                                   | Verification                                                                  |
| ----- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1     | Electron, React, Vite, Tailwind, sandboxed preload, sidebar                        | `src/main/index.ts`, `src/preload`, `src/renderer`, build configs | Dev startup, build, Electron launch and sandbox checks                        |
| 2     | Ollama discovery, provider abstraction, abortable NDJSON streaming, model selector | `services/ollama`, Chat screen                                    | Real installed-model streaming                                                |
| 3     | SQLite history, messages, rename/delete/search/continue                            | `database/chat.ts`                                                | Close/reopen database; real chat across app relaunch                          |
| 4     | Saved Text Markdown CRUD, search/copy/send-to-chat/import/export                   | `services/filesystem/library.ts`, libraries screen                | Portable file round trip and UI create/edit/delete                            |
| 5     | SKILL.md parsing, accordion, enable/edit/delete                                    | same library service, Skills UI                                   | Parser tests; UI accordion and edit/delete                                    |
| 6     | JSON MCP definitions, SDK stdio start/stop/restart/test, tools and logs            | `services/mcp`                                                    | Real test-server process, discovery, call, ping, redaction and stop           |
| 7     | LanceDB, Ollama embeddings, folder/file sources, ignores, chunking and search      | `services/rag`, Knowledge screen                                  | Native LanceDB and real embeddings                                            |
| 8     | URL fetch/normalization, replacement sync, previews and progress                   | `services/rag/knowledge.ts`                                       | Old-content disappearance, new retrieval, incremental skip and removal        |
| 9     | Markdown agents, model/skills/tools/knowledge/project selection, bounded loop      | `services/agents/agents.ts`                                       | Real model runs against isolated project                                      |
| 10    | Workspace tools, hash-checked edits, diffs, approval, restricted commands          | `services/agents/tools.ts`                                        | Traversal/symlink/command rejection; stale-hash rejection; real approved edit |
| 11    | Themes, shortcuts, settings, OS credentials, import/export, docs, packaging        | settings/security services, renderer, documentation               | Typecheck/lint/service tests/UI workflows and host packaging                  |

Commands used during development: `pnpm install`, `pnpm dev`, `pnpm typecheck`, `pnpm lint`,
`pnpm test`, `LOCALAI_LIVE_TEST=1 pnpm test`, `pnpm build`, `pnpm test:ui`,
`LOCALAI_LIVE_TEST=1 pnpm test:ui`, and packaging checks. Current check results are reported
in the delivery message; do not interpret this table as cross-platform release certification.

Issues found and corrected included split UTF-8 streaming, keyword literal matching, unsafe
frontmatter engine selection, executable-vs-embedding model selection in live tests, MCP output
redaction, settings label selection, stale file approvals, concurrent index creation, and
shutdown persistence. See README for deliberate release limits.

## Verified on 2026-09-18 (macOS arm64)

- TypeScript, ESLint and production build: passed.
- Service suite: 18 tests passed, including native LanceDB/MCP, boundary checks and .env handling.
- Live Ollama service checks: passed for chat, embeddings and an approved agent edit.
- Live Electron workflows: all 5 passed (sandboxing; library/settings persistence; chat restart;
  URL knowledge and RAG chat; real agent diff approval).
- After the packaging bootstrap change, the non-live desktop suite passed again (2 passed,
  3 opt-in live cases skipped in that invocation).
- Development renderer smoke check: passed against the running Vite server.
- Packaged macOS application smoke check: passed with exit code 0, including Knowledge Base startup.
- Packaging fixes: explicit Apache Arrow runtime dependency for LanceDB's peer dependency;
  local ad-hoc signing; early module-loading diagnostics in `src/main/bootstrap.ts`.

The resulting local application is `dist/mac-arm64/LocalAI Workspace.app`. It is ad-hoc signed
for local use, not Developer ID signed/notarized. System Git still requires acceptance of the
machine's Xcode license; Windows and Linux remain unverified build targets.

## Feature update verified on 2026-09-21 (macOS)

The requirements in `newfeature.md` added:

- A Tools sidebar and file-backed definitions for API calls and Node.js/JavaScript logic,
  validated parameters, test execution, bounded output/timeouts, and approved agent calls.
- Optional, removable/reselectable folder context shared by Chat and Run Agent;
  `/agent <name>` can run configured instructions without a task or folder.
- MCP auto-start configuration with startup error reporting, plus dependency checks that
  block deletion of MCPs and Tools referenced by any agent.
- Confirmed multi-agent deletion, per-agent maximum execution iterations, and separate
  Running/Completed/Failed/Cancelled/Max iterations reached statuses.
- Application-generated Thinking/Planning progress and persistent accordion run history,
  including timings, iteration counts, request/folder, tool/MCP activity, results and errors.

No agent-generation workflow exists, so no generation-iteration control was introduced.
JavaScript executes directly; TypeScript transpilation is not implemented.

Verification for this implementation: `pnpm typecheck`, `pnpm lint`, `pnpm build`, and
`pnpm test` passed (37 tests across 14 files). `pnpm test:ui` passed 4 non-live UI tests;
3 opt-in live Ollama UI tests were skipped. Live Ollama execution and packaging were not
reverified for this feature update. These results describe the implementation run preceding
this documentation update, not a new execution of those checks for documentation-only edits.

The UI checks caught and led to a fix for YAML serialization of optional fields passed as
`undefined`; regression coverage was added. See [Tools](TOOLS.md), [Agents](AGENTS.md),
[Chat](CHAT.md), [MCP](MCP.md), and [Security](SECURITY.md) for current behavior.

## Capability routing verified on 2026-09-21 (macOS)

Implemented the separate `new-feature.md` specification: centralized capability decisions and
routing, Auto/Selected/None modes, per-type restrictions, user instruction restrictions,
per-capability permissions, optional decision traces, and agent editor controls. Skills and
knowledge are lazy actions rather than automatically loaded context. Regular Chat also gates
selected skills and knowledge. Legacy definitions retain their exact selections.

`pnpm typecheck`, `pnpm lint`, `pnpm test` (65 tests across 15 files), `pnpm build` and
`pnpm test:ui` (4 passed, 3 opt-in live tests skipped) passed. The settings screenshot was
visually inspected. The new deterministic tests mock model relevance judgments; live Ollama
language understanding and packaged builds were not reverified. See
[Capability decisions](CAPABILITIES.md) for behavior and limitations.

## Normal Chat KB correction verified on 2026-09-21

Knowledge relevance checks now receive selected source names/collections and recent conversation,
rather than only the generic label “Selected knowledge”. The policy distinguishes private and
project-specific questions from general knowledge. Retrieval status and grounding instructions
are passed to the answer model, and activity reports actual passage counts or empty results.
Unindexed selections are identified before attempting retrieval.

Typecheck, lint, build and 71 tests passed. The targeted live Electron test for URL indexing,
semantic search and RAG Chat passed with real local Ollama and embeddings: the response contained
the document's private codename and showed one retrieved source. This does not guarantee every
model relevance judgment; the regression tests additionally cover source/collection/all scopes,
follow-up context and skipped, empty and unavailable knowledge.

## Selected-KB query scope correction verified on 2026-09-21

Reproduced the reported `give me chat details` failure: a ready `agent-desktop` source was
skipped by the relevance decision, and the response interpreted the query as personal chat
history. A read-only search confirmed that the index contained relevant CHAT.md passages.
Normal Chat now supplies its selected knowledge scope as the subject for ambiguous topical
queries to both the relevance check and response prompt. Explicit restrictions and unrelated
general questions retain their previous behavior.

Typecheck, lint, build and 71 tests passed. A new live Electron regression test with real Ollama
and embeddings selects a folder named `agent-desktop`, submits the exact reported wording,
and verifies a retrieved source and an answer about documented Chat features. The test passed;
its setup waits for automatic model discovery before indexing the fixture.

## LangChain/LangGraph/Deep Agents migration (2026-09)

Historical implementation record: the bridge and JSON-action loop described below have
been replaced. See [LangChain migration](LANGCHAIN_MIGRATION.md) for the current implementation.

Implemented the AI-stack migration specified in
`docs/Existing Electron App Migration Prompt — No Directory Restructure.md` by modifying the
existing services in place. No directory restructure; no existing file was renamed.

**Current architecture analysis.** Provider creation happens in
`services/ollama/provider.ts` (`createLLMProvider`/`createEmbeddingProvider` over
`OllamaLLMProvider`, `OpenAICompatibleLLMProvider`, `GoogleLLMProvider`,
`AnthropicLLMProvider`); model calls in `services/ollama/chat.ts` (`ChatService`) and
`services/agents/agents.ts` (bounded JSON-action loop); provider resolution in
`services/providers/router.ts` (`ProviderRouter.capture`); persistence in `database/*`
using built-in `node:sqlite`; approvals and permissions in `services/agents/tools.ts` and
`services/agents/capabilities.ts`; IPC in `ipc/register.ts` with Zod validation.

**Reused.** All provider adapters, credential handling (`SecretStore`), capability routing
and permission model, `AgentTools` (workspace path guards, hash-checked writes, diffs,
allowlisted commands), MCP service, RAG/Knowledge, chat persistence, workflows, settings,
and the entire renderer.

**Added (new files only, in existing conventions).**

- `services/ai/langchain-model.ts` — `AppChatModel`, a LangChain `BaseChatModel` wrapping
  the existing `LLMProvider` abstraction, with native tool-call mapping (`bindTools` →
  OpenAI-style function definitions, streamed `tool_call_chunks`, parsed provider
  `tool_calls`). All frameworks now invoke models through the existing adapters, so every
  configured provider (Ollama default) is usable from LangChain/LangGraph/Deep Agents.
- `database/checkpoints.ts` — `CheckpointDatabase`, a LangGraph `BaseCheckpointSaver`
  backed by built-in `node:sqlite` (same engine/pattern as `chat.ts`), storing serialized
  checkpoints and pending writes under `database/checkpoints.sqlite`. Avoids the native
  `better-sqlite3` dependency and its Electron ABI/packaging risk.
- `services/ai/memory.ts` — `MemoryService`: long-term memory (global/conversation/agent
  scopes) in `database/memory.sqlite`, with recency/keyword retrieval capped at five
  entries, a bounded `<long_term_memory>` system-prompt block, explicit "remember …"
  capture without a model call, opt-in conservative automatic capture, and refusal to
  store secret-shaped values. Separate from RAG and chat history. Settings:
  `memoryEnabled`, `memoryAutomatic` (General tab).
- `services/ai/deep-agents.ts` — `DeepAgentEngine`: optional Deep Agents execution for
  existing agent definitions with a selected folder. Agent Markdown, model selection and
  per-capability permissions are translated at runtime; tools execute through the existing
  `AgentTools` (approval flow included), so no parallel tool system exists. Enabled by
  `deepAgentMode: 'deep'` in Settings → General; the classic loop remains the default.

**Modified.** `chat.ts` injects retrieved memory and captures after completion;
`agents.ts` routes opted-in runs to the deep engine; `index.ts` wires the new services and
closes the checkpoint store on quit; `ipc/register.ts`, `preload/index.ts` and
`shared/api.ts` add the `memory:*` handlers; `shared/types.ts`/`schemas.ts` add the three
settings fields and memory entry type; `settings.tsx` adds two checkboxes and an engine
selector reusing existing components and styles.

**Dependencies.** Added only `langchain`, `@langchain/core`, `@langchain/langgraph`,
`@langchain/langgraph-checkpoint`, `deepagents`, `langsmith` (peer). No per-provider
LangChain packages; no `better-sqlite3`.

**Verification.** `pnpm typecheck`, `pnpm lint`, `pnpm build` and `pnpm test` pass
(115 passing; the single `library.test.ts` failure and the `libraries.tsx` lint error are
pre-existing on master and reproduce without these changes). New tests in
`tests/ai-stack.test.ts` (memory CRUD/secret refusal/retrieval/kill switch; checkpoint
put/getTuple/putWrites/list/deleteThread; adapter tool binding) and `tests/deep-agent.test.ts`
(deep run executes through `AgentTools`; sensitive operations surface the existing approval
callback and a rejection blocks the write). Dev-launch smoke test with an isolated data
dir: app boots, all databases including the two new ones are created, streaming chat errors
only because no Ollama server exists in the sandbox. Live-model chat, packaged builds and
UI tests were not re-run in this environment.

**Remaining.** LangGraph checkpointing is wired and persisted but no shipped workflow yet
invokes a graph with it (the integration point is ready for future stateful workflows);
deep-agent subagent spawning uses harness defaults; memory management is IPC-first with no
dedicated Settings panel yet.

## Full LangGraph conversion (2026-09, phase 2)

Converted the application to be fully LangChain-native with LangGraph as the execution
engine, still without restructuring directories or changing UI/data/permissions.

**One model entry point.** `AppChatModel` is now the only path to model traffic. It gained
constructor fields (`disableStreaming`, `format`), a `complete()`-backed non-streaming path
(JSON-action and tool-call-critical flows), and an exported `toProviderMessages` converter.
Every call site that previously streamed the provider directly (`ChatService`, the agent
loop, `modelEvaluator` capability decisions, memory `maybeCapture`) now goes through
LangChain calls (`invoke`/`stream`) on this model.

**Chat turns as a LangGraph graph.** `services/ai/chat-graph.ts` (`ChatTurnGraph`) is a
compiled `StateGraph` with `prepare → retrieve → remember → generate → persist` nodes over
the existing capability router, knowledge search, memory service and history windowing.
`ChatService` delegates generation to it: same admission control, persistence, events and
cancellation; the conversation id is the LangGraph `thread_id`, so every turn checkpoints
durable state in `checkpoints.sqlite` via `CheckpointDatabase` (per-thread channels hold
only serializable data; live handles ride in `configurable`). Streaming tokens flow through
the model's stream into the same `updateMessage` + `streaming` events as before.

**Agent loop as a LangGraph graph.** `services/ai/agent-graph.ts` (`AgentLoopGraph`)
reimplements the bounded JSON-action loop as `plan ⇄ act` conditional-edge nodes: `plan`
asks the model for one JSON action (AppChatModel invoke, JSON format), `act` executes the
capability through the existing `CapabilityRouter` (permissions, approvals, trace events,
run persistence and tool history unchanged), and the graph ends on `final`, the iteration
cap (existing status) or abort. `AgentService.loop` now delegates to it.

**Checkpointer.** `CheckpointDatabase` is passed to both the chat graph (via
`ChatServiceOptions`) and Deep Agents, making SQLite-backed LangGraph state the standard
persistence for all graph execution.

**Verification.** `pnpm typecheck`, `pnpm build` and `pnpm lint` pass (the single
`libraries.tsx` lint error is pre-existing). `pnpm test` runs 120 tests with only the
pre-existing `library.test.ts` mkdir-race flake failing. New `tests/langraph-integration.test.ts`
covers threaded chat turns through the SQLite checkpointer (distinct checkpoints per turn,
`deleteThread`), the plan/act graph (completion, iteration cap, tool-run persistence) and
activity-event visibility through the graph path.


## Native LangChain agent runtime (2026-09-27)

Replaced the JSON plan/act loop with `createAgent`, removed the production custom model
bridge and chat stream parsers, and adopted official LangChain provider integrations.
Both standard and Deep engines share native capability tools, run lifecycle, model-turn
limits and SQLite checkpoints. See [the migration report](LANGCHAIN_MIGRATION.md) for
findings, implementation boundaries and behavior changes.

Typecheck, lint, build and 140 service tests passed. Electron tests: 6 passed, 4 live-model
cases skipped. Live inference and packaged releases were not revalidated.
