# LocalAI Workspace

LocalAI Workspace is a desktop application that brings AI chat, project assistance, personal knowledge, and reusable automation into one place. You can talk to a model, ask questions about your documents, create specialist agents, and connect tools that perform tasks.

The application is built with Electron, React, and TypeScript. Your workspace data is stored locally. You can use a local model through Ollama or connect a hosted AI provider. A cloud account is not required for local use; hosted providers require their own connection and credentials.

## Contents

- [What you can do](#what-you-can-do)
- [Key concepts](#key-concepts)
- [Install and start](#install-and-start)
- [Your first conversation](#your-first-conversation)
- [Application sections](#application-sections)
- [Common workflows](#common-workflows)
- [Built-in content and examples](#built-in-content-and-examples)
- [Providers and credentials](#providers-and-credentials)
- [Data, privacy, and backups](#data-privacy-and-backups)
- [Troubleshooting](#troubleshooting)
- [Development and packaging](#development-and-packaging)
- [Current limitations](#current-limitations)
- [Detailed documentation](#detailed-documentation)

## What you can do

| Goal                                                           | Where to start                         | What you need                                                      |
| -------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| Ask questions, draft text, or explain a topic                  | Chat                                   | A configured chat model                                            |
| Ask questions about your own notes and documents               | Saved Text / Knowledge Base, then Chat | An embedding model, indexed content, and a chat model              |
| Explain or update a local software project                     | Code                                   | A selected project folder and a supported local inference endpoint |
| Reuse instructions such as a writing style or review checklist | Skills                                 | A saved skill selected for the task or agent                       |
| Create a specialist assistant                                  | Agents                                 | Instructions, a chat model, and any required capabilities          |
| Call an API or run reusable logic                              | Tools                                  | A trusted tool definition and its dependencies or credentials      |
| Connect external tools and services                            | MCP                                    | A working MCP server or endpoint                                   |
| Run several agents or tools as a process                       | Workflows                              | Configured agents/tools and a valid workflow                       |

For example, you can index product documentation, create a support agent that uses it, and connect a delivery-status tool. The agent can then combine document knowledge with a real tool result. The [order-support example](examples/order-support/README.md) demonstrates this pattern.

## Key concepts

| Term                 | Plain-language explanation                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Provider             | The service that runs your AI model, such as Ollama or OpenAI.                                                               |
| Chat model           | The model that reads your request and generates an answer.                                                                   |
| Embedding model      | A model that turns text into numerical representations so related documents can be found. It does not generate chat answers. |
| Knowledge Base / RAG | Your indexed reference documents. RAG means retrieving relevant passages and giving them to the model when answering.        |
| Skill                | Reusable instructions describing how a task should be done. A skill is not an executable tool.                               |
| Tool                 | An executable capability, such as an API request, calculation, or project operation.                                         |
| MCP                  | Model Context Protocol: a standard way to connect tool servers to the application.                                           |
| Agent                | A saved assistant configuration combining instructions, a model, and permitted capabilities.                                 |
| Workflow             | A process that coordinates agents and tools, passing results between steps.                                                  |
| Code workspace       | A saved connection to a local project folder that can be linked to a conversation.                                           |
| Memory               | Selected durable context about a user, conversation, or agent. It is separate from documents and chat transcripts.           |

## Install and start

### Requirements

- Node.js **22.16 or newer**.
- **pnpm 11**; the repository specifies `pnpm@11.5.2`.
- Ollama if you want local inference, or credentials for a supported hosted provider.
- Enough memory and storage for the local models you choose. Requirements depend on the model.

Run these commands from the repository directory:

```sh
pnpm install
pnpm dev
```

Use pnpm for installation so the repository's dependency patches are applied. The development command starts Vite and opens the Electron application.

### Option A: Use a local model

Install Ollama separately, then start its server if it is not already running:

```sh
ollama serve
```

In another terminal, download a chat model suitable for your machine. The following is an example, not a required model:

```sh
ollama pull qwen3-coder:latest
```

If you also want document indexing and semantic search, download an embedding model:

```sh
ollama pull nomic-embed-text
```

In **Settings → AI Providers**, configure Ollama, discover its installed models, and select a default chat model. The default Ollama endpoint is `http://localhost:11434`. Configure the embedding model in the knowledge settings before indexing documents.

Do not start a second Ollama server if one is already running. The application does not assume that a model is installed on first launch.

### Option B: Use a hosted provider

Open **Settings → AI Providers**, add the provider, save its API key, and discover or register the model you want to use. Supported provider types include OpenAI, Anthropic Claude, Google Gemini, OpenRouter, Groq, and custom compatible endpoints.

Hosted inference needs network access and may incur charges from that provider. Direct Code workspace conversations require a supported local endpoint; ordinary Chat and other saved-agent paths support hosted providers. See [provider configuration](docs/MULTI_PROVIDER_AI.md) and [Code runtime details](docs/CODE.md).

## Your first conversation

1. Open **Chat** and create a conversation.
2. Select your provider and chat model in the header.
3. Leave the capability checkboxes unchecked for a simple model conversation.
4. Enter a request, such as “Explain this application in simple terms.”
5. Click the send arrow or press **Cmd/Ctrl+Enter**.

With all modes unchecked, the model receives your message and bounded conversation history, without automatic tools, knowledge retrieval, agent instructions, or memory. Enable the relevant mode when you want those features. Explicit slash commands remain available regardless of the checkboxes.

Conversations are saved locally and can be continued after restarting. You can rename, search, delete, copy responses, regenerate, or stop an active response.

| Shortcut            | Action                        |
| ------------------- | ----------------------------- |
| Cmd/Ctrl+Enter      | Send the current message      |
| Cmd/Ctrl+N          | Create a new chat             |
| Cmd/Ctrl+K          | Open global search            |
| Escape              | Cancel active chat/agent work |
| `/` in the composer | Show available commands       |

Use `/help` for command help, `/clear` to clear the current conversation, `/agent` to select an agent, `/tools` to select a tool, `/mcp` to select a server or tool, and `/code` to choose a saved project folder. See [Chat](docs/CHAT.md) for command syntax and mode behavior.

## Application sections

### Chat

Use Chat for everyday questions, writing, research over indexed documents, and explicit agent/tool requests. Capability controls determine which additional features are available for ordinary messages. Review tool activity and approve or reject operations in the conversation when requested.

### Saved Text

Create Markdown or plain-text notes with a title and body. Notes can be edited, copied, imported, exported, or sent to a new chat. Saved Text automatically updates its own knowledge collection when indexing is available.

Saving a note does not mean every chat will use it. Enable knowledge context and select **Collection: Saved Text** or **All knowledge** to retrieve it. **No knowledge context** does not search saved notes.

### Knowledge Base

Add `.md` or `.txt` files, a folder containing those files, or a URL. Select **Sync / Re-index**, then inspect the normalized content and search results. Choose the relevant source or collection in Chat to use it as reference material.

Semantic search requires an embedding model. Re-index after changing the embedding model or chunk settings. URL ingestion fetches the selected page; it is not an automatic website crawler or a JavaScript browser.

### Skills

Store reusable Markdown instructions, such as “Use plain language and include a short example.” Enable the skill and select it when configuring an agent or using the relevant Chat capability. Skills guide behavior; tools perform actions.

### Tools

Create reusable logic or API calls, define input parameters, and test the result before attaching the tool to an agent. The current implementation includes a builder and TypeScript source editing, with TypeScript transpilation for supported tool modules.

Custom tools execute trusted code or make network requests. They can have effects outside the built-in project tools' folder boundaries. Referenced tools cannot be deleted until their agent references are removed.

### MCP

Connect local **stdio** servers or remote **Streamable HTTP** servers. Configure the connection, start or test it, and inspect discovered tools and logs. Local servers need their executable and dependencies installed separately. Remote servers need a reachable endpoint and any required authentication.

Auto-connect/start is opt-in. Select MCP capabilities in Chat or agent configuration to use them. A server referenced by an agent cannot be deleted until the reference is removed.

### Hooks

Configure reusable logic around agent execution events. Hooks are an advanced feature for modifying or checking execution behavior. Review [Agent hooks](docs/AGENT_HOOKS.md) for supported events, inputs, outputs, and execution restrictions.

### Agents

Create a specialist assistant with a name, instructions, provider/model, skills, tools, and knowledge sources. Set an iteration limit to bound the number of model turns. Choose a project folder when the task requires project operations; folderless tasks are also supported.

Run the agent from its section or select it with `/agent` in Chat. Inspect its activity, results, status, and persisted run history. Review proposed changes when approval is requested. Capability modes **Auto**, **Selected**, and **None**, along with per-capability permissions, control what the agent may use.

### Workflows

Use **Workflows → New workflow** to coordinate multiple steps. The **Default** editor provides an agent graph builder. **Dynamic** editors provide Form, Markdown, JSON, and YAML representations for structured workflows.

Dynamic workflows support agent and tool steps, sequences, parallel branches, loops, conditions, switches, bounded repetition, retries, and hooks. Later steps can consume earlier outputs. See [Declarative workflows](docs/DECLARATIVE_WORKFLOWS.md) for exact syntax and execution limits.

### Code

Add a local folder through the native folder picker and link it to a conversation. Use `/code` in Chat to choose a saved folder without leaving the composer. Enable Code mode for ordinary project requests, or use the explicit command flow.

Start with a request such as “Explain the structure of this project and identify its test command.” The runtime can inspect eligible project files and propose changes using guarded tools. Read-only inspection does not normally require approval; changes and commands retain their permission rules, and explicit denials remain enforced.

Direct Code chat uses DeepAgents through ACP and requires a configured local inference endpoint. Folder links and conversation history persist, but the live ACP session itself does not survive an application restart. See [Code](docs/CODE.md) for supported endpoints, permissions, and implementation status.

### Settings and memory

Manage providers, credentials, appearance, application and landing-page preferences, knowledge settings, execution limits, import/export, and memory. Settings also shows the exact local data directory.

Long-term memory and automatic memory capture have separate switches. Automatic capture is opt-in. Memory does not replace your chat history or knowledge documents, and pure model chat with all capability modes unchecked skips memory. See [Memory](docs/MEMORY.md) for scope and management.

## Common workflows

### Ask questions about your documents

1. Configure a chat model and an embedding model.
2. Add documents under **Knowledge Base**, or create a note in **Saved Text**.
3. Wait for indexing to complete; use **Sync / Re-index** for knowledge sources.
4. In Chat, enable KB and choose the appropriate source or collection.
5. Ask a specific question and inspect the answer's supporting source context.

Example: “Using the product guide, explain how a customer resets their account.”

### Create a reusable writing assistant

1. Create a Skill containing your writing rules.
2. Create an Agent with a clear task, such as drafting customer-facing release notes.
3. Select the skill and a chat model; add knowledge only if needed.
4. Run the agent with a concrete request and inspect the output.

Example: “Turn these changes into release notes with a short summary and three bullets.”

### Review and update a project

1. Configure a supported local chat model with tool-calling capability.
2. Add the project in **Code** and link it to Chat.
3. Enable Code mode and ask the assistant to explain the relevant files first.
4. Request a specific change and review any proposed diff or command approval.
5. Inspect the verification output before treating the task as complete.

Selecting a folder does not grant unrestricted access. Protected paths, capability permissions, and execution limits still apply.

## Built-in content and examples

The `built-in/` directory supplies bundled agents, skills, tools, MCP definitions, knowledge documents, and initial settings. These appear in **Built-in** groups and are read-only in the application. Personal definitions remain editable.

Samples include a Workspace Guide, a calculator, writing skills, Miniature Video Studio, and Riddle and Joke Studio. The video agent prepares scripts and generation prompts; it does not render videos unless you connect a suitable external tool.

Developers can change bundled content before building the app. Restart development after changes, or rebuild the installer for distribution. Existing users retain saved settings; bundled General and Landing defaults initialize new user-data directories. See [Built-in content](built-in/README.md).

For complete configurations, start with [Examples](examples/README.md), [Order support](examples/order-support/README.md), [Governance review](examples/governance-review/README.md), or [Video story studio](examples/video-story-studio/README.md).

## Providers and credentials

Multiple provider configurations, including multiple accounts or servers of the same type, are supported. Chat and embeddings can use different models. A provider that supports chat does not necessarily support embeddings in this application.

Store secrets through **Settings → Credentials** or explicitly select an environment file. References such as `${API_TOKEN}` resolve at execution time in supported configuration fields, in this order:

1. OS-encrypted stored credentials.
2. The environment file selected in Settings.
3. The application process environment.

Embedded references such as `Bearer ${API_TOKEN}` are supported in applicable fields. Exports retain placeholders instead of resolving them. Custom code reads environment values through `process.env`; source code is not interpolated.

Keep authentication values in tool environments or MCP headers. Environment references used in agent or skill instructions become part of the prompt sent to the model. Secure credential storage is rejected when a supported OS encryption backend is unavailable.

## Data, privacy, and backups

The default data directory is `~/.local-ai-workspace`, separate from this repository. Check Settings for the actual path.

| Data                                                       | Storage                                  |
| ---------------------------------------------------------- | ---------------------------------------- |
| Conversations and Code workspace metadata                  | SQLite in `database/app.sqlite`          |
| Agent execution history                                    | `database/agent-runs.sqlite`             |
| Long-term memory                                           | `database/memory.sqlite`                 |
| LangGraph checkpoints                                      | `database/checkpoints.sqlite`            |
| Personal agents, skills, notes, tools, and MCP definitions | Local portable definition files          |
| Knowledge vectors                                          | Local LanceDB under `rag/lancedb`        |
| Provider configuration                                     | `config/providers.json`                  |
| Stored credentials                                         | Separate OS-encrypted credential storage |

Local storage does not mean every operation stays offline. Hosted models receive the conversation and selected context needed for inference. Remote MCP servers, API tools, and URL sources make network requests. Local Ollama use can keep inference on your machine when all selected capabilities are local.

Open **Settings → Import / Export** to export or import a supported workspace archive. Import merges by ID: matching records are replaced, while unrelated local records remain. Archives can contain conversation content and executable definitions. Stored credentials, selected environment-file contents, external project folders, and bundled definitions are not included. Literal secrets embedded in definitions can be included, so use credential references.

An application export is not a complete copy of every runtime file or your projects. See [Settings](docs/SETTINGS.md) for archive contents. If making a separate filesystem backup of the data directory, close the application first.

## Troubleshooting

| Problem                                        | What to check                                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| The app opens, but Chat cannot answer          | Select an available chat model and verify its provider connection. An embedding model alone cannot answer.                      |
| Ollama cannot connect                          | Check that Ollama is running and the endpoint matches Settings. Avoid starting a duplicate server.                              |
| No local models appear                         | Download a model in Ollama, then refresh/discover models in AI Providers.                                                       |
| Saved notes are not used in answers            | Enable KB and select Saved Text or All knowledge; check indexing status.                                                        |
| Indexing fails                                 | Verify the embedding provider/model and connection, then retry Sync / Re-index.                                                 |
| Code rejects the selected provider             | Direct Code chat requires a supported local endpoint. See the Code guide.                                                       |
| A model answers but cannot use tools           | Check model tool support, enabled modes, selected capabilities, and permissions.                                                |
| MCP will not start or connect                  | Inspect logs; verify the executable or URL, dependencies, environment references, and credentials.                              |
| A tool, skill, or MCP server cannot be deleted | Remove references from agents, including disabled agents, then retry.                                                           |
| An agent reaches its limit                     | Narrow the task or adjust its maximum iterations. Model turns, including the final report, count toward the limit.              |
| Large files or folders fail to index           | Reduce source size or add ignore patterns; see limits below.                                                                    |
| A Git operation fails                          | Confirm Git works outside the app and inspect the actual error. On macOS, complete any required Xcode command-line tools setup. |

If your IDE sets `ELECTRON_RUN_AS_NODE=1`, launch development with that variable removed on macOS/Linux:

```sh
env -u ELECTRON_RUN_AS_NODE pnpm dev
```

Notes, definitions, and settings remain usable when inference is unavailable; model-dependent tasks still require a reachable model.

## Development and packaging

### Project layout

```text
src/main/       Electron lifecycle, services, databases, and privileged operations
src/preload/    Restricted bridge between the desktop UI and main process
src/renderer/  React interface, feature screens, and state stores
src/shared/    Shared types, API contracts, and validation schemas
built-in/      Content and defaults bundled with the application
examples/      Example agents, tools, and workflows
docs/          Feature guides and implementation documentation
tests/         Service, integration, and Electron UI tests
patches/       Tracked dependency patches
scripts/       Supporting development and package checks
```

The React renderer has no direct Node.js access. It calls named preload methods through validated IPC. Main-process services own filesystem access, credentials, model requests, tool execution, SQLite, and LanceDB. LangChain and DeepAgents provide AI orchestration; application capability checks govern execution.

### Commands

| Command                            | Purpose                                                 |
| ---------------------------------- | ------------------------------------------------------- |
| `pnpm dev`                         | Start Vite and the Electron development app             |
| `pnpm typecheck`                   | Check TypeScript types                                  |
| `pnpm lint`                        | Run ESLint                                              |
| `pnpm test`                        | Run default unit/service tests                          |
| `LOCALAI_LIVE_TEST=1 pnpm test`    | Include opt-in live integration checks                  |
| `pnpm build`                       | Compile main, preload, and renderer code                |
| `pnpm test:ui`                     | Run Electron UI tests against the compiled build        |
| `LOCALAI_LIVE_TEST=1 pnpm test:ui` | Include live AI UI workflows                            |
| `pnpm package`                     | Build an unpacked application                           |
| `pnpm dist`                        | Build the configured installer for the current platform |
| `pnpm format`                      | Format the files covered by the repository script       |

Build before running UI tests. Live tests need the services and models described in [Development](docs/DEVELOPMENT.md); they are not enabled by default. Commands above describe available checks, not a claim that every suite currently passes.

Packaging targets are macOS DMG, Windows NSIS, and Linux AppImage. Output goes to `dist/`. macOS packaging uses ad-hoc signing by default; public distribution needs appropriate signing, notarization where applicable, and platform testing.

For isolated development, `LOCALAI_DATA_DIR` can point to a separate data directory in unpackaged builds. Do not run concurrent app instances against the same database.

## Current limitations

- This is a development-stage desktop application, not a signed public release. macOS is the documented verified platform; Windows and Linux need native QA.
- Model quality, available context, and reliable tool calling depend on the selected provider and model.
- Built-in project tools enforce folder boundaries and permissions. Custom tools and MCP servers are trusted code, not an OS sandbox.
- Chat context is bounded. Do not assume the model receives the complete conversation history on every turn.
- Code's live ACP sessions are not persisted across restarts; durable conversation history seeds a new session.
- Code search is bounded path/content search, not full AST or symbol indexing. Some advanced permission and project-memory features in the Code specification are not implemented; consult its implementation-status section.
- Document ingestion limits include 2 MB text files, 5 MB URL responses, 10,000 eligible files per folder traversal, and 600 KB previews. Agent file reads have a 200 KB ceiling. Agent runs are bounded by time and iteration limits.
- English is the current UI language.

## Detailed documentation

| Topic                                     | Guide                                                                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Chat modes, commands, and conversations   | [Chat](docs/CHAT.md)                                                                                       |
| Local and hosted model configuration      | [Multi-provider AI](docs/MULTI_PROVIDER_AI.md)                                                             |
| Notes and document retrieval              | [Saved Text](docs/SAVED_TEXT.md), [Knowledge Base](docs/KNOWLEDGE_BASE.md), [RAG](docs/RAG.md)             |
| Reusable capabilities                     | [Skills](docs/SKILLS.md), [Tools](docs/TOOLS.md), [MCP](docs/MCP.md)                                       |
| Agents, permissions, and hooks            | [Agents](docs/AGENTS.md), [Capability decisions](docs/CAPABILITIES.md), [Agent hooks](docs/AGENT_HOOKS.md) |
| Multi-step automation                     | [Declarative workflows](docs/DECLARATIVE_WORKFLOWS.md)                                                     |
| Project assistance                        | [Code workspaces and implementation status](docs/CODE.md)                                                  |
| Preferences, backups, and memory          | [Settings](docs/SETTINGS.md), [Memory](docs/MEMORY.md)                                                     |
| Bundled content and sample configurations | [Built-in content](built-in/README.md), [Examples](examples/README.md)                                     |
| Engineering and security                  | [Architecture](docs/ARCHITECTURE.md), [Development](docs/DEVELOPMENT.md), [Security](docs/SECURITY.md)     |

Some detailed documents retain earlier design notes or historical verification results. When a feature guide mixes specification and implementation, use its implementation-status section and current source/tests to distinguish shipped behavior from planned work.
