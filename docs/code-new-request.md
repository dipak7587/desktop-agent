
You are modifying an EXISTING Electron + TypeScript application.

IMPORTANT:

The application already has a working **Code sidebar / Code workspace UI**.

DO NOT redesign the Code sidebar.

DO NOT rebuild the UI from scratch.

DO NOT remove existing working functionality.

Your responsibility is to inspect the existing implementation and replace/refactor the INTERNAL CODING AGENT ARCHITECTURE so the existing Code area is powered by:

```text
deepagents
+
deepagents-acp
+
local LLM
```

The final user experience should feel similar to a local coding assistant such as Codex:

- user selects a project/code folder
- user chats naturally
- agent understands the selected project
- agent can answer questions about the project
- agent can search/read project files
- agent can edit/create files when requested
- agent can run commands when permitted
- agent can inspect errors
- agent can fix code
- agent can run tests
- agent can run lint/typecheck
- agent can explain code
- agent can perform multi-step coding tasks
- agent should remember the active conversation/session
- all operations are scoped to the selected code folder
- inference uses the configured LOCAL MODEL

The user should NOT need to understand ACP, DeepAgents, LangGraph, tools, or internal architecture.

---

# CORE PRINCIPLE

Treat the selected folder as the active coding workspace.

Example:

```text
User selects:

/Users/me/projects/my-electron-app
```

That becomes:

```text
workspaceRoot
```

for the DeepAgent/ACP session.

Everything the agent does must be scoped to that workspace unless explicitly allowed otherwise.

Architecture should approximately become:

```text
Existing Code UI
      ↓
Code Chat Store
      ↓
Code Agent Service
      ↓
ACP Client / Adapter
      ↓
deepagents-acp
      ↓
DeepAgent
      ↓
Local Model
      ↓
Selected Workspace
```

Do not tightly couple React components directly to DeepAgents APIs.

---

# 1. FIRST ANALYZE THE EXISTING PROJECT

Before changing code:

Inspect the entire existing Code feature.

Locate:

```text
Code sidebar
Code page
Code chat
selected folder logic
workspace state
IPC handlers
preload APIs
Electron main process
agent implementation
model/provider implementation
terminal integration
file utilities
permission handling
chat history
stores
services
types
```

Search for concepts such as:

```text
code
workspace
folder
project
agent
chat
terminal
shell
readFile
writeFile
provider
ollama
model
ipc
preload
```

Understand the CURRENT data flow before modifying anything.

Do not assume filenames.

Do not introduce a parallel implementation while the old implementation remains active.

Refactor the existing architecture.

---

# 2. PRESERVE THE EXISTING CODE UI

The current Code sidebar/page is already working.

Preserve:

- current layout
- current styling
- current folder selection UI
- current chat UI
- current message rendering
- current sidebar navigation
- current dark/light theme
- current icons
- current buttons
- current Code route

Only modify UI when required to expose genuinely new runtime states such as:

```text
Working
Reading files
Running command
Waiting for approval
Error
Stopped
```

Avoid unnecessary visual changes.

---

# 3. SELECTED FOLDER = WORKSPACE ROOT

The most important behavior is:

```text
selectedCodeFolder
        ↓
workspaceRoot
        ↓
DeepAgents filesystem / ACP session
```

Example concept:

```ts
const workspaceRoot = selectedCodeFolder;
```

The selected folder must be the source of truth.

Do NOT use:

```ts
process.cwd()
```

for every Code session when the user has selected another folder.

If no folder is selected, prevent workspace-specific operations and show the existing folder selection experience.

---

# 4. CREATE ONE WORKSPACE CONTEXT

Create/refactor a single workspace context similar to:

```ts
interface CodeWorkspace {
  id: string;
  rootPath: string;
  name: string;

  agentSessionId?: string;

  status:
    | "idle"
    | "starting"
    | "ready"
    | "running"
    | "waiting_permission"
    | "error";
}
```

Use the project's existing store architecture.

Do not create duplicate workspace state in multiple React components.

---

# 5. DEEPAGENTS-ACP INTEGRATION

Use the installed/current `deepagents-acp` API.

Do NOT blindly copy outdated examples.

Inspect:

```text
package.json
package-lock.json / pnpm-lock.yaml / yarn.lock
node_modules/deepagents-acp
installed TypeScript declarations
official package documentation
```

Implement against the actual installed version.

`deepagents-acp` should act as the standardized bridge between the application and DeepAgents.

Conceptually:

```ts
import { DeepAgentsServer } from "deepagents-acp";
```

or use the current equivalent API exposed by the installed package.

Example concept:

```ts
const server = new DeepAgentsServer({
  agents: [
    {
      name: "code-agent",
      description: "Local workspace coding assistant",
      model: selectedModel,
      skills: ["./skills/"],
      memory: ["./.deepagents/AGENTS.md"],
    },
  ],

  workspaceRoot,
  debug: isDevelopment,
});
```

Adapt this to the actual installed API.

---

# 6. LOCAL MODEL ONLY

The Code Agent must work with the application's configured local model.

Primary target:

```text
Ollama
```

but architecture should remain provider-agnostic enough to support:

```text
Ollama
vLLM
llama.cpp
LM Studio
other LangChain-compatible local chat models
```

Do not hardcode Anthropic or OpenAI.

Do not require cloud API keys.

Example desired flow:

```text
Settings
   ↓
Provider: Ollama
   ↓
Model: selected local model
   ↓
DeepAgent
```

Use the application's existing provider/model configuration if one exists.

Do not create a second independent model configuration system.

---

# 7. LOCAL MODEL CAPABILITY CHECK

DeepAgents requires a model capable of effectively using tools.

Therefore detect/document whether the selected local model supports:

```text
tool calling
structured tool invocation
multi-turn reasoning
```

Do not silently fail if an unsuitable model is selected.

Expose a useful error such as:

```text
The selected model does not appear to support tool calling,
which is required for Code Agent operations.
```

Do not artificially block normal text Q&A if the model can still answer basic questions.

---

# 8. GENERAL QUESTIONS MUST WORK

The Code page must NOT only accept coding commands.

Users should be able to ask normal questions.

Examples:

```text
What does this project do?
```

```text
Explain this architecture.
```

```text
Where is authentication implemented?
```

```text
Which file handles MCP?
```

```text
How does the chat flow work?
```

```text
Why are we using LangChain here?
```

The agent should answer using the selected workspace when the question relates to the project.

---

# 9. PROJECT-AWARE QUESTIONS

If the question refers to the project:

```text
How does authentication work?
```

the agent should NOT guess.

It should inspect relevant files.

Desired flow:

```text
User question
   ↓
Agent determines project context is needed
   ↓
search files
   ↓
read relevant files
   ↓
understand relationships
   ↓
answer
```

Example:

User:

```text
Where is MCP initialized?
```

Agent:

```text
Search workspace
→ locate MCP-related files
→ read relevant files
→ answer with actual file paths
```

---

# 10. DO NOT READ THE ENTIRE CODEBASE FOR EVERY QUESTION

The agent should behave intelligently.

Do NOT automatically scan every project file.

Preferred process:

```text
question
   ↓
search
   ↓
identify likely files
   ↓
read only relevant portions
   ↓
follow imports/references when needed
```

This is particularly important for local models with smaller context windows.

---

# 11. CODE SEARCH

Provide the agent with reliable workspace search capability.

It should be able to search:

```text
filenames
directory names
symbols
classes
functions
imports
text
configuration keys
package dependencies
```

Prefer existing project search infrastructure if present.

Otherwise create a safe workspace search tool.

Do not index:

```text
node_modules
.git
dist
build
coverage
out
.next
.cache
```

unless necessary.

Respect `.gitignore` where practical.

---

# 12. FILE READING

The agent must be able to read files inside the selected workspace.

Example:

```text
read_file
```

Input:

```ts
{
  path: string;
}
```

Resolve all paths against:

```text
workspaceRoot
```

Prevent directory traversal outside the selected workspace.

Reject paths such as:

```text
../../../../etc/passwd
```

unless a separate explicitly approved external access feature exists.

---

# 13. FILE EDITING

When the user asks:

```text
fix this bug
```

or:

```text
add validation
```

the agent should be capable of modifying code.

Preferred process:

```text
understand request
↓
search
↓
read
↓
plan
↓
edit
↓
inspect diff
↓
test
↓
report
```

Use DeepAgents/ACP file edit capabilities where available.

Do not write custom duplicate file editing logic if the library already provides it.

---

# 14. FILE CREATION

Support requests such as:

```text
Create a new service for agent sessions.
```

The agent should determine the correct project location based on existing architecture.

Do not dump new files into arbitrary directories.

Inspect nearby code first.

---

# 15. DIFFS

Changes should be represented as diffs whenever supported by ACP.

The UI/service should be able to understand:

```text
file changed
lines added
lines removed
```

Architecture should support future diff preview without changing the agent implementation again.

---

# 16. TERMINAL / COMMAND EXECUTION

The coding agent should be able to run project commands when needed.

Examples:

```text
npm test
npm run lint
npm run typecheck
pnpm test
git status
```

But commands must run with:

```text
cwd = selected workspace
```

Never default command execution to the application installation folder when another project is selected.

---

# 17. PERMISSION SYSTEM

Potentially impactful operations should request permission according to existing application policy.

Examples:

```text
terminal command
file deletion
large file overwrite
dependency installation
git destructive actions
external process execution
```

ACP supports permission-oriented interactions, so use the protocol instead of creating random confirmation logic where possible.

Desired flow:

```text
Agent wants command
      ↓
ACP permission request
      ↓
Existing Code UI
      ↓
Approve / Reject
      ↓
Agent continues
```

---

# 18. SAFE COMMAND EXECUTION

Never automatically execute obviously destructive commands such as:

```text
rm -rf
git reset --hard
git clean -fd
DROP DATABASE
disk formatting
```

without explicit approval.

Always scope shell execution to the workspace.

Do not expose arbitrary host filesystem access.

---

# 19. CODING AGENT SYSTEM INSTRUCTIONS

Create a strong coding system prompt.

The agent should behave approximately like this:

```text
You are a local coding assistant working inside the user's selected project.

Treat the selected workspace as your primary source of truth.

When answering project-specific questions:
- inspect relevant project files instead of guessing
- search before reading large portions of the project
- cite file paths when explaining implementation

When modifying code:
- inspect related code first
- follow existing architecture and conventions
- make minimal changes
- avoid unrelated refactoring
- preserve working behavior
- run appropriate validation after changes

You may:
- read project files
- search project files
- create files
- modify files
- run approved terminal commands
- run tests
- run lint
- run type checking
- inspect package configuration
- inspect git diff/status

Never fabricate project details.

If the answer can be given without changing code, simply answer the user.

Do not modify files unless the user's request requires a change.

Do not run terminal commands unnecessarily.
```

---

# 20. CODING TASK EXAMPLE

User:

```text
Fix the login validation bug.
```

Expected agent behavior:

```text
1. Search for login/authentication implementation.
2. Inspect relevant components/services.
3. Inspect relevant tests.
4. Determine root cause.
5. Modify minimal code.
6. Run focused tests.
7. Run typecheck/lint if appropriate.
8. Explain changes.
```

Not:

```text
scan every file
rewrite authentication
install random package
```

---

# 21. GENERAL PROJECT QUESTION EXAMPLE

User:

```text
How is the agent created in this project?
```

Expected:

```text
1. Search for DeepAgents/agent initialization.
2. Read relevant files.
3. Follow imports if necessary.
4. Explain actual architecture.
5. Include relevant project paths.
```

No code modification should occur.

---

# 22. NON-PROJECT QUESTION EXAMPLE

User:

```text
What is dependency injection?
```

The model can answer normally.

Do NOT unnecessarily search the project unless project context would materially improve the answer.

This is important.

The Code chat should remain a NORMAL CHAT capable of coding work, not a command-only interface.

---

# 23. CONTEXT DECISION

Implement clear behavior:

```text
QUESTION
   ↓
Does this require project context?
   ↓
YES → search/read workspace
NO  → answer directly
```

Examples requiring workspace:

```text
What does our chat service do?
Where is this error coming from?
Explain this function.
Why does build fail?
```

Examples not requiring workspace:

```text
What is React memo?
Explain TypeScript generics.
What is LangGraph?
```

---

# 24. SESSION SUPPORT

ACP sessions should map to Code conversations.

Desired relationship:

```text
Code Chat
   ↕
ACP Session
   ↕
DeepAgent
```

Each conversation should have a stable session ID.

Example:

```ts
interface CodeConversation {
  id: string;
  workspaceId: string;
  agentSessionId: string;
  messages: CodeMessage[];
}
```

Do not recreate the agent session on every message.

---

# 25. FOLDER SWITCHING

When the user switches from:

```text
/project-a
```

to:

```text
/project-b
```

do NOT accidentally retain project A as the active filesystem context.

Create/load the correct workspace-specific ACP session.

Desired isolation:

```text
Project A
  └── sessions for A

Project B
  └── sessions for B
```

---

# 26. CONVERSATION HISTORY

Preserve the existing conversation history behavior.

Do not rely solely on React component memory.

Use the existing persistence architecture.

ACP/deep agent session state should complement, not unnecessarily replace, existing application persistence.

---

# 27. AGENTS.md SUPPORT

Support optional project instructions.

For example:

```text
<workspace>/.deepagents/AGENTS.md
```

or another application-configured path.

The coding agent can use it for:

```text
coding rules
architecture rules
test commands
project conventions
security requirements
```

Do not require AGENTS.md for every project.

If missing, the agent should still work.

---

# 28. SKILLS SUPPORT

Allow the Code Agent to use DeepAgents skills.

Potential structure:

```text
skills/
  coding/
  testing/
  debugging/
  review/
```

But do not require the user to manually choose a skill for ordinary questions.

The agent should use appropriate skills internally.

---

# 29. SUBAGENTS

DeepAgents supports sub-agent style workflows.

Design the service so future tasks can delegate, for example:

```text
Main Code Agent
├─ Explorer
├─ Implementer
├─ Tester
└─ Reviewer
```

However:

DO NOT implement unnecessary multi-agent complexity just because it exists.

Start with one strong Code Agent.

Keep interfaces extensible.

---

# 30. LOCAL MODEL CONTEXT MANAGEMENT

Local models may have smaller context windows.

Therefore:

- avoid dumping entire files unnecessarily
- avoid dumping entire repository trees
- search first
- read relevant sections
- summarize previous findings
- use DeepAgents context management
- avoid repeatedly feeding identical content

This is mandatory.

---

# 31. MODEL CONFIGURATION

Use the application's existing model selection.

Example:

```text
Settings

Provider: Ollama
Model: qwen3-coder
```

Code Agent should receive this selected configuration.

Conceptually:

```ts
createCodeAgent({
  workspaceRoot,
  model: selectedModel,
});
```

Do not hard-code:

```ts
claude-sonnet...
```

---

# 32. OLLAMA

If the existing app uses Ollama, integrate through the existing LangChain-compatible Ollama model layer.

Concept:

```text
Ollama
  ↓
LangChain chat model
  ↓
DeepAgent
```

Use the actual installed LangChain package/API.

Do not introduce raw HTTP calls to Ollama if the application already has an abstraction.

---

# 33. ACP EVENT STREAMING

Support streaming from the agent.

The existing Code UI should receive events such as:

```text
assistant text
thinking/status
tool started
tool completed
file read
file edit
command started
command completed
permission request
error
final response
```

Map actual ACP events to application UI events.

Do not invent protocol event names.

Create an adapter.

---

# 34. DO NOT EXPOSE RAW ACP TO REACT

Bad:

```tsx
deepAgentsServer.someInternalMethod(...)
```

inside a component.

Good:

```tsx
codeAgent.sendMessage(...)
```

React should depend on an application abstraction.

Example:

```ts
interface CodeAgentClient {
  startWorkspace(path: string): Promise<void>;

  sendMessage(
    conversationId: string,
    message: string
  ): Promise<void>;

  stop(): Promise<void>;

  approvePermission(id: string): Promise<void>;

  rejectPermission(id: string): Promise<void>;
}
```

---

# 35. ELECTRON ARCHITECTURE

Because this is Electron, keep Node-level agent functionality outside the renderer.

Preferred architecture:

```text
React Renderer
      ↓
Preload
      ↓
IPC
      ↓
Code Agent Manager
      ↓
ACP
      ↓
DeepAgent
      ↓
Filesystem / Terminal
```

Do not give renderer unrestricted filesystem or shell access.

---

# 36. PRELOAD API

Extend the existing preload bridge rather than exposing Node directly.

Conceptual API:

```ts
window.codeAgent.selectWorkspace(path);

window.codeAgent.sendMessage({
  conversationId,
  text,
});

window.codeAgent.stop();

window.codeAgent.approvePermission(id);

window.codeAgent.rejectPermission(id);

window.codeAgent.onEvent(callback);
```

Adjust this to existing application patterns.

---

# 37. AGENT MANAGER

Create/refactor a central manager.

Example concept:

```text
CodeAgentManager
```

Responsibilities:

```text
workspace lifecycle
DeepAgent lifecycle
ACP lifecycle
sessions
model selection
event streaming
permissions
cancellation
cleanup
```

Do not put this logic inside React components.

---

# 38. ONE AGENT INSTANCE PER APPROPRIATE SCOPE

Do not start a new DeepAgents server for every token or every React render.

Determine the correct lifecycle from the installed package.

Prefer something such as:

```text
application agent runtime
+
workspace-specific sessions
```

or:

```text
workspace runtime
+
multiple conversations
```

depending on the capabilities of the installed version.

---

# 39. CANCELLATION

Existing Code chat should support Stop.

Example:

```text
User
→ "Fix all TypeScript errors"

Agent starts work

User clicks Stop

ACP/agent execution should cancel cleanly.
```

Do not merely stop UI rendering while backend execution continues.

---

# 40. ERROR HANDLING

Handle:

```text
Ollama offline
model missing
model load failure
ACP connection failure
workspace missing
workspace deleted
filesystem permission denied
tool failure
terminal failure
agent failure
invalid session
context overflow
```

Return understandable UI errors.

Example:

```text
Could not connect to Ollama.

Check that Ollama is running and that the selected model is installed.
```

Avoid dumping raw stack traces to normal users.

Keep detailed logs available in development/debug mode.

---

# 41. LOGGING

Add useful debug logs around:

```text
workspace selected
ACP started
agent created
session created
prompt received
tool started
tool completed
permission requested
run completed
run failed
```

For example:

```text
[CodeAgent] workspace initialized
[CodeAgent] session created
[ACP] prompt received
[ACP] tool call started: read_file
```

Do not log secrets or huge file contents.

---

# 42. VERIFY THE USER MESSAGE REACHES THE AGENT

Implement development diagnostics so we can verify the complete path:

```text
UI
→ preload
→ IPC
→ CodeAgentManager
→ ACP
→ DeepAgent
→ model
```

Example debug logging:

```text
[CodeUI] sending message

[IPC] code-agent:message received

[CodeAgent] sending prompt to session <id>

[ACP] prompt received

[DeepAgent] model invocation started

[DeepAgent] model invocation completed
```

This is important for debugging.

---

# 43. TESTING REQUIREMENTS

After implementation, test at minimum:

### Workspace

```text
select project folder
initialize agent
switch folder
close folder
```

### Chat

```text
ask normal question
ask project question
ask architecture question
```

### Files

```text
search
read
create
edit
```

### Commands

```text
run safe command
reject command
approve command
```

### Coding

```text
fix small bug
run relevant test
report result
```

### Sessions

```text
send multiple messages
continue same conversation
open new conversation
switch workspace
```

### Local model

```text
Ollama running
Ollama offline
missing model
tool-capable model
```

---

# 44. DO NOT CREATE CUSTOM AGENT LOGIC UNNECESSARILY

Important architectural rule:

Use DeepAgents capabilities wherever they already exist.

Do not recreate:

```text
agent planning
tool orchestration
filesystem agent loop
subagent orchestration
context management
```

using custom application logic unless required.

Our application should mainly provide:

```text
UI
workspace selection
model configuration
security boundaries
permissions
ACP integration
persistence
event presentation
```

DeepAgents should handle the agent reasoning/orchestration.

---

# 45. DO NOT TURN THIS INTO A CLI

The user interacts through the existing graphical application.

Do not require:

```bash
npx deepagents-acp
```

as a normal user workflow.

Programmatically integrate the package into the Electron application.

CLI commands may be used during development/testing only.

---

# 46. EXPECTED USER EXPERIENCE

The final result should work like:

```text
Code
│
├── Select Folder
│     /projects/my-app
│
└── Chat
```

User:

```text
Explain this project.
```

Agent:

```text
searches relevant files
reads package.json / entry points
explains project
```

User:

```text
Where is the DeepAgents server initialized?
```

Agent:

```text
searches project
reads implementation
answers with file paths
```

User:

```text
Change it so the workspace comes from the selected Code folder.
```

Agent:

```text
searches
reads
edits
shows progress
validates
explains changes
```

User:

```text
Run the tests.
```

Agent:

```text
requests command permission if required
runs correct package-manager command
reads output
explains results
```

This should feel like a local graphical Codex-style workspace.

---

# 47. IMPLEMENTATION STRATEGY

Perform the work in this order:

```text
Phase 1
Analyze existing Code architecture

Phase 2
Map current architecture to DeepAgents/ACP

Phase 3
Create/refactor CodeAgentManager

Phase 4
Connect selected folder → workspaceRoot

Phase 5
Connect existing local model configuration

Phase 6
Implement ACP sessions

Phase 7
Connect chat message streaming

Phase 8
Connect filesystem operations

Phase 9
Connect terminal + permissions

Phase 10
Connect cancellation

Phase 11
Add error handling/logging

Phase 12
Run tests and fix regressions
```

Do NOT begin by rewriting the UI.

---

# 48. BEFORE WRITING CODE

Produce a concise architecture assessment containing:

```text
Current Code Flow

Current relevant files

Current agent implementation

Current local model implementation

Current workspace/folder implementation

Current IPC/preload flow

What can be reused

What must change

What should be removed/replaced

Proposed DeepAgents ACP flow
```

Then implement it.

Do not stop after the assessment unless implementation is blocked by a real technical limitation.

---

# 49. AFTER IMPLEMENTATION

Report:

```text
Architecture changed

Files changed

DeepAgents integration

ACP integration

Local model integration

Workspace integration

Session behavior

Permissions

Commands/tests executed

Remaining limitations
```

Also provide the final runtime flow:

```text
Selected Code Folder
        ↓
Existing Code UI
        ↓
IPC / Preload
        ↓
CodeAgentManager
        ↓
deepagents-acp
        ↓
DeepAgent
        ↓
Local Model
        ↓
Workspace Tools
```

---

# FINAL RULES

DO:

- understand existing code first
- reuse existing UI
- use selected folder as workspace root
- use the configured local model
- use DeepAgents for agent behavior
- use `deepagents-acp` for ACP integration
- support normal conversation
- support project-aware Q&A
- search/read files when project context is needed
- allow coding operations
- support tests/lint/typecheck
- support permissions
- support sessions
- support streaming
- keep Electron security boundaries

DO NOT:

- rebuild the entire Code feature
- redesign the sidebar unnecessarily
- hard-code Claude/OpenAI
- require cloud APIs
- scan the entire repository for every question
- automatically modify code for simple questions
- expose filesystem/shell directly to React
- create a second model configuration system
- run commands outside the selected workspace
- create custom orchestration that DeepAgents already provides
- fake ACP behavior
- use outdated package APIs without checking installed versions

The goal is:

**Turn the EXISTING Code feature into a full local project-aware coding assistant powered by DeepAgents + `deepagents-acp`, while keeping the current UI and allowing the user to ask anything—from simple questions to complete coding tasks—against the selected code folder.**