# MASTER BUILD PROMPT

# Local-First Electron AI Workspace

You are a senior Electron, React, TypeScript, AI/RAG, MCP and developer-tool engineer.

Build a production-quality **local-first Electron desktop application similar to an Ollama UI**, but focused on local AI development, documentation, knowledge management, agents, skills and MCP.

The application must run locally and must NOT require a cloud backend.

Do not build a fake/demo UI.

Implement the actual functionality.

Do not stop after creating the UI.

Build the application in small working phases and verify each phase before moving to the next one.

---

# 1. PRODUCT NAME

Use a temporary working name:

```text
LocalAI Workspace
```

Keep the application name configurable so it can easily be renamed later.

---

# 2. PRIMARY REQUIREMENTS

The application must have these main sections:

```text
Chat
MCP
Skills
Saved Text
Agents
Knowledge Base
Settings
```

The application is primarily local.

Use:

```text
Electron
React
TypeScript
Vite
Tailwind CSS
Zustand
SQLite only where explicitly required
Ollama
LanceDB
```

However:

### IMPORTANT STORAGE RULE

Do NOT use a database for:

```text
MCP
Skills
Saved Text
Agent definitions
```

These should be stored as local files.

Use SQLite only for data where a database is genuinely useful, such as:

```text
Chat conversations
Chat messages
Application metadata
Knowledge Base indexing metadata if required
```

RAG vectors must be stored in a local vector database.

---

# 3. LOCAL-FIRST ARCHITECTURE

Architecture:

```text
Electron Main Process
        |
        +-----------------------------+
        |                             |
        v                             v
 Local Services                  File System
        |                             |
        +-------------+---------------+
                      |
                      v
                Renderer UI
                      |
       +--------------+--------------+
       |              |              |
       v              v              v
      Chat           RAG            Agents
       |              |              |
       v              v              v
     Ollama        LanceDB        Tools/MCP
```

Never allow the renderer to directly access Node.js APIs.

Use Electron IPC.

Use:

```text
contextBridge
preload.ts
IPC handlers
```

Expose only explicitly required APIs.

Never expose:

```text
nodeIntegration: true
```

Never expose the complete Node.js process to the renderer.

---

# 4. SECURITY

Electron BrowserWindow must use:

```ts
contextIsolation: true
nodeIntegration: false
sandbox: true
```

Where technically compatible.

All filesystem operations must happen in the Electron main process.

All command execution must happen through controlled main-process services.

Do not allow arbitrary renderer-to-shell execution.

---

# 5. PROJECT STRUCTURE

Create a clean structure similar to:

```text
src/
├── main/
│   ├── index.ts
│   ├── ipc/
│   ├── services/
│   │   ├── ollama/
│   │   ├── rag/
│   │   ├── mcp/
│   │   ├── skills/
│   │   ├── agents/
│   │   ├── filesystem/
│   │   └── settings/
│   ├── database/
│   └── security/
│
├── preload/
│   └── index.ts
│
├── renderer/
│   ├── app/
│   ├── components/
│   ├── features/
│   │   ├── chat/
│   │   ├── mcp/
│   │   ├── skills/
│   │   ├── saved-text/
│   │   ├── agents/
│   │   ├── knowledge/
│   │   └── settings/
│   ├── stores/
│   ├── hooks/
│   ├── types/
│   └── utils/
│
└── shared/
    ├── types/
    ├── constants/
    └── schemas/
```

Keep business logic out of React components.

---

# 6. UI DESIGN

Create a modern desktop AI application.

Layout:

```text
┌─────────────────────────────────────────────────────┐
│                    Top Bar                           │
├───────────────┬─────────────────────────────────────┤
│               │                                     │
│   Sidebar     │             Main Content             │
│               │                                     │
│   Chat        │                                     │
│   MCP         │                                     │
│   Skills      │                                     │
│   Saved Text  │                                     │
│   Agents      │                                     │
│   Knowledge   │                                     │
│               │                                     │
│   Settings    │                                     │
│               │                                     │
└───────────────┴─────────────────────────────────────┘
```

Use a clean dark/light theme.

Use Tailwind CSS.

Use accessible components.

Use Lucide icons.

Do not over-design.

The UI should feel like a professional developer tool.

---

# 7. CHAT

Chat must support normal conversation.

Features:

```text
New Chat
Conversation History
Search History
Rename Conversation
Delete Conversation
Streaming Response
Stop Generation
Regenerate
Copy
Markdown
Code Blocks
Syntax Highlighting
Model Selection
```

Example:

```text
User:
Explain this React component.

Assistant:
This component...
```

The user should be able to continue the same conversation.

Conversation history must persist locally.

---

# 8. CHAT HISTORY

Store conversations locally.

Suggested schema:

```text
conversations

id
title
model
created_at
updated_at
```

Messages:

```text
messages

id
conversation_id
role
content
created_at
metadata
```

Roles:

```text
system
user
assistant
tool
```

The chat screen should load previous conversations.

When the user opens an existing conversation:

```text
conversation
    ↓
load messages
    ↓
render history
    ↓
continue conversation
```

Do not lose conversation history after restarting the application.

---

# 9. OLLAMA

Create an Ollama service.

Default:

```text
http://127.0.0.1:11434
```

Make URL configurable.

Support:

```text
List Models
Get Model Information
Generate
Chat
Streaming
Embeddings
```

Create interfaces:

```ts
interface LLMProvider {
  listModels(): Promise<Model[]>;
  chat(request: ChatRequest): AsyncIterable<ChatChunk>;
}

interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}
```

Implement:

```text
OllamaLLMProvider
OllamaEmbeddingProvider
```

Do not hardcode Ollama everywhere.

---

# 10. MODEL SETTINGS

Settings must include:

```text
LLM Provider
Ollama URL
Chat Model
Embedding Model
Temperature
Context Size
Top K
```

The model selector should automatically fetch models from Ollama.

Example:

```text
Chat Model

[ qwen3-coder ▼ ]

Embedding Model

[ nomic-embed-text ▼ ]
```

Do not assume that a particular model is installed.

Detect installed models dynamically.

If Ollama is unavailable:

```text
Show clear error
Show connection status
Provide retry
```

Do not crash the application.

---

# 11. LOCAL RAG

The Knowledge Base uses a completely local RAG architecture.

Use:

```text
LanceDB
```

for vector storage.

Use Ollama embeddings.

Default embedding model:

```text
nomic-embed-text
```

Make embedding model configurable.

Architecture:

```text
Knowledge Source
       ↓
Fetcher / File Reader
       ↓
Content Normalizer
       ↓
Markdown/Text extraction
       ↓
Chunker
       ↓
Ollama Embedding
       ↓
LanceDB
```

---

# 12. IMPORTANT KNOWLEDGE BASE RULE

The Knowledge Base itself should store **Markdown-oriented knowledge**.

The user can add:

```text
Markdown
TXT
URLs
```

However, the application should normalize supported sources into Markdown/text before indexing.

Do not index binary files directly.

---

# 13. KNOWLEDGE SOURCES

The user should be able to add:

```text
Local File
Local Folder
URL
```

Supported local text formats should include:

```text
.md
.txt
.json
.yaml
.yml
.csv
```

Do not index:

```text
node_modules
.git
dist
build
coverage
.env
.env.*
```

Allow custom ignore patterns.

---

# 14. URL KNOWLEDGE SOURCES

The user can add a URL.

Example:

```text
https://example.com/docs
```

Store:

```ts
interface KnowledgeSource {
  id: string;
  type: "file" | "folder" | "url";
  name: string;
  location: string;
  createdAt: number;
  updatedAt: number;
  lastSyncedAt?: number;
  status: "idle" | "syncing" | "indexing" | "ready" | "error";
}
```

---

# 15. URL SYNC

When user clicks:

```text
Sync
```

the application must:

```text
1. Mark source as syncing
2. Remove old indexed content
3. Remove old preview
4. Fetch latest URL content
5. Convert content into Markdown/text
6. Generate new preview
7. Chunk content
8. Generate embeddings
9. Insert into LanceDB
10. Update source status
```

The old content must NOT remain in the RAG database after synchronization.

Use source IDs to isolate documents.

Example:

```text
sourceId = docs-react
```

Before re-indexing:

```text
DELETE vectors WHERE sourceId = docs-react
```

Then:

```text
INSERT new vectors
```

---

# 16. KNOWLEDGE PREVIEW

For each source show:

```text
Name
Type
URL/path
Status
Last Sync
Document count
Chunk count
```

When opening a source:

```text
Preview
Metadata
Sync
Re-index
Remove
```

Preview should show the normalized Markdown/text.

---

# 17. KNOWLEDGE SEARCH

Implement:

```text
Semantic Search
Keyword Search
```

Return:

```text
file/source
relevance
content
metadata
```

Example:

```text
Search:
"How does authentication work?"

Results:

1. authentication.md
2. api-auth.md
3. security.md
```

---

# 18. RAG CHAT

Allow Chat to use Knowledge Base context.

UI:

```text
Knowledge
[ None ▼ ]
```

Options:

```text
None
All Knowledge
Specific Source
Specific Collection
```

Flow:

```text
User Question
      ↓
Retrieve relevant chunks
      ↓
Build context
      ↓
Send context + conversation
      ↓
Ollama
      ↓
Stream answer
```

Show when RAG context was used.

Example:

```text
Sources used: 4
```

Allow user to expand and inspect sources.

---

# 19. SAVED TEXT

Saved Text must NOT use a database.

Store files locally.

Directory:

```text
<appData>/saved-text/
```

Each saved text can be represented as:

```text
<id>.md
```

The file should contain frontmatter:

```md
---
id: abc123
title: React Architecture
createdAt: 123456789
updatedAt: 123456789
---

# React Architecture

Content...
```

The UI requires TWO inputs:

```text
Title
Text
```

Text must support:

```text
Plain text
Markdown
```

Features:

```text
Create
Edit
Save
Delete
Search
Copy
Send to Chat
```

---

# 20. SAVED TEXT UI

Example:

```text
Saved Text

[ + New ]

Search...

┌─────────────────────────────┐
│ React Architecture          │
│ Updated 2 hours ago         │
└─────────────────────────────┘

┌─────────────────────────────┐
│ API Guidelines              │
│ Updated yesterday           │
└─────────────────────────────┘
```

Editor:

```text
Title
[________________________]

Text
┌─────────────────────────────┐
│ # Documentation             │
│                             │
│ ...                         │
└─────────────────────────────┘

[Cancel] [Save]
```

---

# 21. MCP

MCP configurations must NOT use a database.

Store locally as JSON.

Directory:

```text
<appData>/mcp/
```

Example:

```text
mcp/
├── filesystem.json
├── github.json
└── jira.json
```

Example configuration:

```json
{
  "name": "filesystem",
  "command": "npx",
  "args": [
    "-y",
    "@modelcontextprotocol/server-filesystem"
  ],
  "env": {
    "ROOT_PATH": "/Users/example/project"
  },
  "enabled": true
}
```

Support:

```text
Create
Edit
Delete
Enable/Disable
Start
Stop
Restart
View Logs
Test Connection
```

---

# 22. MCP SECURITY

Never expose secrets in the renderer.

Support environment variable references.

Example:

```json
{
  "env": {
    "GITHUB_TOKEN": "${GITHUB_TOKEN}"
  }
}
```

Resolve environment variables in the Electron main process.

Never render secret values by default.

Display:

```text
GITHUB_TOKEN = ********
```

---

# 23. SKILLS

Skills must NOT use a database.

Store skills as Markdown files.

Directory:

```text
<appData>/skills/
```

Each skill:

```text
skills/
├── code-review/
│   └── SKILL.md
├── documentation/
│   └── SKILL.md
└── react-generator/
    └── SKILL.md
```

---

# 24. SKILL FORMAT

Example:

```md
---
name: React Component Generator
description: Generate React components following project conventions
version: 1.0.0
---

# React Component Generator

## Instructions

Generate React components using TypeScript.

Follow the existing project architecture.

Do not introduce unnecessary dependencies.

## Rules

- Use TypeScript
- Follow existing patterns
- Reuse existing components
```

---

# 25. SKILLS UI

Display skills using an accordion.

Example:

```text
Skills

▼ React Component Generator
  Description
  Version
  Instructions
  Tools
  Actions

  [Edit] [Delete]

▶ Code Reviewer

▶ Documentation Generator
```

When expanded, show full skill details.

Features:

```text
Create
Read
Update
Delete
Search
Enable/Disable
```

No database.

---

# 26. AGENTS

Agents are reusable AI workers.

An Agent should be able to:

```text
Read source code
Understand project structure
Use Knowledge Base
Use Skills
Use Tools
Use MCP
Execute controlled commands
Create files
Modify files
```

Agent definitions must be stored locally as files.

Directory:

```text
<appData>/agents/
```

---

# 27. AGENT FORMAT

Use Markdown with frontmatter.

Example:

```md
---
name: React Code Reviewer
description: Review React code according to project rules
model: qwen3-coder
skills:
  - code-review
  - react
tools:
  - filesystem.read
  - filesystem.search
  - git.diff
  - git.status
---

# React Code Reviewer

You are a senior React engineer.

Read the source code before making conclusions.

Review:

- Architecture
- React patterns
- TypeScript
- Accessibility
- Performance
- Testing

Do not modify files unless explicitly requested.
```

---

# 28. AGENT EXECUTION

Agent flow:

```text
User Request
      ↓
Agent
      ↓
Load Agent Definition
      ↓
Load Selected Model
      ↓
Load Skills
      ↓
Load Tools
      ↓
Retrieve Knowledge
      ↓
Plan
      ↓
Execute Tools
      ↓
Validate
      ↓
Final Response
```

---

# 29. AGENT TOOLS

Create a controlled tool system.

Initial tools:

```text
filesystem.read
filesystem.write
filesystem.edit
filesystem.list
filesystem.search
filesystem.exists

project.detect

git.status
git.diff
git.log

shell.execute
```

IMPORTANT:

The shell tool must be restricted.

Do not allow unrestricted shell execution from the renderer.

Agent execution happens in the main process.

---

# 30. FILE MODIFICATION

Agents must be able to modify project files.

Example request:

```text
Create a reusable Button component using our existing project conventions.
```

Agent should:

```text
1. Inspect project
2. Read package.json
3. Read relevant source files
4. Search for existing Button components
5. Read project conventions
6. Load relevant Skills
7. Generate implementation
8. Show planned changes
9. Apply changes
10. Verify files
11. Run tests/lint when appropriate
12. Report result
```

Do not blindly overwrite files.

---

# 31. SAFE FILE EDITING

Before modifying a file:

```text
Read file
Calculate current hash
Create proposed change
Validate target
Apply change only if original hash is unchanged
```

If the file changed during execution:

```text
Abort modification
Notify user
Request/recalculate patch
```

---

# 32. AGENT APPROVAL

Provide execution modes:

```text
Ask before changes
Auto approve safe changes
Full auto mode
```

Default:

```text
Ask before changes
```

For dangerous operations such as:

```text
rm
delete
git reset
git push
format disk
```

always require confirmation.

---

# 33. AGENT UI

Example:

```text
Agents

[ + New Agent ]

┌──────────────────────────────┐
│ React Code Reviewer          │
│ qwen3-coder                  │
│ 3 skills                     │
│ 4 tools                      │
│                              │
│ [Run] [Edit] [Delete]        │
└──────────────────────────────┘
```

Agent execution screen:

```text
React Code Reviewer

Task:
Review Button component

Thinking / Planning

✓ Read package.json
✓ Read Button.tsx
✓ Search related components
✓ Load code-review skill
✓ Analyze implementation

Tools

filesystem.read
filesystem.search

Changes

2 files changed

[Review Changes] [Apply]
```

---

# 34. AGENT + SKILLS + TOOLS + MODEL

An Agent configuration must explicitly define:

```text
Agent
 ├── Model
 ├── Skills
 ├── Tools
 └── Knowledge Sources
```

Example:

```json
{
  "model": "qwen3-coder",
  "skills": [
    "react-component",
    "code-review"
  ],
  "tools": [
    "filesystem.read",
    "filesystem.write",
    "filesystem.search"
  ],
  "knowledgeSources": [
    "project-docs"
  ]
}
```

---

# 35. API KEY MANAGEMENT

Create a local API key manager.

The application may need keys for:

```text
OpenAI
Anthropic
GitHub
Other MCP servers
```

Do not store plaintext secrets in normal application files if the operating system secure credential store is available.

Use Electron-safe OS credential storage such as:

```text
keytar
```

if compatible with the selected Electron version.

Fallback to environment variables when explicitly configured.

Allow:

```text
Add API Key
Update API Key
Remove API Key
Use Environment Variable
```

Never show full API keys.

Example:

```text
OpenAI API Key

sk-**************9x2

[Update] [Remove]
```

---

# 36. ENVIRONMENT VARIABLES

Support:

```text
.env
environment variables
secure credential storage
```

Do NOT automatically expose all environment variables to the renderer.

Only expose explicitly requested variables.

For MCP/Agents:

```text
${GITHUB_TOKEN}
${OPENAI_API_KEY}
```

resolve them in the main process.

---

# 37. SETTINGS

Settings page should include:

## General

```text
Theme
Language
Startup behavior
```

## Ollama

```text
Ollama URL
Connection Status
Refresh Models
```

## Models

```text
Chat Model
Embedding Model
```

## RAG

```text
Top K
Chunk Size
Chunk Overlap
```

## Agents

```text
Default Agent
Approval Mode
Command Timeout
```

## Security

```text
API Keys
Environment Variables
```

---

# 38. LOCAL APPLICATION DATA

Use Electron's application data directory.

Example:

```text
<userData>/
```

Structure:

```text
local-ai-workspace/
│
├── database/
│   └── app.sqlite
│
├── rag/
│   └── lancedb/
│
├── skills/
│   ├── code-review/
│   │   └── SKILL.md
│   └── documentation/
│       └── SKILL.md
│
├── agents/
│   └── react-reviewer.md
│
├── mcp/
│   └── filesystem.json
│
├── saved-text/
│   ├── notes.md
│   └── prompts.md
│
└── cache/
```

Never put application data inside the source repository.

---

# 39. KNOWLEDGE INDEXING PIPELINE

Implement a proper indexing service.

Interface:

```ts
interface KnowledgeIndexer {
  indexSource(sourceId: string): Promise<IndexResult>;

  removeSource(sourceId: string): Promise<void>;

  reindexSource(sourceId: string): Promise<IndexResult>;

  search(
    query: string,
    options?: SearchOptions
  ): Promise<SearchResult[]>;
}
```

Indexing:

```text
Source
 ↓
Load
 ↓
Normalize
 ↓
Hash
 ↓
Chunk
 ↓
Embed
 ↓
Store
```

---

# 40. INCREMENTAL INDEXING

Do not re-index unchanged files unnecessarily.

Calculate:

```text
SHA-256
```

for source content.

If:

```text
oldHash === newHash
```

skip embedding.

If changed:

```text
delete old chunks
create new chunks
embed
insert
```

---

# 41. PROGRESS UI

When indexing:

```text
Indexing Knowledge

██████████████░░░░░░ 72%

Files:
72 / 100

Chunks:
1,283

Current:
docs/react/hooks.md
```

Allow:

```text
Cancel
```

if technically safe.

---

# 42. RAG DATABASE SCHEMA

Use LanceDB tables such as:

```text
knowledge_chunks
```

Fields:

```text
id
sourceId
content
embedding
filePath
title
chunkIndex
startLine
endLine
hash
createdAt
updatedAt
metadata
```

Use vector search.

---

# 43. CHAT + RAG PROMPT

When RAG is enabled, construct the system context approximately like:

```text
You are a local AI assistant.

Answer using the provided conversation and retrieved knowledge.

If the retrieved knowledge does not contain enough information,
say that the available knowledge is insufficient.

Do not invent source code, APIs, documentation or project rules.

Retrieved knowledge:

<knowledge_context>
...
</knowledge_context>
```

Keep retrieved context separate from user instructions.

---

# 44. MCP + AGENT

Agents should be able to use MCP tools.

Architecture:

```text
Agent
  |
  +-- Local Tools
  |
  +-- MCP Tools
  |
  +-- Skills
  |
  +-- Knowledge Base
  |
  +-- Model
```

Normalize all tools into a common interface.

Example:

```ts
interface AgentTool {
  name: string;
  description: string;
  inputSchema: unknown;
  execute(input: unknown): Promise<unknown>;
}
```

---

# 45. MCP TOOL DISCOVERY

When an MCP server starts:

```text
Connect
 ↓
Initialize
 ↓
List tools
 ↓
Store tool metadata
 ↓
Expose tools to Agent
```

UI:

```text
Filesystem MCP

Status: Connected

Tools:

✓ read_file
✓ write_file
✓ list_directory
✓ search_files
```

---

# 46. ERROR HANDLING

Every service must return structured errors.

Example:

```ts
interface AppError {
  code: string;
  message: string;
  details?: unknown;
}
```

Never silently swallow errors.

Display useful messages.

Example:

```text
Ollama is not running.

Expected:
http://127.0.0.1:11434

Start Ollama and click Retry.
```

---

# 47. OFFLINE REQUIREMENT

The core application must work without internet.

Internet is only required when the user explicitly uses:

```text
URL Knowledge Source
Cloud API
Remote MCP
```

The following must work offline:

```text
Chat with Ollama
RAG
Saved Text
Skills
Agents
Local MCP
Local files
Conversation history
```

---

# 48. NO DOCKER

Do not require:

```text
Docker
PostgreSQL
Redis
Supabase
External vector database
```

The application should run directly on the user's machine.

---

# 49. NO CLOUD DEPENDENCY

Do not make any cloud API mandatory.

The default flow must be:

```text
Electron
 ↓
Ollama
 ↓
Local Model
```

---

# 50. TYPESCRIPT

Use strict TypeScript.

tsconfig:

```json
{
  "compilerOptions": {
    "strict": true
  }
}
```

Avoid:

```ts
any
```

unless absolutely necessary.

Prefer:

```ts
unknown
```

with validation.

---

# 51. VALIDATION

Use a schema validation library such as:

```text
zod
```

Validate:

```text
MCP JSON
Skill frontmatter
Agent frontmatter
Settings
Knowledge Source
IPC arguments
Tool arguments
```

Never trust renderer input.

---

# 52. IPC DESIGN

Create typed IPC APIs.

Example:

```ts
window.api.chat.send(...)
window.api.chat.history(...)
window.api.models.list(...)
window.api.skills.list(...)
window.api.skills.save(...)
window.api.skills.delete(...)
window.api.agents.run(...)
window.api.knowledge.sync(...)
window.api.knowledge.search(...)
window.api.mcp.list(...)
window.api.mcp.start(...)
```

Do not expose raw Electron IPC to React.

---

# 53. LOGGING

Create application logging.

Separate:

```text
info
warn
error
debug
```

Logs should be available from:

```text
Settings → Logs
```

Avoid logging secrets.

Never log:

```text
API keys
tokens
passwords
environment secrets
```

---

# 54. TESTING

Add tests for:

```text
Ollama service
RAG chunking
RAG indexing
RAG search
Markdown parsing
Skill parser
Agent parser
MCP config parser
Saved Text
IPC validation
File editing
```

Test critical services independently from Electron UI.

---

# 55. UI TESTING

Test:

```text
Create conversation
Continue conversation
Load history
Create Skill
Edit Skill
Delete Skill
Create Agent
Run Agent
Create Saved Text
Edit Saved Text
Delete Saved Text
Add Knowledge Source
Sync URL
Remove Knowledge Source
Search Knowledge
Change Model
```

---

# 56. PERFORMANCE

Do not block Electron's main thread during:

```text
Embedding
Large file indexing
RAG search
Large file reading
Agent execution
MCP operations
```

Use appropriate workers/background processing where required.

The UI must remain responsive.

---

# 57. LARGE CODEBASE SUPPORT

The Knowledge Base and Agent system must handle large repositories.

Never load an entire large repository into an LLM context.

Use:

```text
File search
Symbol search
RAG
Targeted reads
```

Agent should first identify relevant files.

Example:

```text
User:
Fix authentication bug.

Agent:

1. Search authentication
2. Find relevant files
3. Read only relevant files
4. Understand dependency chain
5. Modify required files
6. Test
```

---

# 58. PROJECT UNDERSTANDING

Agents should support selecting a project folder.

Example:

```text
Agent Workspace

Project:
[ /Users/me/projects/my-app ]

Knowledge:
[ Project Docs ]

Skills:
[ React ]
[ TypeScript ]

Tools:
[ Filesystem ]
[ Git ]

Model:
[ qwen3-coder ]
```

The agent should understand:

```text
package.json
README.md
project structure
source files
configuration
tests
```

without blindly reading every file.

---

# 59. AGENT MEMORY

Do not create hidden permanent memory.

Use explicit sources:

```text
Conversation
Knowledge Base
Saved Text
Skills
Agent configuration
Project files
```

The agent must clearly know which context it is using.

---

# 60. CHANGE PREVIEW

When an agent wants to modify files, show a diff.

Example:

```diff
src/Button.tsx

- old implementation
+ new implementation
```

Actions:

```text
[Reject]
[Apply]
```

For multiple files:

```text
3 files changed

[Review All]
[Apply All]
```

---

# 61. COMMAND EXECUTION

For commands such as:

```text
pnpm test
pnpm lint
pnpm build
git diff
```

show execution:

```text
$ pnpm test

✓ 42 tests passed

Exit code: 0
```

Add timeout.

Capture:

```text
stdout
stderr
exit code
duration
```

---

# 62. AGENT LOOP

Implement a controlled agent loop:

```text
while task not complete:

    ask model for next action

    validate action

    if dangerous:
        request approval

    execute tool

    return tool result to model

    update task state

    continue
```

Add:

```text
maximum iterations
timeout
cancellation
```

Avoid infinite loops.

---

# 63. AGENT STATUS

Display:

```text
Planning
Reading
Searching
Editing
Running command
Testing
Completed
Failed
Waiting for approval
```

---

# 64. CANCELLATION

The user must be able to stop:

```text
Chat generation
RAG indexing
Agent execution
MCP operation
```

Use AbortController where possible.

---

# 65. DATA EXPORT

Add optional export/import for:

```text
Skills
Agents
MCP configurations
Saved Text
Settings
```

Use portable files.

Do NOT export secrets unless explicitly requested.

---

# 66. IMPORT

Allow:

```text
Import Skill
Import Agent
Import MCP JSON
Import Saved Markdown
```

Validate imported content.

---

# 67. SEARCH

Provide global search where useful.

Search:

```text
Chats
Skills
Agents
Saved Text
Knowledge
```

---

# 68. KEYBOARD SHORTCUTS

Add:

```text
Cmd/Ctrl + K
```

Global command/search.

```text
Cmd/Ctrl + N
```

New chat.

```text
Cmd/Ctrl + Enter
```

Send message.

```text
Esc
```

Cancel generation/agent.

---

# 69. ACCESSIBILITY

Use:

```text
ARIA labels
Keyboard navigation
Focus management
Accessible dialogs
Accessible accordion
Accessible buttons
```

Do not rely only on color to communicate state.

---

# 70. RESPONSIVE DESKTOP UI

Optimize for:

```text
1280x800
1440x900
1920x1080
```

Sidebar should be resizable/collapsible.

Chat content should have a maximum readable width.

---

# 71. THEME

Support:

```text
Dark
Light
System
```

Persist preference locally.

---

# 72. DEVELOPMENT COMMANDS

Provide:

```text
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm lint
pnpm typecheck
pnpm package
```

The application should start with:

```text
pnpm dev
```

---

# 73. BUILD TARGETS

Prepare architecture for:

```text
macOS
Windows
Linux
```

Initially prioritize macOS if development is happening on macOS.

Do not hardcode macOS paths.

Use:

```ts
app.getPath("userData")
```

---

# 74. DOCUMENTATION

Create:

```text
README.md
ARCHITECTURE.md
DEVELOPMENT.md
RAG.md
AGENTS.md
MCP.md
SKILLS.md
SECURITY.md
```

Documentation must explain how the system works.

---

# 75. FIRST-RUN EXPERIENCE

On first launch:

```text
Welcome to LocalAI Workspace

1. Check Ollama
2. Detect installed models
3. Select Chat Model
4. Select Embedding Model
5. Create application directories
6. Initialize SQLite
7. Initialize LanceDB
```

If Ollama is unavailable:

```text
Ollama not detected

[Retry]
[Open Ollama Documentation]
```

Do not prevent the user from opening other parts of the application.

---

# 76. EMPTY STATES

Every section must have a useful empty state.

Example:

```text
No Skills

Create your first reusable AI Skill.

[Create Skill]
```

Knowledge:

```text
No Knowledge Sources

Add documentation, files or URLs to create
your local knowledge base.

[Add Source]
```

Agents:

```text
No Agents

Create an agent for repetitive development tasks.

[Create Agent]
```

---

# 77. APPLICATION STATE

Use Zustand for renderer state.

Separate stores:

```text
chatStore
settingsStore
knowledgeStore
skillsStore
agentsStore
mcpStore
savedTextStore
```

Do not put everything into one global store.

---

# 78. IMPORTANT ARCHITECTURAL RULES

Follow these rules strictly:

1. Renderer cannot access Node.js directly.
2. Renderer cannot execute shell commands.
3. Secrets stay in main process.
4. MCP configs are files, not DB.
5. Skills are files, not DB.
6. Agents are files, not DB.
7. Saved Text is files, not DB.
8. RAG vectors are local.
9. Ollama is the default local LLM provider.
10. No cloud dependency for core features.
11. No Docker.
12. No unnecessary external services.
13. Use TypeScript.
14. Validate IPC input.
15. Never silently swallow errors.
16. Never log secrets.
17. Do not block the UI thread.
18. Agents must show file changes before applying them by default.
19. Dangerous commands require approval.
20. Do not blindly read the entire repository into the model.

---

# 79. IMPLEMENTATION ORDER

Do NOT attempt everything in one giant implementation.

Build in this order:

## Phase 1

Electron foundation:

```text
Electron
React
Vite
Tailwind
IPC
Preload
Security
Routing
Sidebar
```

Verify:

```text
pnpm dev
```

works.

---

## Phase 2

Ollama:

```text
Connection
Model list
Model selector
Chat
Streaming
```

Verify real Ollama communication.

---

## Phase 3

Chat history:

```text
SQLite
Conversations
Messages
Search
Rename
Delete
Continue conversation
```

---

## Phase 4

Saved Text:

```text
Filesystem storage
Markdown files
Create
Edit
Delete
Search
Send to Chat
```

---

## Phase 5

Skills:

```text
SKILL.md
Create
Read
Update
Delete
Accordion UI
Search
```

---

## Phase 6

MCP:

```text
JSON config
Create
Edit
Delete
Enable
Start
Stop
Tool discovery
Logs
```

---

## Phase 7

Knowledge Base:

```text
LanceDB
Embedding provider
Source management
Markdown normalization
Chunking
Indexing
Search
```

---

## Phase 8

URL Sync:

```text
URL fetch
Normalize
Remove old vectors
Preview
Re-index
Progress
```

---

## Phase 9

Agents:

```text
Agent Markdown
Model
Skills
Tools
Knowledge
Project folder
Agent loop
```

---

## Phase 10

Developer tools:

```text
Filesystem tools
Git tools
Shell tools
Diff
Approval
Apply changes
Testing
```

---

## Phase 11

Polish:

```text
Settings
API keys
Themes
Keyboard shortcuts
Error handling
Logging
Performance
Accessibility
Tests
Documentation
Packaging
```

---

# 80. CODING STYLE

Write maintainable production code.

Prefer:

```text
small services
typed interfaces
dependency injection
clear boundaries
pure functions
testable modules
```

Avoid:

```text
giant components
giant services
global mutable state
duplicated logic
hardcoded paths
hardcoded models
hardcoded ports
```

---

# 81. DO NOT CREATE FAKE FUNCTIONALITY

Do NOT implement:

```ts
// TODO
// fake response
// mock agent
// pretend indexing
// fake MCP connection
```

unless it is specifically inside a test.

If a feature cannot yet be fully implemented, create the correct interface and clearly document the missing implementation.

But prioritize implementing real functionality.

---

# 82. MODEL DEFAULTS

Do not assume the exact model name is available.

Detect installed Ollama models.

For coding tasks, allow a coding-capable Qwen model to be selected.

For embeddings:

```text
nomic-embed-text
```

should be the initial recommended option, but allow the user to select another compatible embedding model.

---

# 83. FINAL ACCEPTANCE CRITERIA

The application is considered functional only when this workflow works:

```text
Launch Electron
      ↓
Connect to Ollama
      ↓
Select local model
      ↓
Create Chat
      ↓
Send message
      ↓
Receive streaming response
      ↓
Close application
      ↓
Open application
      ↓
Conversation still exists
```

Knowledge workflow:

```text
Add Markdown source
      ↓
Index
      ↓
Search
      ↓
Get relevant chunks
      ↓
Ask Chat
      ↓
Answer contains retrieved context
```

URL workflow:

```text
Add URL
      ↓
Sync
      ↓
Preview generated
      ↓
Index
      ↓
Search
      ↓
Sync again
      ↓
Old vectors removed
      ↓
New content indexed
```

Skill workflow:

```text
Create Skill
      ↓
SKILL.md created
      ↓
Skill appears in accordion
      ↓
Expand
      ↓
Edit
      ↓
Save
      ↓
Delete
```

Agent workflow:

```text
Create Agent
      ↓
Select Model
      ↓
Select Skills
      ↓
Select Tools
      ↓
Select Knowledge
      ↓
Select Project Folder
      ↓
Run task
      ↓
Agent reads source code
      ↓
Agent searches relevant files
      ↓
Agent proposes changes
      ↓
User reviews diff
      ↓
User approves
      ↓
Agent modifies files
      ↓
Agent runs tests
      ↓
Agent reports result
```

---

# 84. IMPORTANT QWEN CODE EXECUTION INSTRUCTIONS

You are operating as a coding agent inside a local development environment.

Before writing code:

1. Inspect the existing repository.
2. Determine whether a project already exists.
3. Do not destroy existing work.
4. Reuse existing configuration when appropriate.
5. Identify the package manager.
6. Inspect package.json.
7. Inspect existing source structure.
8. Create a short implementation plan.

Then implement the project.

After each major phase:

```text
Run typecheck
Run lint
Run tests
Run build where appropriate
```

Fix errors before continuing.

Do not ask unnecessary questions.

If a reasonable implementation decision can be made, make it.

When requirements conflict, prioritize:

```text
Security
Correctness
Local-first architecture
Maintainability
User experience
```

---

# 85. FINAL COMMAND

Start by inspecting the repository.

Then create:

```text
ARCHITECTURE.md
```

with the proposed architecture.

After that, immediately implement Phase 1.

Do not only explain what you would build.

Actually create the files and code.

Continue phase by phase until the application is functional.

At the end of every phase, report:

```text
Completed
Files created/changed
Commands executed
Tests
Known issues
Next phase
```

The goal is to produce a real, runnable Electron desktop AI workspace — not a prototype screenshot or static UI.
