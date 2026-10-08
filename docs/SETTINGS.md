# Settings

Configure workspace preferences, model providers, retrieval, agent execution, and credentials.

## AI Providers

Open **AI Providers** to configure Ollama, OpenAI, Anthropic Claude, Google Gemini, OpenRouter,
Groq, or a custom compatible endpoint. Multiple configurations of the same type are supported.
First launch creates **Local Ollama** at `http://localhost:11434` without assuming a model is installed.

**Add provider** and **Edit** open the form above the saved list. Spacing separates the tabs,
heading, description, form, and saved configurations. **Save provider** closes the form only after
a successful save. **Test connection / Refresh models** keeps it open so you can select a default.
Use **Add model** for manual model IDs when discovery is unavailable. Configure the display name,
endpoint, credential, enabled state, timeout, default chat model, and embedding model. Custom
endpoints support no authentication, bearer tokens, or an API-key header. HTTP shows an
unencrypted-connection notice.

**Set default** affects new chats and agents without overwriting existing selections. Adding a
provider does not change the default. Chat and agent editors show only the model selector when
one provider is enabled, and both selectors when multiple providers are enabled.

**Delete** is blocked while any agent references the provider, including disabled agents. The
error dialog lists the names and count and offers **Manage agents**. Reassign those agents first.
The main process enforces this rule for settings saves and imports too. With no agent references,
deletion asks for confirmation and lists affected chats; historical messages remain readable.

## Landing

Open **Settings → Landing** to edit the empty-chat welcome label, heading, description,
and the title, prompt and icon of each of the three suggestion cards. Each card inserts its
prompt into the chat draft. Upload a PNG, JPEG or WebP logo up to 1 MB, or remove it to use
the default mark. The preview updates while editing; **Save landing** applies your changes.
**Reset landing to defaults** restores the original content in the form; save to apply it.
Landing content and the embedded logo persist locally and are included in workspace backups.

## Models and retrieval

Choose a provider such as Ollama, OpenAI, Anthropic Claude, Google Gemini, OpenRouter,
Groq, or a custom OpenAI-compatible endpoint. For Ollama, set the local endpoint and select
installed chat and embedding models. For hosted providers, add your API key and optional base
URL, then choose the model names your account exposes.

Chat generation needs a chat model; knowledge indexing and semantic retrieval need an embedding
model. An embedding model alone cannot generate chat answers. If a provider does not support
embeddings in this app, use Ollama or another provider with embedding support.

Adjust chunk size, chunk overlap, Top K retrieval count, and folder ignore patterns. Re-index
affected sources after changing the embedding model or chunking settings. Saved Text remains
on disk even when its background indexing fails.

## Preferences and agents

Choose the appearance and general preferences. Configure agent execution limits and approval
behavior. The global maximum-iteration setting is the initial value for new agents and the
fallback for saved definitions without `maxIterations`. Each agent can save its own **Maximum
execution iterations** (1–500); that value takes precedence. Iterations count model turns,
including a final report. Generation iterations are not a separate setting in this release.

The command timeout also bounds custom Tool execution. Custom Tool and MCP calls ask
for approval by default, even with global automatic approval enabled. Per-agent capability
permissions can override this with Always allow or Deny. Built-in project tools operate within a
folder explicitly selected for that run; folder selection is optional for other agent work. Read [Security](SECURITY.md) before enabling automatic approvals or external tools.

## Credentials and local data

Open **Settings → Credentials** to see stored credential names, add or replace a key,
remove a key, or connect/disconnect a `.env` file. Stored values remain masked and are
never returned to the interface. **General** contains the Local data directory information.

## Workspace import and export

Open **Settings → Import / Export** to export the workspace as JSON, YAML, or Markdown, or import
a `.json`, `.yaml`, `.yml`, or `.md` backup. The archive includes settings, chat history, agents,
skills, Saved Text, MCP definitions, custom Tool definitions and JavaScript, and workflows.
Import merges by ID: matching definitions and conversations are replaced; local records absent
from the archive remain.

Backups include chat content and executable MCP/Tool definitions. Literal environment values saved
inside MCP definitions are included; OS-stored credentials and selected `.env` file contents are
not. Provider IDs that match the current installation retain their locally stored credentials.
External project and server folders are not copied, including files excluded by `.gitignore` or
the configured ignore patterns.

Store supported credentials using OS encryption or explicitly select a `.env` file. MCP
definitions reference environment variable names rather than containing secret values. Custom
API Tool headers can use `${NAME}` references resolved at execution time. Keep literal credentials
out of custom code, URLs and headers, since those definition fields are portable.
Secure credential storage is rejected when a supported encryption backend is unavailable.

Existing provider keys are never loaded into the form. Blank credential edits retain the saved
key; **Remove stored credential** removes it. Metadata is stored in `config/providers.json`, separate
from OS-encrypted `credentials.json`. Legacy plaintext provider settings are migrated on startup.
See [Multi-provider AI](MULTI_PROVIDER_AI.md) for storage and migration details.

The Local data section shows the app's data directory. Settings are stored locally; notes,
skills, agents, custom Tools and MCP definitions remain portable files. Chat and agent run
history use SQLite; RAG vectors use LanceDB. MCP auto-start is configured per server in the
MCP editor, separately from the preference to launch the application at login.

See [Chat](CHAT.md), [Knowledge Base](KNOWLEDGE_BASE.md), [Agents](AGENTS.md), [MCP](MCP.md), and [Tools](TOOLS.md).

See [Capability decisions](CAPABILITIES.md) for Auto/Selected/None modes, restrictions,
permissions, relevance checks and decision traces.

## Memory and agent engine (General tab)

- **Enable long-term agent memory** turns scoped long-term memory on or off
  (`memoryEnabled`). With it off, nothing is retrieved or captured. See
  [Memory](MEMORY.md).
- **Allow automatic memory capture** opts into conservative model-driven
  capture (`memoryAutomatic`); explicit “Remember that …” requests always work
  while memory is enabled. Automatic capture never stores secret-shaped
  content.
- **Agent engine** chooses between LangChain `createAgent` (default, stored as `classic`) and
  Deep Agents with todo planning (`deepAgentMode`). Approvals, permissions and execution limits apply
  identically in both engines.
