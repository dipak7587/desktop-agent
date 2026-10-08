# Governance review

Import this document using Workflows → New workflow.

```yaml
name: Governance review
description: Review changed files against selected governance rules, then save a report.
maxDepth: 20
maxIterations: 100
inputs:
  target:
    type: string
    description: Repository path or merge request URL
  governanceFolder:
    type: string
    default: ./governance
config:
  defaultAgent: workflow-tools
agents:
  change_detector: change-detector
  rule_selector: rule-selector
  code_reviewer: code-reviewer
  reporter: reporter
tools:
  list_governance_files: custom:list-governance-files
  read_file: filesystem.read
  read_governance_file: filesystem.read
hooks:
  postWorkflow:
    - id: persist_report
      type: tool
      tool: filesystem.write
      input:
        path: governance-review.md
        content: '{{steps.final_report.output}}'
steps:
  - id: get_changes
    type: agent
    agent: '{{agents.change_detector}}'
    input:
      target: '{{input.target}}'
      instruction: Return a JSON object with a files array containing objects with a path field.
  - id: get_rules
    type: tool
    tool: '{{tools.list_governance_files}}'
    input:
      folder: '{{input.governanceFolder}}'
  - id: review_files
    type: loop
    over: '{{steps.get_changes.output.files}}'
    as: changedFile
    mode: parallel
    maxConcurrency: 2
    hooks:
      beforeIteration:
        - id: load_file
          type: tool
          tool: '{{tools.read_file}}'
          input:
            path: '{{changedFile.path}}'
    steps:
      - id: select_rules
        type: agent
        agent: '{{agents.rule_selector}}'
        input:
          file: '{{changedFile}}'
          rules: '{{steps.get_rules.output}}'
          instruction: Return a JSON object with a relevantRules array containing objects with a path field.
      - id: review_rules
        type: loop
        over: '{{steps.select_rules.output.relevantRules}}'
        as: rule
        hooks:
          beforeIteration:
            - id: load_rule
              type: tool
              tool: '{{tools.read_governance_file}}'
              input:
                path: '{{rule.path}}'
        steps:
          - id: review
            type: agent
            agent: '{{agents.code_reviewer}}'
            retry:
              maxAttempts: 2
            input:
              target: '{{input.target}}'
              file: '{{hooks.load_file.output}}'
              governance: '{{hooks.load_rule.output}}'
  - id: final_report
    type: agent
    agent: '{{agents.reporter}}'
    input:
      reviews: '{{steps.review_files.output}}'
      instruction: Return a Markdown report as plain text.
```
