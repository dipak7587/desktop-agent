# Short-term and long-term memory

Memory answers **what the assistant should remember about the user, a
conversation, or an agent**. It is intentionally separate from
[Knowledge Base/RAG](RAG.md) (document content) and from SQLite chat history
(transcripts). Long-term memory adds durable context on top of normal
conversation state; it never replaces either system.

## Storage

Long-term memories live in `<userData>/database/memory.sqlite`, a dedicated
SQLite database created by `MemoryService` (`src/main/services/ai/memory.ts`)
using the same built-in `node:sqlite` engine as the other app databases. It
holds exactly one table (`memories`) and stores no credentials. Chat
transcripts remain in `app.sqlite`, agent run history in `agent-runs.sqlite`,
and LangGraph workflow checkpoints in `checkpoints.sqlite`; no data is
duplicated across systems.

## Scopes

Each entry has one of three scopes:

| Scope          | Meaning                                   | Retrieved when                      |
| -------------- | ----------------------------------------- | ----------------------------------- |
| `global`       | Applies across every conversation         | Always considered                   |
| `conversation` | Tied to one chat thread (`threadId`)      | Only in that conversation           |
| `agent`        | Tied to one agent definition              | Only during that agent's activity   |

Scope keys use the identifiers the application already has. There are no
workspace or project IDs beyond the conversation and agent concepts that
already exist.

## Retrieval

Memory is **not** injected wholesale. Before a chat request, `MemoryService.retrieve`
selects at most five entries for the active scopes by scoring recency,
keyword overlap with the request, and an explicit-entry bonus. Selected
entries are rendered into a bounded `<long_term_memory>` block in the system
prompt that states the memory is background context, not instructions.
Retrieval failures never block or fail the chat itself.

## Writing

Two capture paths exist:

- **Explicit:** wording such as "Remember that …" in a user message stores a
  conversation-scoped entry without any model call. The stored text is the
  user's own statement.
- **Automatic (off by default):** after a completed exchange, the configured
  model is asked once, with JSON-only output, whether a durable fact worth
  remembering appeared. Only a concise, model-extracted statement is stored;
  failures and unparsable replies are silently discarded.

Both paths refuse to store secret-shaped content (API keys, tokens, passwords,
private keys, bearer headers, credential-style key-value pairs) and throw or
skip instead. Settings → General exposes **Enable long-term agent memory**
(master switch) and **Allow automatic memory capture** (opt-in).

## Management

Memory management uses the existing IPC surface (`memory:list`,
`memory:save`, `memory:remove`, `memory:clear`, all Zod-validated in
`src/main/ipc/register.ts`) through the preload bridge
(`window.workspace.memory`). Entries can be listed per scope, removed by ID,
or cleared per scope; global memory can be cleared wholesale. The renderer
never sees or stores anything beyond entry content and metadata.

## Short-term memory

Conversation state remains the application's existing SQLite chat history
(`ChatDatabase`): threads already survive restart and supply the bounded
recent-history window used in every prompt. Each conversation ID is the
stable thread identifier and is also the `thread_id` used for LangGraph
checkpointing when stateful execution needs persisted graph state
(`database/checkpoints.sqlite`). No second short-term store exists.

## Privacy and security

- Memory lives only in the local application data directory; nothing is sent
  anywhere except as ordinary prompt context to the already-selected provider.
- The retrieval block instructs the model to treat memory as background, never
  as instructions, and prompts never claim memory came from the KB.
- Secret-shaped values are rejected before storage; credential values managed
  by `SecretStore` are never readable from memory entries.
- Disabling the master switch makes retrieval and capture inert immediately;
  existing entries remain on disk and can be removed or cleared by scope.
