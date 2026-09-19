import { readdir, readFile, rm } from 'node:fs/promises';
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
    return matter.stringify(content, kind === 'saved-text' ? { ...meta, title: item.name } : meta);
  }
  async save(kind: LibraryKind, input: LibraryItem) {
    const value = librarySchema.parse(input);
    const now = Date.now();
    const item = { ...value, createdAt: value.createdAt || now, updatedAt: now };
    if (kind === 'mcp' && !item.description.trim()) throw new Error('MCP description is required');
    await atomicWrite(this.path(kind, item.id), this.serialize(kind, item));
    if (kind === 'saved-text') await this.onSavedTextChange?.();
    return item;
  }
  async remove(kind: LibraryKind, id: string) {
    await rm(this.path(kind, id), { force: true });
    if (kind === 'skills') await rm(join(this.root, kind, id), { recursive: true, force: true });
    if (kind === 'saved-text') await this.onSavedTextChange?.();
  }
  async get(kind: LibraryKind, id: string) {
    return this.parse(kind, await readFile(this.path(kind, id), 'utf8'), id);
  }
}
