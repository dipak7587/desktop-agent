# Code Workspaces

## Purpose

Add a persistent, project-linked coding workspace to LocalAI Workspace. A user can connect a local project folder from the application UI, use ordinary Chat with that project, optionally attach an existing agent, and return to the same project in later conversations.

The implementation status below describes the shipped runtime; the remaining sections retain the broader workspace specification. Direct Code chat now requires a configured local inference endpoint. Saved-agent tasks and ordinary Chat retain their existing provider support. This document is otherwise a model-agnostic implementation specification. It can be given to any coding LLM together with the repository. Do not assume a particular model vendor, model name, inference API, agent framework, shell, or operating system. Reuse the application's configured provider/model and existing application tool/permission architecture.

The experience is conversational, not a CLI embedded in Chat. `/code` lists saved folders in the Chat composer without navigating to Code. Select a folder by mouse or keyboard, filter by name/path, or use **Open another folder…**. It is not a command that launches a separate process. Terminal-like actions, if implemented, are application tools behind explicit policy checks and approval.

## Current Repository Baseline

Read these documents and inspect the current implementation before changing code:

- [Architecture](ARCHITECTURE.md): Electron main process owns data and tools; renderer uses a sandboxed preload API; model providers and agent execution are behind application services.
- [Chat](CHAT.md): `/agent` currently accepts an optional folder for one run. That folder selection clears after the run or conversation change and is not a persistent default. Normal Chat now dispatches guarded coding tools through the linked workspace.
- [Capability decisions](CAPABILITIES.md): model-proposed agent capabilities are subject to hard mode, selection, availability, permission, relevance and approval checks through the central router.
- [Security](SECURITY.md): built-in project tools enforce path boundaries, ignore sensitive/generated paths, bound reads and search, and use content hashes plus reviewable diffs for writes. Built-in commands are allowlisted; this is not an OS sandbox.
- [Agents](AGENTS.md): saved agents and their capabilities are optional configurations, not a prerequisite for normal Chat.

The existing optional agent folder is not the requested persistent workspace. Implement the workspace feature by extending the owning persistence, IPC, capability and Chat boundaries. Do not create a second model stack or a parallel, weaker filesystem/approval implementation. If repository code has changed since this document, treat source and tests as authoritative and update this document to match reality.

## Implementation Status

Initial implementation (2026-09-29): the app persists workspace metadata in the existing local SQLite database, links a workspace ID to a conversation, opens folders through Electron's native picker, lists, reconnects, and relinks recent workspaces, and supports `/code` as an inline saved-folder chooser in Chat. Reopening a linked conversation refreshes workspace availability and its last-opened time. Relinking retains identity but clears permissions and provider/agent preferences for the replacement path. Disconnecting affects only that conversation; removing a workspace record does not delete project files and clears conversation links. New workspaces start with an empty permission policy, and the Chat indicator reports restricted access.

### DeepAgents / ACP runtime (2026-10-03)

The existing folder chooser and Chat renderer remain in place. The Code page also provides
**Agent template → Add agent** and **Edit agent** for multiple specialist profiles.
The **Commit and Push** template can stage and commit explicitly selected files and push the current
branch to its configured upstream; each mutation requires its own approval.
Direct messages in a linked Code conversation now use **DeepAgents 1.14.1 +
`deepagents-acp` 0.1.33**, regardless of the optional saved-agent engine setting.
Saved coding profiles marked `agentRuntime: deepagents-acp` use this runtime too, with a
separate session per task and cleanup when the task finishes. The previous `AgentLoopGraph`
path remains for other saved agents and MCP/skill commands; each task executes one engine.

```text
Selected Code folder → existing Code / Chat UI → store → preload / validated IPC
  → ChatService → ChatCommands → AgentService (policy, run history, approvals)
  → CodeAgentManager → ACP SDK client ↔ deepagents-acp server
  → DeepAgent → configured local LangChain model → guarded workspace tools
```

Relevant implementation files:

- `src/main/services/agents/code-agent-manager.ts`: ACP connections, session lifecycle,
  local model capability discovery, model/tool boundaries, context budgets and event adapter.
- `src/main/services/ollama/{chat,commands}.ts`: conversation/workspace identity and bounded
  persisted history passed into Code; model settings use the existing provider router.
- `src/main/services/agents/{agents,coding,tools}.ts`: capability registration, coding
  instructions, workspace validation, approval/diff review, command execution and run history.
- `src/main/services/ai/{capability-tools,chat-graph,tool-schemas}.ts`: native tools,
  Chat streaming and validated tool arguments.
- `src/main/ipc/register.ts`: folder switching, disconnect/removal and conversation cleanup.
- `patches/deepagents-acp+0.1.33.patch`: embedded transport support (see below).

**Local inference.** Existing Settings and Chat model selection are the only configuration.
Ollama and compatible `custom`/`openai` profiles must use loopback or a private IPv4 endpoint.
Cloud profiles are rejected for direct Code chat. No cloud key or CLI is required.
Ollama `/api/show` is accessed through its existing provider abstraction. Explicitly missing
`tools` capability removes tool bindings and reports a visible explanation while retaining
ordinary text Q&A. Compatible endpoints without capability metadata are attempted normally;
reliable tool use and multi-turn quality still depend on the selected model.

**Sessions and history.** One ACP server/session is retained per active conversation,
with at most 20 cached conversations. Each turn gets fresh policy/tool closures while the
DeepAgent retains its conversation state. Workspace/root, model/provider configuration,
instructions/catalog or context-budget changes replace the session. Different conversations
have independent cancellation controllers. Switching/disconnecting/relinking/removing a folder
cancels and settles affected runs before releasing their sessions. Chat deletion and shutdown
also release runtime state. SQLite remains the durable Chat/run history authority. After restart,
eviction, failure or cancellation, a new ACP session is seeded with at most 12 messages / 16,000
characters of persisted conversation; unfinished operations are never automatically replayed.
ACP session IDs themselves and full DeepAgent checkpoints are **not persisted across restarts**.

**Permissions and tools.** All actual workspace operations retain the existing capability
router and `AgentTools`; read-only inspection runs without approval, changes retain their approval policy, and explicit deny wins.
Read-only operations are `filesystem.read`, `filesystem.list`, `filesystem.search`,
`filesystem.exists`, `project.detect`, `git.status`, `git.diff`, and `git.log`.
Legacy Ask settings do not prompt for these operations. Unselected tools, disabled capabilities,
protected paths, missing workspace access, and explicit Deny settings remain blocked.
Shell commands and custom/MCP tools are not assumed read-only; they retain their approval rules.
For native Code workspace tool calls, the coding model's tool selection supplies relevance;
there is no second JSON-only model request for `project.detect`, filesystem, Git, or shell tools.
This also applies to configured agent profiles inside ACP. Mode, selection, enabled state,
workspace restrictions, permission denials, tool-argument validation, and approvals still run.
Skills, custom tools, MCP, knowledge, and non-Code agent runs keep the relevance check.
General programming questions can be answered without a tool call; stack and test-command
questions use project inspection instead of guessed commands.
The exact validated operation and optional diff travel through ACP `requestPermission` to the
existing application approval UI. Upstream's generic tool announcement only permits dispatch
to a registered guarded tool, never grants filesystem/command access. Writes recheck hashes
following approval; deletion is always reviewed. Commands retain the existing executable/
argument validation, selected-root cwd, timeout, output bounds and cancellation. Commands can
execute project code and are not an OS sandbox.

DeepAgents owns reasoning, planning and context management. Its default host filesystem,
shell and delegation tools are excluded from both model bindings and execution. A state-only
backend prevents implicit host access. Existing guarded edits are deliberately reused because
the library's default filesystem backend does not enforce this app's secret exclusions,
content-hash review or capability policies.

Search matches file paths (including directory segments) and contents, returns at most 60
results, and skips generated/sensitive paths. Root `.gitignore` positive rules and configured
ignore patterns are honored; nested ignore files and re-inclusion (`!`) semantics are not yet
implemented. File reads default to 200 lines and accept zero-based `offset` and `limit` (up to
1,000); their hash always covers the whole file. The existing 200 KB read ceiling remains.
Instructions tell the agent to search before reading, cite actual paths, answer general questions
without tools, and make no edits for explanatory questions. Optional `AGENTS.md`,
`.deepagents/AGENTS.md` and `skills/*/SKILL.md` can be read through approved workspace tools.
Automatic DeepAgents filesystem skill/memory discovery and delegated subagents remain disabled.

**Streaming and errors.** Actual ACP `agent_message_chunk` updates flow into the existing Chat
stream. This package emits complete model-message chunks, rather than token-by-token deltas.
Tool execution, outcomes, plans and permission waits reuse run activity; private model thought
chunks are ignored. Stop sends ACP cancellation and aborts the owning tool/model signal.
Context overflow, changed roots, model discovery failures and iteration limits report errors.
Development logs contain lifecycle/session identifiers, never prompt bodies, files or keys.

**Pinned package patch.** Upstream 0.1.33 only exposes `start()` over process stdio, installing
process-global exit/signal handlers. The tracked pnpm patch adds a typed `connect(Stream)`
entry point in ESM/CJS and declarations, using its unchanged ACP request handlers and SDK.
Electron uses in-memory SDK message streams, not private method casts, a CLI or simulated ACP.
Review/remove this patch when upstream offers an embedded transport; install using pnpm so
`patchedDependencies` is applied.

**Validation.** Deterministic tests cover session reuse/isolation, workspace/model changes,
normal chat, guarded read/search/create/edit, ACP approve/reject, cancellation, traversal,
default-tool exclusion, command cwd, model capability/offline errors, iteration limits and a
read → bug fix → focused command-check flow. `tests/code-agent-manager.test.ts` also offers
an opt-in real Ollama chat/read/follow-up check with `CODE_AGENT_LIVE_MODEL`. This check passed with the installed `qwen3-coder:latest` on 2026-10-03.

### Verification results (2026-10-04)

- `pnpm typecheck`, `pnpm lint`, `pnpm build`: passed.
- `pnpm test`: 210 passed; one opt-in live test skipped by default.
- `CODE_AGENT_LIVE_MODEL=qwen3-coder:latest pnpm exec vitest run tests/code-agent-manager.test.ts -t 'live local Ollama'`: passed separately on 2026-10-03.
- `pnpm exec playwright test tests/ui/workflows.spec.ts -g 'Code workspace|/code saves'`: all three Code desktop tests passed. The workspace test's stale `Open folder` selector was updated to the existing `Add Folder` button; the product UI was not changed.
- Full `pnpm test:ui` run: 18 passed, four live tests skipped, six failures. The Code selector failure was fixed and verified above. Five other failures remain in workflow screenshots, Saved Text editing, global-error popover expectations, skill slash selection and Knowledge group selection. The full desktop suite is not green.

The fuller specification below still includes unimplemented workspace permission editing,
once/conversation/workspace grant controls, workspace-specific activity filtering, project memory
and a workspace-linked agent selector. This update does not claim those features are shipped.

## Product Requirements

### 1. Link a local project

- Typing `/code` opens a saved-folder list in Chat; the Code sidebar remains available for workspace management.
- The chooser lists recently used/linked workspaces and provides **Open Folder**. Use the native folder picker; never trust a renderer-supplied arbitrary path as proof of user selection.
- Connecting a folder associates it with the current conversation and displays its name and permission state in the Chat UI.
- Reconnecting an already known canonical folder reuses its workspace identity rather than creating duplicate records. Provide a way to disconnect/switch without deleting the workspace record.
- Selecting a workspace does not grant tool permissions. A workspace with no granted capabilities can still be selected and discussed without project access.

### 2. Persist and reconnect

Persist workspace metadata independently of conversation history. At minimum:

```ts
interface CodeWorkspace {
  id: string;
  name: string;
  canonicalPath: string;
  createdAt: string;
  lastOpenedAt: string;
  permissions: WorkspacePermissionPolicy;
  selectedAgentId: string | null;
  preferredProviderId?: string | null;
  preferredModelId?: string | null;
}
```

- Store workspace records in the app's local persistence under the existing main-process ownership. Do not put secrets or file contents in workspace metadata.
- Persist `workspaceId` on the conversation (nullable for existing/folderless conversations). Reopening a conversation reconnects its workspace if the folder still exists and access remains valid.
- A workspace can be selected from a new conversation, making it easy to continue work without relying on previous chat messages as the project source of truth.
- `lastOpenedAt` changes on a successful open/reconnect. Handle missing, moved, inaccessible, or deleted folders with a clear state and explicit relink/remove action; do not silently substitute a different folder.
- Keep provider/model selection compatible with existing per-conversation settings. Workspace preferences are optional defaults, not a hidden override. The active Chat header must show the effective provider/model and the selected optional agent.
- Workspace memory, if added, is explicitly scoped by workspace ID and kept separate from global, conversation, and agent memory. Do not silently treat conversation history as project memory.

### 3. Optional agent

- Normal Chat with a workspace and no selected agent is a first-class path.
- A user may attach, change, or detach an existing saved agent without disconnecting the workspace.
- An agent inherits the current workspace context only; it receives no permissions beyond those allowed for the workspace/conversation and its own capability configuration.
- Existing agent execution limits, cancellation, tool routing and history semantics remain in force. No agent or framework default filesystem/shell tool may bypass application tools.

### 4. Capabilities and permission policy

All model- or agent-initiated project operations must be registered capabilities and pass through the application's central permission/router boundary. Selecting a folder is not an authorization grant. A model response, agent instruction, prompt, or tool argument cannot grant itself permission.

Represent policy per capability/action using the existing permission vocabulary where practical (`always_allow`, `ask`, `deny`), with scope and expiry:

```ts
type PermissionScope = 'once' | 'conversation' | 'workspace';
interface WorkspacePermissionPolicy {
  // Capability/action ID -> default decision and, where applicable, scope.
  rules: Record<
    string,
    {
      decision: 'always_allow' | 'ask' | 'deny';
      scope: PermissionScope;
    }
  >;
}
```

The implementation may adapt this shape to established repository types, but must preserve the semantics below:

- **Ask every time:** ask before each applicable operation.
- **Allow once:** authorize only the exact pending operation; do not persist the grant.
- **Allow for conversation:** authorize matching operations only for that conversation; clear on conversation end/removal as appropriate.
- **Allow for workspace:** persist the rule for that workspace until the user changes/removes it.
- **Deny:** do not dispatch the operation. Deny must win over broader allows and is not overridable by model output.
- Show and edit workspace policy in the UI. Show the effective access level in Chat, for example `Restricted` or `Custom permissions`.
- Existing capability modes, explicit user restrictions, relevance checks, and agent-specific selections continue to apply. Effective authorization is the intersection of workspace policy, conversation policy, selected-agent policy, capability eligibility, and explicit user restrictions; a grant in one layer never bypasses a denial in another.

Support these capability categories, mapping them to existing tool IDs where available:

| Category                             | Default                                                           | Notes                                                                             |
| ------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Read project files                   | Ask                                                               | Exclude secrets and ignored/generated paths by default.                           |
| Search/list project files            | Ask                                                               | Bounded and rooted in the active workspace.                                       |
| Write/modify files                   | Ask                                                               | Require diff review, prior-content hash and post-approval hash recheck.           |
| Create files                         | Ask                                                               | Show the proposed content/diff and confirm before writing.                        |
| Delete files                         | Deny or unavailable until a dedicated confirmed flow exists       | Do not emulate deletion as an unrestricted shell command.                         |
| Rename/move files                    | Deny or unavailable until a dedicated confirmed flow exists       | Validate source and destination roots and collisions.                             |
| Git read/status/diff                 | Ask                                                               | Root commands in the workspace; disclose output.                                  |
| Git commit                           | Ask                                                               | Show staged scope/message and require approval.                                   |
| Git push/reset/force/destructive Git | Deny or require a distinct high-risk confirmation                 | Never inherit a generic Git allow.                                                |
| Terminal/package scripts             | Ask                                                               | Prefer existing fixed command allowlist; never expose arbitrary shell by default. |
| Install dependencies                 | Ask, distinct from ordinary tests/build                           | Treat lifecycle scripts as arbitrary project code.                                |
| Run tests/build/lint                 | Ask unless existing policy explicitly allows the specific command | Existing command allowlist and limits remain mandatory.                           |
| Network access                       | Ask or unavailable                                                | Project tools do not gain arbitrary network access implicitly.                    |
| Development tools                    | Ask                                                               | Define each tool and its side effects; do not grant a broad ambiguous capability. |
| Environment/credential access        | Deny by default                                                   | No automatic `.env`, keychain, home-directory, SSH, token or credential reads.    |

Do not represent unavailable tools as implemented. Where the current app has no safe built-in implementation (for example delete, move, general network or general shell), document it as out of scope or unavailable rather than adding an unsafe shortcut.

### 5. Approval flow and audit activity

For an operation requiring consent:

1. Validate capability, arguments, active workspace, path/command constraints and policy in the main process.
2. If policy says ask, show the user the exact operation, target path or command, a short reason, and its risk/side effects.
3. Offer **Allow Once**, **Allow for Conversation**, **Allow for Workspace**, and **Deny** only when each scope is supported by that operation. High-risk operations may offer only a one-time approval or remain blocked.
4. Bind the approval to an immutable request/arguments fingerprint. Reject or re-prompt if arguments, target, workspace, diff, or command changes while approval is pending.
5. Revalidate policy, workspace identity, real path, symlink/path constraints, content hash and command allowlist immediately before execution.
6. Execute only through the owning application service, then record a redacted audit event for success, denial, failure, cancellation and approval outcome.

Activity is associated with the workspace and conversation and is visible in Chat or a workspace activity view. Each record should identify the action, target, time, outcome and relevant safe summary. Do not persist raw hidden model reasoning or unredacted secrets. File modifications must have an inspectable diff before apply; where the existing write tool already applies after approval, preserve that established flow rather than inventing a second write lifecycle. Do not claim revert support unless an actual reversible snapshot is implemented.

### 6. Terminal and command policy

- Terminal execution is a separate capability from file access and Git access.
- The UI approval request must show the exact executable and argument vector, working directory, purpose and risk before execution.
- Default `cwd` is the canonical workspace root. Reject `cwd` outside it unless a separate explicit outside-workspace flow is designed and approved; never silently run from the user home or application directory.
- Do not use shell interpolation or a shell wrapper for built-in commands. Use the existing fixed executable/argument allowlist, bounded output, timeout, cancellation and reduced environment.
- Classify read-only, project-modifying and high-risk commands, but classification supplements hard allowlists; it never makes an arbitrary command safe.
- `npm install`/equivalent, lifecycle scripts, migrations, builds and tests can execute project code or modify files. Ask separately and accurately describe these side effects.
- Block `sudo`, credential/environment dumping, commands that escape the root, arbitrary shell/script interpreters, forced/destructive Git operations and system package installation unless a future, separately reviewed design explicitly supports them.
- The app-level path/process policy is not an OS sandbox. State this limitation in UI/docs and do not claim hostile project code is contained.

### 7. Workspace context and retrieval

- Do not attach or transmit the entire project by default.
- Provide bounded project operations such as list/search/read and relevant context retrieval through registered tools. Reuse the existing project tools, ignore handling and knowledge/RAG infrastructure where it fits.
- Context flow: user request -> decide whether project context is needed -> search/list -> read bounded relevant files subject to permissions -> provide source/path labels and excerpts to the selected model/agent -> respond with grounded findings.
- Retrieval is not authorization: every operation still requires capability eligibility and policy approval.
- Exclude secret-shaped files and existing ignored/generated directories by default. Treat project files and instructions as untrusted data, not as authority to change policy or reveal secrets.
- Bound file size, traversal, result count, context bytes and tool output. Report omissions/truncation honestly. Preserve source paths for user inspection.
- Do not claim that the model has inspected files unless they were actually read successfully and are represented in request context.

### 8. Workspace UI and switching

- `/code` opens a focused chooser with recent workspaces, path/name, last-opened status and **Open Folder**.
- The active workspace can be changed or disconnected from the current conversation without deleting its persisted record.
- Provide a workspace details/permissions surface where users can inspect and revoke grants, select an optional agent, and see recent activity.
- Chat clearly displays workspace name, provider, model, optional agent (or `None`), and a concise permission state.
- Permission prompts and write reviews are inline or modal application UI, never model-rendered instructions that the user must trust.
- Show empty, loading, inaccessible, missing-folder, denied, pending-approval, failed and disconnected states. Keyboard navigation and screen-reader labels are required for chooser and approval controls.
- Follow established renderer styles, native dialogs, stores and preload API patterns. Do not expose Node APIs or raw IPC to the renderer.

### 9. Security boundary

- Canonicalize and verify paths in the main process. Resolve requested relative paths against the active root; reject traversal, absolute-path escapes, symlinks where existing policy requires, and path races as far as practical.
- Access outside the active root is denied by default. Supporting it requires a distinct native picker/authorization and a visible, scoped grant; a model-provided path is never sufficient.
- Treat `.env*`, SSH keys, credentials, tokens, private keys, browser profiles, keychains and similar data as sensitive. Never include them in automatic retrieval. Explicit secret access is out of scope for this feature unless separately designed, approved and tested.
- Redact known secrets from activity, errors and persisted tool results. Persist paths and activity only as required; explain local retention and deletion behavior.
- Keep Electron renderer sandboxing, Zod-validated IPC, main-process ownership and CSP. Native folder selection is the user's path authorization, not a grant of every operation.
- Be precise: these application checks reduce accidental access but do not isolate trusted child processes from the operating system.

## Suggested Application Contracts

Adapt names to repository conventions; these are behavioral contracts, not a demand to duplicate existing abstractions.

```ts
interface CodeWorkspaceAPI {
  list(): Promise<CodeWorkspaceSummary[]>;
  chooseAndConnect(conversationId: string): Promise<CodeWorkspace | null>;
  chooseAndRelink(workspaceId: string, conversationId: string): Promise<CodeWorkspace | null>;
  reconnect(workspaceId: string, conversationId: string): Promise<CodeWorkspace>;
  disconnect(conversationId: string): Promise<void>;
  updatePermissions(workspaceId: string, policy: WorkspacePermissionPolicy): Promise<void>;
  setAgent(workspaceId: string, agentId: string | null): Promise<void>;
  remove(workspaceId: string): Promise<void>;
  listActivity(workspaceId: string, conversationId?: string): Promise<WorkspaceActivity[]>;
}
```

- Validate every IPC request and response shape. Keep filesystem paths, dialogs, persistence and tool execution in the main process.
- On connect, use the native directory picker and derive identity from a normalized/canonical path. Handle platform path case rules and unavailable directories deliberately.
- Persist only metadata and permission policy in the workspace registry; store conversation-to-workspace association with conversation data or an equivalent referentially safe record.
- Preserve referential integrity on conversation/workspace deletion. Removing a workspace record must not delete project files. Define whether activity and workspace-scoped memory are retained or removed and make that behavior visible.
- Do not persist one-time grants. Conversation grants must not become workspace grants through migration, export/import, agent save, or restart.
- Add schemas/migrations with backward-compatible defaults for existing conversations and workspace data.

## Implementation Guidance for a Coding LLM

Use this document as the feature acceptance contract, not as permission to rewrite unrelated architecture.

1. Inspect current source, relevant docs, tests, package scripts and git status before editing. Follow repository instructions. Confirm where Chat conversation state, slash commands, native folder dialogs, workspace tools, capability permissions, persistence, IPC/preload and activity events are owned.
2. State the smallest implementation sequence and identify any requirement not supported by the existing tool boundary. Do not invent a general shell, unrestricted filesystem tool, hidden permission grant or pretend UI.
3. Implement in small vertical slices using the existing provider/model abstraction. Keep all model vendors usable; never add vendor-specific logic to workspace persistence or permission checks.
4. Add focused tests for persistence/migration, native picker and conversation linkage, permissions/scopes/deny precedence, path boundary and sensitive-file rejection, approval argument binding and revalidation, activity redaction, UI switching/reconnect, and folderless/legacy behavior.
5. Run the narrowest relevant tests immediately after each slice, then the repository typecheck/lint/test/build commands that are available. Do not weaken or delete existing security tests to make a feature pass.
6. Update `docs/CHAT.md`, `docs/SECURITY.md`, `docs/ARCHITECTURE.md`, and any API/agent docs affected by actual behavior. Keep `CODE.md` synchronized with what is shipped; distinguish implemented, deferred and unavailable capabilities.
7. Finish with a concise report of behavior changed, security limitations, files touched, and exact checks run/results. Do not claim full support for a requirement that remains deferred.

## Acceptance Criteria

### User workflow

- User can invoke `/code`, choose a directory using the native picker and link it to the current conversation.
- User can create a new conversation and reconnect a previously linked workspace without relying on an older conversation's prompt/history.
- User can switch or disconnect the active workspace without deleting project files or other workspace records.
- Workspace name and effective provider/model, optional agent and permission state are visible in Chat.
- `/code` works with no agent, and changing/detaching an agent does not disconnect the workspace.
- Existing conversations and folderless Chat/agent runs continue to work after migration.

### Authorization and security

- Connecting/selecting a folder alone grants no read, write, terminal, Git, network, install, delete, move or credential access.
- A denied capability cannot execute even if a model requests it, an agent selects it, or another policy layer allows it.
- One-time, conversation and workspace grants have distinct persistence/expiry behavior and are tested.
- A request outside the active root, traversal path, disallowed symlink, sensitive file, stale write hash or modified-after-approval request is blocked or reapproved.
- Writes present a reviewable diff and cannot be silently applied outside the established approval policy.
- Command execution is separately authorized, constrained to the selected root and current allowlist, bounded, cancellable and auditable.
- Activity records include denials/failures and redact known secrets; no raw model chain-of-thought is stored or shown.

### Context quality and portability

- Project retrieval is bounded, permission-gated and source-labeled; the whole project is never automatically sent.
- Every currently configured provider/model can use the feature through the same application model/tool interfaces.
- Workspace data is isolated by workspace ID, and deleting/revoking one workspace does not affect another.
- UI approvals are generated by the application and cannot be spoofed by project content or model text.

## Explicit Non-Goals

Unless separately specified, do not implement a standalone CLI, remote/cloud workspace synchronization, unrestricted shell, OS-level sandbox, automatic `.env`/credential access, automatic whole-project upload, arbitrary network access, automatic dependency installation, Git push/reset, agent generation, or an invented undo system. Do not require an agent to use `/code`, and do not replace existing provider integrations or the central capability router.
