# Security model

## Renderer boundary

BrowserWindow uses `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
The preload exposes named methods only; raw IPC, process and Node handles are not exposed.
Main validates both the owning webContents/main frame and Zod payload schemas. Native
permission requests are denied. New windows and renderer navigation are blocked. CSP limits
scripts/resources to the application; Markdown does not render raw HTML or remote images.
The only external browser action opens a fixed Ollama setup URL.

## Credentials

Electron safeStorage encrypts values through the OS backend. The insecure Linux `basic_text`
backend is refused. API values are never returned to the UI; only configured key names are
listed. MCP configs accept `${NAME}` references only. `.env` loading requires a user-selected
file; the app stores its path, not a copy of plaintext values. Settings/definition exports omit
credentials. Protect the original `.env` file yourself. Redaction removes known credential
values and resolved MCP environment values from MCP logs/results.

## Agent tools

The main process accepts a project only after a native folder selection. Tools validate paths
relative to its real path, reject traversal and symlinks, exclude secrets/generated folders,
and cap reads and traversal. Writes require the prior content hash (or `missing` for new files),
produce a diff, and recheck the hash after approval. The final written content is verified.
Default approval mode asks before every file change. Safe mode approves common source/document
edits but asks for configuration/other file types; full auto permits allowed writes/scripts.

Package scripts require approval except in full-auto mode. Only npm/pnpm/yarn test, lint, build,
and typecheck commands are permitted. Shell interpreters, arbitrary arguments, destructive
commands, git push/reset and deletion tools are unavailable. Child processes run with bounded
output, a timeout, cancellation and a reduced environment. Project scripts themselves are
arbitrary code: inspect/trust the selected project before approving them. MCP calls always ask.

This is an application-level policy boundary, not an OS sandbox around agent child processes.
The Electron renderer is sandboxed, but trusted MCP servers/package scripts run as the current
user. Path and hash checks prevent ordinary accidental/concurrent changes; they are not a
race-proof defense against a hostile local process changing directories at the same instant.
Use a disposable checkout for untrusted projects.

## Operations

Network access is limited to the configured Ollama endpoint and explicitly added URL sources,
plus programs the user starts through MCP. No telemetry or automatic cloud inference is present.
Local HTTP URLs are allowed for internal documentation. URL content is untrusted reference
material. Existing credential files are excluded from automatic code/document traversal.

The app cancels work and awaits service cleanup on quit. Error logs live in `<userData>/logs/`.
Chat content, previews and source files are not encrypted at rest by the app; use OS disk
protection if needed. The local macOS package is ad-hoc signed; it is not Developer ID signed or notarized for public distribution.
