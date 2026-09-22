# Chat

Chat with Ollama or a configured hosted provider and optionally use your indexed knowledge as reference material.

## Provider and model selection

Choose the provider and model in the **chat header**. With one enabled provider, only the
model selector appears; with multiple enabled providers, both selectors appear. Missing or
disabled selections block sending. Use the dropdowns or **Use [provider]** to recover; redundant
provider-unavailable and select-an-available-model labels are not displayed alongside them.
No enabled providers shows a setup action.

Each conversation persists its selection. Changes preserve history and apply to subsequent
requests; an in-flight request retains the provider, credential, and model captured at send time.
Assistant messages show historical provider/model labels and completion status. Renaming or deleting
a provider does not rewrite those labels. Partial responses survive restart and interrupted streams
are marked canceled. Older messages without attribution are explicitly labeled as legacy.

**Open in Chat** initializes an agent's saved provider/model. The header identifies conversation
overrides. **Save to Agent** explicitly updates the definition; ordinary selector changes do not.
See [Multi-provider AI](MULTI_PROVIDER_AI.md) for setup, migration, and adapter scope.

## Ask questions about Saved Text

1. Create and save a note in **Saved Text**.
2. Open **Knowledge Base** and wait for the **Saved Text** source to become ready.
3. Open **Chat** and select a model from your configured provider.
4. In **Knowledge context**, choose **Collection: Saved Text** or **All knowledge**.
5. Ask your question. Expand **Sources used** below the response to inspect retrieved excerpts.

The feature is implemented. Saving a note automatically schedules indexing, but Chat defaults
to **No knowledge context**. With that option selected, the question does not search RAG.
Selecting a source supplies matching excerpts to the model; it does not enforce answers exclusively
from those excerpts. The model is instructed to cite source names and acknowledge insufficient context.

Use **Settings → AI Providers** to configure providers, then select one in the chat header: local Ollama or a hosted provider such as OpenAI,
Anthropic Claude, Google Gemini, OpenRouter, Groq, or a custom OpenAI-compatible endpoint.
Selection does not automatically trigger retrieval. A capability decision searches only when
stored or project-specific information is needed; general questions can be answered directly.
Only ready sources are retrieved. If a source fails to index, correct the reported problem and
use **Sync / Re-index** in Knowledge Base.

## Slash commands

Type `/` for command types, then `/mcp `, `/agent `, or `/skills ` for a searchable list of
enabled items. Use Up/Down and Enter, or click an item. Escape dismisses suggestions.
Selection creates a removable chip. Skills and MCP apply to the next message; an agent establishes a conversation context until removed. Enter your query
and send with Enter or the arrow. Shift+Enter inserts a new line; Cmd/Ctrl+Enter also sends. Names with spaces can also be entered explicitly:

```text
/mcp "My server" "Find the requested information"
/agent "Code reviewer" "Review authentication"
/skills "Documentation" "Explain this API"
```

- **Skills:** applies the selected skill's instructions only when the capability decision finds
  its workflow relevant and necessary for the request.
  Uses conversation history and the selected knowledge context. It does not grant tools.
- **Agent:** initializes the saved provider/model and uses the conversation’s effective selection, skills, selected tools,
  knowledge sources and execution limit. The Chat knowledge selector does not override the
  agent's configured sources. A task and project folder are optional; `/agent <name>` alone
  runs the configured instructions.
- **MCP:** uses the current chat model to choose tools from the selected connected server only.
  Start the server in MCP first. The selected Chat knowledge context is available to this run.
  No built-in filesystem or shell tools are granted by this command.

### Agent folders and progress

Selecting an agent shows optional folder controls beside the × button in the command bar,
with the full path (or **No folder selected**) below. Typing `/agent ` before selecting an
agent also shows a folder selector. Use
**Select Folder** to choose a folder, **Change Folder** to replace it, or **Remove Folder**
to clear it. The full path is displayed and stored with the submitted command. Cancelling
the picker leaves the current selection unchanged and does not prevent a folderless run.
The selection clears after sending or changing conversations; it is not a permanent default.
Without a folder, built-in filesystem, Git, project and package-script tools are unavailable.
Configured custom Tools, MCPs, skills and knowledge can still be used.

Thinking/Planning displays safe progress generated by the app. Tool activity, approvals,
completion and errors replace it as execution proceeds. Raw model planning fields are not
shown. Agent runs also appear in the persistent [Agents history](AGENTS.md#execution-history),
including iteration usage and a distinct status when the maximum is reached.

Agent and MCP commands start a fresh task using the submitted query; they do not inherit the
whole conversation. Progress, tool results, and approval controls appear inline. MCP
and custom Tool calls require approval by default; saved agents may override this with
per-capability Always allow permissions. Agent file changes follow the existing approval settings and
hash checks. Stop generation cancels the associated run, including pending approvals.

Results, command names, and the latest 100 activity events persist with the conversation.
Historical approval controls cannot execute again. Commands cannot use Regenerate; send a
new command to repeat a task deliberately. Ordinary messages use normal chat unless an agent context is active.

## Conversation history

Create, search, rename, delete, and reopen conversations. Use the trash button in the
history header to remove all local chat history at once, or delete a single conversation from
the row actions. Send with the arrow button or Enter (or Cmd/Ctrl+Enter). Use Shift+Enter
for a new line. Enter confirms an open slash-command suggestion first, and does not send while
an IME is composing text. Stop an active response, regenerate a response, or copy message text.
Conversation history and retrieved source excerpts are stored locally in SQLite. Model selection
is provider-aware, so the same chat can use local Ollama or a remote API such as OpenAI,
Anthropic, Google, OpenRouter, Groq, or a custom compatible endpoint.

See [Agents](AGENTS.md), [Tools](TOOLS.md), [Saved Text](SAVED_TEXT.md), [Knowledge Base](KNOWLEDGE_BASE.md), and [Settings](SETTINGS.md).

See [Capability decisions](CAPABILITIES.md) for Auto/Selected/None modes, restrictions,
permissions, relevance checks and decision traces.

## Checking KB answers

Normal Chat's relevance check receives the selected source names/collections and recent
conversation, including follow-up context. Questions about private/project facts or the selected
documents require retrieval even if the model knows the general topic. Successful retrieval
passes the real passages to the answer model and saves them under **Sources used**.

Expand the response activity to see **Knowledge retrieval** and its passage count. If the
selection has no ready sources, sync/index them in Knowledge Base. Empty or skipped retrieval
is explicitly included in the answer model's context; it must not claim a KB-grounded answer
without retrieved passages. General unrelated questions can still skip RAG.

The selected KB also supplies the subject for ambiguous topical requests. For example, selecting
**agent-desktop** and asking **give me chat details** means the project's Chat feature, not
personal chat history. Both the relevance check and answer prompt receive this scope. Explicitly
unrelated general questions and instructions disabling knowledge still take precedence.
