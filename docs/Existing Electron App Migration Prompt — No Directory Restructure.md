# Master Migration Prompt — Existing Running Electron Application

You are working on an **existing, already-running Electron desktop application**.

The application already has:

- its own directory structure
- UI
- styling
- screens
- services
- IPC implementation
- settings
- chat
- agents
- AI providers
- tools
- MCP
- skills
- RAG
- knowledge base
- saved text
- persistence
- existing architecture

Your job is **NOT to rebuild, redesign, restructure, or recreate the application**.

Your task is to modify and improve the existing implementation so the AI architecture uses:

- LangChain.js
- LangGraph.js
- Deep Agents JavaScript
- short-term conversation memory
- long-term persistent memory
- multi-agent support
- existing skills
- existing tools
- existing MCP implementation
- existing RAG / Knowledge Base
- existing multi-provider AI
- streaming
- human-in-the-loop where required

while keeping the current application fully functional.

---

# 1. CRITICAL RULE — MODIFY EXISTING CODE ONLY

This is a running application.

Do NOT create a new architecture from scratch.

Do NOT create a new directory structure unless absolutely required for a missing feature.

Do NOT reorganize folders simply to match LangChain, LangGraph, Deep Agents, or your preferred architecture.

Do NOT move existing files unnecessarily.

Do NOT rename existing modules unless there is a strong technical reason.

Do NOT redesign the UI.

Do NOT change the application's visual style.

Do NOT rewrite working functionality unnecessarily.

Do NOT duplicate existing services.

Do NOT introduce parallel systems for functionality the application already has.

Instead:

1. inspect the current implementation
2. understand the existing architecture
3. identify reusable components
4. identify components that need modification
5. integrate LangChain/LangGraph/Deep Agents into the existing code
6. preserve existing interfaces where possible
7. refactor incrementally
8. keep the application runnable during migration

The existing repository structure is the source of truth.

---

# 2. READ ALL PROJECT DOCUMENTATION FIRST

Before modifying code, completely read:

```text
AGENTS.md
IMPLEMENTATION.md
SECURITY.md
KNOWLEDGE_BASE.md
SETTINGS.md
ARCHITECTURE.md
MCP.md
SKILLS.md
CAPABILITIES.md
MULTI_PROVIDER_AI.md
TOOLS.md
CHAT.md
RAG.md
WORKFLOW.md
DEVELOPMENT.md
SAVED_TEXT.md
```

Also inspect the real implementation of:

```text
package.json
Electron main process
preload
renderer
IPC
chat
providers
models
agents
tools
skills
MCP
RAG
knowledge base
settings
database
storage
saved text
security
tests
```

The Markdown documents describe the intended application.

The source code shows the actual implementation.

Compare both before making changes.

---

# 3. DO NOT CREATE A NEW FOLDER ARCHITECTURE

The current directory structure already exists.

Do not generate recommendations such as:

```text
src/ai/
src/agents/
src/runtime/
src/providers/
```

unless those folders already exist or creating a very small missing module is genuinely required.

Instead, locate the existing modules responsible for:

```text
AI runtime
providers
models
agents
chat
tools
skills
MCP
RAG
memory
settings
database
IPC
```

and modify those modules.

When a new file is required, place it in the most appropriate **existing** feature/module directory according to the application's current conventions.

Follow the repository's current:

```text
naming conventions
module conventions
file organization
service pattern
state-management pattern
database pattern
IPC pattern
testing pattern
```

Do not impose a new style.

---

# 4. MIGRATION GOAL

The current application already has custom AI functionality.

Migrate or adapt this functionality so the core AI stack becomes:

```text
LangChain
    ↓
models
providers
tools
structured output
embeddings

LangGraph
    ↓
stateful workflows
thread state
checkpointing
routing
interrupts
resume
multi-step execution

Deep Agents
    ↓
complex autonomous agents
planning
skills
subagents
filesystem/workspace interaction
long-running tasks
```

Do not use all three frameworks for every request.

Use the appropriate layer.

---

# 5. RESPONSIBILITY OF LANGCHAIN

Use LangChain for the common AI model abstraction.

Use it for functionality such as:

```text
chat models
provider integrations
messages
tools
structured output
embeddings
retrievers
streaming
model invocation
```

Existing provider-specific logic should gradually move behind a common abstraction.

Do not allow provider-specific implementation details to spread throughout the application.

Example goal:

```text
Existing Chat
     ↓
Existing AI Service
     ↓
Provider Resolver
     ↓
LangChain Chat Model
```

Modify the application's current services rather than replacing them.

---

# 6. RESPONSIBILITY OF LANGGRAPH

Use LangGraph where workflows need:

```text
persistent state
thread state
multiple steps
routing
conditions
tools
agent orchestration
retry logic
human approval
interrupt
resume
subagents
```

Do not convert normal functions into LangGraph nodes without reason.

Simple chat may continue using a direct LangChain model.

Complex workflows should use LangGraph.

---

# 7. RESPONSIBILITY OF DEEP AGENTS

Use `deepagents` for advanced autonomous tasks such as:

```text
planning
task decomposition
multi-step execution
subagents
skills
complex tool usage
filesystem/workspace interaction
context management
research workflows
coding workflows
large tasks
```

Do not make every chat request a Deep Agent request.

Use roughly:

```text
normal chat
→ LangChain

stateful workflow
→ LangGraph

complex autonomous agent
→ Deep Agent

complex orchestration involving agents
→ LangGraph + Deep Agent
```

---

# 8. PRESERVE CURRENT CHAT

The current chat implementation is already working.

Do not rewrite the complete chat module.

Integrate the new AI runtime underneath the existing chat interface.

Preserve current features such as:

```text
send message
stream message
stop generation
retry
regenerate
edit message
thread history
provider selection
model selection
agent selection
```

if they already exist.

Refactor the implementation, not the user experience.

---

# 9. MULTI-PROVIDER AI

Use the current implementation described by:

```text
MULTI_PROVIDER_AI.md
SETTINGS.md
CHAT.md
```

Do not remove existing provider support.

Maintain the application's current provider selection behavior.

Possible providers may currently include:

```text
Ollama
OpenAI
Anthropic
Google
OpenRouter
Groq
Mistral
Azure
custom OpenAI-compatible APIs
```

Only preserve or implement providers actually required by the application.

Do not add unnecessary providers.

---

# 10. DEFAULT PROVIDER

Preserve the existing rule where applicable:

```text
Ollama = default provider
```

if that is what the current application/documentation specifies.

The application must continue supporting local models.

Do not make a cloud API mandatory.

---

# 11. PROVIDER CONFIGURATION

Provider configuration should remain centralized.

Do not duplicate provider settings inside:

```text
chat
agents
workflows
tools
```

They should reference the existing saved provider configuration.

Each AI request should resolve:

```text
provider
model
configuration
capabilities
credentials
```

through the existing central provider/model system.

---

# 12. PROVIDER CAPABILITIES

Provider and model behavior should be capability based.

Capabilities may include:

```text
streaming
tools
vision
reasoning
structured output
embeddings
audio
context window
```

Avoid scattered logic such as:

```text
if provider === "openai"
```

when capability detection can handle it.

Use the existing `CAPABILITIES.md` design.

---

# 13. AGENTS

Read:

```text
AGENTS.md
SKILLS.md
TOOLS.md
CAPABILITIES.md
```

Preserve the current agent implementation and UI.

Enhance the internals.

An agent should be able to choose:

```text
provider
model
system instructions
skills
tools
MCP servers
knowledge bases
memory
subagents
```

if supported by the current specifications.

---

# 14. AGENT MODEL SELECTION

Each agent may have its own provider and model.

Resolution should follow the application's current behavior.

A sensible fallback is:

```text
Agent provider/model
        ↓
Application selected/default model
        ↓
Provider default
```

Do not duplicate credentials in agent configurations.

---

# 15. DEEP AGENT INTEGRATION

Where an existing agent requires advanced autonomous execution, upgrade that agent using Deep Agents rather than building a separate agent system beside it.

Reuse the application's:

```text
agent definitions
tool configuration
skills
model selection
permissions
settings
```

Translate those existing configurations into Deep Agent configuration during runtime.

---

# 16. SUBAGENTS

Support subagents only where useful.

For example:

```text
Main agent
    ↓
Research subagent
Coding subagent
Knowledge subagent
General-purpose subagent
```

These are examples only.

Do not create these agents unless the current product actually needs them.

Each subagent should have a clear responsibility.

---

# 17. DIFFERENT MODELS FOR DIFFERENT AGENTS

Allow agents and subagents to use different configured models.

For example:

```text
Main Agent
→ configured primary model

Research Agent
→ configured research model

Fast Agent
→ configured local model
```

This must remain configurable.

Never assume that OpenAI, Anthropic, or any other provider is available.

---

# 18. SKILLS

Preserve the application's current skill system.

Read:

```text
SKILLS.md
AGENTS.md
```

Do not redesign the skill format unless necessary.

Integrate existing skills with Deep Agents.

Skills should be loaded only when relevant.

Do not inject all skill content into every model request.

Use progressive skill loading.

---

# 19. TOOLS

Preserve existing tools.

Do not recreate existing application tools as a second tool system.

Instead, adapt the current tools so they can be used by:

```text
LangChain
LangGraph
Deep Agents
```

through the existing application tool layer.

Tool inputs must be runtime validated.

Use the project's existing validation library where possible.

---

# 20. TOOL PERMISSIONS

The model is NOT the security authority.

Execution must remain controlled by the application.

Flow should remain conceptually:

```text
Model/Agent
     ↓
tool request
     ↓
existing tool layer
     ↓
validation
     ↓
permission check
     ↓
optional user approval
     ↓
execution
```

Do not allow agents to bypass the application's existing tool permissions.

---

# 21. MCP

Read and preserve:

```text
MCP.md
```

Do not recreate the MCP implementation if it already exists.

Adapt existing MCP tools so that LangChain/LangGraph/Deep Agents can consume them.

Existing MCP functionality should remain the source of truth for:

```text
server configuration
connection
disconnection
tool discovery
tool execution
permissions
errors
```

Do not build a competing MCP manager unless the existing one genuinely cannot support the required integration.

---

# 22. RAG

Read:

```text
RAG.md
KNOWLEDGE_BASE.md
```

Preserve the current RAG implementation where it is working.

Do not replace:

```text
document storage
chunking
embedding storage
vector database
knowledge-base configuration
```

without a technical reason.

Integrate the existing retriever with LangChain/agents.

---

# 23. RAG AND MEMORY ARE DIFFERENT

Do not mix RAG and agent memory.

RAG answers:

```text
What information exists in my documents?
```

Memory answers:

```text
What should the assistant remember about the user, project, or agent?
```

Keep these separate.

---

# 24. SHORT-TERM MEMORY

Conversation/thread memory should use LangGraph persistence where suitable.

Each chat must have a stable:

```text
threadId
```

Use that ID with LangGraph persistence.

Do not generate a new thread ID for every message.

Conversation state should survive application restart if current app chat persistence supports restart.

---

# 25. LANGGRAPH CHECKPOINTING

Use persistent checkpointing for production.

Do not rely only on in-memory checkpointing.

For the existing Electron/local-first app, SQLite-backed LangGraph checkpointing can be used if it is compatible with the current persistence architecture.

However:

Do not introduce another SQLite database if the application already has an appropriate persistence mechanism unless necessary.

First inspect the current database architecture.

---

# 26. LONG-TERM MEMORY

Implement long-term memory separately from normal conversation history.

Examples:

```text
user preference
project preference
agent-specific fact
workspace information
explicit remember instruction
durable application context
```

Long-term memory should persist across chats.

---

# 27. MEMORY SCOPES

Support scopes such as:

```text
global/user
workspace
project
agent
```

Use whichever scopes make sense for the existing application's current workspace/user model.

Do not introduce concepts such as workspace IDs if the application does not have workspaces.

Adapt memory to the real application.

---

# 28. MEMORY RETRIEVAL

Do not inject all memories into every prompt.

Before an AI request:

```text
current request
      ↓
find relevant memory
      ↓
select small relevant set
      ↓
inject context
```

Memory retrieval can use:

```text
scope
semantic similarity
recency
importance
metadata
```

---

# 29. MEMORY WRITING

Support explicit memory.

Example:

```text
Remember that I prefer Ollama for local development.
```

Automatic memory should be conservative.

Never automatically store:

```text
API keys
passwords
access tokens
private keys
authentication headers
temporary OTPs
complete documents
huge tool outputs
```

---

# 30. MEMORY MANAGEMENT

Users should eventually be able to:

```text
view memory
search memory
remove memory
clear memory
disable automatic memory
disable memory for selected agents
```

Use the current application's styling and settings UI.

Do not redesign Settings.

---

# 31. MEMORY DOCUMENTATION

Add:

```text
MEMORY.md
```

because the existing documentation does not currently include a dedicated memory specification.

Document:

```text
short-term memory
long-term memory
storage
retrieval
scopes
agent memory
privacy
deletion
configuration
security
```

This is a documentation addition, NOT a request to restructure the application's code directories.

---

# 32. EXISTING DATABASE

Inspect the existing database/storage first.

Reuse it wherever possible.

Do not add another database simply because LangGraph examples use one.

Document clearly which system stores:

```text
threads
messages
agent settings
provider settings
memory
knowledge base
saved text
checkpoints
```

Avoid duplicating the same data across multiple sources.

---

# 33. SAVED TEXT

Preserve the behavior from:

```text
SAVED_TEXT.md
```

Saved Text is user-managed content.

It is not automatically the same thing as long-term AI memory.

Do not merge them without a strong product reason.

---

# 34. WORKFLOWS

Read:

```text
WORKFLOW.md
```

Identify workflows that benefit from LangGraph.

Good LangGraph candidates:

```text
multi-step tasks
conditional workflows
approval workflows
retry workflows
tool-heavy workflows
multi-agent workflows
resumable workflows
```

Do not convert simple code paths into graphs.

---

# 35. HUMAN-IN-THE-LOOP

Where a workflow performs a sensitive operation, use LangGraph interrupts or the existing approval system.

Examples:

```text
delete file
overwrite file
execute command
external API mutation
send message
modify external system
```

Agent execution should pause until the user approves or rejects the action.

---

# 36. FILE ACCESS

Do not automatically expose the complete local filesystem to Deep Agents.

Reuse the application's existing file access/security rules.

Agent access should be limited to:

```text
selected workspace
approved directory
application data
explicitly selected files
```

Prevent path traversal and unauthorized filesystem access.

---

# 37. SHELL EXECUTION

If shell execution already exists, preserve its permission model.

If it does not exist, do not add unrestricted shell access simply because Deep Agents supports it.

Any command execution should support:

```text
approval
timeout
cancellation
restricted working directory
sanitized environment
logging
secret redaction
```

---

# 38. ELECTRON SECURITY

Preserve and strengthen the existing security rules in:

```text
SECURITY.md
```

Verify:

```text
contextIsolation: true

nodeIntegration: false

safe preload API

runtime validated IPC

no arbitrary ipcRenderer exposure

no credentials exposed to renderer

no unrestricted filesystem API

no unrestricted child_process access
```

Do not weaken the current Electron security model.

---

# 39. RENDERER RESPONSIBILITY

Do not put AI framework code directly into the renderer.

Renderer should communicate with the existing main-process services through the existing IPC architecture.

Do not instantiate:

```text
OpenAI client
Anthropic client
LangChain provider
LangGraph graph
Deep Agent
database
filesystem manager
```

inside UI components.

---

# 40. CREDENTIAL SECURITY

API keys must remain in the secure backend/main-process side.

Never send the actual API key to the renderer.

Renderer may receive:

```text
configured: true
```

instead of receiving the secret itself.

Do not store keys in:

```text
localStorage
UI state
browser devtools
logs
telemetry
URLs
```

---

# 41. STREAMING

Preserve the current streaming UX.

Convert LangChain/LangGraph/Deep Agent streaming into the application's existing streaming event system.

Do NOT redesign the renderer around framework-specific event formats.

Normalize events before IPC.

Possible application events:

```text
run started
text delta
thinking delta
tool started
tool completed
agent started
subagent started
approval required
run completed
run failed
run cancelled
```

Use the application's current naming if it already defines event types.

---

# 42. STOP GENERATION

The existing Stop button must continue to work.

Use cancellation mechanisms such as:

```text
AbortController
AbortSignal
framework cancellation
tool cancellation where supported
```

Stopping should cancel the active run instead of just stopping UI rendering.

---

# 43. CONTEXT MANAGEMENT

Build prompts/context from only relevant information.

Possible context sources:

```text
agent instructions
skills
relevant memory
RAG results
conversation context
current user message
```

Do NOT automatically inject:

```text
all skills
all memory
all documents
all previous chats
all tool outputs
```

Keep context efficient.

---

# 44. LARGE CONTEXT

When conversation/context becomes too large, use appropriate strategies:

```text
conversation summarization
retrieval
tool-result offloading
Deep Agent context management
selective skills
selective memory
```

Do not simply continue increasing prompt size.

---

# 45. ERRORS

Preserve the application's current error architecture if one exists.

Normalize provider/framework errors before sending them to UI.

The UI should not need to understand raw LangChain or provider exceptions.

Handle errors such as:

```text
provider not configured
authentication failure
model unavailable
rate limit
context limit
tool failure
MCP failure
memory failure
RAG failure
agent failure
cancelled request
```

---

# 46. RETRIES

Retry only transient errors.

Do not automatically retry:

```text
invalid API key
invalid configuration
permission rejection
bad tool parameters
user cancellation
```

Use bounded retries.

---

# 47. LOGGING

Preserve the current logging system.

Add useful AI execution metadata where needed:

```text
thread ID
run ID
agent ID
provider
model
tool
duration
workflow
```

Never log secrets.

---

# 48. LANGSMITH

LangSmith may be used only if the application explicitly wants it.

It must NOT become a required dependency or required online service.

Remote tracing should be optional.

Do not silently send private user data to remote observability services.

---

# 49. CURRENT SETTINGS UI

Preserve the current Settings screen and visual style.

Integrate new configuration into the existing settings categories instead of designing a separate new settings app.

Potential settings include:

```text
default provider
default model
agent models
memory
MCP
skills
tools
RAG
embedding model
privacy
```

Only expose settings required by the product.

---

# 50. EXISTING UI STYLE

Very important:

Do not change:

```text
colors
spacing
fonts
components
navigation
layout
sidebar design
chat design
button style
forms
dialog design
```

unless implementation requires a tiny addition.

Any new UI must reuse existing components and design tokens.

---

# 51. DATA MIGRATION

Do not lose existing application data.

Preserve:

```text
chat history
settings
provider configuration
agents
skills
MCP configuration
knowledge bases
saved text
```

If storage schema changes, implement versioned migrations.

Never delete old user data as part of migration unless explicitly required.

---

# 52. DEPENDENCIES

Inspect `package.json` before installing anything.

Do not install every LangChain package.

Only add packages required by the current implementation.

Expected core dependencies may include:

```text
langchain
@langchain/core
@langchain/langgraph
deepagents
```

plus only the provider integrations actually required.

If persistent LangGraph SQLite checkpoints are needed, evaluate:

```text
@langchain/langgraph-checkpoint-sqlite
```

but verify Electron/native module compatibility first.

---

# 53. REMOVE OLD LIBRARIES CAREFULLY

Do not immediately delete the current AI implementation.

Migration approach:

```text
new integration
      ↓
adapt current service
      ↓
migrate callers
      ↓
test
      ↓
remove obsolete implementation
```

Only remove old dependencies after all callers have migrated.

---

# 54. TYPESCRIPT

Use the current TypeScript configuration.

Maintain strict typing.

Avoid unnecessary:

```text
any
unknown casts
@ts-ignore
```

Do not weaken the project's TypeScript settings simply to make LangChain integration compile.

---

# 55. TESTING

Preserve existing tests.

Add tests for new behavior.

At minimum test:

```text
existing chat still works

provider selection

model selection

agent model selection

streaming

stop generation

thread persistence

LangGraph checkpoint/resume

long-term memory

skill loading

tool execution

tool permissions

MCP

RAG

Deep Agent

subagent execution

approval interrupt/resume
```

Use mocks so normal tests do not require paid AI APIs.

---

# 56. BUILD VALIDATION

Do not only run TypeScript tests.

Validate the actual Electron application.

Run the repository's existing commands for:

```text
typecheck
lint
test
development launch
production build
packaging
```

Fix errors introduced by the migration.

---

# 57. ELECTRON NATIVE MODULES

If adding SQLite or another native module, verify:

```text
Electron ABI

electron-rebuild / equivalent

macOS packaging

Windows packaging if supported

asar behavior

production build
```

Do not assume a native package that works in Node automatically works inside packaged Electron.

---

# 58. PERFORMANCE

Do not block Electron's main thread with heavy operations.

Document parsing, embedding generation, indexing, or other CPU-heavy work should use the current application's background execution architecture where available.

Do not introduce unnecessary workers if the existing system already handles this correctly.

---

# 59. IMPLEMENTATION ORDER

Do the migration incrementally.

Recommended order:

## Step 1

Read documentation and inspect current implementation.

## Step 2

Map current implementation:

```text
chat
provider
agent
tool
MCP
RAG
settings
database
IPC
skills
```

## Step 3

Update `IMPLEMENTATION.md` with the migration plan and findings.

## Step 4

Integrate LangChain into the existing provider/model layer.

Verify normal chat.

## Step 5

Add LangGraph where stateful workflows actually need it.

Verify thread persistence/resume.

## Step 6

Add short-term and long-term memory.

## Step 7

Integrate Deep Agents with existing agent definitions.

## Step 8

Connect existing skills/tools/MCP/RAG to agents.

## Step 9

Add approval/interruption for sensitive actions.

## Step 10

Update existing UI only where required.

## Step 11

Run tests/security/build validation.

## Step 12

Update all affected Markdown documentation.

---

# 60. IMPLEMENTATION.md

Use the existing:

```text
IMPLEMENTATION.md
```

to track this migration.

Add/update sections such as:

```text
Current Architecture Analysis

Migration Status

Completed

In Progress

Remaining

Architecture Decisions

Compatibility Notes

Database Changes

Tests

Known Issues
```

Do not create duplicate planning documents unnecessarily.

---

# 61. BEFORE MAKING CODE CHANGES

First inspect the repository and identify:

```text
where provider creation happens

where model calls happen

where agents are created

where messages are streamed

where tools are registered

where MCP tools are loaded

where RAG is called

where settings are stored

where chat threads are persisted

where IPC handlers live

where credentials are stored
```

Then modify those exact existing locations.

Do not create a parallel architecture.

---

# 62. BEFORE CREATING A NEW FILE

Ask internally:

```text
Does an existing module already own this responsibility?
```

If YES:

modify that module.

If NO:

create the minimum required file following the existing repository conventions.

Do not create folders simply to make the architecture look cleaner.

---

# 63. BEFORE CREATING A NEW SERVICE

Search the repository for an equivalent existing service.

Examples:

```text
ProviderService
AIService
ChatService
AgentService
ToolService
MCPService
RAGService
SettingsService
DatabaseService
```

Extend/adapt the existing service when appropriate.

Avoid:

```text
OldProviderService
NewProviderService

OldAgentSystem
NewAgentSystem

OldToolRegistry
NewToolRegistry
```

running side-by-side permanently.

---

# 64. FRAMEWORK ADAPTER APPROACH

Where possible, treat LangChain, LangGraph, and Deep Agents as implementation details underneath the application's current abstractions.

For example, if the application already has:

```ts
sendChatMessage()
```

do not make UI components call:

```ts
model.stream()
```

directly.

Update the implementation of `sendChatMessage()` or its underlying service.

Likewise, if existing code has:

```ts
runAgent()
```

keep that public interface where practical and change the internal agent engine.

---

# 65. NO GREENFIELD CODE

Do not answer the migration task by generating a completely new example Electron application.

Do not generate a new boilerplate app.

Do not generate another:

```text
package.json
vite config
electron main template
React shell
sidebar
chat page
```

unless the existing project is missing that exact required piece.

This task is repository modification, not application generation.

---

# 66. SECURITY REVIEW

After implementation, specifically inspect changed code for:

```text
renderer secret exposure
unsafe IPC
filesystem escape
unsafe shell execution
tool permission bypass
MCP permission bypass
unvalidated external input
memory storing secrets
log leaks
```

Fix issues before declaring the migration complete.

---

# 67. UPDATE DOCUMENTATION

Review and update these existing files after implementation:

```text
AGENTS.md
IMPLEMENTATION.md
SECURITY.md
KNOWLEDGE_BASE.md
SETTINGS.md
ARCHITECTURE.md
MCP.md
SKILLS.md
CAPABILITIES.md
MULTI_PROVIDER_AI.md
TOOLS.md
CHAT.md
RAG.md
WORKFLOW.md
DEVELOPMENT.md
SAVED_TEXT.md
```

Add:

```text
MEMORY.md
```

only because long-term/short-term memory now requires dedicated documentation.

Do not create other new architecture documents unless genuinely required.

---

# 68. FINAL APPLICATION BEHAVIOR

After migration the existing application should still look and behave like the same application.

The difference should be primarily in the AI architecture underneath.

A user should be able to:

```text
launch existing Electron app

use same UI

open chat

choose provider

choose model

switch model from chat

choose agent

run normal chat

run advanced agents

use skills

use tools

use MCP

use knowledge base

use RAG

retain conversation state

use long-term memory

resume existing conversations

stop generation

approve sensitive agent actions
```

without needing to understand LangChain, LangGraph, or Deep Agents.

---

# 69. TARGET EXECUTION MODEL

The internal flow should roughly become:

```text
Existing UI
   ↓
Existing IPC
   ↓
Existing Chat / Agent Service
   ↓
resolve existing configuration
   ↓
LangChain model
   ↓
LangGraph when workflow/state required
   ↓
Deep Agent when autonomous agent required
   ↓
existing Tools / Skills / MCP / RAG
   ↓
existing persistence
   ↓
normalized stream events
   ↓
existing UI
```

This is a conceptual execution model.

Do not recreate the repository structure to match this diagram.

---

# 70. IMPORTANT PRINCIPLE

The frameworks must adapt to the application.

The application must NOT be unnecessarily redesigned to adapt to the frameworks.

LangChain, LangGraph, and Deep Agents are implementation tools.

They are not the product architecture.

The application's existing architecture, domain model, UI, settings, and behavior remain primary.

---

# 71. FINAL VALIDATION CHECKLIST

Before declaring migration complete verify:

```text
existing Electron app launches

existing UI unchanged

existing styling unchanged

existing navigation works

existing chats still load

new chats work

streaming works

Stop works

provider switching works

model switching works

Ollama/local model works if currently supported

cloud providers work if configured

agent selection works

per-agent model works

skills work

tools work

MCP works

RAG works

knowledge base works

saved text works

LangGraph thread persistence works

application restart preserves state

long-term memory works

memory can be removed

Deep Agent works

subagents work where configured

approval/resume works

credentials are not exposed

IPC remains secure

existing tests pass

new tests pass

typecheck passes

lint passes

development build works

production Electron build works
```

---

# 72. FINAL REPORT

At completion update `IMPLEMENTATION.md` and provide a concise implementation report containing:

```text
what existing code was reused

what existing code was modified

what code was removed

LangChain integration

LangGraph integration

Deep Agent integration

memory implementation

provider changes

agent changes

skill changes

tool changes

MCP changes

RAG changes

database migrations

security changes

tests executed

remaining issues
```

Also explicitly identify any feature that was not completed.

Never claim completion without verifying the working application.

---

# FINAL DIRECTIVE

This is an **existing running Electron application**.

DO NOT REBUILD IT.

DO NOT RESTRUCTURE IT.

DO NOT REDESIGN IT.

DO NOT GENERATE A NEW PROJECT.

Work inside the current repository.

Read the existing Markdown specifications and actual code first.

Reuse existing modules wherever possible.

Integrate LangChain into the current model/provider layer.

Use LangGraph only for workflows that need state, persistence, orchestration, interruption, or resumption.

Use Deep Agents only for advanced autonomous agents.

Integrate the existing tools, skills, MCP, RAG, providers, settings, and chat system with these frameworks.

Add short-term and long-term memory without confusing memory with RAG or normal chat history.

Preserve all current working features and user data.

Make small, controlled changes.

Test after every major migration step.

The final result must be the **same existing application with an improved AI engine underneath it**, not a newly generated application.