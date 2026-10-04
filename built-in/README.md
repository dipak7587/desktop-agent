# Built-in application content

Add your content here **before starting development or building the app**.
`pnpm dev` loads this folder when the app starts. `pnpm dist` includes it in
the installer (DMG on macOS). Installed copies load their own bundled folder;
they do not need your source checkout or an import step.

```text
built-in/
  agents/                 → Agents sidebar section
    my-agent.md
  skills/                 → Skills sidebar section
    my-skill/SKILL.md
  mcp/                    → MCP sidebar section
    my-server.json
  tools/                  → Tools sidebar section
    my-tool.ts
  kb/                     → Knowledge Base sidebar section
    product-guide/        (one knowledge source per folder)
      introduction.md
      reference.txt
  general.json            → first-install General settings
  landing.json            → first-install Landing settings
```

The folders include ready-to-load samples:

| Section | Sample |
| --- | --- |
| Agents | Workspace guide, connected to the sample skill, tool, and knowledge base |
| Skills | Clear writing |
| Tools | Local calculator (add, subtract, multiply, divide) |
| MCP | [DeepWiki](https://docs.devin.ai/work-with-devin/deepwiki-mcp), a remote public-repository documentation server; click Start to connect |
| Knowledge Base | Workspace guide, with getting-started and customization documents |
| Settings | Explicit General defaults and three Landing suggestion cards |

Replace or remove these sample files in the source folder before building your
own app. The MCP sample needs internet access and does not auto-connect.
The calculator works without a model; the agent needs a configured chat model,
and knowledge search needs an embedding model and an initial Sync / Re-index.

Use names containing only letters, numbers, hyphens, and underscores for IDs.
Use a `builtin-` prefix for library filenames/skill folders to avoid collisions
with personal items. A filename (or skill folder name) is the item's ID.
Knowledge folder IDs become `builtin-kb-<folder-name>`.

Restart development after changing these files. Rebuild and reinstall to ship
changes to installed users. Bundled definitions are read directly from the app,
so newer versions replace the built-in originals without overwriting personal
definitions. Built-ins appear in the **Built-in** group of their existing sidebar
section. They have no Edit/Delete actions and cannot be moved to another group.
Personal items remain editable. Workspace backups exclude bundled definitions.

## Agents and skills

You can export a definition from the app and put it in the matching folder.
Alternatively, create Markdown with YAML frontmatter:

`agents/builtin-helper.md`:

```markdown
---
name: Product helper
description: Answers questions about our product.
skills:
  - builtin-clear-writing
knowledgeSources:
  - builtin-kb-product-guide
---
Use the product guide to answer questions. Say when the guide does not contain
the answer, and cite the relevant source when available.
```

`skills/builtin-clear-writing/SKILL.md`:

```markdown
---
name: Clear writing
description: Write clear, concise explanations.
---
Lead with the answer. Use concrete examples and explain unfamiliar terms.
```

Leave an agent's `providerId` and `model` unset to use the user's active provider
and default model. Users still configure their own provider/model before running
an agent. References to skills, tools, MCP servers, and knowledge must match their
IDs, using the same definition format as app exports.

## MCP servers

Put one exported MCP definition in each `.json` file. For example,
`mcp/builtin-product-docs.json`:

```json
{
  "name": "Product docs",
  "description": "Our team's documentation server",
  "enabled": true,
  "transport": "streamable-http",
  "connection": {
    "type": "streamable-http",
    "url": "https://your-server.example/mcp"
  },
  "runtime": { "autoConnect": false }
}
```

Replace the example URL with your real server. The definition is visible on
installation; connecting still requires a working endpoint and any credentials.
Do not put secrets or developer-specific absolute paths in distributable files.
For stdio servers, the command and dependencies must be available on the user's
machine; adding a definition does not install external executables.

## Tools

Export a tool as TypeScript from the app, or add a LangChain tool such as
`tools/builtin-add.ts`:

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const add = tool(
  async ({ a, b }) => String(a + b),
  {
    name: 'add_numbers',
    description: 'Add two numbers.',
    schema: z.object({ a: z.number(), b: z.number() }),
  },
);
```

## Knowledge bases

Create a folder under `kb/` for each knowledge base and add `.md` or `.txt`
documents. It is visible immediately and can be previewed before indexing.
Users select an embedding model in Settings → KBase, then use **Sync / Re-index**
to make it searchable. Re-index after shipping changed documents. Indexes and
sync status live in user data, not inside the application bundle.

## General and Landing defaults

`general.json` supports `appName`, `appLogo` (PNG/JPEG/WebP data URL), `theme`,
`language`, `startAtLogin`, and `defaultAgent`. `landing.json` supports `eyebrow`,
`title`, `description`, `logo`, and exactly three `suggestions` with `icon`,
`title`, and `text`. Valid icons are `code`, `book`, and `terminal`.
Omitted fields use application defaults; `{}` is valid.

These settings initialize a **new user-data directory**. Existing users keep
their saved settings across restarts and upgrades. For a clean development test:

```sh
LOCALAI_DATA_DIR="$(mktemp -d)" pnpm dev
```

To change the installer/app bundle name and identity, also edit `build.productName`
and `build.appId` in the repository's `package.json` before building.
