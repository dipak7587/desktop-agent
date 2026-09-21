# Tools

The **Tools** sidebar manages reusable API calls and custom Node.js/JavaScript logic.
Tools can be created, edited, enabled/disabled, imported, exported, tested, and selected by agents.
Creating or testing a Tool does not require Ollama.

## Create a Tool

Choose **New tool**, enter a name and optional description, then select an execution type.
Define **Input parameters · JSON** as an array:

```json
[{ "name": "value", "type": "number", "required": true }]
```

Parameter names must be unique identifiers. Supported types are `string`, `number`, `boolean`,
`object`, and `array`. Required parameters must be present and all declared parameters supplied
must match their types. Undeclared input keys are not rejected. Save the enabled definition.

### Node.js / JavaScript

Enter an async function body in **JavaScript logic**. It receives `input`, supports Node.js
`require`, and may use `await`. Return the result:

```js
const doubled = input.value * 2;
return { doubled };
```

The app executes the code in a separate Node.js process using its bundled runtime, without a
shell wrapper. Returned values are JSON serialized (`undefined` becomes `null`); stdout is also
captured, so console output can appear alongside the result. Exceptions and nonzero exits are
reported as errors. The editor executes JavaScript; it does not transpile TypeScript.

When called by an agent with a selected folder, that folder is the process working directory.
Otherwise no working-directory override is set. This is trusted local code with the current
user's privileges, not an OS sandbox or a restriction to the selected folder. Use only code
you trust. The process receives a reduced environment, not all application credentials.

### API call

Configure an HTTP(S) **API URL**, a method (`GET`, `POST`, `PUT`, `PATCH`, or `DELETE`), and
**Headers · JSON**. GET sends input keys as query parameters; other methods send a JSON body.
The default content type is `application/json`. Response text is returned to the caller;
non-success HTTP statuses are errors. Redirects are rejected and URLs cannot embed credentials.

Header values can reference credentials configured in Settings:

```json
{
  "Authorization": "Bearer ${API_TOKEN}"
}
```

References resolve in the main process at execution time. Known secrets are redacted from
results and errors. Do not put literal secrets in code, URLs or headers: these fields are
stored and exported as part of the definition.

## Test and run

Choose **Test / Run**, enter an input JSON object such as `{"value":3}`, then choose **Run tool**.
The dialog displays a loading state, the actual result, or an error. Correct invalid input or
tool configuration and retry. Running here directly authorizes execution; there is no additional
agent approval dialog. Closing the test dialog does not cancel an already-running Tool.

The Settings command timeout applies to both execution types. Input is limited to 100,000
serialized characters; API response bodies and combined Node.js stdout/stderr are limited to
100,000 bytes. At most three custom Tools execute concurrently. Agent cancellation interrupts
its running Tool, and application shutdown aborts active custom Tools.

## Use from an agent

In the **Agents** editor, select the Tool under **Tools**. It is saved as `custom:<tool-id>`.
The agent receives its description and parameter definitions, passes input, and receives the
real output or error. Only enabled Tools permitted by the agent's capability settings are available. Selection alone
does not cause execution. Custom Tool calls ask for approval by default, including in global
full-auto mode; a per-capability Always allow permission can skip that prompt. Inputs, results and
errors appear in the persistent [execution history](AGENTS.md#execution-history).
Custom Tools can be called without selecting a project folder.

## Storage and deletion

Definitions are Markdown files with YAML metadata in `<userData>/tools/<id>.md`.
The `toolConfig` metadata stores the execution type, parameters, API URL, method and headers;
the Markdown body stores JavaScript logic. Import/export uses these portable files.
Resolved Settings secrets are not embedded in exported definitions.

Deletion requires confirmation. The app checks all agent definitions, including disabled
agents, for references. If any use the Tool, deletion is blocked and the affected agents are
named. Remove their Tool selections or delete those agents before retrying. Cancelling the
confirmation leaves the Tool intact.

See [Agents](AGENTS.md), [Chat](CHAT.md), [Settings](SETTINGS.md), and [Security](SECURITY.md).

See [Capability decisions](CAPABILITIES.md) for Auto/Selected/None modes, restrictions,
permissions, relevance checks and decision traces.
