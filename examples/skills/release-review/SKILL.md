---
name: Release review
description: Review a project for release readiness and report actionable findings
version: 1.0.0
enabled: true
---

Review the project for release readiness.

1. Inspect the relevant source files, tests, and package scripts before making
   claims.
2. Look for correctness bugs, missing validation, security risks, and missing
   tests.
3. Prioritize findings by severity and include the file and line when possible.
4. Do not modify files unless the user explicitly requests implementation.
5. End with a concise release recommendation and list the checks that were run.
