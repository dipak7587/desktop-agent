# Declarative workflows

Open **Workflows → New workflow** to build the workflows described in
`DYNAMIC_GOVERNANCE_AGENT_WORKFLOW.md`. The **Default** tab is selected for new workflows and contains the agent graph builder.
The other four tabs—**Form**, **Markdown**, **JSON**, and **YAML**—are grouped under a bordered **Dynamic** label.
Saved workflows are grouped under **Default** and **Dynamic** border labels. Both kinds use the same persistence, run history, cancellation,
and chat workflow command.

## Authoring formats

- **Form** provides recursive step, branch, loop, hook, and retry controls. Structured
  input, switch cases, input definitions, aliases, and configuration use JSON fields.
- **JSON** and **YAML** represent the same validated definition.
- **Markdown** contains exactly one fenced `yaml`, `yml`, or `json` block, or YAML
  front matter. Prose outside the definition is documentation and is not executed or
  retained when converting formats.

Import `.md`, `.json`, `.yaml`, or `.yml` files; export Markdown, JSON, or YAML.
Incomplete source does not block tab switching. Unreadable drafts are preserved in their source tab while other tabs show the last readable values. Save and export still require a valid workflow. Formats preserve workflow limits.
Saved definitions remain JSON files with application IDs and timestamps. Dynamic
configuration is stored in the `definition` field; exported dynamic documents contain
that configuration directly. Importing preserves the current editor's application ID.

An executable, configurable governance example is available in
[`examples/governance-review`](../examples/governance-review/README.md) in all three
file formats. Agent and tool names in the design document are placeholders: set their
aliases to real saved agent/tool IDs before running.

## Runtime

Supported step types are `agent`, `tool`, `sequence`, `parallel`, `loop`, `condition`,
`switch`, and `repeat`. Every step can declare `id`, `input`, `retry`, and `hooks` where
applicable. Unknown properties and unsupported types are rejected. IDs must be unique
within a sibling list. Omitted IDs receive position-based runtime paths.

Sequential steps see earlier results as `steps.ID.output`. A sequence returns its
ordered outputs; parallel execution waits for all active branches and returns outputs
in definition order. A loop returns one ordered child-output array per item. Parallel
branches and loop iterations get isolated step/hook maps; nested loops inherit their
parent's variables and hook outputs. Parallel sibling branches cannot consume each
other's outputs while running. After the join, named branch results are available to
following steps. Loop-local results are accessed through the loop's aggregate output.

`loop.over` must resolve to an array. Its default mode is sequential; parallel mode
uses `maxConcurrency` (default 4, maximum 32). `repeat` executes its whole body, then
checks `until`. It requires `maxIterations` and fails if that bound is reached without
success. Put a condition around a fixer if it must be skipped when tests already pass.
`switch` selects `cases[value]`, falling back to `cases.default`. An unmatched switch
without a default returns an empty array. Condition/until values must be booleans.

`maxDepth` defaults to 20 and `maxIterations` to 100 at the application level. The
latter is a shared execution budget, counting container steps, hooks, and retry
attempts. Cancellation aborts agent/tool work and retry waits, and starts no further
steps. A failed parallel group waits for already-started work to settle; queued work
is not started. This avoids side effects continuing after a workflow is marked failed.

## Values and inputs

Whole references preserve their JSON type: `{{input.files}}` can produce an array.
References embedded in text produce strings. Nested objects and arrays resolve
recursively. Available roots are `input`, `steps`, `hooks`, `workflow`, `agents`,
`tools`, and `env`, plus loop variables. `workflow.config.defaultAgent` is useful
for tool permissions; `env.NAME` reads the main process environment. Undefined paths
fail explicitly. Inputs declared without a default are required unless `required`
is false. Supported input types are string, number, boolean, array, and object.
The run form accepts strings directly and other values as JSON; chat supplies `task`
plus declared defaults.

Expressions support safe dotted paths, strings, numbers, booleans, null, parentheses,
`!`, `&&`, `||`, strict equality (`==`/`===`, `!=`/`!==`), and numeric ordering.
Both logical operands are evaluated. JavaScript calls, assignments, arbitrary code,
and prototype traversal are not supported. Properties defining execution structure
(type, IDs, retry/concurrency limits, branches) are static; values, selectors, loop
sources, and conditions may be dynamic.

## Hooks and retry

Root hooks: `preWorkflow`/`before`, `postWorkflow`/`after`, `success`/`onSuccess`, and
`error`/`onError`. Step hooks: `before`/`pre`/`preStep`, `after`/`post`/`postStep`,
`success`/`onSuccess`, and `error`/`onError`. Loops additionally support `beforeLoop`,
`afterLoop`, `beforeIteration`, and `afterIteration`. If multiple aliases are supplied,
they all run in that order. Hook outputs use `hooks.ID.output`; hooks can use the same
step primitives. Error hooks receive `error.message`, and run on failure, not cancellation.
After hooks can read the completed step's output. An after-hook failure fails the step.

Retry runs the step body again, up to `maxAttempts` (1–10), with cancellable `delayMs`
(0–60,000). Before hooks run once; after/success hooks run after the successful body.
Use retry carefully with writes: effects are not rolled back. Optional `on` filters
match `timeout`, `tool_error`, or `invalid_output`; adapter errors can supply a `code`,
and other tool-step errors are classified as `tool_error`. Without `on`, all body
failures are retried within the global budget.

## Agent and tool execution

Agent nodes invoke saved agents with their own models, capabilities, and limits. JSON
agent replies become structured output; other replies remain text. Agent tasks include
the run task and resolved step input. All executed nodes, including hooks and loop
iterations, have distinct paths in workflow history and link to child run history.

Tool nodes require an `agent` or `config.defaultAgent` to supply permissions. They
execute an explicitly selected capability without asking a model to select it again.
The capability router still applies selection, enablement, user restrictions, project
access, and permission checks. Calls use the existing tool wrappers, validation,
approvals, redaction, and history. An unavailable or rejected tool fails the step.
Tool nodes do not grant capabilities absent from the selected permission agent.

Dedicated `approval` nodes, subworkflows, fallback blocks, and per-step timeouts remain
future extensions. Existing tool approvals are fully active.
