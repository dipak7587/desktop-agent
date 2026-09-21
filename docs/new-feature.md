# Feature: Intelligent Agent Capability Decision & Tool Routing

## Objective

Implement a robust **Agent Capability Decision Layer** for the local AI agent.

The agent may have access to:

* Skills
* MCP Servers
* Tools
* Knowledge Bases / RAG
* Local project context

The agent must **decide whether a capability is actually required before calling it**.

The existence or selection of a capability must NOT automatically trigger execution.

The system must prevent unnecessary tool calls and must strictly respect user-disabled capabilities.

---

# 1. Core Requirement

Before executing any Skill, MCP, Tool, or Knowledge Base query, the agent must evaluate:

1. Is this capability enabled?
2. Is this capability allowed for the current agent?
3. Is this capability selected by the user?
4. Is this capability relevant to the current request?
5. Is the capability actually required?
6. Can the request be answered without using it?
7. Does the capability require user confirmation?

Only when the decision is positive should the capability be executed.

---

# 2. Capability Types

Create a common capability model.

```ts
type CapabilityType =
  | "skill"
  | "mcp"
  | "tool"
  | "knowledge";
```

Create:

```ts
interface Capability {
  id: string;
  name: string;
  type: CapabilityType;
  description?: string;
  enabled: boolean;
}
```

---

# 3. Capability Modes

Support three modes:

```ts
type CapabilityMode =
  | "auto"
  | "selected"
  | "none";
```

### Auto

The agent can use any enabled capability when relevant.

### Selected

The agent can only use capabilities explicitly selected by the user.

### None

The agent must not use any external capability.

Example:

```json
{
  "mode": "none"
}
```

Expected behavior:

```text
User:
Explain React Server Components.

Agent:
Answer directly.

Tool calls:
0
```

---

# 4. Agent Configuration

Create:

```ts
interface AgentCapabilityConfig {
  mode: CapabilityMode;

  skills: string[];

  mcpServers: string[];

  tools: string[];

  knowledgeBases: string[];

  allowSkills: boolean;

  allowMCP: boolean;

  allowTools: boolean;

  allowKnowledgeBase: boolean;
}
```

Example:

```json
{
  "mode": "selected",
  "allowSkills": true,
  "allowMCP": true,
  "allowTools": false,
  "allowKnowledgeBase": true,
  "skills": [
    "code-review"
  ],
  "mcpServers": [
    "github"
  ],
  "tools": [],
  "knowledgeBases": [
    "carbon-platform"
  ]
}
```

---

# 5. Capability Decision Engine

Create a central service:

```ts
CapabilityDecisionEngine
```

Example API:

```ts
interface CapabilityDecision {
  shouldCall: boolean;

  capability?: Capability;

  reason: string;

  confidence?: number;

  requiresConfirmation?: boolean;
}
```

Main method:

```ts
decide(
  userRequest: string,
  capability: Capability,
  config: AgentCapabilityConfig,
  context?: AgentContext
): Promise<CapabilityDecision>;
```

---

# 6. Decision Rules

Implement the following rules in this exact priority order.

## Rule 1 — Explicitly disabled capability

If the capability is disabled:

```text
shouldCall = false
```

Example:

```text
User:
No MCP.

Question:
Get Jira ticket CRBN-123.
```

Do not call Jira MCP.

The agent should explain that MCP access is disabled if necessary.

---

## Rule 2 — None mode

If:

```ts
mode === "none"
```

then:

```text
No Skills
No MCP
No Tools
No Knowledge Base
```

may be called.

This rule must override every other rule.

---

## Rule 3 — Capability not selected

When mode is:

```ts
mode === "selected"
```

only selected capabilities may be used.

Example:

```text
Selected:
- GitHub MCP

Available:
- GitHub MCP
- Jira MCP
- Slack MCP
```

The agent may use GitHub but must not call Jira or Slack.

---

## Rule 4 — Capability relevance

A selected capability is NOT automatically executed.

Example:

```text
Selected Skill:
Code Review
```

User:

```text
What is React?
```

Decision:

```json
{
  "shouldCall": false,
  "reason": "The request does not require code review."
}
```

---

## Rule 5 — Direct answer preferred

If the model can answer accurately without external capabilities:

```text
Do not call a capability.
```

Example:

```text
User:
What does Array.map() do?

MCP available: GitHub
Skill available: Code Review
KB available: React Docs
```

Expected:

```text
Direct answer.
0 capability calls.
```

---

# 7. Knowledge Base Decision

Knowledge Base should be used when the request requires project-specific or stored information.

Use KB when:

```text
"According to our project..."
"How does our Carbon Platform work?"
"What are our coding standards?"
"Search the project documentation."
"What does our architecture document say?"
```

Do not use KB unnecessarily for general knowledge.

Example:

```text
User:
What is TypeScript?

KB:
NO
```

Example:

```text
User:
What TypeScript rules does our project require?

KB:
YES
```

---

# 8. Skill Decision

Skills represent reusable specialized workflows.

Example:

```text
Skill:
code-review
```

Use it for:

```text
Review this code.
Review this MR.
Check coding standards.
Analyze this pull request.
```

Do not use it for:

```text
Explain JavaScript promises.
```

---

# 9. MCP Decision

MCP should only be called when external data or external action is required.

Example:

```text
User:
Show me Jira CRBN-123.

MCP:
jira → YES
```

Example:

```text
User:
What is Jira?

MCP:
NO
```

---

# 10. Tool Decision

Tools should only be called when required.

Example:

```text
User:
List files in this project.

File Tool:
YES
```

Example:

```text
User:
Explain what a package.json file is.

File Tool:
NO
```

---

# 11. Explicit User Instructions Have Highest Priority

Detect explicit instructions such as:

```text
No tools.
Don't use tools.
Don't call MCP.
No MCP.
Don't use skills.
No skills.
Don't search the knowledge base.
Don't access the project.
Answer directly.
Use only the model.
```

Convert them into capability restrictions.

Example:

```text
User:
No skills, no MCP, no tools.
Explain React hooks.
```

Runtime configuration should become:

```json
{
  "allowSkills": false,
  "allowMCP": false,
  "allowTools": false,
  "allowKnowledgeBase": false
}
```

Expected tool calls:

```text
0
```

---

# 12. Capability Router

Create:

```ts
CapabilityRouter
```

Responsibilities:

```text
1. Receive user request.
2. Read agent configuration.
3. Read available capabilities.
4. Evaluate relevance.
5. Build capability decision.
6. Validate permissions.
7. Ask for confirmation when required.
8. Execute only approved capabilities.
9. Return results to the agent.
```

Architecture:

```text
User Request
     ↓
Agent
     ↓
Capability Decision Engine
     ↓
Capability Router
     ↓
Permission Check
     ↓
┌─────────┬─────────┬────────┬──────────┐
│ Skills  │   MCP   │ Tools  │    KB    │
└─────────┴─────────┴────────┴──────────┘
     ↓
Execution
     ↓
Agent
     ↓
Final Response
```

---

# 13. Permission Layer

Create:

```ts
type PermissionMode =
  | "always_allow"
  | "ask"
  | "deny";
```

Example:

```json
{
  "terminal": "ask",
  "github-read": "always_allow",
  "github-write": "ask",
  "file-delete": "deny"
}
```

Before executing a capability:

```ts
checkPermission(capability)
```

If:

```text
deny
```

never execute.

If:

```text
ask
```

request user confirmation.

If:

```text
always_allow
```

execute if capability relevance rules pass.

---

# 14. Decision Trace

Add an optional decision trace for debugging.

Example:

```json
{
  "request": "Explain React hooks",
  "decision": "direct_answer",
  "capabilitiesEvaluated": [
    {
      "type": "skill",
      "name": "code-review",
      "selected": true,
      "relevant": false,
      "called": false
    },
    {
      "type": "mcp",
      "name": "github",
      "selected": true,
      "relevant": false,
      "called": false
    },
    {
      "type": "knowledge",
      "name": "carbon-platform",
      "selected": true,
      "relevant": false,
      "called": false
    }
  ]
}
```

This should be available in development/debug mode.

---

# 15. UI

Add a capability section to Agent Settings.

```text
Agent Capabilities

Mode
○ Auto
○ Selected
● None

Skills
☐ Code Review
☐ Jira Review
☐ Documentation Generator

MCP
☐ GitHub
☐ Jira
☐ Slack

Knowledge Base
☐ Carbon Platform
☐ Project Documentation

Tools
☐ File System
☐ Terminal
☐ Git
```

When `None` is selected, disable all capability checkboxes.

When `Selected` is selected, allow individual capability selection.

---

# 16. Chat UI Decision Indicator

Show optional capability decisions in the chat.

Example:

```text
Capability Decision

✓ No tool required
✓ No MCP required
✓ No skill required
✓ No knowledge search required

Answering directly...
```

For an MCP call:

```text
Capability Decision

✓ GitHub MCP is relevant
→ Reading repository information...
```

For a Skill:

```text
Capability Decision

✓ Code Review skill matched
→ Running code review workflow...
```

---

# 17. Important Anti-Pattern

DO NOT implement:

```ts
if (selectedSkills.length > 0) {
  executeAllSkills();
}
```

DO NOT implement:

```ts
if (mcpServers.length > 0) {
  callMCP();
}
```

DO NOT implement:

```ts
if (knowledgeBases.length > 0) {
  searchKnowledgeBase();
}
```

Availability or selection does not equal execution.

---

# 18. Correct Implementation

Use:

```ts
const decision = await capabilityDecisionEngine.decide(
  userRequest,
  capability,
  config,
  context
);

if (!decision.shouldCall) {
  return;
}

if (decision.requiresConfirmation) {
  await requestConfirmation();
}

await capabilityRouter.execute(capability);
```

---

# 19. Test Cases

Create automated tests for all of the following.

### Test 1

```text
No skills, no MCP, no tools.
Explain React.
```

Expected:

```text
0 calls
```

### Test 2

```text
Skill selected: Code Review

User:
Explain React.
```

Expected:

```text
0 skill calls
```

### Test 3

```text
Skill selected: Code Review

User:
Review this code.
```

Expected:

```text
Code Review skill called
```

### Test 4

```text
MCP selected: GitHub

User:
Explain GitHub.
```

Expected:

```text
0 MCP calls
```

### Test 5

```text
MCP selected: GitHub

User:
Show my repositories.
```

Expected:

```text
GitHub MCP called
```

### Test 6

```text
KB selected: Carbon Platform

User:
What is our Carbon architecture?
```

Expected:

```text
Carbon KB searched
```

### Test 7

```text
KB selected: Carbon Platform

User:
What is React?
```

Expected:

```text
0 KB calls
```

### Test 8

```text
Mode: none

User:
Review this code.
```

Expected:

```text
0 capability calls
```

The agent should answer using only the available conversation context/model knowledge.

### Test 9

```text
Mode: selected

Selected:
GitHub MCP

User:
Get Jira ticket CRBN-123.
```

Expected:

```text
0 GitHub calls
0 Jira calls
```

### Test 10

```text
Terminal permission: deny

User:
Run npm install.
```

Expected:

```text
Terminal not executed.
```

---

# 20. System Instruction

Add this instruction to the agent:

```text
CAPABILITY USAGE POLICY

Capabilities are available resources, not mandatory actions.

Always determine whether a capability is necessary before using it.

Never call a Skill, MCP server, Tool, or Knowledge Base merely because it is
available or selected.

User restrictions have priority over capability availability.

If the user disables a capability, never use it.

If capability mode is "none", never call any external capability.

If capability mode is "selected", only selected capabilities may be considered.

A selected capability is not automatically executed.

Prefer answering directly when the request can be accurately answered without
external capabilities.

Use Knowledge Base only when project-specific or stored information is needed.

Use Skills only when the request matches the Skill's purpose.

Use MCP only when external data or an external action is required.

Use Tools only when the task actually requires the tool.

Before every capability call, verify:
1. It is enabled.
2. It is allowed.
3. It is selected when required.
4. It is relevant.
5. It is necessary.
6. It has the required permission.

If any condition fails, do not call the capability.

Never invent capability calls.

Never execute all selected capabilities automatically.

The goal is minimum necessary capability usage.
```

---

# 21. Definition of Done

The feature is complete when:

* Agent can distinguish Skills, MCP, Tools, and Knowledge Base.
* Agent decides whether each capability is relevant.
* User can disable individual capability types.
* User can select specific capabilities.
* `none` mode guarantees zero capability calls.
* Selected capabilities are not automatically executed.
* Explicit user instructions such as "no tools" are respected.
* Permission checks happen before execution.
* Dangerous tools can require confirmation.
* Decision traces are available for debugging.
* Automated tests cover positive and negative tool-call scenarios.
* The agent prefers direct answers when external capabilities are unnecessary.
* No capability can bypass the central `CapabilityRouter`.
* All capability execution goes through one centralized decision and permission layer.
