---
name: Release summary
description: Turn structured review findings into a concise release summary
version: 1.0.0
enabled: true
toolConfig:
  type: javascript
  parameters:
    - name: findings
      type: array
      required: true
    - name: release
      type: string
      required: true
  url: ""
  method: GET
  headers: {}
---

const findings = Array.isArray(input.findings) ? input.findings : [];
const release = String(input.release || ' 이번 release').trim();

return {
  release,
  total: findings.length,
  summary: findings.length
    ? findings.map((finding, index) => `${index + 1}. ${String(finding)}`).join('\n')
    : 'No findings were reported.',
};
