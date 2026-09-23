# MCP

## MCP sidebar menu

Enter a required name and description. The executable command is optional when saving;
add it before starting or testing the server. Existing definitions without a description
remain readable, but require a description when saved again.

Check **Import from JSON** beside the server notice to hide executable, arguments, and environment fields and paste a JSON
configuration instead. Uncheck it to return to manual entry. Each mode keeps its own draft;
only the selected mode is used on save. JSON can contain a single server object or a
`mcpServers` object containing exactly one server. The name, description, and enabled state
from the form are used for the saved definition. Invalid JSON, unsupported fields/transports,
and non-string environment values are rejected.

Start or test the server, inspect discovered tools and logs, and stop or restart it as needed.
Definitions can be edited, imported, exported, or deleted. To use a discovered tool, select
it explicitly in the **Agents** editor. See [Settings](SETTINGS.md) for credentials and
[Security](SECURITY.md) before starting a server.

Definitions live in `<userData>/mcp/<id>.json`; no database is involved.
The app uses the official MCP SDK Client and StdioClientTransport. Start launches the configured
executable without a shell, performs initialization and tool discovery, and captures stderr.
Test pings a connected server or connects a stopped server. Stop closes the transport and
subprocess; Restart does both. Editing a definition stops its running instance. An allowed
deletion also stops it; a deletion blocked by agent references leaves it running.

```json
{
  "name": "Project files",
  "description": "Read project files through a local MCP server",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/your/project"],
  "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" },
  "enabled": true,
  "autoStart": false
}
```

## Auto-start and deletion

Check **Start automatically when application starts** in the editor to persist `autoStart: true`.
The default is off, including for older definitions. On application launch, only enabled servers
with auto-start on are started. A successful connection appears as **Running** on its card;
startup failures appear as an error status with details in **Tools & logs**, without preventing
other servers or the application from starting. Correct the executable, arguments or secret
references and use Start/Restart to retry. Saving the checkbox does not immediately start a server.
When auto-start is off, start the server manually. The checkbox also applies when entering
configuration through **Import from JSON**.

Deleting a server requires confirmation. Before stopping or deleting it, the app checks all
agent definitions, including disabled agents, for `mcp:<server-id>:<tool-name>` references and
the server ID in the agent capability configuration. If any exist, deletion is blocked and the
affected agents are named in the confirmation modal. Remove those references in the Agents
editor, or delete the agents, then retry. This prevents broken agent configurations.

## Imports and execution

Import creates a new local ID. The editor accepts one argument per line. Environment values
can be literal strings or exact `${NAME}` references. References resolve from OS-encrypted stored
credentials, the explicitly selected `.env` file, then the main process environment. Other strings
are passed unchanged, including empty strings. Literal values are stored in the server JSON,
visible in the editor, and included in exports. Resolved references are not returned to the renderer.
Both literal and resolved values are removed from server logs and tool results.

MCP is an execution boundary: installing or starting an untrusted server can execute code
with your user's privileges. The filesystem boundary of built-in agent tools does not sandbox
MCP servers. Configure each server's own permissions. The app gives it a minimal environment
plus configured environment values.

Connected tools appear in the Agent editor as `mcp:<server-id>:<tool-name>`. Agents receive
tool descriptions/input schemas and can call only capabilities allowed by its mode, type
switches, selections and permissions. MCP calls require a positive relevance decision and ask
for approval by default, including in global full-auto mode; per-capability Always allow skips
the approval prompt. Discovery/handshake, ping and tool calls
have timeouts. MCP-reported tool failures become execution errors and are recorded in agent
history with the tool input/output or error. Use Stop to cancel an in-progress connection.

In Chat, type `/mcp ` and select a connected server, then enter your query. The chat model
can use only that server's discovered tools. Approve or reject calls inline and inspect
their results under Command activity. See [Chat](CHAT.md) for slash-command controls.

Only stdio MCP transport is implemented in this release. SSE/Streamable HTTP and OAuth are
not advertised as working features.

See [Capability decisions](CAPABILITIES.md) for Auto/Selected/None modes, restrictions,
permissions, relevance checks and decision traces.
