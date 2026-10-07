# Governance review example

The YAML, JSON, and Markdown files contain the same workflow. Import any one from
**Workflows → New dynamic workflow → Import workflow file**. Select **Form** to
edit its steps, nested loops, hooks, retries, inputs, and aliases. The JSON-valued
fields in Form support structured input and alias/configuration objects.

Before running:

1. Create agents and replace the example agent IDs with their saved IDs. Configure
   the change detector to return `{ "files": [{ "path": "src/example.ts" }] }` and
   the selector to return `{ "relevantRules": [{ "path": "governance/security.md" }] }`.
   Structured output must be valid JSON, without a Markdown fence.
2. Create a tool named `list-governance-files`, or change its alias to your own
   custom/MCP tool. It accepts `{ "folder": "./governance" }` and must return an
   array of `{ "path": "governance/security.md" }` objects. The engine contains no
   repository-provider or governance-specific tool implementations.
3. Set `config.defaultAgent` to an enabled agent whose selected capabilities include
   that custom tool, `filesystem.read`, and `filesystem.write`. This agent supplies
   permissions for tool nodes. A node can override it with `agent`. Tool IDs use the
   application's existing IDs: `filesystem.read`, `custom:ID`, or `mcp:SERVER:TOOL`.
4. Select a project folder in the run dialog and supply `target`. The report write
   follows existing permissions and approval rules.

Each file gets an isolated context; the nested rule loop inherits its loaded file.
The final agent receives the ordered loop results. The workflow has a shared budget
of 100 step attempts, including hooks and containers. Narrow the input if the review
exceeds that limit. Every agent still has its own execution and iteration limits.

See [the runtime reference](../../docs/DECLARATIVE_WORKFLOWS.md) for all supported
primitives and format semantics.
