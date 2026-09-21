# Development

## Stack

Electron 44, React 19, TypeScript, electron-vite/Vite, Tailwind 4, Zustand, Electron's
built-in `node:sqlite`, LanceDB and the official MCP TypeScript SDK. The sandboxed preload
is bundled to CommonJS. Renderer modules cannot import Node services.

`src/shared/api.ts` is the typed bridge contract. `src/shared/schemas.ts` validates IPC.
`src/main/ipc/register.ts` is the only renderer request dispatch layer. UI feature modules
call named preload methods and maintain separate Zustand stores. Services own business logic.

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:ui
```

Live tests are opt-in: `LOCALAI_LIVE_TEST=1 pnpm test` and
`LOCALAI_LIVE_TEST=1 pnpm test:ui`. They require a running local Ollama instance,
`qwen3-coder:latest` for the agent integration test and `nomic-embed-text:latest` for RAG.
All test data is isolated in temporary directories. Test fixtures are the only simulated
providers/content in the repository. The MCP integration test starts a real SDK stdio server.

The UI tests use Playwright's Electron driver. They verify renderer isolation, the OS sandbox,
file-backed editors, settings, real streaming, history across application restart, RAG source
retrieval, and a real agent diff approval. Non-live feature coverage also includes custom Tool
creation/testing, deletion dependency errors, temporary folder selection, bulk agent deletion
and MCP auto-start configuration. Service tests in `tests/new-features.test.ts` cover Node.js
and HTTP Tool execution/limits, dependency checks, startup failures, iteration counts, safe
progress, persisted runs and optional-field serialization. Traces and screenshots are written to `test-results/`.

`LOCALAI_DATA_DIR` overrides the data directory only in unpackaged development builds. This
is used for isolation in tests; do not point concurrent processes at the same database.

## Builds

`pnpm package` builds a host-platform unpacked app in `dist/`. `pnpm dist` creates the
configured host installer. A distributable release needs your signing identity, Apple
notarization credentials for macOS, platform-native smoke tests, and a branded icon.
Local macOS packages use ad-hoc signing (`mac.identity: "-"`). Override that identity with your Developer ID for distribution. No signing credentials are embedded. The product name and app ID are in `package.json`;
the runtime display name is configurable in Settings.

On this development machine the system Git command reports an unaccepted Xcode license.
Git-dependent agent tools return that command's real error; they do not simulate results.
Accept the license using Apple's normal interactive flow before using those tools here.

## Extending

Add a new provider through `LLMProvider` / `EmbeddingProvider`, a controlled tool through
`AgentTools`, or a named IPC method through the shared API, preload and validated main
handler. Never expose generic invoke, shell, filesystem or process handles to the renderer.
New tool capabilities need boundary and approval tests.

Custom user-authored Tools are handled by `services/tools/custom.ts`; their portable definitions
reuse the library service and shared `toolConfig` schema. Agent history has its own SQLite
adapter in `database/agent-runs.ts`, injected into `AgentService`. Keep runtime history separate
from file-backed definitions. Reuse `components/folder-selection.tsx` for temporary project
selection, and preserve native-picker authorization for any supplied IPC project path.
MCP auto-start belongs in the main startup lifecycle; dependency checks belong in the library
service, before any destructive IPC side effects.

The Chromium version shipped by Electron 44 is the browser support target. Native dialog,
`color-scheme`, `light-dark()` and modern CSS are supported; no legacy browser fallbacks
are required for this desktop-only renderer.

Packaged startup is covered by `node scripts/smoke-package.mjs`. The bootstrap logs module-loading errors before initializing services. Apache Arrow is an explicit runtime dependency because LanceDB declares it as a peer and pnpm-aware packaging must include it.
