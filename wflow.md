# Application architecture and complete execution flows

This document describes the current implementation, verified against the source on 2026-10-03. Graphs show actual application paths, including configuration, execution, approvals, persistence, failures and cancellation. They do not imply that every selected capability executes.

## 1. Feature roles and execution order

| Feature | Responsibility | Selection behavior |
| --- | --- | --- |
| Chat | Accept messages, choose a command/model, display answers, sources, activity and approvals | Feature checkboxes enable command paths; they do not execute every feature |
| Agent | Combine instructions, model, capability policy and iteration limits | Saved settings determine its eligible capabilities |
| Skill | Supply task instructions; a directly selected skill can also run with its own capabilities | An agent-attached skill loads when called; a direct skill command follows the two paths below |
| MCP | Connect to external servers and expose discovered tools | Agent calls require an enabled, connected server and permitted tool |
| Tools | Execute custom functions or built-in workspace operations | Invocation requires an eligible capability; explicit editor tests execute directly |
| Knowledge Base (KB) | Index documents and retrieve reference passages | Chat context and saved agent KB selections are separate |
| Workflow | Schedule agents by dependencies and pass outputs between them | Each node runs its referenced agent with that agent's settings |
| Code | Connect a workspace and constrain built-in file, shell and Git operations | Workspace policy restricts agent access |
| Memory | Store and retrieve durable background facts | Separate from KB, chat transcripts and graph checkpoints |
| Saved Text | Store notes and refresh their searchable KB collection | Saving notes triggers indexing, not agent execution |

For a saved agent: **load configuration → filter capabilities → retrieve permitted agent KB context → model call → optional capability calls → repeat → final answer**. There is no fixed Skills → Tools → MCP order. Calls within one agent are serialized; separate workflow agents can run concurrently.

## 2. Overall architecture

```mermaid
flowchart TB
    UI["Electron renderer: Chat, Agents, Skills, MCP, Tools, KB, Workflows, Code, Settings"]
    UI --> Bridge["Preload: window.workspace"]
    Bridge --> IPC["Main-process IPC: validate request with Zod"]
    IPC --> Chat["Chat service and ChatTurnGraph"]
    IPC --> Agent["Agent service and AgentLoopGraph"]
    IPC --> Workflow["Workflow service"]
    IPC --> Library["Library and definition services"]
    IPC --> KB["Knowledge indexing and retrieval"]
    IPC --> MCP["MCP service"]
    IPC --> Tools["Custom tool service"]
    IPC --> Settings["Settings, provider router and secrets"]
    Chat --> Agent
    Chat --> Workflow
    Workflow --> Agent
    Agent --> Router["Capability router"]
    Router --> Library
    Router --> KB
    Router --> MCP
    Router --> Tools
    Router --> Local["Built-in workspace tools"]
    Chat --> Model["Shared LangChain model bridge"]
    Agent --> Model
    Model --> Provider["Selected provider and model"]
    Library --> Files["Local definition files"]
    KB --> Vectors["LanceDB vectors and content cache"]
    Chat --> DB["Chat history and checkpoints"]
    Agent --> Runs["Agent run history and checkpoints"]
    Workflow --> WRuns["Workflow run history"]
    Chat --> Events["App events through preload subscriptions"]
    Agent --> Events
    Workflow --> Events
    KB --> Events
    MCP --> Events
    Events --> UI
```

## 3. Chat admission and command priority

The renderer resolves one active command. Enabling several checkboxes does not merge several commands or replace the selected agent's capability configuration.

```mermaid
flowchart TD
    Send["Send message"] --> Busy{"Conversation already generating?"}
    Busy -->|Yes| Error["Show error"]
    Busy -->|No| Modes["Apply chat modes: KB off means knowledge none"]
    Modes --> Match{"Command's matching mode enabled?"}
    Match -->|No| Error
    Match -->|Yes or no command| Select["Capture chat provider/model; workflow uses child agent models"]
    Select --> Regen{"Regenerate a command run?"}
    Regen -->|Yes| Error
    Regen -->|No| Workspace["Resolve and validate active Code workspace when applicable"]
    Workspace --> Command{"Explicit or remembered command?"}
    Command -->|Yes| Prepare["Prepare agent, workflow, skill, tool or MCP command"]
    Command -->|No| Code{"Active Code workspace?"}
    Code -->|Yes| Coding["Prepare built-in coding agent"]
    Code -->|No| MCPMode{"MCP mode enabled?"}
    MCPMode -->|Yes| AllMCP["Prepare agent using enabled connected MCP servers"]
    MCPMode -->|No| Plain["Ordinary chat"]
    Prepare --> Save["Save user message; create assistant placeholder"]
    Coding --> Save
    AllMCP --> Save
    Plain --> Save
    Save --> Turn["Run ChatTurnGraph"]
```

## 4. Chat turn graph: plain chat, context and command execution

```mermaid
flowchart TD
    Start["Start chat turn"] --> Pure{"All chat modes unchecked?"}
    Pure -->|Yes| Direct["Generate with bounded history; no app system prompt or context preparation"]
    Pure -->|No| Prepare["Prepare instruction-only skill if selected; executor commands skip this step"]
    Prepare --> KB{"Chat KB selected?"}
    KB -->|No| Memory["Retrieve relevant conversation/global memory"]
    KB -->|Yes| Forced{"KB mode explicitly enabled?"}
    Forced -->|Yes| Search["Retrieve passages directly; record empty/unready status"]
    Forced -->|No| Decision["Capability relevance check before retrieval"]
    Decision -->|Allowed and necessary| Search
    Decision -->|Skipped or blocked| Status["Record that KB was not searched"]
    Search --> Memory
    Status --> Memory
    Memory --> Exec{"Prepared command has executor?"}
    Exec -->|Yes| Task["Append Chat KB status and passages to task"]
    Task --> Run["Execute agent, capability-enabled skill, tool/MCP wrapper or workflow"]
    Exec -->|No| Prompt["Build system prompt with policy, skill, KB and memory"]
    Prompt --> Stream["Trim history to context budget; stream model tokens"]
    Direct --> Persist["Persist assistant response"]
    Stream --> Persist
    Run --> Persist
    Persist --> Capture["Eligible completed exchange: optional memory capture"]
    Capture --> End["Save sources, activity and final status; emit done/error/stopped"]
```

Memory is retrieved at the graph's `remember` node, but an executor command receives the task plus Chat KB context, not the ordinary chat system prompt or its retrieved memory block. Executor command results return as a completed answer; ordinary chat streams tokens.

## 5. Agent initialization and model/tool loop

```mermaid
flowchart TD
    Start["Run saved agent, chat wrapper or workflow node"] --> Admit["Check enabled agent, model/provider and concurrency"]
    Admit --> Create["Create run ID, AbortController, history and timer"]
    Create --> Load["Load Skills, Tools, MCP definitions and KB sources"]
    Load --> Register["Register capability metadata, input schemas and executors"]
    Register --> Filter["Filter catalog by mode, switches, selections, permissions and user restrictions"]
    Filter --> KB["Search eligible agent KB scopes before first model request"]
    KB --> Prompt["Build policy, agent instructions, workspace, catalog and reference context"]
    Prompt --> Harness{"Configured agent harness"}
    Harness -->|Standard| Standard["LangChain createAgent"]
    Harness -->|Deep| Deep["Deep harness; internal planning tool only in addition to permitted capabilities"]
    Standard --> Think["Model call: trim messages and increment iteration count"]
    Deep --> Think
    Think --> Limit{"Model-call budget exhausted?"}
    Limit -->|Yes| Max["Max iterations reached"]
    Limit -->|No| Calls{"Model requests capability calls?"}
    Calls -->|Yes| Execute["Serialize calls through capability router"]
    Execute --> Result["Record redacted inputs, output/error and activity"]
    Result --> Think
    Calls -->|No| Final["Validate final assistant answer"]
    Final --> Done["Completed; persist result"]
    Think -->|Invalid response or unrecoverable error| Fail["Failed; persist error"]
    Create -->|Stop or 15-minute timer| Cancel["Abort run; resolve pending approvals; mark interrupted calls"]
    Cancel --> Cancelled["Cancelled"]
```

At most three agents run at once. Workflow nodes wait for an available slot; a direct start at capacity fails. The deep harness does not independently authorize filesystem or delegation tools. Agent-attached skills are not all inserted into the initial prompt: their instructions are returned when the model calls them.

## 6. Capability eligibility, relevance and approval

```mermaid
flowchart TD
    Proposed["Proposed skill, KB, custom tool, local tool or MCP call"] --> Eligible{"Enabled, type allowed, correct mode/selection,<br/>project available and permission not denied?"}
    Eligible -->|No| Block["Return blocked reason; do not execute"]
    Eligible -->|Yes| Evaluate["Model-based relevance and necessity check<br/>with task, args and previous results"]
    Evaluate --> Need{"Relevant and necessary,<br/>cannot answer directly,<br/>not forbidden by user?"}
    Need -->|No or invalid verdict| Block
    Need -->|Yes| Available{"Still available?"}
    Available -->|No| Block
    Available -->|Yes| Permission{"Effective permission"}
    Permission -->|Always allow| Recheck["Recheck cancellation and availability"]
    Permission -->|Ask| Internal{"Built-in mutation confirms inside executor?"}
    Internal -->|No| Ask["Display approval with tool and input"]
    Ask --> Approved{"User approves?"}
    Approved -->|No| Block
    Approved -->|Yes| Recheck
    Internal -->|Yes| Recheck
    Recheck --> Execute["Execute capability; built-in mutation may show diff/command approval"]
    Execute --> Result["Return result/error to model and run history"]
```

Modes: **None** blocks all capabilities; **Selected** permits selected entries; **Auto** permits eligible entries across allowed types. A deny at any applicable permission scope wins. Skills and KB retrieval do not ask for approval, but an explicit deny still blocks them. Custom tools and MCP default to Ask. Built-in mutations can confirm inside their executor. Upfront agent KB retrieval uses the filtered catalog directly and does not make this per-call relevance request.

## 7. Skills: all three usage paths

```mermaid
flowchart TD
    Skill["Skill definition: instructions and optional capability settings"] --> Use{"How is the skill used?"}
    Use -->|Attached to agent| Attached["Register skill as an eligible capability"]
    Attached --> Choose["Model chooses skill when task matches"]
    Choose --> Router["Capability router checks relevance and availability"]
    Router --> Instructions["Return skill instructions to agent model"]
    Instructions --> Loop["Agent continues with its own permitted capabilities"]
    Use -->|Direct Chat skill command| Has{"Skill has active capabilities or Auto mode?"}
    Has -->|No| Plain["Prepare instruction-only skill"]
    Plain --> Check["Chat relevance check"]
    Check --> Apply["If allowed, insert instructions into ordinary chat system prompt"]
    Apply --> Answer["Chat model generates answer"]
    Has -->|Yes| Connect["Attempt to start permitted enabled MCP servers"]
    Connect --> Wrapper["Use skill as agent instructions and capability configuration"]
    Wrapper --> Agent["Run full agent loop with skill's permitted KB, Skills, Tools and MCP"]
```

An attached skill supplies instructions; loading it does not replace the parent agent's capability policy. A directly selected capability-enabled skill uses its own capability configuration in the agent wrapper.

## 8. MCP configuration, connection, discovery and calls

```mermaid
flowchart TD
    Editor["Form / JSON / YAML / Markdown input"] --> Parse["Parse and validate MCPServerConfig"]
    Parse -->|Invalid| Error["Show editor error; do not save"]
    Parse -->|Valid| Save["Save canonical server JSON; editing stops existing connection"]
    Save --> Start{"Connection trigger"}
    Start --> Manual["Start / Restart / Test"]
    Start --> Auto["App startup: enabled and autoConnect/autoStart"]
    Start --> Slash["Direct Chat MCP command"]
    Start --> Skill["Capability-enabled Chat skill starts eligible MCP servers"]
    Manual --> Resolve["Check enabled config; resolve env/header secret references"]
    Auto --> Resolve
    Slash --> Resolve
    Skill --> Resolve
    Resolve --> Transport{"Transport"}
    Transport -->|stdio| Process["MCPAdapter launches command with args, cwd and reduced environment"]
    Transport -->|streamable-http| HTTP["MCPAdapter HTTP connection with URL and headers"]
    Process --> Discover["Initialize and list tools"]
    HTTP --> Discover
    Discover --> Connected["Connected state: names, descriptions and input schemas"]
    Discover -->|Failure| Failed["Error state and redacted logs"]
    Connected --> Catalog["Eligible agent catalog exposes discovered tools"]
    Catalog --> Gate["Model chooses tool; router checks relevance and approval"]
    Gate --> Invoke["Invoke adapter LangChain tool with args, signal and timeout"]
    Invoke --> Output["Convert, bound and redact result; tool error becomes execution error"]
    Output --> Model["Return to model and record MCP use in agent run"]
    Connected --> Stop["Stop / Restart / edit / allowed deletion / app shutdown"]
    Stop --> Close["Invalidate connection generation and close adapter"]
```

Saved-agent execution does not start all selected MCP servers; its catalog uses already-connected servers. MCP mode without a selected server also uses already-connected enabled servers and fails if none have tools. Direct `/mcp` attempts to connect its selected server. Test pings an existing connection or starts a stopped server. Runtime configuration supports stdio restart settings and tool timeout settings. MCP resource/prompt metadata does not establish an agent resource-reading or prompt-execution path: the implemented agent integration uses discovered tools.

## 9. Custom tools: authoring, conversion, saving and testing

```mermaid
flowchart TD
    Input{"Tool input"} --> Builder["Builder: name, description, inputs and async function body"]
    Input --> TS["TypeScript source"]
    Input --> Formats["JSON / YAML / simple Markdown"]
    Builder --> Generate["Generate canonical LangChain tool TypeScript"]
    Formats --> Convert["Parse definition and generate TypeScript"]
    Generate --> AST["Static TypeScript AST analysis"]
    Convert --> AST
    TS --> AST
    AST --> Invalid["Syntax/schema/import errors at editor top"]
    AST --> Valid["Validate exported tool, name, description and supported Zod schema"]
    Valid --> Mapping{"Builder-compatible source?"}
    Mapping -->|Yes| Sync["Allow two-way Builder / TypeScript conversion"]
    Mapping -->|No| Advanced["Preserve advanced source in TypeScript mode"]
    Sync --> Action{"User action"}
    Advanced --> Action
    Action --> Format["Format / Validate / Copy: no module execution"]
    Action --> Save["Derive metadata and atomically save id.ts"]
    Action --> Test["Explicit Run test with JSON input; unsaved source is supported"]
    Save --> Load["Reload with static analysis; no execution"]
    Save --> Catalog["Agent exposes saved input schema and custom tool ID"]
    Catalog --> Gate["Agent router checks eligibility, relevance and approval"]
    Gate --> Run["CustomToolService execution"]
    Test --> Run
```

```mermaid
flowchart TD
    Run["Run custom tool"] --> Limits["Check concurrency, enabled config, input size and cancellation"]
    Limits --> Kind{"Tool implementation"}
    Kind -->|Native TypeScript or converted JavaScript| Analyze["Analyze source, then transpile only for execution"]
    Analyze --> Child["Spawn Node child with reduced environment and optional project cwd"]
    Child --> Invoke["Load exported tool; hydrate supported date input; call tool.invoke"]
    Kind -->|Legacy API configuration| API["Resolve header secrets; HTTP request with validated URL and no redirects"]
    Invoke --> Bound["Timeout/cancellation and output limits"]
    API --> Bound
    Bound --> Result["Redact output/error and return to test UI or agent"]
```

Canonical tool storage is `.ts`, unlike MCP JSON. Legacy Markdown tools remain readable; saving migrates them to TypeScript with the same stable ID. An unchanged legacy API definition retains its existing credential-aware execution path. Static validation does not execute modules or arbitrary callbacks and is not a full semantic TypeScript type check. Child-process isolation is not an OS sandbox. Explicit Tool Test is a direct user invocation and does not pass through the agent relevance/approval router.

## 10. Knowledge Base: indexing, incremental sync and retrieval

```mermaid
flowchart TD
    Source["Add file, folder, URL or Saved Text source"] --> Metadata["Persist source metadata with idle status"]
    Metadata --> Sync["Sync / Re-index; serialize index jobs"]
    Sync --> Read["Read supported Markdown/text files or fetch one HTML URL"]
    Read --> Normalize["Normalize text and create preview"]
    Normalize --> Hash{"Content and chunk settings unchanged?"}
    Hash -->|Yes for local document| Skip["Reuse existing chunks"]
    Hash -->|No| Chunk["Split into overlapping chunks"]
    Chunk --> Embed["Batch embeddings using selected Ollama embedding model"]
    Embed --> Store["Store source-labelled vectors in model-specific LanceDB table"]
    Skip --> Clean["Remove deleted documents; update manifests and counts"]
    Store --> Clean
    Clean --> Ready["Ready status and progress event"]
    Sync -->|Failure or cancellation| Error["Remove partial vectors; mark source error for retry"]
    Ready --> Search{"Search mode"}
    Search -->|Semantic| Query["Embed query; vector search filtered by selected scope"]
    Search -->|Keyword| Literal["Escaped literal substring search"]
    Query --> Passages["Return bounded passages with source names and locations"]
    Literal --> Passages
    Passages --> Context["Chat reference context or agent KB context/tool result"]
    Context --> Answer["Model uses passages, cites sources and acknowledges missing evidence"]
```

Supported local source content is `.md` and `.txt`; folder traversal ignores configured paths and does not follow symlinks. URL indexing fetches one page, without browser rendering or link crawling. Embedding-model changes require reindexing selected sources. KB groups organize sources; retrieval selects source IDs, collections or all ready sources, not a group name by itself.

## 11. Chat KB versus agent KB

```mermaid
flowchart TD
    ChatKB["Chat KB selector and KB mode"] --> ChatSearch["ChatTurnGraph retrieval before command execution"]
    ChatSearch --> Task["Append passages and retrieval status to command task"]
    AgentKB["Saved agent knowledge selections and capability policy"] --> Catalog["Filter eligible agent KB scopes"]
    Catalog --> Initial["Retrieve passages before first agent model call"]
    Task --> Model["Agent model receives task plus initial agent context"]
    Initial --> Model
    Model -->|Needs additional evidence| Tool["knowledge capability call through router"]
    Tool --> Model
```

These selections can overlap, so a chat-triggered agent can perform Chat retrieval and then agent retrieval. Chat KB does not overwrite saved agent KB settings. A workflow's Chat KB context travels in its task; individual nodes still use their saved agent KB configuration.

## 12. Workflow definition and scheduling

```mermaid
flowchart TD
    Builder["Create/edit workflow: agent nodes, prompts, connections and mappings"] --> Validate["Validate schema, unique nodes, existing edges, safe mappings, cycles and limits"]
    Validate -->|Invalid| Error["Show error; do not save"]
    Validate -->|Valid| References["Check every referenced agent exists"]
    References --> Save["Save workflows/id.json atomically"]
    Save --> Trigger["Run from Workflows or Chat workflow command"]
    Trigger --> Snapshot["Snapshot definition and create workflow run history"]
    Snapshot --> Mode{"Execution mode"}
    Mode -->|Sequential| Sequence["Derive edges from agent array order"]
    Mode -->|Parallel| Parallel["Use no dependency edges; nodes are independent"]
    Mode -->|Mixed| Mixed["Use saved connections"]
    Sequence --> Schedule["Schedule each node once; wait for all incoming dependencies"]
    Parallel --> Schedule
    Mixed --> Schedule
    Schedule --> Upstream{"All required upstream nodes completed?"}
    Upstream -->|No| Failed["Mark dependent node failed without running its agent"]
    Upstream -->|Yes| Mapping["Map upstream outputs into prompt or previousAgentOutput"]
    Mapping --> Task["Combine original task, node prompt and source-labelled upstream outputs"]
    Task --> Slot["Wait for agent capacity; check cancellation and input/execution limits"]
    Slot --> Agent["Run referenced saved agent with its own model and capability settings"]
    Agent --> Events["Publish node activity, iterations and approval waiting status"]
    Events --> Result["Save node result as parsed JSON when valid, otherwise text"]
    Result --> Downstream["Release dependent nodes"]
    Downstream --> Schedule
    Result --> All["After all scheduled nodes settle"]
    Failed --> All
    All --> End["Persist completed, failed or cancelled workflow"]
    End --> Chat["Chat success returns terminal nodes' labelled results"]
```

Sequential mode uses list order even if other saved connections exist. Parallel mode ignores dependency edges for execution; saved connections are still validated. Mixed mode uses connections for dependencies. Edge mode labels do not introduce a second scheduler. No conditional branching evaluator or recursive workflow-as-node executor is implemented. Workflow `maxIterations` limits agent-node executions; each agent separately limits model calls. Workflow `maxDepth` validates dependency depth.

## 13. Sequential, parallel and mixed examples

```mermaid
flowchart LR
    subgraph Sequential
        SA["Agent A"] -->|Output| SB["Agent B"] -->|Output| SC["Agent C"]
    end
    subgraph Parallel
        Task["Same workflow task"] --> PA["Agent A"]
        Task --> PB["Agent B"]
        Task --> PC["Agent C"]
        PA --> Results["Terminal results returned together"]
        PB --> Results
        PC --> Results
    end
    subgraph Mixed
        MA["Analysis agent"] --> MB["Security agent"]
        MA --> MC["Performance agent"]
        MB --> MD["Final review waits for both"]
        MC --> MD
    end
```

Independent branches run concurrently subject to the shared three-agent limit. A failed branch blocks its dependents; unrelated branches may finish. Aggregation preserves each source node/agent and its mapped result rather than silently merging objects.

## 14. Workflow output mapping

```mermaid
flowchart LR
    Output["Upstream agent final answer"] --> Parse["Parse JSON when valid; otherwise retain text"]
    Parse --> Select["Select result or safe dotted path such as result.issues"]
    Select --> Target{"targetInput"}
    Target -->|prompt| Prompt["Append source-labelled prompt text"]
    Target -->|previousAgentOutput| Context["Append source-labelled JSON context"]
    Prompt --> Task["Original task + node prompt + mapped context"]
    Context --> Task
    Task --> Agent["Downstream saved agent"]
    Select -->|Missing path| Error["Fail downstream node with mapping error"]
```

## 15. Code workspace and built-in tools

```mermaid
flowchart TD
    Code["Connect Code workspace to conversation"] --> Validate["Validate workspace path and access policy"]
    Validate --> Route{"Chat command"}
    Route -->|No explicit command| Coding["Prepare built-in coding agent with recent conversation context"]
    Route -->|Saved agent| Policy["Apply workspace policy to saved agent"]
    Coding --> Catalog["Expose permitted file, project, Git and shell tools"]
    Policy --> Catalog
    Catalog --> Router["Capability checks and model relevance"]
    Router --> Read["Read/list/search/exists, project detection or Git inspection"]
    Router --> Write["Write/edit/delete: check expected file hash and approval"]
    Router --> Shell["Shell: validate executable/arguments/cwd and approval"]
    Read --> Result["Return bounded result or error to agent"]
    Write --> Result
    Shell --> Result
```

Workspace restrictions for built-in tools do not create an OS sandbox for custom tool code or an external MCP server. Tools requiring a project are filtered out when no project is available or the request forbids project access.

## 16. Save, import/export, groups and deletion

```mermaid
flowchart TD
    Input["Form, source editor or imported file"] --> Parse["Parse selected format"]
    Parse --> Validate["Validate shared schema and feature-specific definition"]
    Validate -->|Invalid| Error["Editor error; preserve draft"]
    Validate -->|Valid| Format{"Feature storage"}
    Format --> MCP["MCP: canonical JSON"]
    Format --> Tool["Tools: canonical TypeScript and inert app metadata comment"]
    Format --> Workflow["Workflows: JSON"]
    Format --> Other["Agents, Skills, Saved Text: existing Markdown/frontmatter storage"]
    MCP --> Write["Atomic write with stable ID"]
    Tool --> Write
    Workflow --> Write
    Other --> Write
    Write --> Reload["Reload renderer library/store"]
    Reload --> Export["Export feature's canonical format"]
    Reload --> Group["Move item / rename group / delete group"]
    Group --> Meta["Update metadata and group registry; preserve item IDs"]
    Meta --> Reload
    Reload --> Delete["Request item deletion"]
    Delete --> References["Check dependent references where enforced"]
    References -->|Referenced| Block["Show affected definitions; deletion blocked"]
    References -->|Removable| Confirm["Confirm destructive deletion in UI"]
    Confirm --> Remove["Remove definition; stop MCP when applicable; refresh Saved Text index when applicable"]
```

Library groups are organizational filters, not capability permissions or workflow dependency edges. Deleting a library group moves its members to the ungrouped state; it does not delete their definitions. Tool imports preview conversion before saving. KB source groups are metadata, while collections also provide retrieval scopes. Workflow duplication creates a new workflow ID.

## 17. Provider selection and credentials

```mermaid
flowchart TD
    Selection{"Entry point"} --> Chat["Chat: selected provider/model captured for this turn"]
    Selection --> Agent["Standalone agent: saved provider/model"]
    Selection --> Workflow["Workflow: each saved child agent selects its provider/model"]
    Chat --> Validate["Validate enabled provider and available model"]
    Agent --> Validate
    Workflow --> Validate
    Validate --> Snapshot["Create provider settings snapshot"]
    Snapshot --> Bridge["LangChain native model or provider bridge"]
    Bridge --> Response["Response / native capability calls"]
    Secrets["Credential store / configured env / process environment"] --> Resolve["Resolve explicit secret references in main process"]
    Resolve --> MCP["MCP env or HTTP headers"]
    Resolve --> API["Legacy API tool headers"]
    Response --> Redact["Redact persisted/emitted application output"]
    MCP --> Redact
    API --> Redact
```

Chat-selected model settings can override the saved agent's model for that chat invocation. A workflow runs its saved child-agent models instead of overriding every node with the Chat model. Embeddings use the independently selected KB embedding model.

## 18. History, memory and Saved Text

```mermaid
flowchart TD
    Exchange["Chat exchange"] --> History["SQLite chat messages and metadata"]
    History --> Recent["Bounded recent-history prompt window"]
    Exchange --> Capture["Explicit remember capture or optional automatic capture"]
    Capture --> Filter["Reject secret-shaped content; honor memory settings"]
    Filter --> Memory["memory.sqlite: global, conversation or agent scope"]
    Memory --> Retrieve["Relevant bounded memory retrieval"]
    Retrieve --> Chat["Ordinary chat system prompt background context"]
    Note["Save/edit/import/delete Saved Text note"] --> MD["Markdown note storage"]
    MD --> Sync["Refresh Saved Text collection; cancel outdated index work"]
    Sync --> KB["KB indexing and retrieval pipeline"]
    Agent["Agent calls and final status"] --> AgentDB["agent-runs.sqlite"]
    Workflow["Workflow definition snapshot and node statuses"] --> WorkflowDB["Workflow run SQLite store"]
    Graph["Chat/agent graph execution"] --> Checkpoint["checkpoints.sqlite: graph state by thread ID"]
```

Transcripts, long-term memory, document vectors and graph checkpoints have different purposes. The ordinary Chat graph retrieves memory for the conversation. The current agent loop does not separately inject agent-scoped long-term memory, even though the memory API supports that scope. Saved Text remains saved if embedding fails; its KB source can be reindexed later.

## 19. Failure, approval, cancellation and restart lifecycle

```mermaid
flowchart TD
    Active["Active Chat / Agent / Workflow / Tool / MCP / KB job"] --> Approval["A capability may wait for approval"]
    Approval -->|Approve| Continue["Recheck availability; continue execution"]
    Approval -->|Reject| Blocked["Return rejection; agent may continue with another approach"]
    Active --> Stop["User Stop, timeout or application shutdown"]
    Stop --> Chat["Abort Chat; prepared command receives signal"]
    Chat --> Workflow["Workflow abort propagates to running child agents"]
    Chat --> Agent["Abort chat-triggered agent"]
    Workflow --> Agent
    Agent --> Calls["Cancel child calls and resolve pending approval waits"]
    Stop --> Tool["Abort custom tool; kill Node child when applicable"]
    Stop --> MCP["Close MCP adapter and invalidate stale connection completion"]
    Stop --> KB["Abort indexing; remove partial vectors and mark retryable error"]
    Calls --> Persist["Persist terminal status and partial activity"]
    Tool --> Persist
    MCP --> Persist
    KB --> Persist
    Persist --> UI["Publish error/stopped/cancelled status"]
    Launch["Application restart"] --> Restore["Restore definitions, chat, agent/workflow history and checkpoints"]
    Restore --> Interrupted["Previously unfinished agent/workflow runs become cancelled; KB jobs become errors"]
    Restore --> Auto["Start enabled MCP configs with auto-connect enabled"]
```

Capability errors are recorded and returned to the model so it can respond or recover. Admission failures, invalid final responses and unrecoverable graph errors fail the run. Workflow upstream failures prevent dependent agents from executing, but do not automatically stop every independent branch. The shutdown handler separately stops chat, workflows, agents, KB, MCP and custom tools before closing databases.

## 20. Full example with all requested features

Request: “Use our pricing KB, follow the quote-writing skill, fetch current customer details, calculate the quote and have a review agent check it.” This example uses a mixed workflow; the model may skip any unnecessary capability.

```mermaid
sequenceDiagram
    actor User
    participant Chat
    participant Workflow
    participant Quote as Quote Agent
    participant KB
    participant Skill
    participant MCP
    participant Tool as Calculator Tool
    participant Review as Review Agent
    User->>Chat: Select workflow and send request
    opt Chat KB selected
        Chat->>KB: Retrieve Chat context
        KB-->>Chat: Source passages and status
    end
    Chat->>Workflow: Task plus any Chat KB context
    Workflow->>Quote: Original task and quote-node prompt
    Quote->>KB: Retrieve permitted agent KB context upfront
    KB-->>Quote: Pricing passages
    Quote->>Quote: Model plans next step
    opt Skill relevant and necessary
        Quote->>Skill: Load through capability router
        Skill-->>Quote: Quote-writing instructions
    end
    opt Customer lookup necessary and MCP connected
        Quote-->>User: Request approval when permission is Ask
        User->>Quote: Approve
        Quote->>MCP: Invoke customer lookup
        MCP-->>Quote: Customer details
    end
    opt Calculation necessary
        Quote-->>User: Request tool approval when permission is Ask
        User->>Quote: Approve
        Quote->>Tool: Invoke validated calculation input
        Tool-->>Quote: Calculation result
    end
    Quote-->>Workflow: Final quote with source citations
    Workflow->>Review: Task, review prompt and mapped quote output
    Review->>Review: Run own model/capability loop
    Review-->>Workflow: Reviewed quote
    Workflow-->>Chat: Terminal node result
    Chat-->>User: Final answer and recorded activity
```

## Implementation references

- [Chat admission and command priority](src/main/services/ollama/chat.ts)
- [Chat command wrappers, skills and MCP connection behavior](src/main/services/ollama/commands.ts)
- [Chat turn graph, KB and memory context](src/main/services/ai/chat-graph.ts)
- [Agent registration, upfront KB retrieval and lifecycle](src/main/services/agents/agents.ts)
- [Agent model/tool loop and harness](src/main/services/ai/agent-graph.ts)
- [Capability modes, permissions, relevance and approval](src/main/services/agents/capabilities.ts)
- [Serialized calls and tool history](src/main/services/ai/capability-tools.ts)
- [MCP transports, discovery and invocation](src/main/services/mcp/mcp.ts)
- [Tools static parsing and conversion](src/main/services/tools/typescript.ts)
- [Tools execution and limits](src/main/services/tools/custom.ts)
- [KB indexing and retrieval](src/main/services/rag/knowledge.ts)
- [Workflow validation, edges and mappings](src/shared/workflows.ts)
- [Workflow definition storage](src/main/services/workflows/definitions.ts)
- [Workflow scheduling, failures and cancellation](src/main/services/workflows/workflows.ts)
- [Library storage and groups](src/main/services/filesystem/library.ts)
- [Provider capture](src/main/services/providers/router.ts)
- [Memory service](src/main/services/ai/memory.ts)
- [IPC validation and feature operations](src/main/ipc/register.ts)
- [Startup and shutdown](src/main/index.ts)
