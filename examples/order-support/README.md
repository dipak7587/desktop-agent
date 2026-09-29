# Running example: order support

This demo uses a real local Ollama model and real MCP stdio communication.
The order records are fictional fixtures. No API key or paid service is needed.

| Part        | File           | Purpose                                                            |
| ----------- | -------------- | ------------------------------------------------------------------ |
| MCP server  | `server.mjs`   | Exposes `get_order_status` for three sample orders                 |
| Custom Tool | `tool.mjs`     | `format_delivery_reply` turns verified order facts into a reply    |
| Agent       | `agent.mjs`    | An Ollama tool-calling loop that chooses and invokes tools         |
| Workflow    | `workflow.mjs` | Runs the same agent twice, passing lookup facts to the reply stage |

The MCP server itself exposes one tool. The custom formatter is an additional
local Tool, illustrating the desktop app's separate **MCP** and **Tools** sections.

## Run now

From the repository root:

```sh
node examples/order-support/workflow.mjs "Where is my order ORD-123?"
```

Requirements: the project's dependencies installed (`pnpm install`), Node 22.16+,
Ollama running, and `qwen3-coder:latest` installed. This machine already had these
when the example was created. On another machine, use `ollama serve` if needed
and `ollama pull qwen3-coder:latest`, or select an installed tool-capable model:

```sh
OLLAMA_MODEL=your-model node examples/order-support/workflow.mjs "Where is ORD-123?"
```

`OLLAMA_HOST` defaults to `http://localhost:11434`; set it to a full base URL
without a trailing slash to use another Ollama instance.

The terminal shows model turns, tool calls, and actual tool results. The final
reply for ORD-123 is:

```text
Workflow: completed
Your order ORD-123 has shipped with Demo Express. Expected delivery: 2026-10-01.
```

Try ORD-456 (processing), ORD-789 (delivered), ORD-999 (unknown), or ask
"Where is my order?" to see the missing-ID path.

```text
Customer question
  → Stage 1: agent → MCP client → Order Service → get_order_status
  → Pass the returned order object to stage 2
  → Stage 2: same agent → format_delivery_reply
  → Print reply
```

There is a six-model-turn limit per stage and a three-minute model request budget
for the workflow. A failed stage stops the workflow and closes the MCP connection.
The CLI checks that the formatter receives the unchanged lookup result and prints
the formatter's output. The desktop definitions use the app's own agent runtime
and permission checks; these CLI-specific data checks are not an app feature.

## Use the definitions in LocalAI Workspace

Generate definitions with paths pointing to your checkout:

```sh
node examples/order-support/setup.mjs
```

This creates `definitions/mcp/order-service-demo.json`,
`definitions/tools/format-delivery-reply.md`,
`definitions/agents/order-support-demo.md`, and
`definitions/workflows/order-support-demo.json`.

With the app closed, copy the four files into the matching `mcp`,
`tools`, `agents`, and `workflows` folders under the data directory shown in Settings,
then reopen the app. Do not replace an existing item with the same ID.
This preserves the filenames/IDs needed for the definitions to reference each other.
Choose your configured provider/model on the agent if its provider ID differs from
`ollama-local`, and start the MCP server.

Alternatively, use the app's **Import** buttons for MCP, Tools, and Agents.
Import assigns new IDs, so reselect the imported MCP server and custom Tool in the
agent's capability settings. Then create the two sequential stages in **Workflows**,
selecting that imported agent for both and copying the prompts from the workflow JSON.

Run **Order support demo** with task `Where is my order ORD-123?`. No project folder
is required. Approve the sample lookup/formatter calls if the app requests it.
The same single agent definition is used for both workflow stages.

## Verify

```sh
node --test examples/order-support/smoke.test.mjs
```

This checks actual MCP discovery, valid/unknown/invalid orders, and reply formatting
without a model. The normal run command exercises the real AI agent end to end.

Implementation references: [MCP SDK v1](https://ts.sdk.modelcontextprotocol.io/)
and [Ollama tool calling](https://docs.ollama.com/capabilities/tool-calling).
