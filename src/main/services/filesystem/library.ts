import { capabilityConfig } from '../../../shared/capabilities';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';
import { randomUUID } from 'node:crypto';
import { librarySchema, idSchema } from '../../../shared/schemas';
import type { LibraryKind, LibraryItem } from '../../../shared/types';
import { atomicWrite } from './storage';
export class LibraryService {
  constructor(
    private root: string,
    private onSavedTextChange?: () => Promise<void>,
  ) {}
  path(kind: LibraryKind, id: string) {
    idSchema.parse(id);
    return kind === 'skills'
      ? join(this.root, kind, id, 'SKILL.md')
      : join(this.root, kind, `${id}.${kind === 'mcp' ? 'json' : 'md'}`);
  }
  async list(kind: LibraryKind): Promise<LibraryItem[]> {
    await mkdir(join(this.root, kind), { recursive: true });
    const entries = await readdir(join(this.root, kind), { withFileTypes: true });
    const items: LibraryItem[] = [];
    for (const entry of entries) {
      if (
        kind === 'skills'
          ? !entry.isDirectory()
          : !entry.name.endsWith(kind === 'mcp' ? '.json' : '.md')
      )
        continue;
      const id = kind === 'skills' ? entry.name : entry.name.replace(/\.(json|md)$/, '');
      items.push(this.parse(kind, await readFile(this.path(kind, id), 'utf8'), id));
    }
    return items.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  parse(kind: LibraryKind, raw: string, id: string = randomUUID()): LibraryItem {
    if (kind === 'mcp') return librarySchema.parse({ ...JSON.parse(raw), id });
    if (!/^---\r?\n/.test(raw))
      throw new Error('Markdown definitions require YAML frontmatter (--- on its own line)');
    const parsed = matter(raw);
    return librarySchema.parse({
      ...parsed.data,
      name: parsed.data.name ?? parsed.data.title,
      content: parsed.content.trim(),
      id,
    });
  }
  serialize(kind: LibraryKind, item: LibraryItem) {
    if (kind === 'mcp') {
      const { content: _content, ...config } = item;
      return JSON.stringify(config, null, 2);
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
    const value = librarySchema.parse(input);
    const now = Date.now();
    const item = { ...value, createdAt: value.createdAt || now, updatedAt: now };
    if (kind === 'tools') {
      if (!item.toolConfig) throw new Error('Configure the Tool execution type and parameters');
      if (item.toolConfig.type === 'api') {
        const url = new URL(item.toolConfig.url);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
          throw new Error('Use an HTTP(S) API URL without credentials');
      } else if (!item.content.trim())
        throw new Error('Add JavaScript logic before saving this Tool');
    }
    if (kind === 'mcp' && !item.description.trim()) throw new Error('MCP description is required');
    await atomicWrite(this.path(kind, item.id), this.serialize(kind, item));
    if (kind === 'saved-text') await this.onSavedTextChange?.();
    return item;
  }
  async assertRemovable(kind: LibraryKind, id: string) {
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
    if (agents.length)
      throw new Error(
        `Cannot delete this ${kind === 'skills' ? 'skill' : kind === 'mcp' ? 'MCP server' : 'Tool'}. It is currently used by: ${agents.map((a) => a.name).join(', ')}. Remove it from these Agents before deleting it.`,
      );
  }
  async remove(kind: LibraryKind, id: string) {
    await this.assertRemovable(kind, id);
    await rm(this.path(kind, id), { force: true });
    if (kind === 'skills') await rm(join(this.root, kind, id), { recursive: true, force: true });
    if (kind === 'saved-text') await this.onSavedTextChange?.();
  }
  async get(kind: LibraryKind, id: string) {
    return this.parse(kind, await readFile(this.path(kind, id), 'utf8'), id);
  }
}
