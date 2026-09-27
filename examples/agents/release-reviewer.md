---
name: Release reviewer
description: Inspect a project and produce a prioritized release-readiness review
providerId: ollama-local
model: qwen3-coder:latest
skills:
  - release-review
tools:
  - custom:release-summary
  - mcp:project-files:list_directory
  - mcp:project-files:read_file
knowledgeSources: []
maxIterations: 8
enabled: true
capabilityConfig:
  mode: selected
  allowSkills: true
  allowMCP: true
  allowTools: true
  allowKnowledgeBase: false
  skills:
    - release-review
  mcpServers:
    - project-files
  tools:
    - custom:release-summary
    - mcp:project-files:list_directory
    - mcp:project-files:read_file
  knowledgeBases: []
  permissions:
    custom:release-summary: ask
    mcp:project-files: ask
  trace: true
---

Inspect the selected project and produce a release-readiness review. Use the
project-files MCP tools to inspect files when needed. Use the Release summary
Tool after collecting findings. Do not modify files. Report severity, evidence,
verification checks, and remaining risks.
