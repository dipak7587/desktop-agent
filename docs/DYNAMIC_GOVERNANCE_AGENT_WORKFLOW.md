# Dynamic Workflow Engine with Hooks

## Goal

Design a generic workflow engine that can execute agents and tools dynamically using:

- Sequential execution
- Parallel execution
- Loops
- Nested loops
- Conditions
- Retry
- Hooks
- Dynamic value passing
- Dynamic agent/tool selection

The workflow engine should not contain PR-review-specific logic.

PR review, code review, testing, document processing, research, and other use cases should be created only through workflow configuration.

---

# 1. Core Workflow Types

Recommended workflow node types:

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
```

For the first version, the most important types are:

```text
agent
tool
sequence
parallel
loop
condition
```

---

# 2. Dynamic Value Resolution

All workflow properties should support dynamic references.

Example:

```yaml
{{input.target}}

{{input.governanceFolder}}

{{steps.get_changes.output}}

{{steps.get_changes.output.files}}

{{steps.get_rules.output}}

{{changedFile}}

{{rule}}

{{workflow.config.defaultAgent}}

{{env.GITLAB_URL}}
```

Example runtime context:

```ts
{
  input: {
    target: "...",
    governanceFolder: "./governance"
  },

  steps: {
    get_changes: {
      output: {}
    },

    get_rules: {
      output: []
    }
  },

  variables: {
    changedFile: {},
    rule: {}
  }
}
```

Every nested loop should create a child context while still having access to the parent context.

---

# 3. Sequential Workflow

Sequential execution means every step waits for the previous step to finish.

```yaml
steps:

  - id: fetch_mr
    type: tool
    tool: "{{tools.gitlab_get_mr}}"
    input:
      mrUrl: "{{input.mrUrl}}"

  - id: analyze_changes
    type: agent
    agent: "{{agents.change_detector}}"
    input:
      diff: "{{steps.fetch_mr.output.diff}}"

  - id: review
    type: agent
    agent: "{{agents.code_reviewer}}"
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

Typical use cases:

- Fetch → analyze → review → report
- Generate code → test → fix
- Parse document → analyze → summarize
- Research → validate → report

---

# 4. Parallel Workflow

Independent agents or tools can run simultaneously.

```yaml
steps:

  - id: get_changes
    type: agent
    agent: "{{agents.change_detector}}"
    input:
      target: "{{input.target}}"

  - id: reviews
    type: parallel

    steps:

      - id: security_review
        type: agent
        agent: "{{agents.security_reviewer}}"
        input:
          changes: "{{steps.get_changes.output}}"

      - id: architecture_review
        type: agent
        agent: "{{agents.architecture_reviewer}}"
        input:
          changes: "{{steps.get_changes.output}}"

      - id: test_review
        type: agent
        agent: "{{agents.test_reviewer}}"
        input:
          changes: "{{steps.get_changes.output}}"

  - id: final_report
    type: agent
    agent: "{{agents.reporter}}"
    input:
      reviews: "{{steps.reviews.output}}"
```

Execution:

```text
                   security_review
                 /
get_changes ─── architecture_review
                 \
                   test_review
                        ↓
                   final_report
```

Typical use cases:

- Security + architecture + test review
- Multiple research agents
- Multiple model comparison
- Frontend + backend + database analysis

---

# 5. Simple Loop

A loop processes an array one item at a time.

```yaml
steps:

  - id: get_changes
    type: agent
    agent: "{{agents.change_detector}}"

  - id: review_files
    type: loop
    over: "{{steps.get_changes.output.files}}"
    as: file

    steps:

      - id: review_file
        type: agent
        agent: "{{agents.code_reviewer}}"
        input:
          file: "{{file}}"
```

Execution:

```text
file-a.ts → reviewer

file-b.ts → reviewer

file-c.ts → reviewer
```

Typical use cases:

- Changed files
- Documents
- Database records
- Test files
- API results
- Code modules

---

# 6. Nested Loop

Nested loops are useful when one item must be checked against multiple items.

Example:

```yaml
steps:

  - id: get_changes
    type: agent
    agent: "{{agents.change_detector}}"

  - id: get_rules
    type: tool
    tool: "{{tools.list_governance_files}}"

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
            agent: "{{agents.code_reviewer}}"
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

This prevents sending the complete PR and complete knowledge base to the LLM in one request.

---

# 7. Parallel Loop

A loop can also process multiple items concurrently.

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
      agent: "{{agents.code_reviewer}}"

      input:
        file: "{{file}}"
```

Supported modes:

```yaml
mode: sequential
```

or:

```yaml
mode: parallel
maxConcurrency: 4
```

This is useful when a PR contains many independent files.

---

# 8. Condition

Conditions dynamically select the next workflow path.

```yaml
- id: analyze_risk
  type: agent
  agent: "{{agents.risk_analyzer}}"

  input:
    changes: "{{steps.get_changes.output}}"

- id: review_path
  type: condition

  if: "{{steps.analyze_risk.output.securitySensitive == true}}"

  then:

    - id: security_review
      type: agent
      agent: "{{agents.security_reviewer}}"

  else:

    - id: normal_review
      type: agent
      agent: "{{agents.code_reviewer}}"
```

Example:

```text
Security-sensitive code?

YES
 ↓
Security reviewer

NO
 ↓
Normal reviewer
```

---

# 9. Switch

Use `switch` when multiple branches are possible.

```yaml
- id: review_by_type
  type: switch

  value: "{{file.type}}"

  cases:

    typescript:
      - type: agent
        agent: "{{agents.typescript_reviewer}}"

    sql:
      - type: agent
        agent: "{{agents.database_reviewer}}"

    terraform:
      - type: agent
        agent: "{{agents.infrastructure_reviewer}}"

    default:
      - type: agent
        agent: "{{agents.general_reviewer}}"
```

This can dynamically route files based on:

```text
.ts
.tsx
.sql
.yaml
.tf
.md
.py
```

---

# 10. Repeat Until

This is different from a normal `foreach` loop.

It keeps executing until a condition becomes true.

Example:

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
      agent: "{{agents.code_fixer}}"

      input:
        errors: "{{steps.run_tests.output.errors}}"
```

Execution:

```text
Run tests
   ↓
Failed
   ↓
Fix code
   ↓
Run tests
   ↓
Failed
   ↓
Fix code
   ↓
Run tests
   ↓
Passed
```

---

# 11. Retry

Every step should optionally support retry.

```yaml
- id: review
  type: agent
  agent: "{{agents.code_reviewer}}"

  retry:
    maxAttempts: 3
    delayMs: 2000
```

More advanced:

```yaml
retry:
  maxAttempts: 3

  on:
    - timeout
    - tool_error
    - invalid_output
```

Useful for:

- LLM timeout
- MCP failure
- GitLab API failure
- Temporary network error
- Invalid structured output

---

# 12. Hooks

Hooks allow developers to execute actions before or after workflow events.

Recommended hooks:

```text
preWorkflow
postWorkflow

preStep
postStep

onSuccess
onError

beforeLoop
afterLoop

beforeIteration
afterIteration
```

---

# 13. Workflow-Level Hooks

Example:

```yaml
hooks:

  preWorkflow:

    - id: validate
      type: tool
      tool: "{{tools.validate_input}}"

  postWorkflow:

    - id: save_report
      type: tool
      tool: "{{tools.save_report}}"
```

Execution:

```text
preWorkflow
     ↓
Workflow
     ↓
postWorkflow
```

Typical `preWorkflow` operations:

- Validate input
- Load environment
- Validate repository
- Check permissions
- Initialize workspace

Typical `postWorkflow` operations:

- Save report
- Cleanup
- Store metrics
- Send result
- Generate final summary

---

# 14. Step-Level Hooks

Example:

```yaml
- id: review
  type: agent
  agent: "{{agents.code_reviewer}}"

  hooks:

    pre:

      - id: load_context
        type: tool
        tool: "{{tools.load_context}}"

    post:

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

Execution:

```text
pre
 ↓
execute agent
 ↓
post
 ↓
success
```

If execution fails:

```text
pre
 ↓
execute agent
 ↓
error
```

---

# 15. Loop Hooks

Loops should support lifecycle hooks.

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

      - id: save_file_result
        type: tool
        tool: "{{tools.save_partial_result}}"

    afterLoop:

      - id: aggregate
        type: agent
        agent: "{{agents.result_aggregator}}"

  steps:

    - id: review
      type: agent
      agent: "{{agents.code_reviewer}}"

      input:
        file: "{{hooks.load_file.output}}"
```

Execution:

```text
beforeLoop

   ↓

File A
   beforeIteration
   ↓
   review
   ↓
   afterIteration

File B
   beforeIteration
   ↓
   review
   ↓
   afterIteration

File C
   beforeIteration
   ↓
   review
   ↓
   afterIteration

   ↓

afterLoop
```

---

# 16. Nested Loop with Hooks

This is especially useful for PR review.

```yaml
steps:

  - id: get_changes
    type: agent
    agent: "{{agents.change_detector}}"

  - id: get_rules
    type: tool
    tool: "{{tools.list_governance_files}}"

  - id: review_files
    type: loop

    over: "{{steps.get_changes.output.files}}"

    as: changedFile

    hooks:

      beforeIteration:

        - id: load_changed_file
          type: tool
          tool: "{{tools.read_file}}"

          input:
            path: "{{changedFile.path}}"

    steps:

      - id: review_rules
        type: loop

        over: "{{steps.get_rules.output}}"

        as: governanceRule

        hooks:

          beforeIteration:

            - id: load_rule
              type: tool
              tool: "{{tools.read_governance_file}}"

              input:
                path: "{{governanceRule.path}}"

        steps:

          - id: review
            type: agent
            agent: "{{agents.code_reviewer}}"

            input:
              file: "{{hooks.load_changed_file.output}}"
              governance: "{{hooks.load_rule.output}}"
```

Execution:

```text
File A
   ↓
load File A

   Rule 1
      ↓
   load Rule 1
      ↓
   review

   Rule 2
      ↓
   load Rule 2
      ↓
   review

File B
   ↓
load File B

   Rule 1
      ↓
   load Rule 1
      ↓
   review
```

Only the required file and governance document enter the current LLM context.

---

# 17. Relevant Knowledge Selection

Avoid reviewing every source file against every knowledge-base file.

Add a selector first.

```yaml
- id: select_rules
  type: agent

  agent: "{{agents.rule_selector}}"

  input:
    file: "{{changedFile}}"
    availableRules: "{{steps.get_rules.output}}"
```

Then:

```yaml
- id: review_rules
  type: loop

  over: "{{steps.select_rules.output.relevantRules}}"

  as: rule
```

Example:

```text
100 governance documents

UserService.ts
       ↓
Rule Selector
       ↓
security.md
api-guidelines.md
typescript.md
```

Only three documents are reviewed instead of all 100.

---

# 18. Dynamic Agent Selection

Agents should also be dynamically selectable.

```yaml
- id: review
  type: agent

  agent: "{{input.reviewAgent}}"

  input:
    file: "{{file}}"
```

Possible runtime values:

```text
code-reviewer
security-reviewer
gemma-reviewer
claude-reviewer
custom-reviewer
```

No workflow engine code needs to change.

---

# 19. Dynamic Tool Selection

Tools should follow the same pattern.

```yaml
- id: fetch_changes
  type: tool

  tool: "{{input.changeProvider}}"

  input:
    target: "{{input.target}}"
```

Possible values:

```text
gitlab_get_changes
github_get_changes
bitbucket_get_changes
local_git_diff
```

---

# 20. Fan-Out / Fan-In

Multiple agents can analyze the same input and then one agent combines their results.

```yaml
- id: reviews
  type: parallel

  steps:

    - id: security
      type: agent
      agent: "{{agents.security_reviewer}}"

    - id: architecture
      type: agent
      agent: "{{agents.architecture_reviewer}}"

    - id: quality
      type: agent
      agent: "{{agents.code_quality_reviewer}}"

- id: aggregate
  type: agent

  agent: "{{agents.review_aggregator}}"

  input:
    reviews: "{{steps.reviews.output}}"
```

Execution:

```text
              Security
             /
Changes → Architecture
             \
              Quality
                 ↓
             Aggregator
```

---

# 21. Recommended Hook Model

Use the same naming convention everywhere.

```yaml
hooks:

  before: []

  after: []

  success: []

  error: []
```

Loops can add:

```yaml
hooks:

  beforeLoop: []

  afterLoop: []

  beforeIteration: []

  afterIteration: []
```

Workflow root can use:

```yaml
hooks:

  preWorkflow: []

  postWorkflow: []

  onError: []
```

---

# 22. Hooks Should Not Become Hidden Workflow Logic

Hooks should use the same primitives as the workflow itself.

Allowed:

```text
agent
tool
condition
sequence
parallel
```

Avoid arbitrary JavaScript inside workflow YAML such as:

```yaml
before:
  script: |
    if (...) {
      ...
    }
```

Otherwise:

- workflow becomes difficult to debug
- security becomes harder
- UI cannot understand the workflow
- execution becomes unpredictable
- workflows become application-code dependent

The workflow engine should remain declarative.

---

# 23. Recommended Architecture

```text
Workflow YAML / JSON
        ↓
Workflow Parser
        ↓
Schema Validator
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
        ├── Sequential Runner
        │
        ├── Parallel Runner
        │
        ├── Loop Runner
        │
        ├── Condition Runner
        │
        └── Hook Runner
        ↓
Structured Outputs
        ↓
Final Result
```

---

# 24. Responsibility Separation

## Workflow Controls

The workflow should decide:

```text
WHAT runs

WHEN it runs

WHICH agent runs

WHICH tool runs

WHAT order is used

PARALLEL or SEQUENTIAL

HOW MANY times something runs

WHAT data goes to the next step

WHEN execution should stop
```

## Agent Controls

The agent decides:

```text
HOW to perform the assigned task

HOW to reason about the supplied context

WHICH available tools to use inside its allowed scope

WHAT result to return
```

This separation gives developers strong control while keeping agents flexible.

---

# 25. Recommended First Version

Start with:

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

Then later add:

```text
repeat

switch

approval

timeout

fallback

subworkflow
```

---

# 26. Example Complete PR Review Workflow

```yaml
name: governance-review

inputs:

  target:
    type: string

  governanceFolder:
    type: string
    default: "./governance"

hooks:

  preWorkflow:

    - id: validate_target
      type: tool
      tool: "{{tools.validate_target}}"

  postWorkflow:

    - id: persist_report
      type: tool
      tool: "{{tools.save_report}}"

steps:

  - id: get_changes
    type: agent

    agent: "{{agents.change_detector}}"

    input:
      target: "{{input.target}}"

  - id: get_rules
    type: tool

    tool: "{{tools.list_governance_files}}"

    input:
      folder: "{{input.governanceFolder}}"

  - id: review_files
    type: loop

    over: "{{steps.get_changes.output.files}}"

    as: changedFile

    mode: sequential

    hooks:

      beforeIteration:

        - id: load_file
          type: tool

          tool: "{{tools.read_file}}"

          input:
            path: "{{changedFile.path}}"

    steps:

      - id: select_rules
        type: agent

        agent: "{{agents.rule_selector}}"

        input:
          file: "{{changedFile}}"
          rules: "{{steps.get_rules.output}}"

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

            agent: "{{agents.code_reviewer}}"

            retry:
              maxAttempts: 2

            input:
              target: "{{input.target}}"
              file: "{{hooks.load_file.output}}"
              governance: "{{hooks.load_rule.output}}"

  - id: final_report
    type: agent

    agent: "{{agents.reporter}}"

    input:
      reviews: "{{steps.review_files.output}}"
```

---

# 27. Final Principle

The workflow engine should be generic.

Do not design:

```text
PR Review Engine
```

Design:

```text
Generic Agent Workflow Engine
```

Then PR review becomes only one workflow configuration.

The same engine should later support:

```text
PR review

Code migration

Test fixing

Bug investigation

Security audit

Document analysis

Research workflows

Feature implementation

Knowledge-base review

Data processing

Multi-agent collaboration
```

without changing the core workflow executor.