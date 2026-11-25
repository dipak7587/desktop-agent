# Workflows

A workflow runs several agents or tools as one process and passes each step's output to the next. Use it when one assistant is not enough, for example analyze code, then review it, then write documentation.

There are two kinds, both found under **Workflows → New workflow**. They share saving, run history, cancellation and the chat workflow command.

| Kind        | Best for                                      | Editor                          |
| ----------- | --------------------------------------------- | ------------------------------- |
| **Default** | A graph of agents with simple dependencies    | Visual agent graph builder      |
| **Dynamic** | Loops, conditions, retries, hooks, tool steps | Form, Markdown, JSON, YAML tabs |

## How a run works

```text
Agent A ──output──▶ Agent B ──output──▶ Agent C
```

1. Each node runs its saved agent with **that agent's own** model, capabilities and limits.
2. A node starts when everything it depends on has finished. Independent nodes run in parallel.
3. A node receives the run task plus the mapped outputs of its upstream nodes.
4. The last node's result is returned to Chat, and every node is recorded in run history.

```text
            ┌──▶ Reviewer ──┐
Analyst ────┤               ├──▶ Writer
            └──▶ Security ──┘
```

## Typical patterns

| Pattern    | Shape                             | Example                                   |
| ---------- | --------------------------------- | ----------------------------------------- |
| Sequential | A → B → C                         | Analysis → review → documentation         |
| Parallel   | A → (B, C) → D                    | Two reviewers feed one summarizer         |
| Mixed      | Any combination of the two        | Research in parallel, then draft, then QA |
| Dynamic    | Loops, conditions, retries, hooks | Run tests, fix, repeat until they pass    |

## Limits and safety

- **Maximum iterations** is a shared execution budget (default 100, maximum 100 per workflow). Container steps, hooks and retry attempts count toward it.
- A workflow cannot nest deeper than `maxDepth` (default 20) or contain a cycle.
- **Cancel** stops running agents and tools and starts no new steps.
- If one parallel branch fails, already-started branches finish; queued ones never start.
- Each agent still obeys its own approval rules. A workflow cannot grant capabilities its agents lack.
- Retries do **not** roll back side effects. Be careful retrying steps that write files.

## Long tasks in Code

Single Code runs have their own iteration limit (**Settings → Maximum iterations**, default 15). When a run reaches it, the same session now continues automatically with a fresh budget, up to 20 times, instead of stopping. For very large jobs, raise **Context size** and ask the agent to keep a `docs/PROGRESS.md` checklist so it can resume cleanly.

## Where to go next

- [Declarative workflows](DECLARATIVE_WORKFLOWS.md): exact syntax, step types, expressions, hooks, retry.
- [Execution flows](EXECUTION_FLOWS.md): diagrams of scheduling, output mapping, failure and cancellation (sections 12–14, 19).
- [Examples](../examples/README.md): ready-to-import workflows such as `order-support` and `governance-review`.
- [Original requirements](specs/WORKFLOW_SPEC.md): the design input this feature grew from.

Source: [src/main/services/workflows/](../src/main/services/workflows) · [src/shared/workflows.ts](../src/shared/workflows.ts)
