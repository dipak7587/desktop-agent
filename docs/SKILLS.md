# Skills and portable libraries

## Skills sidebar menu

Create reusable instructions, expand a skill to read it, and use the editor to change its
name, description, content, or enabled state. Search, import, export, and delete skills from
this menu. Select enabled skills in the **Agents** editor to make them available to a run; creating
a skill does not automatically apply it to ordinary Chat messages.

To apply one explicitly in Chat, type `/skills `, select the skill, and enter your query.
Its instructions apply only when the decision engine finds the workflow relevant and necessary.
Selected RAG context is also searched only when needed.
The skill grants no tool access. See [Chat](CHAT.md).

Saved notes have their own guide: [Saved Text](SAVED_TEXT.md).

Skills are Markdown files at `<userData>/skills/<id>/SKILL.md` with YAML frontmatter.

```md
---
name: Code reviewer
description: Review code against project conventions
version: 1.0.0
enabled: true
---

Read relevant files first. Explain findings with file references. Do not change files
unless the task asks for changes. Prefer the project's existing patterns.
```

The UI adds IDs and timestamps, supports accordion inspection, editing, search, enabling,
disabling, import, export and deletion. Skill deletion requires confirmation and is blocked
while any agent, including disabled agents, references the skill. The error names the affected
agents; remove the skill from those agent definitions before retrying. Agents discover eligible skill metadata, then load a skill body only through the capability
router after a positive relevance and permission decision. Skills are not applied automatically.
See [Capability decisions](CAPABILITIES.md).

Saved Text follows the same portable Markdown approach in `saved-text/<id>.md`, with a
`title`, `createdAt`, `updatedAt` and Markdown/plain-text body. Agents are in `agents/<id>.md`
with model, skill IDs, tool names, and knowledge source IDs in frontmatter. MCP uses JSON.

Writes use a same-directory temporary file, restrictive file permissions and atomic rename.
IDs are validated so imports cannot choose arbitrary paths. Only YAML frontmatter is accepted;
executable JavaScript frontmatter engines are rejected before parsing. YAML uses safe loading.
A malformed imported definition is rejected with a visible error.

Exports contain portable definitions, not stored credential values. Imported documents receive
a fresh local ID; references between separately imported agents/skills/sources may need to be
reselected in the Agent editor. Export/import is per definition, not a dependency-aware bundle.
