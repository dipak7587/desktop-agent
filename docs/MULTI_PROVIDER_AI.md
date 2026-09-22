# Multi-provider AI

Open **Settings → AI Providers** to add an account or server. The Add/Edit form appears above the saved list with clear spacing and closes after a successful save. Errors and model discovery leave it open. Save a credential once; subsequent edits leave the stored credential unchanged unless you replace or remove it. Credentials are encrypted by Electron's OS-backed `safeStorage`. If secure storage is unavailable, credential writes fail without a plaintext fallback.

Use **Test connection / Refresh models** to discover models. Providers without discovery can use **Add model** with an explicit model ID. Choose a default chat model per provider, then **Set default** to use that configuration for new chats and agents. Adding a configuration does not change the application default. HTTP endpoints show an unencrypted-connection notice; prefer HTTPS for remote services.

Chat saves its own provider and model selection using selectors in the chat header. In both Chat and agent editors, one enabled provider shows only the model selector; multiple enabled providers show both selectors. Disabled or deleted selections remain visibly invalid until reassigned, and cannot send requests. Each response stores the provider name at send time, model, and completion state. Changing the selectors during generation affects the next request. Partial responses are persisted; interrupted responses are marked canceled on restart. Old messages without provider metadata are labeled as legacy rather than attributed to the current provider.

Agents persist a provider ID and model in their existing Markdown definitions. **Open in Chat** initializes those selections. Conversation overrides leave the definition unchanged; **Save to Agent** explicitly updates it. Provider deletion is blocked while any agent, including a disabled agent, references it. The error shows the agent count and a scrollable list of names, with a **Manage agents** action. The restriction is enforced for main-process settings saves and imports as well. Once no agents reference the provider, deletion previews affected chats and preserves historical responses.

## Storage and migration

- Provider metadata: `<userData>/config/providers.json`, schema version 1.
- General preferences: existing `<userData>/settings.json`.
- Encrypted credentials: existing `<userData>/credentials.json`.
- Agents: existing `<userData>/agents/*.md`.
- Conversations: existing `<userData>/database/app.sqlite`, migrated to schema version 2.

Startup migrates the earlier global/provider settings and encrypts existing plaintext provider keys before replacing settings metadata. Existing agent files and conversations retain their models and receive the legacy application's provider assignment. Provider configuration writes are atomic, serialized, and restricted to owner read/write permissions. Exports contain no credential values.

## Adapter scope

Ollama uses its native chat protocol. Anthropic and Gemini use native endpoints and system-instruction fields. OpenAI, OpenRouter, Groq, and custom compatible configurations use streaming Chat Completions. Custom configurations support no authentication, bearer authentication, or an API-key header. Timeouts, cancellation, authentication errors, and rate limits have recoverable errors; the router does not retry through another provider.

The current chat UI is text-based. Remote adapters do not claim native tool, image, or structured-output support. Agents continue to use the application's validated JSON action loop and capability permissions. Anthropic does not supply embeddings; knowledge indexing requires an embedding-capable application-default provider and a configured embedding model.

Service tests cover migration, key isolation, request snapshots, discovery, native adapter payloads, stream parsing, failures, and restart recovery. Electron tests exercise settings, selectors, message attribution, agent overrides, and restart persistence against a local test server. Live provider/account validation is separate and is not performed by the default test suite.
