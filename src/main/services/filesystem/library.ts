import {
  parseToolFile,
  serializeToolFile,
  toolItemFromSource,
  legacyToolSource,
} from '../tools/files';
import { mcpConfigFromItem } from '../../../shared/mcp-schema';
import { capabilityConfig } from '../../../shared/capabilities';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import { randomUUID } from 'node:crypto';
import { librarySchema, idSchema } from '../../../shared/schemas';
import { BUILT_IN_GROUP, type LibraryKind, type LibraryItem } from '../../../shared/types';
import { atomicWrite, readJSON } from './storage';
export class LibraryService {
  private builtIns = new Map<LibraryKind, Map<string, LibraryItem>>();
  async loadBuiltIns(root: string) {
    const bundled = new LibraryService(root);
    const next = new Map<LibraryKind, Map<string, LibraryItem>>();
    for (const kind of ['agents', 'skills', 'mcp', 'tools'] as const) {
      const items = await bundled.list(kind);
      next.set(
        kind,
        new Map(
          items.map((item) => [
            item.id,
            {
              ...item,
              builtIn: true,
              group: BUILT_IN_GROUP,
            },
          ]),
        ),
      );
    }
    this.builtIns = next;
  }
  assertWritable(kind: LibraryKind, id: string) {
    idSchema.parse(id);
    if (this.builtIns.get(kind)?.has(id))
      throw new Error('Built-in items cannot be edited, moved, or deleted.');
  }

  constructor(
    private root: string,
    private onSavedTextChange?: () => Promise<void>,
  ) {}
  path(kind: LibraryKind, id: string) {
    idSchema.parse(id);
    return kind === 'skills'
      ? join(this.root, kind, id, 'SKILL.md')
      : join(this.root, kind, `${id}.${kind === 'mcp' ? 'json' : kind === 'tools' ? 'ts' : 'md'}`);
  }
  private groupPath(kind: LibraryKind) {
    return join(this.root, kind, 'groups.registry');
  }
  private async readGroups(kind: LibraryKind) {
    const stored = await readJSON<unknown>(this.groupPath(kind), []);
    if (!Array.isArray(stored)) throw new Error(`Invalid ${kind} group registry`);
    const names = stored.map((name) => {
      if (typeof name !== 'string') throw new Error(`Invalid ${kind} group registry`);
      return librarySchema.shape.group.parse(name);
    });
    return [...new Set(names.filter((name): name is string => !!name))];
  }
  private async writeGroups(kind: LibraryKind, groups: string[]) {
    await atomicWrite(
      this.groupPath(kind),
      JSON.stringify(
        [...new Set(groups)].filter(Boolean).sort((a, b) => a.localeCompare(b)),
        null,
        2,
      ),
    );
  }
  async groups(kind: LibraryKind) {
    const [stored, items] = await Promise.all([this.readGroups(kind), this.list(kind)]);
    const assigned = items.map((item) => item.group).filter((name): name is string => !!name);
    return [
      ...new Set([...stored, ...assigned, ...(kind === 'saved-text' ? [] : [BUILT_IN_GROUP])]),
    ].sort((a, b) => a.localeCompare(b));
  }
  async list(kind: LibraryKind): Promise<LibraryItem[]> {
    const entries = await readdir(join(this.root, kind), { withFileTypes: true }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    const items: LibraryItem[] = [];
    for (const entry of entries) {
      if (
        kind === 'skills'
          ? !entry.isDirectory()
          : !(kind === 'tools'
              ? /\.(ts|md)$/.test(entry.name)
              : entry.name.endsWith(kind === 'mcp' ? '.json' : '.md'))
      )
        continue;
      const id = kind === 'skills' ? entry.name : entry.name.replace(/\.(json|md|ts)$/, '');
      if (
        kind === 'tools' &&
        entry.name.endsWith('.md') &&
        entries.some((candidate) => candidate.name === `${id}.ts`)
      )
        continue;
      items.push(
        this.parse(
          kind,
          await readFile(
            kind === 'tools' ? join(this.root, kind, entry.name) : this.path(kind, id),
            'utf8',
          ),
          id,
        ),
      );
    }
    const bundled = this.builtIns.get(kind);
    return [
      ...items.filter((item) => !bundled?.has(item.id)),
      ...structuredClone([...(bundled?.values() ?? [])]),
    ].sort((a, b) => b.updatedAt - a.updatedAt);
  }
  parse(kind: LibraryKind, raw: string, id: string = randomUUID()): LibraryItem {
    if (kind === 'tools' && !/^---\r?\n/.test(raw)) return parseToolFile(raw, id);
    if (kind === 'mcp') {
      const value = { ...JSON.parse(raw), id };
      return librarySchema.parse(
        value.connection ? { ...value, ...mcpConfigFromItem(value) } : value,
      );
    }
    if (!/^---\r?\n/.test(raw))
      throw new Error('Markdown definitions require YAML frontmatter (--- on its own line)');
    const parsed = matter(raw);
    const item = librarySchema.parse({
      ...parsed.data,
      name: parsed.data.name ?? parsed.data.title,
      content: parsed.content.trim(),
      id,
    });
    if (kind === 'tools' && item.toolConfig) item.toolSource = legacyToolSource(item);
    return item;
  }
  serialize(kind: LibraryKind, item: LibraryItem) {
    if (kind === 'tools') return serializeToolFile(item);
    if (kind === 'mcp') {
      return JSON.stringify(
        {
          ...mcpConfigFromItem({ ...item }),
          group: item.group,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        },
        null,
        2,
      );
    }
    const { content, ...meta } = item;
    const metadata = Object.fromEntries(
      Object.entries(meta).filter(([, value]) => value !== undefined),
    );
    return matter.stringify(
      content,
      kind === 'saved-text' ? { ...metadata, title: item.name } : metadata,
    );
  }
  async save(kind: LibraryKind, input: LibraryItem) {
    this.assertWritable(kind, input.id);
    const value = librarySchema.parse(input);
    const now = Date.now();
    const item = { ...value, createdAt: value.createdAt || now, updatedAt: now };
    if (kind === 'tools') {
      if (!item.toolConfig) throw new Error('Configure the Tool execution type and parameters');
      if (item.toolConfig.type === 'langchain') {
        Object.assign(item, toolItemFromSource(item.content, item));
      } else if (item.toolConfig.type === 'api') {
        const url = new URL(item.toolConfig.url);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
          throw new Error('Use an HTTP(S) API URL without credentials');
      } else if (!item.content.trim())
        throw new Error('Add JavaScript logic before saving this Tool');
    }
    if (kind === 'tools' && item.toolConfig?.type !== 'langchain')
      item.toolSource = legacyToolSource(item);
    if (kind === 'mcp') Object.assign(item, mcpConfigFromItem({ ...item }));
    await atomicWrite(this.path(kind, item.id), this.serialize(kind, item));
    if (kind === 'tools') await rm(join(this.root, kind, `${item.id}.md`), { force: true });
    if (kind === 'saved-text') await this.onSavedTextChange?.();
    return kind === 'mcp' || kind === 'tools'
      ? this.parse(kind, this.serialize(kind, item), item.id)
      : item;
  }
  async assertRemovable(kind: LibraryKind, id: string) {
    this.assertWritable(kind, id);
    if (kind !== 'skills' && kind !== 'mcp' && kind !== 'tools') return;
    const prefix = kind === 'mcp' ? `mcp:${id}:` : `custom:${id}`;
    const agents = (await this.list('agents')).filter(
      (a) =>
        (kind === 'skills'
          ? [...a.skills, ...capabilityConfig(a).skills].includes(id)
          : [...a.tools, ...capabilityConfig(a).tools].some((t) =>
              kind === 'mcp' ? t.startsWith(prefix) : t === prefix,
            )) ||
        (kind === 'mcp' && capabilityConfig(a).mcpServers.includes(id)),
    );
    const dependentSkills =
      kind === 'skills'
        ? (await this.list('skills')).filter(
            (skill) =>
              skill.id !== id && [...skill.skills, ...capabilityConfig(skill).skills].includes(id),
          )
        : [];
    const dependents = [...agents, ...dependentSkills];
    if (dependents.length)
      throw new Error(
        `Cannot delete this ${kind === 'skills' ? 'skill' : kind === 'mcp' ? 'MCP server' : 'Tool'}. It is currently used by: ${dependents.map((item) => item.name).join(', ')}. Remove it from these definitions before deleting it.`,
      );
  }
  async setGroup(kind: LibraryKind, ids: string[], group: string) {
    for (const id of ids) this.assertWritable(kind, id);
    const name = librarySchema.shape.group.parse(group);
    const items = await Promise.all([...new Set(ids)].map((id) => this.get(kind, id)));
    const groups = new Set(await this.readGroups(kind));
    for (const item of items) if (item.group) groups.add(item.group);
    if (name) groups.add(name);
    await this.writeGroups(kind, [...groups]);
    // Grouping changes organization only, without restarting servers or changing runtime settings.
    for (const item of items) {
      await atomicWrite(
        this.path(kind, item.id),
        this.serialize(kind, {
          ...item,
          group: name,
          updatedAt: Date.now(),
        }),
      );
    }
  }
  async renameGroup(kind: LibraryKind, from: string, to: string) {
    const previous = librarySchema.shape.group.parse(from);
    const next = librarySchema.shape.group.parse(to);
    if (!previous || !next) throw new Error('Group names cannot be empty');
    if (previous === BUILT_IN_GROUP) throw new Error('The Built-in group cannot be renamed.');
    const items = await this.list(kind);
    const ids = items.filter((item) => item.group === previous).map((item) => item.id);
    if (ids.length) await this.setGroup(kind, ids, next);
    const groups = (await this.readGroups(kind)).filter((name) => name !== previous);
    await this.writeGroups(kind, [...groups, next]);
  }
  async deleteGroup(kind: LibraryKind, group: string) {
    const name = librarySchema.shape.group.parse(group);
    if (!name) throw new Error('Group name cannot be empty');
    if (name === BUILT_IN_GROUP) throw new Error('The Built-in group cannot be deleted.');
    const items = await this.list(kind);
    const ids = items.filter((item) => item.group === name).map((item) => item.id);
    if (ids.length) await this.setGroup(kind, ids, '');
    await this.writeGroups(
      kind,
      (await this.readGroups(kind)).filter((existing) => existing !== name),
    );
  }
  async remove(kind: LibraryKind, id: string) {
    await this.assertRemovable(kind, id);
    await rm(this.path(kind, id), { force: true });
    if (kind === 'tools') await rm(join(this.root, kind, `${id}.md`), { force: true });
    if (kind === 'skills') await rm(join(this.root, kind, id), { recursive: true, force: true });
    if (kind === 'saved-text') await this.onSavedTextChange?.();
  }
  async get(kind: LibraryKind, id: string) {
    idSchema.parse(id);
    const bundled = this.builtIns.get(kind)?.get(id);
    if (bundled) return structuredClone(bundled);
    let raw: string;
    try {
      raw = await readFile(this.path(kind, id), 'utf8');
    } catch (error) {
      if (kind !== 'tools' || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      raw = await readFile(join(this.root, kind, `${id}.md`), 'utf8');
    }
    return this.parse(kind, raw, id);
  }
}
