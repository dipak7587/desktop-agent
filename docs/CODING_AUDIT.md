# Coding requirements audit

Compared `code-requirement.md` with the Code UI, Chat dispatch, main-process tools,
provider selection and execution tests.

| Requirement | Result |
| --- | --- |
| `/code` folder picker, saved workspaces and reconnect | Already available; reused |
| Read, create, edit, list and search project files | Existing guarded tools; now available in linked Chat |
| Code without creating a separate agent | Added built-in coding execution using the current Chat model/provider |
| Agent Chat controls | Restored one-run folder selection and Save to Agent for provider/model overrides |
| Optional configured agent and provider choice | Removed the Code form's local-Ollama filter; linked Chat agents inherit the project |
| Continue with the saved workspace | Main process resolves the conversation's persisted workspace each turn |
| Inspect, plan, implement, test and report honestly | Added shared coding instructions to project runs |
| Diff review, approval, stale-file checks | Already available; reused and extended to deletion |
| Delete files when necessary | Added individual text-file deletion with explicit approval and hash checks |
| Tests, lint, type checks, builds and formatting | Existing four Node script categories retained; added reviewed development commands and arguments for other tools/languages |
| Git inspection | Existing status, diff and log tools reused |
| Cancellation, limits, errors and run history | Existing runtime reused for direct coding |
| Electron isolation, IPC validation, protected paths | Existing boundaries retained |
| Workspace permission restrictions | Empty policy asks per operation; workspace and saved-agent denials win |

All development commands are reviewed except the existing four package-script categories when
explicit automatic approval is configured. Child processes are not OS-sandboxed. File tools
reject protected paths, symlinks and traversal; deletion does not support directories or binary
files. Model tool-calling capability and installed development executables remain prerequisites.
No live external-model verification is implied by scripted provider tests.

The separate `CODE.md` roadmap also describes a permission editor, scoped remembered grants,
workspace-specific memory and activity filtering. Those are not added by this coding-behavior
update and remain identified as unimplemented in that roadmap.
