---
name: Release review summarizer
description: Turn a previous release review into a concise go or no-go recommendation
providerId: ollama-local
model: qwen3-coder:latest
skills:
  - release-review
tools: []
knowledgeSources: []
maxIterations: 5
enabled: true
capabilityConfig:
  mode: selected
  allowSkills: true
  allowMCP: false
  allowTools: false
  allowKnowledgeBase: false
  skills:
    - release-review
  mcpServers: []
  tools: []
  knowledgeBases: []
  permissions: {}
  trace: true
---

Summarize the previous review output. Return a short release recommendation,
the highest-priority unresolved findings, and the verification checks that
support the recommendation. Do not invent evidence or modify files.
