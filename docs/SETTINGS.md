# Settings

Configure workspace preferences, Ollama models, retrieval, agent execution, and credentials.

## Models and retrieval

Set the Ollama endpoint and choose installed chat and embedding models. Chat generation needs
a chat model; knowledge indexing and semantic retrieval need an embedding model. An embedding
model alone cannot generate chat answers.

Adjust chunk size, chunk overlap, Top K retrieval count, and folder ignore patterns. Re-index
affected sources after changing the embedding model or chunking settings. Saved Text remains
on disk even when its background indexing fails.

## Preferences and agents

Choose the appearance and general preferences. Configure agent execution limits and approval
behavior. The global maximum-iteration setting is the initial value for new agents and the
fallback for saved definitions without `maxIterations`. Each agent can save its own **Maximum
execution iterations** (1–50); that value takes precedence. Iterations count model turns,
including a final report. Generation iterations are not a separate setting in this release.

The command timeout also bounds custom Tool execution. Custom Tool and MCP calls ask
for approval by default, even with global automatic approval enabled. Per-agent capability
permissions can override this with Always allow or Deny. Built-in project tools operate within a
folder explicitly selected for that run; folder selection is optional for other agent work. Read [Security](SECURITY.md) before enabling automatic approvals or external tools.

## Credentials and local data

Store supported credentials using OS encryption or explicitly select a `.env` file. MCP
definitions reference environment variable names rather than containing secret values. Custom
API Tool headers can use `${NAME}` references resolved at execution time. Keep literal credentials
out of custom code, URLs and headers, since those definition fields are portable.
Secure credential storage is rejected when a supported encryption backend is unavailable.

The Local data section shows the app's data directory. Settings are stored locally; notes,
skills, agents, custom Tools and MCP definitions remain portable files. Chat and agent run
history use SQLite; RAG vectors use LanceDB. MCP auto-start is configured per server in the
MCP editor, separately from the preference to launch the application at login.

See [Chat](CHAT.md), [Knowledge Base](KNOWLEDGE_BASE.md), [Agents](AGENTS.md), [MCP](MCP.md), and [Tools](TOOLS.md).

See [Capability decisions](CAPABILITIES.md) for Auto/Selected/None modes, restrictions,
permissions, relevance checks and decision traces.
