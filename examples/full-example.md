# Generic Dynamic Agent Workflow Engine — Complete Reference Example

> **Purpose:** A single reference document for designing and implementing a generic, declarative workflow engine that can orchestrate agents and tools without embedding use-case-specific logic in the engine.

---

# 1. Goals

The workflow engine must support:

- Agent execution
- Tool execution
- Sequential execution
- Parallel execution
- `foreach`-style loops
- Nested loops
- Repeat-until loops
- Conditions
- Switch/case routing
- Retry
- Timeout
- Hooks
- Dynamic input/output references
- Dynamic agent selection
- Dynamic tool selection
- Fan-out / fan-in
- Human approval
- Fallback execution
- Subworkflows
- Structured outputs
- Execution tracing

The core engine must stay generic.

It must **not** contain special logic such as:

```text
if workflow == "pr-review":
    ...
```

Instead, PR review, code review, testing, document processing, research, migrations, security audits, and other use cases are expressed through workflow configuration.

---

# 2. Core Design Principle

```text
Workflow controls WHAT / WHEN / WHICH / ORDER.

Agent controls HOW.
```

## Workflow controls

The workflow decides:

```text
WHAT runs
WHEN it runs
WHICH agent runs
WHICH tool runs
WHAT order is used
PARALLEL or SEQUENTIAL
HOW MANY times something runs
WHAT data is passed
WHEN execution stops
```

## Agent controls

The agent decides:

```text
HOW to perform the assigned task
HOW to reason about supplied context
WHICH allowed tools to use
WHAT result to return
```

---

# 3. Recommended Node Types

```yaml
type:
  - agent
  - tool
  - sequence
  - parallel
  - loop
  - repeat
  - condition
  - switch
  - approval
  - subworkflow
```

For the first implementation, prioritize:

```text
agent
tool
sequence
parallel
loop
condition
hooks
retry
```

Add later:

```text
repeat
switch
approval
timeout
fallback
subworkflow
```

---

# 4. Top-Level Workflow Shape

```yaml
version: "1.0"

name: example-workflow
description: Generic workflow example

inputs: {}

config: {}

hooks: {}

steps: []

outputs: {}
```

Full example:

```yaml
version: "1.0"

name: governance-review

description: >
  Review changed files against relevant governance rules without
  loading the complete codebase and complete knowledge base into one LLM call.

inputs:
  target:
    type: string
    required: true

  governanceFolder:
    type: string
    required: false
    default: "./governance"

  reviewAgent:
    type: string
    required: false
    default: "code-reviewer"

config:
  defaultAgent: "code-reviewer"
  defaultTimeoutMs: 120000
  defaultMaxConcurrency: 4

hooks: {}

steps: []

outputs:
  report: "{{steps.final_report.output}}"
```

---

# 5. Dynamic Value Resolution

All workflow properties should support dynamic references.

Examples:

```yaml
{{input.target}}

{{input.governanceFolder}}

{{config.defaultAgent}}

{{steps.get_changes.output}}

{{steps.get_changes.output.files}}

{{steps.get_rules.output}}

{{variables.changedFile}}

{{variables.rule}}

{{env.GITLAB_URL}}

{{secrets.GITLAB_TOKEN}}

{{hooks.load_file.output}}
```

Recommended namespaces:

```text
input
config
steps
variables
hooks
env
secrets
workflow
metadata
```

---

# 6. Runtime Context

Recommended runtime context:

```ts
type RuntimeContext = {
  workflow: {
    id: string;
    name: string;
    runId: string;
  };

  input: Record<string, unknown>;

  config: Record<string, unknown>;

  steps: Record<
    string,
    {
      status: "pending" | "running" | "success" | "failed" | "skipped";
      input?: unknown;
      output?: unknown;
      error?: unknown;
      startedAt?: string;
      completedAt?: string;
    }
  >;

  variables: Record<string, unknown>;

  hooks: Record<
    string,
    {
      output?: unknown;
    }
  >;

  metadata: Record<string, unknown>;

  env: Record<string, string | undefined>;

  secrets: Record<string, string | undefined>;
};
```

Example at runtime:

```ts
{
  workflow: {
    id: "governance-review",
    name: "governance-review",
    runId: "run_123"
  },

  input: {
    target: "https://gitlab.example.com/team/project/-/merge_requests/42",
    governanceFolder: "./governance"
  },

  config: {
    defaultAgent: "code-reviewer",
    defaultMaxConcurrency: 4
  },

  steps: {
    get_changes: {
      status: "success",
      output: {
        files: [
          {
            path: "src/user-service.ts",
            changeType: "modified"
          }
        ]
      }
    }
  },

  variables: {
    changedFile: {
      path: "src/user-service.ts"
    }
  },

  hooks: {},

  metadata: {},

  env: {},

  secrets: {}
}
```

Nested loops create child contexts.

A child context:

- inherits parent values
- adds loop variables
- may add local step results
- must not accidentally overwrite unrelated parent values

---

# 7. Expression Resolution Rules

Recommended expression behavior:

```yaml
path: "{{input.target}}"

files: "{{steps.get_changes.output.files}}"

message: "Review {{changedFile.path}}"

agent: "{{input.reviewAgent}}"
```

Recommended rules:

1. If the entire value is one expression, preserve the original type.
2. If the expression is embedded inside text, convert it to string.
3. Missing required references should fail validation or execution.
4. Optional references may support a default.

Example:

```yaml
agent: "{{input.reviewAgent ?? config.defaultAgent}}"
```

Possible future helpers:

```yaml
{{length(steps.get_changes.output.files)}}

{{exists(steps.review.output)}}

{{variables.file.path}}

{{coalesce(input.agent, config.defaultAgent)}}
```

Avoid allowing arbitrary JavaScript evaluation.

---

# 8. Agent Registry

Agents should be registered separately from workflows.

Example:

```yaml
agents:

  change-detector:
    type: agent
    description: Detect changed files from a target.
    model: "ollama:gemma3:27b"
    systemPrompt: |
      Analyze the supplied repository or merge-request information.
      Return only changed-file metadata required by the workflow.

  rule-selector:
    type: agent
    description: Select governance rules relevant to one changed file.
    model: "ollama:gemma3:27b"
    systemPrompt: |
      Given one changed file and the available governance rule metadata,
      select only rules relevant to that file.

  code-reviewer:
    type: agent
    description: Review one file against one governance rule.
    model: "ollama:gemma3:27b"
    systemPrompt: |
      Review only the supplied file against only the supplied governance rule.
      Do not infer unrelated repository context.

  security-reviewer:
    type: agent
    description: Security-focused reviewer.
    model: "ollama:gemma3:27b"

  reporter:
    type: agent
    description: Aggregate structured review findings into a final report.
    model: "ollama:gemma3:27b"
```

Workflow reference:

```yaml
agent: "{{agents.code-reviewer}}"
```

or:

```yaml
agent: "{{input.reviewAgent}}"
```

The engine resolves the name through the agent registry.

---

# 9. Tool Registry

Tools are also registered separately.

Example:

```yaml
tools:

  gitlab_get_changes:
    description: Fetch merge-request changes from GitLab.
    inputSchema:
      type: object
      properties:
        target:
          type: string
      required:
        - target

  local_git_diff:
    description: Read changed files from the current local Git repository.

  list_governance_files:
    description: Return governance document metadata.

  read_file:
    description: Read one source file.

  read_governance_file:
    description: Read one governance document.

  validate_target:
    description: Validate the workflow target.

  save_report:
    description: Persist a generated report.

  log_error:
    description: Persist structured workflow errors.

  run_tests:
    description: Run project tests.
```

Dynamic tool selection:

```yaml
tool: "{{input.changeProvider}}"
```

Possible values:

```text
gitlab_get_changes
github_get_changes
bitbucket_get_changes
local_git_diff
```

---

# 10. Tool Node

```yaml
- id: get_changes
  type: tool

  tool: "{{input.changeProvider}}"

  input:
    target: "{{input.target}}"

  retry:
    maxAttempts: 3
    delayMs: 1000
    on:
      - timeout
      - tool_error

  timeoutMs: 30000
```

Expected tool output:

```json
{
  "files": [
    {
      "path": "src/user-service.ts",
      "status": "modified"
    }
  ]
}
```

Stored in:

```text
steps.get_changes.output
```

---

# 11. Agent Node

```yaml
- id: analyze_changes
  type: agent

  agent: "{{agents.change-detector}}"

  input:
    changes: "{{steps.get_changes.output}}"

  outputSchema:
    type: object
    properties:
      files:
        type: array
    required:
      - files
```

Result:

```text
steps.analyze_changes.output
```

---

# 12. Sequential Execution

```yaml
- id: fetch_mr
  type: tool
  tool: "{{tools.gitlab_get_changes}}"
  input:
    target: "{{input.target}}"

- id: analyze_changes
  type: agent
  agent: "{{agents.change-detector}}"
  input:
    diff: "{{steps.fetch_mr.output}}"

- id: review
  type: agent
  agent: "{{agents.code-reviewer}}"
  input:
    changes: "{{steps.analyze_changes.output}}"

- id: report
  type: agent
  agent: "{{agents.reporter}}"
  input:
    review: "{{steps.review.output}}"
```

Execution:

```text
fetch_mr
   ↓
analyze_changes
   ↓
review
   ↓
report
```

---

# 13. Explicit Sequence Node

A sequence can also be represented as a container:

```yaml
- id: analysis_sequence
  type: sequence

  steps:

    - id: inspect
      type: agent
      agent: "{{agents.change-detector}}"

    - id: review
      type: agent
      agent: "{{agents.code-reviewer}}"
      input:
        data: "{{steps.inspect.output}}"
```

Use this when sequences are nested inside conditions, hooks, loops, or parallel branches.

---

# 14. Parallel Execution

```yaml
- id: reviews
  type: parallel

  maxConcurrency: 3

  steps:

    - id: security_review
      type: agent
      agent: "{{agents.security-reviewer}}"
      input:
        changes: "{{steps.get_changes.output}}"

    - id: architecture_review
      type: agent
      agent: "{{agents.architecture-reviewer}}"
      input:
        changes: "{{steps.get_changes.output}}"

    - id: test_review
      type: agent
      agent: "{{agents.test-reviewer}}"
      input:
        changes: "{{steps.get_changes.output}}"
```

Output:

```json
{
  "security_review": {},
  "architecture_review": {},
  "test_review": {}
}
```

Then fan in:

```yaml
- id: aggregate
  type: agent

  agent: "{{agents.reporter}}"

  input:
    reviews: "{{steps.reviews.output}}"
```

---

# 15. Simple Loop

```yaml
- id: review_files
  type: loop

  over: "{{steps.get_changes.output.files}}"

  as: file

  mode: sequential

  steps:

    - id: review_file
      type: agent

      agent: "{{agents.code-reviewer}}"

      input:
        file: "{{file}}"
```

Execution:

```text
file-a.ts → review_file
file-b.ts → review_file
file-c.ts → review_file
```

---

# 16. Parallel Loop

```yaml
- id: review_files
  type: loop

  over: "{{steps.get_changes.output.files}}"

  as: file

  mode: parallel

  maxConcurrency: 4

  steps:

    - id: review
      type: agent

      agent: "{{agents.code-reviewer}}"

      input:
        file: "{{file}}"
```

Important:

```text
maxConcurrency prevents unbounded model/tool execution.
```

---

# 17. Nested Loop

```yaml
- id: review_files
  type: loop

  over: "{{steps.get_changes.output.files}}"

  as: changedFile

  steps:

    - id: review_rules
      type: loop

      over: "{{steps.get_rules.output}}"

      as: rule

      steps:

        - id: review
          type: agent

          agent: "{{agents.code-reviewer}}"

          input:
            file: "{{changedFile}}"
            governance: "{{rule}}"
```

Execution:

```text
file-a.ts
  ├── security.md
  ├── architecture.md
  └── coding.md

file-b.ts
  ├── security.md
  ├── architecture.md
  └── coding.md
```

---

# 18. Relevant Knowledge Selection

Do not automatically review every file against every knowledge-base document.

Instead:

```text
Changed File
   ↓
Rule Selector
   ↓
Relevant Rules Only
   ↓
Review
```

Example:

```yaml
- id: select_rules
  type: agent

  agent: "{{agents.rule-selector}}"

  input:
    file: "{{changedFile}}"
    availableRules: "{{steps.get_rules.output}}"
```

Expected output:

```json
{
  "relevantRules": [
    {
      "path": "./governance/security.md"
    },
    {
      "path": "./governance/typescript.md"
    }
  ]
}
```

Then:

```yaml
- id: review_rules
  type: loop

  over: "{{steps.select_rules.output.relevantRules}}"

  as: rule
```

This is important for:

- context-window control
- lower token usage
- local model performance
- better relevance
- predictable review scope

---

# 19. Condition

```yaml
- id: review_path
  type: condition

  if: "{{steps.analyze_risk.output.securitySensitive == true}}"

  then:

    - id: security_review
      type: agent
      agent: "{{agents.security-reviewer}}"

  else:

    - id: normal_review
      type: agent
      agent: "{{agents.code-reviewer}}"
```

---

# 20. Switch

```yaml
- id: review_by_type
  type: switch

  value: "{{file.extension}}"

  cases:

    ".ts":
      - id: typescript_review
        type: agent
        agent: "{{agents.typescript-reviewer}}"

    ".sql":
      - id: sql_review
        type: agent
        agent: "{{agents.database-reviewer}}"

    ".tf":
      - id: terraform_review
        type: agent
        agent: "{{agents.infrastructure-reviewer}}"

  default:

    - id: general_review
      type: agent
      agent: "{{agents.general-reviewer}}"
```

---

# 21. Repeat Until

```yaml
- id: fix_tests
  type: repeat

  until: "{{steps.run_tests.output.passed == true}}"

  maxIterations: 5

  steps:

    - id: run_tests
      type: tool
      tool: "{{tools.run_tests}}"

    - id: fix_code
      type: agent
      agent: "{{agents.code-fixer}}"

      when: "{{steps.run_tests.output.passed == false}}"

      input:
        errors: "{{steps.run_tests.output.errors}}"
```

Safety rule:

```text
repeat MUST have maxIterations or another hard stop.
```

---

# 22. Retry

```yaml
retry:
  maxAttempts: 3
  delayMs: 2000
```

Advanced:

```yaml
retry:
  maxAttempts: 3

  backoff:
    type: exponential
    initialDelayMs: 1000
    maxDelayMs: 10000

  on:
    - timeout
    - tool_error
    - model_error
    - invalid_output
```

---

# 23. Timeout

```yaml
- id: review
  type: agent

  agent: "{{agents.code-reviewer}}"

  timeoutMs: 120000
```

---

# 24. Fallback

```yaml
- id: review
  type: agent

  agent: "{{agents.primary-reviewer}}"

  fallback:

    - type: agent
      agent: "{{agents.local-reviewer}}"

    - type: agent
      agent: "{{agents.backup-reviewer}}"
```

---

# 25. Approval Node

```yaml
- id: approve_changes
  type: approval

  message: "Apply the proposed code changes?"

  input:
    changes: "{{steps.generate_fix.output}}"

  decisions:
    - approve
    - reject
    - edit
```

Then:

```yaml
- id: write_changes
  type: tool

  when: "{{steps.approve_changes.output.approved == true}}"

  tool: "{{tools.write_changes}}"
```

---

# 26. Workflow-Level Hooks

```yaml
hooks:

  preWorkflow:

    - id: validate_target
      type: tool
      tool: "{{tools.validate_target}}"

  postWorkflow:

    - id: save_report
      type: tool
      tool: "{{tools.save_report}}"

  onError:

    - id: log_workflow_error
      type: tool
      tool: "{{tools.log_error}}"
```

---

# 27. Step-Level Hooks

```yaml
- id: review
  type: agent

  agent: "{{agents.code-reviewer}}"

  hooks:

    before:

      - id: load_context
        type: tool
        tool: "{{tools.load_context}}"

    after:

      - id: validate_output
        type: tool
        tool: "{{tools.validate_review_output}}"

    success:

      - id: save_result
        type: tool
        tool: "{{tools.save_review}}"

    error:

      - id: log_error
        type: tool
        tool: "{{tools.log_error}}"
```

---

# 28. Loop Hooks

```yaml
- id: review_files
  type: loop

  over: "{{steps.get_changes.output.files}}"

  as: changedFile

  hooks:

    beforeLoop:

      - id: prepare_review
        type: tool
        tool: "{{tools.prepare_review}}"

    beforeIteration:

      - id: load_file
        type: tool
        tool: "{{tools.read_file}}"

        input:
          path: "{{changedFile.path}}"

    afterIteration:

      - id: save_partial_result
        type: tool
        tool: "{{tools.save_partial_result}}"

    afterLoop:

      - id: aggregate
        type: agent
        agent: "{{agents.result-aggregator}}"

  steps:

    - id: review
      type: agent
      agent: "{{agents.code-reviewer}}"

      input:
        file: "{{hooks.load_file.output}}"
```

---

# 29. Hook Rules

Hooks must use the same primitives as normal workflow steps.

Allowed:

```text
agent
tool
sequence
parallel
condition
```

Avoid arbitrary JavaScript inside workflow YAML.

Why:

- difficult to debug
- harder to secure
- impossible for UI builders to understand reliably
- hidden workflow logic
- unpredictable behavior
- implementation becomes application-specific

Keep workflows declarative.

---

# 30. Fan-Out / Fan-In

```yaml
- id: specialist_reviews
  type: parallel

  steps:

    - id: security
      type: agent
      agent: "{{agents.security-reviewer}}"

    - id: architecture
      type: agent
      agent: "{{agents.architecture-reviewer}}"

    - id: quality
      type: agent
      agent: "{{agents.code-quality-reviewer}}"

- id: aggregate
  type: agent

  agent: "{{agents.review-aggregator}}"

  input:
    reviews: "{{steps.specialist_reviews.output}}"
```

---

# 31. Subworkflow

```yaml
- id: security_scan
  type: subworkflow

  workflow: "security-review"

  input:
    target: "{{input.target}}"
```

Recommended behavior:

- separate child run ID
- inherited correlation ID
- isolated local step namespace
- explicit inputs
- explicit outputs

---

# 32. `when` Guard

```yaml
- id: security_review
  type: agent

  when: "{{steps.classify.output.securityRelevant == true}}"

  agent: "{{agents.security-reviewer}}"
```

Difference:

```text
when      → skip or execute one step
condition → execute one branch or another
```

---

# 33. Continue-on-Error

```yaml
- id: optional_metrics
  type: tool

  tool: "{{tools.store_metrics}}"

  continueOnError: true
```

Use carefully.

---

# 34. Structured Output Validation

```yaml
outputSchema:
  type: object

  properties:

    findings:
      type: array

      items:
        type: object

        properties:
          severity:
            type: string
            enum:
              - critical
              - high
              - medium
              - low
              - info

          message:
            type: string

          file:
            type: string

          line:
            type: integer

        required:
          - severity
          - message

  required:
    - findings
```

Invalid output may trigger:

```text
invalid_output
```

---

# 35. Execution Status Model

Recommended statuses:

```text
pending
queued
running
success
failed
skipped
cancelled
waiting_approval
retrying
```

---

# 36. Execution Event Model

Recommended event types:

```text
workflow.started
workflow.completed
workflow.failed

step.started
step.completed
step.failed
step.skipped
step.retrying

hook.started
hook.completed
hook.failed

loop.started
loop.iteration.started
loop.iteration.completed
loop.completed

approval.requested
approval.resolved

agent.started
agent.completed

tool.started
tool.completed
```

This enables:

- UI timeline
- debugging
- logs
- metrics
- tracing
- auditability

---

# 37. Error Model

```ts
type WorkflowError = {
  code:
    | "CONFIG_ERROR"
    | "VALIDATION_ERROR"
    | "EXPRESSION_ERROR"
    | "AGENT_ERROR"
    | "TOOL_ERROR"
    | "TIMEOUT"
    | "INVALID_OUTPUT"
    | "APPROVAL_REJECTED"
    | "MAX_ITERATIONS"
    | "CANCELLED";

  message: string;

  stepId?: string;

  hookId?: string;

  iteration?: number;

  cause?: unknown;

  retryable: boolean;
};
```

---

# 38. Complete End-to-End Workflow

```yaml
version: "1.0"

name: governance-review

description: >
  Generic governance review workflow.
  The engine contains no PR-review-specific implementation.

inputs:

  target:
    type: string
    required: true

  changeProvider:
    type: string
    default: "gitlab_get_changes"

  governanceFolder:
    type: string
    default: "./governance"

  reviewAgent:
    type: string
    default: "code-reviewer"

  enableSecurityReview:
    type: boolean
    default: true

config:

  defaultAgent: "code-reviewer"

  defaultTimeoutMs: 120000

  defaultMaxConcurrency: 4

hooks:

  preWorkflow:

    - id: validate_target
      type: tool

      tool: "{{tools.validate_target}}"

      input:
        target: "{{input.target}}"

  postWorkflow:

    - id: persist_report
      type: tool

      tool: "{{tools.save_report}}"

      input:
        target: "{{input.target}}"
        report: "{{steps.final_report.output}}"

  onError:

    - id: log_workflow_error
      type: tool

      tool: "{{tools.log_error}}"

      input:
        workflow: "{{workflow.name}}"
        target: "{{input.target}}"

steps:

  - id: get_changes
    type: tool

    tool: "{{input.changeProvider}}"

    input:
      target: "{{input.target}}"

    retry:
      maxAttempts: 3
      delayMs: 1000
      on:
        - timeout
        - tool_error

    timeoutMs: 30000

    outputSchema:
      type: object
      properties:
        files:
          type: array
      required:
        - files

  - id: get_rules
    type: tool

    tool: "{{tools.list_governance_files}}"

    input:
      folder: "{{input.governanceFolder}}"

  - id: classify_change
    type: agent

    agent: "{{agents.change-classifier}}"

    input:
      files: "{{steps.get_changes.output.files}}"

    outputSchema:
      type: object
      properties:
        securitySensitive:
          type: boolean
        summary:
          type: string
      required:
        - securitySensitive

  - id: specialist_reviews
    type: condition

    if: "{{input.enableSecurityReview == true}}"

    then:

      - id: specialists
        type: parallel

        maxConcurrency: 2

        steps:

          - id: security
            type: agent

            when: "{{steps.classify_change.output.securitySensitive == true}}"

            agent: "{{agents.security-reviewer}}"

            input:
              target: "{{input.target}}"
              changedFiles: "{{steps.get_changes.output.files}}"

          - id: architecture
            type: agent

            agent: "{{agents.architecture-reviewer}}"

            input:
              changedFiles: "{{steps.get_changes.output.files}}"

    else:

      - id: no_specialist_review
        type: tool

        tool: "{{tools.noop}}"

  - id: review_files
    type: loop

    over: "{{steps.get_changes.output.files}}"

    as: changedFile

    mode: sequential

    hooks:

      beforeLoop:

        - id: prepare_review
          type: tool

          tool: "{{tools.prepare_review}}"

          input:
            target: "{{input.target}}"

      beforeIteration:

        - id: load_file
          type: tool

          tool: "{{tools.read_file}}"

          input:
            path: "{{changedFile.path}}"

      afterIteration:

        - id: persist_file_review
          type: tool

          tool: "{{tools.save_partial_result}}"

      afterLoop:

        - id: file_review_summary
          type: agent

          agent: "{{agents.result-aggregator}}"

    steps:

      - id: select_rules
        type: agent

        agent: "{{agents.rule-selector}}"

        input:
          file:
            metadata: "{{changedFile}}"
            content: "{{hooks.load_file.output}}"

          availableRules: "{{steps.get_rules.output}}"

        outputSchema:
          type: object

          properties:
            relevantRules:
              type: array

          required:
            - relevantRules

      - id: review_rules
        type: loop

        over: "{{steps.select_rules.output.relevantRules}}"

        as: rule

        mode: sequential

        hooks:

          beforeIteration:

            - id: load_rule
              type: tool

              tool: "{{tools.read_governance_file}}"

              input:
                path: "{{rule.path}}"

        steps:

          - id: review
            type: agent

            agent: "{{input.reviewAgent}}"

            retry:
              maxAttempts: 2
              delayMs: 1000
              on:
                - timeout
                - model_error
                - invalid_output

            timeoutMs: 120000

            input:

              target: "{{input.target}}"

              file:
                metadata: "{{changedFile}}"
                content: "{{hooks.load_file.output}}"

              governance:
                metadata: "{{rule}}"
                content: "{{hooks.load_rule.output}}"

            outputSchema:

              type: object

              properties:

                findings:
                  type: array

                  items:
                    type: object

                    properties:

                      severity:
                        type: string
                        enum:
                          - critical
                          - high
                          - medium
                          - low
                          - info

                      message:
                        type: string

                      file:
                        type: string

                      line:
                        type: integer

                    required:
                      - severity
                      - message

              required:
                - findings

  - id: final_report
    type: agent

    agent: "{{agents.reporter}}"

    input:

      target: "{{input.target}}"

      changeSummary: "{{steps.classify_change.output}}"

      specialistReviews: "{{steps.specialist_reviews.output}}"

      fileReviews: "{{steps.review_files.output}}"

    outputSchema:

      type: object

      properties:

        summary:
          type: string

        findings:
          type: array

        recommendation:
          type: string

      required:
        - summary
        - findings

outputs:

  report: "{{steps.final_report.output}}"
```

---

# 39. Execution of the Complete Workflow

```text
preWorkflow
   │
   └── validate_target
         ↓

get_changes
   ↓
get_rules
   ↓
classify_change
   ↓

specialist_reviews
   ├── security
   └── architecture
         ↓

review_files
   │
   ├── beforeLoop
   │
   ├── File A
   │    ├── beforeIteration → load File A
   │    ├── select_rules
   │    ├── review_rules
   │    │    ├── Rule 1 → load → review
   │    │    ├── Rule 2 → load → review
   │    │    └── Rule 3 → load → review
   │    └── afterIteration
   │
   ├── File B
   │    ├── beforeIteration → load File B
   │    ├── select_rules
   │    ├── review_rules
   │    │    ├── Rule 1 → load → review
   │    │    └── Rule 2 → load → review
   │    └── afterIteration
   │
   └── afterLoop
         ↓

final_report
   ↓

postWorkflow
   │
   └── persist_report
```

---

# 40. Important Context-Control Pattern

For a large repository, avoid:

```text
Entire repository
+
Entire knowledge base
+
Entire PR
+
Full chat history
→ one LLM call
```

Prefer:

```text
Changed-file metadata
        ↓
Choose one file
        ↓
Load that file
        ↓
Select relevant governance rules
        ↓
Load one relevant rule
        ↓
Review:

ONE FILE
+
ONE RULE
        ↓
Store finding
        ↓
Next rule
        ↓
Next file
```

This pattern is especially suitable for local models.

---

# 41. Example Review Input

```json
{
  "target": "MR-42",

  "file": {
    "metadata": {
      "path": "src/auth/login.ts",
      "status": "modified"
    },

    "content": "export async function login(...) { ... }"
  },

  "governance": {
    "metadata": {
      "path": "./governance/security.md"
    },

    "content": "# Security Guidelines\n..."
  }
}
```

---

# 42. Example Review Output

```json
{
  "findings": [
    {
      "severity": "high",
      "file": "src/auth/login.ts",
      "line": 42,
      "message": "Authentication token is logged in plaintext."
    }
  ]
}
```

---

# 43. Engine Architecture

```text
Workflow YAML / JSON
        ↓
Workflow Parser
        ↓
Schema Validator
        ↓
Registry Resolver
        ↓
Expression Resolver
        ↓
Runtime Context
        ↓
Workflow Executor
        │
        ├── Agent Runner
        │
        ├── Tool Runner
        │
        ├── Sequence Runner
        │
        ├── Parallel Runner
        │
        ├── Loop Runner
        │
        ├── Repeat Runner
        │
        ├── Condition Runner
        │
        ├── Switch Runner
        │
        ├── Approval Runner
        │
        ├── Hook Runner
        │
        └── Subworkflow Runner
        ↓
Output Validator
        ↓
Structured Result
        ↓
Event / Trace Store
```

---

# 44. Recommended Internal Interfaces

```ts
interface WorkflowNode {
  id: string;
  type: string;
  when?: string;
  retry?: RetryConfig;
  timeoutMs?: number;
  hooks?: StepHooks;
}

interface AgentNode extends WorkflowNode {
  type: "agent";
  agent: string;
  input?: unknown;
  outputSchema?: unknown;
}

interface ToolNode extends WorkflowNode {
  type: "tool";
  tool: string;
  input?: unknown;
  outputSchema?: unknown;
}

interface LoopNode extends WorkflowNode {
  type: "loop";
  over: string;
  as: string;
  mode?: "sequential" | "parallel";
  maxConcurrency?: number;
  steps: WorkflowNode[];
  hooks?: LoopHooks;
}

interface ParallelNode extends WorkflowNode {
  type: "parallel";
  maxConcurrency?: number;
  steps: WorkflowNode[];
}

interface ConditionNode extends WorkflowNode {
  type: "condition";
  if: string;
  then: WorkflowNode[];
  else?: WorkflowNode[];
}
```

---

# 45. Generic Executor Contract

```ts
interface NodeExecutor<TNode extends WorkflowNode = WorkflowNode> {
  supports(node: WorkflowNode): node is TNode;

  execute(
    node: TNode,
    context: RuntimeContext
  ): Promise<unknown>;
}
```

Possible executors:

```text
AgentExecutor
ToolExecutor
SequenceExecutor
ParallelExecutor
LoopExecutor
RepeatExecutor
ConditionExecutor
SwitchExecutor
ApprovalExecutor
SubworkflowExecutor
```

---

# 46. Registry Interface

```ts
interface AgentRegistry {
  get(name: string): AgentDefinition;
}

interface ToolRegistry {
  get(name: string): ToolDefinition;
}

interface WorkflowRegistry {
  get(name: string): WorkflowDefinition;
}
```

---

# 47. Recommended Execution Algorithm

```ts
async function executeWorkflow(workflow, input) {
  validateWorkflow(workflow);

  const context = createRuntimeContext(workflow, input);

  await runHooks(workflow.hooks?.preWorkflow, context);

  try {
    for (const step of workflow.steps) {
      await executeNode(step, context);
    }

    await runHooks(workflow.hooks?.postWorkflow, context);

    return resolve(workflow.outputs, context);

  } catch (error) {
    context.metadata.error = normalizeError(error);

    await runHooks(workflow.hooks?.onError, context);

    throw error;
  }
}
```

Generic node dispatcher:

```ts
async function executeNode(node, context) {
  if (node.when && !evaluate(node.when, context)) {
    markSkipped(node);
    return;
  }

  switch (node.type) {
    case "agent":
      return executeAgent(node, context);

    case "tool":
      return executeTool(node, context);

    case "sequence":
      return executeSequence(node, context);

    case "parallel":
      return executeParallel(node, context);

    case "loop":
      return executeLoop(node, context);

    case "repeat":
      return executeRepeat(node, context);

    case "condition":
      return executeCondition(node, context);

    case "switch":
      return executeSwitch(node, context);

    case "approval":
      return executeApproval(node, context);

    case "subworkflow":
      return executeSubworkflow(node, context);

    default:
      throw new Error(`Unsupported node type: ${node.type}`);
  }
}
```

The dispatcher branches only on generic node type, never business use case.

---

# 48. Loop Execution Pseudo-Code

```ts
async function executeLoop(node, parentContext) {
  const items = resolve(node.over, parentContext);

  await runHooks(node.hooks?.beforeLoop, parentContext);

  const executeItem = async (item, index) => {
    const child = createChildContext(parentContext);

    child.variables[node.as] = item;
    child.metadata.loopIndex = index;

    await runHooks(node.hooks?.beforeIteration, child);

    for (const step of node.steps) {
      await executeNode(step, child);
    }

    await runHooks(node.hooks?.afterIteration, child);

    return collectChildOutput(child);
  };

  let outputs;

  if (node.mode === "parallel") {
    outputs = await runWithConcurrency(
      items,
      node.maxConcurrency ?? 4,
      executeItem
    );
  } else {
    outputs = [];

    for (let index = 0; index < items.length; index++) {
      outputs.push(await executeItem(items[index], index));
    }
  }

  setStepOutput(node.id, outputs, parentContext);

  await runHooks(node.hooks?.afterLoop, parentContext);

  return outputs;
}
```

---

# 49. Retry Execution Pseudo-Code

```ts
async function executeWithRetry(fn, retry) {
  const maxAttempts = retry?.maxAttempts ?? 1;

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = normalizeError(error);

      if (!isRetryAllowed(lastError, retry)) {
        throw lastError;
      }

      if (attempt >= maxAttempts) {
        throw lastError;
      }

      await delay(calculateRetryDelay(retry, attempt));
    }
  }

  throw lastError;
}
```

---

# 50. Validation Rules

Before execution, validate:

```text
workflow name exists

all step IDs are unique within their scope

node type is supported

required node fields exist

referenced agents exist

referenced tools exist

loop has `over`

loop has `as`

parallel maxConcurrency is valid

repeat has maxIterations

condition has `if`

switch has `value`

retry maxAttempts >= 1

timeoutMs > 0

hooks contain valid workflow nodes

output schemas are valid

input schemas are valid
```

Optional advanced validation:

```text
detect impossible references

detect circular subworkflows

detect duplicate output names

detect unsafe secret interpolation

detect unbounded concurrency

detect repeat without stop condition
```

---

# 51. UI Builder Model

A non-coder UI can expose the same workflow model.

Example node palette:

```text
Agent
Tool
Sequence
Parallel
Loop
Condition
Switch
Repeat
Approval
Subworkflow
```

Properties panel for an Agent node:

```text
ID
Agent
Input
Output Schema
Retry
Timeout
Hooks
When
```

Properties panel for a Loop:

```text
ID
Array / Over
Item Variable
Mode
Max Concurrency
Before Loop
Before Iteration
After Iteration
After Loop
Child Steps
```

The visual builder should generate the same YAML/JSON schema.

Do not create a separate "UI workflow format."

---

# 52. Security Rules

Recommended security rules:

1. Workflows cannot execute arbitrary JavaScript.
2. Tools must be explicitly registered.
3. Agents must be explicitly registered.
4. File-system tools must enforce workspace boundaries.
5. Shell execution must be permission-controlled.
6. Secrets must not appear in logs.
7. Approval should be required for destructive actions.
8. Tool input must be schema validated.
9. Agent output must be schema validated when used programmatically.
10. Parallel execution must have concurrency limits.
11. Repeat nodes must have maximum iterations.
12. Subworkflows must have recursion limits.

---

# 53. Suggested Project Structure

```text
src/
├── workflow/
│   ├── parser/
│   │   └── workflow-parser.ts
│   │
│   ├── schema/
│   │   ├── workflow-schema.ts
│   │   └── node-schema.ts
│   │
│   ├── runtime/
│   │   ├── context.ts
│   │   ├── expression-resolver.ts
│   │   └── output-store.ts
│   │
│   ├── executor/
│   │   ├── workflow-executor.ts
│   │   ├── node-executor.ts
│   │   ├── agent-executor.ts
│   │   ├── tool-executor.ts
│   │   ├── sequence-executor.ts
│   │   ├── parallel-executor.ts
│   │   ├── loop-executor.ts
│   │   ├── condition-executor.ts
│   │   ├── repeat-executor.ts
│   │   ├── switch-executor.ts
│   │   ├── approval-executor.ts
│   │   └── subworkflow-executor.ts
│   │
│   ├── hooks/
│   │   └── hook-runner.ts
│   │
│   ├── retry/
│   │   └── retry-runner.ts
│   │
│   ├── registry/
│   │   ├── agent-registry.ts
│   │   ├── tool-registry.ts
│   │   └── workflow-registry.ts
│   │
│   ├── events/
│   │   └── workflow-events.ts
│   │
│   └── errors/
│       └── workflow-error.ts
│
├── agents/
│   └── ...
│
├── tools/
│   └── ...
│
└── workflows/
    ├── governance-review.yaml
    ├── test-fix.yaml
    └── document-analysis.yaml
```

---

# 54. Recommended MVP

## Phase 1

Implement:

```text
workflow parser
schema validation
runtime context
expression resolver
agent node
tool node
sequence
step outputs
basic errors
```

## Phase 2

Add:

```text
parallel
loop
nested loop
hooks
retry
timeouts
structured output validation
```

## Phase 3

Add:

```text
condition
switch
repeat
approval
fallback
subworkflow
event tracing
cancellation
```

## Phase 4

Add:

```text
visual workflow builder
execution debugger
run history
resume/replay
step-by-step inspection
workflow templates
```

---

# 55. Example Additional Workflows Using the Same Engine

The same engine can support:

## Test Fixing

```text
run tests
   ↓
analyze failures
   ↓
fix code
   ↓
repeat until tests pass
```

## Document Processing

```text
load documents
   ↓
loop documents
   ↓
extract
   ↓
analyze
   ↓
summarize
```

## Security Audit

```text
discover files
   ↓
select security-relevant files
   ↓
parallel review
   ↓
aggregate findings
```

## Feature Implementation

```text
understand request
   ↓
find relevant files
   ↓
generate plan
   ↓
approval
   ↓
modify files
   ↓
run tests
   ↓
review
```

## Research

```text
create research questions
   ↓
parallel researchers
   ↓
validation
   ↓
synthesis
```

No core executor changes are required.

---

# 56. Final Design Principle

Do not build:

```text
PR Review Engine
```

Build:

```text
Generic Agent Workflow Engine
```

Then define:

```text
PR review
code review
test fixing
bug investigation
security audit
document analysis
research
feature implementation
code migration
knowledge-base review
data processing
multi-agent collaboration
```

as workflow configurations.

The most important architectural boundary is:

```text
ENGINE
  understands generic execution primitives

WORKFLOW
  defines orchestration and control

AGENT
  performs reasoning

TOOL
  performs deterministic/external actions

REGISTRY
  resolves available capabilities

RUNTIME CONTEXT
  carries data between steps
```

That separation keeps the system reusable, testable, UI-friendly, secure, and compatible with different agents, models, and tools.
