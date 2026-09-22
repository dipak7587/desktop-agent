# 18. Nested Agents / Agent Workflows

Add support for creating **Agent Workflows**, where one Agent can trigger one or more other Agents.

The output from one Agent should be available as the input/context for the next Agent.

## Workflow Example

A user should be able to create a workflow such as:

```text
Agent A
   ↓
Output
   ↓
Agent B
   ↓
Output
   ↓
Agent C
```

Example:

```text
Code Analysis Agent
        ↓
Code Review Agent
        ↓
Documentation Agent
```

The output of the **Code Analysis Agent** becomes the input/context for the **Code Review Agent**.

The output of the **Code Review Agent** can then be passed to the **Documentation Agent**.

---

# 19. Sequential Agent Execution

Support sequential execution using a workflow configuration.

Example:

```text
Agent A → Agent B → Agent C
```

Execution:

```text
Start
  ↓
Run Agent A
  ↓
Agent A Completed
  ↓
Pass Agent A Output to Agent B
  ↓
Run Agent B
  ↓
Agent B Completed
  ↓
Pass Agent B Output to Agent C
  ↓
Run Agent C
  ↓
Workflow Completed
```

The next Agent should **not start until the previous Agent has completed successfully**.

If an Agent fails:

```text
Agent A
  ↓
Agent B ❌
  ↓
Stop Workflow
```

The workflow should provide an appropriate error and identify which Agent failed.

---

# 20. Parallel Agent Execution

Support parallel execution when multiple Agents can work independently.

Example:

```text
                 ┌── Agent B ──┐
Agent A ─────────┼── Agent C ──┼── Agent E
                 └── Agent D ──┘
```

Execution:

```text
Agent A
   ↓
Agent A Output
   ↓
┌───────────────┐
│               │
▼               ▼
Agent B       Agent C
│               │
▼               ▼
Agent D       Agent E
```

For a parallel branch:

* Start independent Agents at the same time.
* Each Agent receives the required input/context.
* Wait for all required Agents to complete.
* Combine their outputs.
* Pass the combined output to the next Agent if configured.

Example:

```text
Code Analysis Agent
        ↓
 ┌──────┴──────┐
 ↓             ↓
Security      Performance
Agent         Agent
 ↓             ↓
 └──────┬──────┘
        ↓
   Final Review
      Agent
```

---

# 21. Workflow Builder

Add a visual workflow builder for creating nested Agent workflows.

Example:

```text
┌──────────────────────┐
│ Code Analysis Agent  │
└──────────┬───────────┘
           │
           ▼
     ┌───────────┐
     │ Parallel  │
     └─────┬─────┘
           │
      ┌────┴────┐
      ▼         ▼
┌──────────┐ ┌──────────────┐
│ Security │ │ Performance  │
│ Agent    │ │ Agent        │
└────┬─────┘ └──────┬───────┘
     │              │
     └──────┬───────┘
            ▼
   ┌────────────────┐
   │ Final Review   │
   │ Agent          │
   └────────────────┘
```

Users should be able to:

* Add an Agent.
* Remove an Agent.
* Connect Agents.
* Reorder Agents.
* Configure sequential execution.
* Configure parallel execution.
* Configure input/output mapping.
* Configure conditions if supported.
* Save the workflow.
* Edit an existing workflow.
* Duplicate a workflow.
* Run a workflow.
* Stop/cancel a running workflow.

---

# 22. Agent Output → Agent Input

The workflow engine must support passing output between Agents.

Example:

```ts
interface AgentOutput {
  agentId: string;
  runId: string;
  status: "completed" | "failed";
  result: unknown;
}
```

The next Agent can receive:

```ts
interface AgentInput {
  prompt: string;
  previousAgentOutput?: unknown;
  folderPath?: string;
}
```

Example:

```text
Agent A Output:

{
  "issues": [
    "Unused dependency",
    "Missing test coverage",
    "Incorrect API usage"
  ]
}
```

Agent B receives:

```text
Previous Agent Output:
{
  "issues": [
    "Unused dependency",
    "Missing test coverage",
    "Incorrect API usage"
  ]
}
```

Agent B can then process those results.

---

# 23. Parallel Output Aggregation

When multiple Agents execute in parallel, provide a mechanism to combine their outputs.

Example:

```text
Security Agent
     ↓
Security Result
     \
      \
       → Aggregator → Final Review Agent
      /
     /
Performance Agent
     ↓
Performance Result
```

The aggregator should preserve the source Agent.

Example:

```ts
interface ParallelAgentResult {
  agentId: string;
  agentName: string;
  status: string;
  result: unknown;
}
```

The final Agent can receive:

```text
Results from Security Agent:
...

Results from Performance Agent:
...
```

---

# 24. Workflow Execution History

Agent Workflow executions should have their own history.

Example:

```text
Agent Workflow History

▼ Run #12
  Workflow: Code Quality Workflow
  Status: Completed
  Duration: 4m 21s
  Agents: 5
  ├── Code Analysis       ✓ 2 iterations
  ├── Security Review     ✓ 3 iterations
  ├── Performance Review  ✓ 2 iterations
  ├── Dependency Review   ✓ 1 iteration
  └── Final Review        ✓ 2 iterations

▶ Run #11
  Workflow: Code Quality Workflow
  Status: Failed
```

Clicking a workflow run should allow the user to inspect each Agent execution.

---

# 25. Nested Agent Depth

Prevent accidental infinite Agent recursion.

For example:

```text
Agent A
  ↓
Agent B
  ↓
Agent C
  ↓
Agent A
```

The system should detect circular dependencies.

Show an error such as:

```text
Circular Agent dependency detected.

Agent A → Agent B → Agent C → Agent A

Please remove the circular dependency before saving this workflow.
```

Also provide a configurable maximum workflow depth/execution limit.

---

# 26. Agent Workflow Status

The workflow should support clear execution states:

```text
pending
running
waiting
completed
failed
cancelled
```

For parallel execution:

```text
Workflow: Running

Code Analysis       ✓ Completed
Security Review     ● Running
Performance Review  ● Running
Dependency Review   ✓ Completed
Final Review        ○ Waiting
```

The UI should update these states in real time.

---

# 27. Workflow Configuration

Each workflow should store:

```ts
interface AgentWorkflow {
  id: string;
  name: string;
  description?: string;

  executionMode: "sequential" | "parallel" | "mixed";

  agents: WorkflowAgentNode[];
  connections: WorkflowConnection[];

  maxDepth?: number;
  maxIterations?: number;

  createdAt: string;
  updatedAt: string;
}

interface WorkflowAgentNode {
  id: string;
  agentId: string;
  name: string;
  position?: {
    x: number;
    y: number;
  };
}

interface WorkflowConnection {
  from: string;
  to: string;

  mode: "sequential" | "parallel";

  inputMapping?: {
    sourceOutput: string;
    targetInput: string;
  };
}
```

---

# 28. Workflow Safety Rules

The workflow engine must:

* Detect circular Agent dependencies.
* Prevent infinite execution.
* Respect Agent maximum iterations.
* Respect workflow maximum iterations/depth.
* Stop dependent Agents when a required upstream Agent fails.
* Allow independent parallel Agents to continue when appropriate.
* Allow users to cancel the entire workflow.
* Propagate cancellation to running child Agents.
* Preserve each Agent's individual execution history.
* Preserve the complete workflow execution history.

---

# 29. Chat Integration

Users should also be able to run a workflow from Chat.

Example:

```text
/workflow code-quality-review
```

Optional folder:

```text
/workflow code-quality-review
📁 /Users/developer/projects/my-app
```

The Chat UI should show safe execution progress:

```text
🤔 Planning workflow...

✓ Code Analysis Agent completed

Running parallel agents...

● Security Review Agent
● Performance Review Agent
✓ Dependency Review Agent

Waiting for parallel agents...

✓ Security Review Agent completed
✓ Performance Review Agent completed

Running Final Review Agent...

✓ Workflow completed
```

Do not display private chain-of-thought or hidden model reasoning. Only show user-facing execution status and meaningful steps.

---

# 30. Acceptance Criteria — Nested Agents

Add these acceptance criteria:

* [ ] Users can create Agent workflows.
* [ ] One Agent's output can become another Agent's input.
* [ ] Sequential Agent execution is supported.
* [ ] Parallel Agent execution is supported.
* [ ] Mixed sequential + parallel workflows are supported.
* [ ] Parallel Agent outputs can be aggregated.
* [ ] Workflow execution has its own history.
* [ ] Individual Agent runs remain visible inside workflow history.
* [ ] Agent iteration counts are displayed.
* [ ] Workflow status updates in real time.
* [ ] Users can cancel a running workflow.
* [ ] Circular Agent dependencies are detected.
* [ ] Infinite Agent execution is prevented.
* [ ] Maximum workflow depth/iterations can be configured.
* [ ] Failed Agents are clearly identified.
* [ ] Dependent Agents do not execute when required upstream Agents fail.
* [ ] Independent parallel Agents can continue when appropriate.
* [ ] `/workflow <workflow-name>` can execute a saved workflow from Chat.
* [ ] Folder selection remains optional.
* [ ] Workflow execution respects the selected folder context.
* [ ] Private chain-of-thought is never exposed.

