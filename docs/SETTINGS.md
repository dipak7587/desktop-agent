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
behavior. Agents operate within the selected project folder using the tools enabled in their
definition. Read [Security](SECURITY.md) before enabling automatic approvals or external tools.

## Credentials and local data

Store supported credentials using OS encryption or explicitly select a `.env` file. MCP
definitions reference environment variable names rather than containing secret values.
Secure credential storage is rejected when a supported encryption backend is unavailable.

The Local data section shows the app's data directory. Settings are stored locally; notes,
skills, agents, and MCP definitions remain portable files, while chat history and RAG vectors
use their respective local databases.

See [Chat](CHAT.md), [Knowledge Base](KNOWLEDGE_BASE.md), [Agents](AGENTS.md), and [MCP](MCP.md).
