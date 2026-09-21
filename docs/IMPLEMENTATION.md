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
