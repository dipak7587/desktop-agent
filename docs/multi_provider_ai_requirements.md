# Multi-Provider AI Integration — Requirements

**Application:** Electron AI Agent & Chat Application

**Feature:** Multi-provider configuration, model selection, persistence, and visibility

**Default provider:** Ollama

**Status:** Implemented; updated with UI and deletion refinements

## 1. Objective

Allow users to configure one or more AI providers, choose a provider and model independently for each agent, switch the active provider/model directly from chat, and see which provider/model produced each response. Use Ollama by default on first launch.

## 2. Supported Providers

Support the following provider types through an extensible adapter architecture:

| Provider                   | Configuration                                                              |
| -------------------------- | -------------------------------------------------------------------------- |
| Ollama (default)           | Local/remote base URL; no API key required for an unsecured local instance |
| OpenAI                     | API key and provider API base URL                                          |
| Anthropic Claude           | API key and provider API base URL                                          |
| Google Gemini              | API key and provider API base URL                                          |
| OpenRouter                 | API key and base URL                                                       |
| Groq                       | API key and base URL                                                       |
| Custom compatible provider | User-defined name, base URL, auth method, and model IDs                    |

Do not hard-code model names as permanent choices. Retrieve available models when the provider supports discovery; otherwise allow manual entry. Support multiple configurations of the same provider type (e.g., two OpenAI accounts or two Ollama servers), each with a unique configuration ID.

## 3. Settings > AI Providers

Create a dedicated **Settings → AI Providers** page where users can:

- Add, edit, enable, disable, and delete provider configurations. Show the Add/Edit form above the saved list with clear spacing. Close it after a successful save; leave it open on errors.
- Set the application-wide default provider and default model.
- Enter provider name, API base URL, authentication details, connection timeout, and any provider-specific options.
- Test the connection and see actionable success/error feedback.
- Refresh/discover models, manually register a model when discovery is unavailable, and select a default model per provider.
- See which provider is the application default and which providers are connected or unavailable.

On first launch, create an Ollama configuration with a configurable default endpoint of `http://localhost:11434`. Do not assume an Ollama server or any specific model is installed; detect availability and show a setup/error state if needed. Adding a provider must not silently change the application default.

### Provider form fields

| Field               | Required                  | Notes                                                   |
| ------------------- | ------------------------- | ------------------------------------------------------- |
| Configuration ID    | Yes                       | Stable, internally generated unique ID                  |
| Provider type       | Yes                       | Ollama, OpenAI, Anthropic, etc.                         |
| Display name        | Yes                       | User-editable; multiple configurations may share a type |
| API base URL        | Provider-dependent        | Editable, with a sensible default when applicable       |
| API credential      | Provider-dependent        | Must be stored securely, not as plaintext JSON          |
| Enabled             | Yes                       | Controls availability for new requests                  |
| Default model ID    | When a model is available | Must belong to the selected provider configuration      |
| Available model IDs | Yes, may be empty         | Discovered and/or manually registered                   |
| Connection timeout  | Optional                  | Validated positive value                                |

## 4. Persistent Configuration

Persist configuration across application restarts in the Electron user-data directory returned by `app.getPath('userData')`. Keep provider metadata separate from secrets.

Suggested structure:

```text
<electron-user-data>/
├── config/
│   ├── settings.json
│   ├── providers.json
│   └── agents.json
└── data/
    └── conversations.db
```

Example `providers.json` (illustrative only; model IDs depend on installation/account):

```json
{
  "schemaVersion": 1,
  "defaultProviderId": "ollama-local",
  "providers": [
    {
      "id": "ollama-local",
      "type": "ollama",
      "name": "Local Ollama",
      "baseUrl": "http://localhost:11434",
      "enabled": true,
      "defaultModelId": null,
      "modelIds": []
    },
    {
      "id": "openai-main",
      "type": "openai",
      "name": "OpenAI",
      "baseUrl": "https://api.openai.com/v1",
      "enabled": true,
      "credentialRef": "provider-openai-main",
      "defaultModelId": "user-selected-model-id",
      "modelIds": ["user-selected-model-id"]
    }
  ]
}
```

Store API keys using the operating system credential manager or a properly encrypted secrets store. Never save plaintext credentials in `providers.json`, render them in the UI, expose them through renderer IPC, or log them. Restrict filesystem access as appropriate; write configuration atomically and validate it on startup. Include schema versioning and a migration path.

## 5. Agent-Level Provider and Model Selection

Each agent has its own persisted provider configuration ID and model ID, independent of the application default.

**Agent create/edit UI:**

1. Show a provider selector only if **more than one enabled provider configuration** exists.
2. If exactly one enabled provider exists, select it automatically and show **only the model selector**.
3. Load only models belonging to the selected provider configuration.
4. On provider change, clear any incompatible model selection; choose that provider's valid default model if available, otherwise require the user to select one.
5. Show provider and model on each agent card and in its detail view.
6. Persist both identifiers when the agent is saved.

Example agent record:

```json
{
  "id": "coding-agent",
  "name": "Coding Agent",
  "providerId": "ollama-local",
  "modelId": "user-selected-ollama-model-id",
  "systemPrompt": "You are an expert coding assistant."
}
```

When opening an agent chat, initialize its model selection from the agent's saved configuration. Switching the model within that conversation should affect that conversation only; do not overwrite the agent's saved configuration unless the user explicitly selects **Save to Agent**.

## 6. Chat Header: Dynamic Provider and Model Switching

Display provider/model selectors in the chat header, where the original model selector appeared.

- **Multiple enabled provider configurations:** show both provider and model selectors.
- **Exactly one enabled provider configuration:** hide the provider selector; show the model selector only.
- **No enabled provider configurations:** show a setup prompt and block AI requests until a valid configuration is selected.
- When the provider changes, refresh the model selector to show only that provider's models.
- Model changes apply to subsequent requests, without deleting or resetting conversation history.
- The selected provider/model must be captured at send time. Changing the UI while a request is in flight must not misattribute or reroute that existing request.
- Clearly distinguish between a request that is streaming, completed, canceled, or failed.
- Persist the active chat-session selection so the chat can reopen with the same selection, unless the user explicitly resets it.

**Example chat layout:**

```text
Chat header: [Provider ▾] [Model ▾]
Conversation history
Message composer: [Ask anything...] [Send]
```

With one enabled provider, the header shows only `[Model ▾]`. The agent editor follows the same
visibility rule. Do not show redundant “The selected provider is unavailable” or “Select an
available model” labels alongside the selectors; retain recovery controls and block invalid requests.

## 7. Provider/Model Visibility in Chat and Agents

Every assistant response must display the **actual provider display name and model ID used to generate that message**. This metadata is historical, not a reflection of the chat's current selection.

```text
AI Assistant · Ollama / selected-ollama-model
<Response generated using Ollama>

AI Assistant · OpenAI / selected-openai-model
<Response generated using OpenAI>
```

Persist metadata with each message:

```json
{
  "id": "msg-1001",
  "role": "assistant",
  "content": "Example response",
  "providerId": "openai-main",
  "providerNameSnapshot": "OpenAI",
  "modelId": "user-selected-model-id",
  "agentId": "coding-agent",
  "status": "completed",
  "createdAt": "2026-09-21T12:00:00Z"
}
```

Store a display-name snapshot so that deleting or renaming a provider does not make previous chat messages misleading. Agent cards and agent chat headers should show the agent's saved provider/model; if a chat-level override is active, clearly indicate the effective selection for the next message.

## 8. Behavior and Edge Cases

| Condition                                     | Required behavior                                                                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| First application launch                      | Create/select Ollama configuration; detect whether server and models are available                                                                                                                                       |
| Only one enabled provider                     | Hide provider selector in chat and agent edit; show only its model selector                                                                                                                                              |
| More than one enabled provider                | Show both provider and model selectors                                                                                                                                                                                   |
| Selected provider has no models               | Show empty state and Refresh / Add Model actions; block sends until a valid model is selected                                                                                                                            |
| Connection or authentication fails            | Show useful error; retain configuration; allow retry/switch                                                                                                                                                              |
| Provider becomes disabled                     | Do not allow new sends through it; prompt affected chats/agents to select a valid provider                                                                                                                               |
| Provider is deleted                           | Block deletion while any agent (including disabled agents) references the provider; show names/count and Manage agents. Otherwise warn about affected chats, preserve historical metadata, and require chat reassignment |
| Model is removed or unavailable               | Preserve old messages; require a valid model for new sends                                                                                                                                                               |
| Application default changes                   | Affect new chats/agents without overwriting explicit selections in existing chats/agents                                                                                                                                 |
| User switches models during streaming         | Finish/cancel the current request according to UI behavior; use the new selection only on the next send                                                                                                                  |
| Multiple configurations share a provider type | Treat configurations as separate choices using stable IDs                                                                                                                                                                |

## 9. Technical Architecture

```text
Electron Application
├── Renderer
│   ├── Settings → AI Providers
│   ├── Agent Create/Edit + Agent Cards
│   └── Chat + Provider/Model Selectors + Message Badges
├── Preload
│   └── Narrow, validated IPC API
├── Main Process
│   ├── Provider Configuration Service
│   ├── Secure Credential Service
│   ├── Model Registry / Discovery Service
│   ├── Agent Service
│   ├── Chat / Conversation Service
│   └── AI Request Router
├── Provider Adapters
│   ├── Ollama
│   ├── OpenAI
│   ├── Anthropic
│   ├── Gemini
│   ├── OpenRouter / Groq
│   └── Custom Compatible API
└── Persistence
    ├── Provider and app metadata
    ├── Agent configurations
    ├── Conversation database
    └── OS-protected credentials
```

Define a unified provider-adapter contract with methods equivalent to:

```ts
interface AIProviderAdapter {
  testConnection(config: ProviderConfig): Promise<ConnectionResult>;
  listModels(config: ProviderConfig): Promise<ModelInfo[]>;
  generate(request: AIRequest): Promise<AIResponse>;
  stream(request: AIRequest): AsyncIterable<AIStreamEvent>;
  cancel?(requestId: string): Promise<void>;
}
```

The application should route requests through the chosen provider adapter while retaining the native API requirements of each provider. Do not assume OpenAI-compatible APIs, tool calling, image input, JSON output, streaming, or context limits are identical across providers. Expose model capabilities and disable unsupported UI features where necessary.

## 10. Security and Reliability

- Make provider HTTP requests in the Electron main process, not directly from the renderer.
- Enable context isolation and restrict IPC to validated, explicitly allowed operations.
- Never return raw API keys to the renderer or write them to logs, error messages, or crash reports.
- Validate custom base URLs; warn about unencrypted HTTP endpoints and apply appropriate protections against unsafe destinations.
- Handle timeouts, rate limits, authentication errors, disconnected Ollama instances, and canceled requests.
- Keep conversation history and configuration intact when an individual provider fails.
- Do not silently fall back to another provider/model: require an explicit user choice or a previously configured opt-in fallback rule.

## 11. Acceptance Criteria

- [x] Ollama is selected as the default provider on first launch.
- [x] Users can add, edit, test, disable, enable, and delete multiple provider configurations.
- [x] Provider settings survive application restart; credentials are stored securely.
- [x] A model list is fetched or manually configured per provider.
- [x] Each agent can save an independent provider and model.
- [x] Chat header can switch the active provider and model without deleting chat history.
- [x] Both selectors appear only when multiple enabled providers exist; otherwise only the model selector appears.
- [x] Each response shows its actual provider/model even after subsequent switching.
- [x] Each agent card and agent chat shows the agent's provider/model.
- [x] An agent-chat model override does not alter the saved agent unless explicitly requested.
- [x] Missing or disabled providers/models lead to recoverable UI states.
- [x] Existing conversations remain readable when a provider is deleted or renamed.
- [x] Provider-specific errors and capabilities are handled without breaking other providers.

## 12. Suggested Implementation Order

1. Define provider configuration schemas, secure credentials, and persistent storage.
2. Implement Ollama adapter, connection validation, and model discovery.
3. Build Settings → AI Providers and the reusable provider/model selector.
4. Implement the unified request router and additional provider adapters.
5. Add agent-level provider/model storage and selection.
6. Add chat-level model switching, request-time selection, and message metadata.
7. Add historical provider/model labels, edge-case handling, and integration tests.

Implementation and verification notes are maintained in [MULTI_PROVIDER_AI.md](MULTI_PROVIDER_AI.md).
