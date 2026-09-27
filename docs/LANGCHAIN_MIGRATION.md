# LangChain runtime migration

## Findings

The previous implementation used LangChain models and LangGraph nodes, but the default
agent still parsed a custom `{tool,args}` / `{final}` JSON protocol and implemented its
own plan/act transitions. Merely installing LangChain or wrapping that loop in a graph
did not replace agent orchestration. Its optional Deep Agents path used a separate tool
list, did not enforce all capability selections, counted streamed graph updates as
iterations, emitted the definition ID instead of the run ID, and used the startup model
provider instead of each run's captured provider. Remote chat adapters explicitly rejected
native tool calls. The custom model bridge also lost provider tool-call IDs.

## Implemented architecture

| Concern                            | Implementation                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Standard agent loop                | LangChain `createAgent` in `src/main/services/ai/agent-graph.ts`                                              |
| Advanced agent harness             | `createDeepAgent` plus `todoListMiddleware`, sharing the standard runtime's tools and lifecycle               |
| Agent iteration limit              | Built-in `modelCallLimitMiddleware`, with the existing Max iterations reached status                          |
| Tools                              | LangChain `tool` with schemas for built-ins, custom Tools, MCP, skill loading and knowledge search            |
| Provider inference                 | Official `ChatOllama`, `ChatOpenAI`, `ChatAnthropic`, `ChatGoogle` integrations                               |
| Streaming and native tool protocol | Official provider integrations; custom SSE/NDJSON chat parsers and production `AppChatModel` removed          |
| Context window                     | LangChain `trimMessages` and approximate token counting; preserve the task and complete recent tool exchanges |
| Relevance/memory extraction        | LangChain models and `StructuredOutputParser`                                                                 |
| Normal Chat                        | Existing application LangGraph pipeline, streaming through official models                                    |
| Checkpoints                        | Existing SQLite LangGraph saver, wired into both agent engines with unique run thread IDs                     |
| Run history                        | Existing redacted tool/event records, actual model-turn counts, final status and checkpoint deletion          |

A tool-capable model is required for native tool execution. Plain Chat continues to work
with text-only models. Agent definitions, saved provider IDs, capability IDs, settings and
file/database layout remain compatible. `deepAgentMode: 'classic'` now selects `createAgent`;
it no longer selects the old JSON loop. Folderless Deep runs use allowed non-workspace
capabilities through the same boundary as standard runs.

Tool-call schemas and results retain their native message structure and correlation IDs.
Provider-safe tool names include a deterministic hash to avoid collisions between MCP,
custom and built-in IDs. Application tools execute sequentially within a model turn to
preserve approval ordering and file hash checks. Error/rejection results feed back to the
model; a rejected change never writes a file. The iteration limit counts agent model
turns, not individual tools, graph nodes, relevance evaluations or memory extraction.

## Application logic that remains

LangChain does not replace Electron IPC, OS credential storage, user-selected folders,
file hashes/diffs, custom Tool execution, MCP connections, capability permissions,
relevance policy, SQLite history, knowledge indexing/embeddings, scoped memory CRUD or
saved-workflow scheduling. Those application services remain behind LangChain tools and
models. Removing them would remove product behavior and permission enforcement.
There is no custom agent decision loop or production custom chat model fallback.

Deep Agents' default filesystem/shell/delegation tools are hidden and rejected at the tool
boundary; they cannot bypass configured capabilities. Deep mode adds internal todo
planning; configured Workflows remain the supported multi-agent execution mechanism.
The application does not claim unrestricted Deep harness delegation. Checkpoints are
persisted, but restarting the app cancels interrupted runs rather than replaying side
effects automatically.

## Validation

Regression coverage includes native tool round trips for all four model integrations,
multiple calls to the same tool, provider tool IDs, custom authentication, UTF-8 streaming,
redacted HTTP errors, approval acceptance/rejection, unavailable tools, malformed
arguments, cancellation, model-turn exhaustion, runs beyond the default LangGraph step
limit, SQLite checkpoint reopening, and existing Chat/MCP/workflow behavior.

Provider protocol tests use deterministic HTTP fixtures with real LangChain integrations.
They do not establish live-account/model compatibility. Live Ollama and hosted-provider
checks remain separate from the default suite. See the delivery report for executed
commands and results.

Verified on 2026-09-27:

- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm test`: 140 passed across 21 files; live-provider checks remain opt-in.
- `pnpm build`: passed (upstream Zod comment-annotation warnings only).
- `pnpm test:ui`: 6 passed, 4 opt-in live-model tests skipped.
- Targeted source formatting and `git diff --check`: passed.

Validation also corrected the existing test-directory creation race, removed one unused
icon import, and updated an outdated UI assertion to check dependency errors in the
confirmation dialog. Live hosted accounts, live Ollama inference and packaged releases
were not validated in this run.

## Official references

- [LangChain agents](https://docs.langchain.com/oss/javascript/langchain/agents)
- [Built-in middleware](https://docs.langchain.com/oss/javascript/langchain/middleware/built-in)
- [ChatOllama](https://docs.langchain.com/oss/javascript/integrations/chat/ollama)
- [Deep Agents customization](https://docs.langchain.com/oss/javascript/deepagents/customization)
