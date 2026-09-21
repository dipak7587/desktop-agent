# Agent capability decisions

Agent editors include **Agent Capabilities**:

- **Auto** considers every enabled capability of an allowed type. It does not execute them automatically.
- **Selected** considers only selected skills, MCP servers/tools, tools and knowledge sources.
- **None** blocks all capability execution, even when the model proposes a call.

Each type has an Allow checkbox. None disables selection controls; Auto disables individual
selection because all enabled capabilities of allowed types are eligible. Choices are retained
when switching modes. Existing definitions without `capabilityConfig` use Selected with their
previous choices; selecting an individual MCP tool does not grant its entire server.
Selecting an MCP server allows its discovered tools. Start the server in MCP first.

Skills and knowledge searches are explicit agent actions. Their bodies/results are loaded into
the model context only after a positive decision. A selected Code Review skill need not be used
for “What is React?”. A selected project knowledge source need not be searched for general
TypeScript explanations. Project-specific questions can request the selected knowledge source.

## Restrictions and permissions

Explicit instructions such as “No tools”, “Don't call MCP”, “No skills”, “Don't search the
knowledge base”, “Don't access the project”, “Answer directly” and “Use only the model” restrict
runtime capabilities. The documented phrases are checked before model evaluation. The relevance
model also checks differently worded user restrictions. Restrictions can only reduce access.
“No skills, no MCP, no tools” also disables knowledge access. Project restrictions block built-in
project tools and knowledge access; MCP/custom code remains subject to its own type restriction.

Expand **Capability permissions** to choose Default, Always allow, Ask or Deny per capability.
Deny blocks execution before model evaluation. Ask requires approval; rejection and cancellation
prevent execution. Always allow skips the capability's approval, but still requires a positive
relevance decision and preserves built-in path/hash/command restrictions. Defaults retain the
existing local-tool approval settings; custom Tools and MCP calls default to Ask independently
of the global automatic-approval setting. Built-in writes show their diff when approval is needed.
A selected folder remains required for built-in filesystem/project/Git/package-script tools.

Configuration is portable YAML in the agent definition. Example:

```yaml
capabilityConfig:
  mode: selected
  allowSkills: true
  allowMCP: true
  allowTools: true
  allowKnowledgeBase: true
  skills: [code-review]
  mcpServers: [github]
  tools: [filesystem.read]
  knowledgeBases: [carbon-platform]
  permissions:
    shell.execute: deny
    mcp:github: ask
  trace: true
```

Permission keys can be exact action IDs (`custom:ID`, `mcp:SERVER:TOOL`, `skill:ID`,
`knowledge:ID`, or built-in tool IDs), server keys (`mcp:SERVER`), or type keys
(`skill`, `mcp`, `tool`, `knowledge`). A matching Deny wins over a more specific Allow.
The editor exposes per-capability choices; broader type policies can be set in YAML.

## Runtime and debugging

`CapabilityDecisionEngine` checks disabled state, mode, selection, project availability and
permission, then asks the configured local model for a structured relevance/necessity decision.
If the model can answer directly, forbids the capability, returns invalid JSON, or fails, the
capability is not called. Every proposed agent capability goes through `CapabilityRouter`.
Enabled state/availability is checked again after approval for saved skills, MCPs and custom tools.
A run uses a snapshot of its agent configuration; changes to that configuration apply to new runs.

Relevance is a model judgment, not a deterministic semantic guarantee. The hard mode, selection,
type, permission and documented restriction checks cannot be overridden by a model response.
Decision checks add a local-model request per proposed eligible capability and share the run's
cancellation/deadline. They do not consume an execution iteration; the proposed action does.

Enable **Show capability decisions in history and Chat** for app-generated decision reasons and
structured decision records in run events. No raw model reasoning is stored. Rejected proposals
appear as blocked/failed attempts, not successful execution. Actual MCP usage is recorded only
when dispatch occurs. Chat shows decisions in its expandable activity; regular Chat also checks
selected skills and knowledge before applying/retrieving them. Agent traces follow the saved
agent's toggle. Knowledge and skill command decisions in regular Chat are recorded automatically.

These rules govern model-initiated agent/Chat actions. Explicit manual operations—Knowledge Base
search/indexing, starting an MCP server, and **Test / Run** in Tools—remain directly user-initiated
operations. None mode does not stop already-running MCP servers or background indexing.

## Verification

`tests/capabilities.test.ts` covers the ten specification scenarios, hard restrictions,
malformed/failed model decisions, permission precedence, approval rejection, cancellation,
availability changes, legacy selections and runtime routing of skills/knowledge/tools.
Model judgments are mocked in deterministic tests; those tests verify enforcement, not a model's
language understanding. UI coverage verifies mode/type controls, permissions and trace settings.
Opt-in live Ollama tests remain separate.
