import { LibraryService } from '../filesystem/library';
import * as lancedb from '@lancedb/lancedb';
import { join, basename, extname, relative } from 'node:path';
import { readFile, rm, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import Turndown from 'turndown';
import type { KnowledgeSource, SearchResult, AppEvent, Settings } from '../../../shared/types';
import { atomicWrite, readJSON, hash, errorMessage } from '../filesystem/storage';
import { walk, readText, ignored, supportedExtensions } from '../filesystem/walk';
import { chunkText } from './chunker';
import type { EmbeddingProvider } from '../ollama/provider';
export class KnowledgeService {
  private pendingResync = new Set<string>();
  private indexQueue: Promise<void> = Promise.resolve();
  private sources: KnowledgeSource[] = [];
  private jobs = new Map<string, AbortController>();
  private db!: lancedb.Connection;
  private persistQueue: Promise<void> = Promise.resolve();
  constructor(
    private root: string,
    private settings: () => Settings,
    private embeddings: EmbeddingProvider,
    private emit: (e: AppEvent) => void,
  ) {}
  async init() {
    await mkdir(join(this.root, 'rag/lancedb'), { recursive: true });
    await mkdir(join(this.root, 'cache'), { recursive: true });
    this.db = await lancedb.connect(join(this.root, 'rag/lancedb'));
    this.sources = await readJSON(join(this.root, 'knowledge.json'), []);
    for (const s of this.sources)
      if (['syncing', 'indexing'].includes(s.status)) {
        s.status = 'error';
        s.error = 'Indexing was interrupted. Sync to retry.';
      }
    await this.persist();
  }
  private persist() {
    const snapshot = JSON.stringify(this.sources, null, 2);
    this.persistQueue = this.persistQueue.then(
      () => atomicWrite(join(this.root, 'knowledge.json'), snapshot),
      () => atomicWrite(join(this.root, 'knowledge.json'), snapshot),
    );
    return this.persistQueue;
  }
  list() {
    return structuredClone(this.sources);
  }
  private source(id: string) {
    const source = this.sources.find((s) => s.id === id);
    if (!source) throw new Error('Knowledge source no longer exists');
    return source;
  }
  async add(type: KnowledgeSource['type'], location: string, collection = '') {
    if (type === 'url' && !['http:', 'https:'].includes(new URL(location).protocol))
      throw new Error('Only HTTP(S) URLs are supported');
    if (
      type === 'file' &&
      (ignored(location) || !supportedExtensions.has(extname(location).toLowerCase()))
    )
      throw new Error('Choose a supported text file. Sensitive files are excluded.');
    const now = Date.now();
    this.sources.push({
      id: randomUUID(),
      type,
      name: type === 'url' ? new URL(location).hostname : basename(location),
      location,
      collection,
      createdAt: now,
      updatedAt: now,
      status: 'idle',
      documentCount: 0,
      chunkCount: 0,
    });
    await this.persist();
  }
  async syncSavedText() {
    const id = 'saved-text';
    if (!this.sources.some((source) => source.id === id)) {
      const now = Date.now();
      this.sources.push({
        id,
        type: 'folder',
        name: 'Saved Text',
        location: join(this.root, 'saved-text'),
        collection: 'Saved Text',
        createdAt: now,
        updatedAt: now,
        status: 'idle',
        documentCount: 0,
        chunkCount: 0,
      });
      await this.persist();
    }
    if (this.jobs.has(id)) {
      this.pendingResync.add(id);
      this.stop(id);
      return;
    }
    await this.sync(id);
  }
  private tableName(model: string) {
    return `chunks_${hash(model).slice(0, 16)}`;
  }
  private async table(model: string) {
    const name = this.tableName(model);
    return (await this.db.tableNames()).includes(name) ? this.db.openTable(name) : null;
  }
  private async deleteVectors(id: string) {
    for (const name of await this.db.tableNames()) {
      const table = await this.db.openTable(name);
      await table.delete(`sourceId = '${id}'`);
    }
  }
  stop(id: string) {
    this.jobs.get(id)?.abort();
  }
  async stopAll() {
    this.pendingResync.clear();
    for (const c of this.jobs.values()) c.abort();
    await this.indexQueue;
  }
  async remove(id: string) {
    if (this.jobs.has(id))
      throw new Error('Cancel indexing and wait for it to stop before removing this source');
    this.source(id);
    await this.deleteVectors(id);
    await rm(join(this.root, 'cache', `${id}.md`), { force: true });
    await rm(join(this.root, 'cache', `${id}.json`), { force: true });
    this.sources = this.sources.filter((s) => s.id !== id);
    await this.persist();
  }
  async preview(id: string) {
    this.source(id);
    try {
      return await readFile(join(this.root, 'cache', `${id}.md`), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT')
        return 'No preview yet. Sync this source to fetch its content.';
      throw e;
    }
  }
  async sync(id: string) {
    if (this.jobs.has(id)) throw new Error('Source is already syncing');
    const source = this.source(id);
    const controller = new AbortController();
    this.jobs.set(id, controller);
    source.status = 'syncing';
    source.error = undefined;
    await this.persist();
    this.emit({ type: 'knowledge', id, status: 'syncing' });
    this.indexQueue = this.indexQueue.then(
      () => this.index(source, controller),
      () => this.index(source, controller),
    );
  }
  private async fetchURL(url: string, signal: AbortSignal) {
    const response = await fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      headers: { Accept: 'text/html,text/plain,text/markdown,application/json' },
    });
    if (!response.ok) throw new Error(`URL returned HTTP ${response.status}`);
    const type = response.headers.get('content-type') ?? '';
    if (!/text\/|json|xml/.test(type))
      throw new Error('URL must return text or HTML, not binary content');
    if (!response.body) throw new Error('URL has no body');
    const reader = response.body.getReader();
    const buffers: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 5_000_000) {
          await reader.cancel();
          throw new Error('URL content exceeds 5 MB limit');
        }
        buffers.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const text = Buffer.concat(buffers).toString('utf8');
    return type.includes('html')
      ? new Turndown({ headingStyle: 'atx', codeBlockStyle: 'fenced' })
          .remove(['script', 'style', 'nav', 'footer', 'form'])
          .turndown(text)
      : text;
  }
  private async index(source: KnowledgeSource, controller: AbortController) {
    const { signal } = controller;
    const settings = this.settings();
    const model = settings.embeddingModel;
    const cache = join(this.root, 'cache', `${source.id}.json`);
    const manifest = await readJSON<Record<string, string>>(cache, {});
    const next: Record<string, string> = {};
    let documents = 0,
      chunks = 0;
    const previews: string[] = [];
    try {
      if (!model) throw new Error('Select an embedding model in Settings before indexing');
      if (source.type === 'url' || source.embeddingModel !== model) {
        await this.deleteVectors(source.id);
        await rm(join(this.root, 'cache', `${source.id}.md`), { force: true });
        for (const key of Object.keys(manifest)) delete manifest[key];
      }
      source.status = 'indexing';
      await this.persist();
      let table = await this.table(model);
      const processDocument = async (
        location: string,
        content: string,
        title = basename(location),
      ) => {
        signal.throwIfAborted();
        documents++;
        const digest = hash(content + settings.chunkSize + ':' + settings.chunkOverlap);
        next[location] = digest;
        const parts = chunkText(content, settings.chunkSize, settings.chunkOverlap);
        chunks += parts.length;
        if (previews.join('').length < 500000)
          previews.push(`# ${title}\n\n${content.slice(0, 500000)}\n`);
        if (manifest[location] !== digest) {
          if (table)
            await table.delete(
              `sourceId = '${source.id}' AND location = '${location.replaceAll("'", "''")}'`,
            );
          for (let offset = 0; offset < parts.length; offset += 16) {
            signal.throwIfAborted();
            const batch = parts.slice(offset, offset + 16);
            const vectors = await this.embeddings.embedBatch(
              batch.map((c) => c.content),
              signal,
            );
            signal.throwIfAborted();
            const rows = batch.map((c, i) => ({
              id: randomUUID(),
              sourceId: source.id,
              name: title,
              location,
              ...c,
              vector: vectors[i],
              createdAt: Date.now(),
            }));
            if (rows.length) {
              if (table) await table.add(rows);
              else table = await this.db.createTable(this.tableName(model), rows);
            }
          }
        }
        this.emit({
          type: 'knowledge',
          id: source.id,
          status: 'indexing',
          content: `${documents} documents · ${chunks} chunks · ${basename(location)}`,
        });
      };
      if (source.type === 'url')
        await processDocument(source.location, await this.fetchURL(source.location, signal));
      else if (source.type === 'file') {
        if (!supportedExtensions.has(extname(source.location).toLowerCase()))
          throw new Error('Only .md and .txt files are allowed.');
        await processDocument(source.location, await readText(source.location));
      } else {
        for await (const file of walk(source.location, settings.ignorePatterns, signal)) {
          if (!supportedExtensions.has(extname(file).toLowerCase())) continue;
          const raw = await readText(file);
          if (source.id === 'saved-text') {
            const note = new LibraryService(this.root).parse(
              'saved-text',
              raw,
              basename(file, '.md'),
            );
            await processDocument(
              relative(source.location, file),
              `# ${note.name}\n\n${note.content}`,
              note.name,
            );
          } else await processDocument(relative(source.location, file), raw);
        }
      }
      if (table)
        for (const old of Object.keys(manifest))
          if (!next[old])
            await table.delete(
              `sourceId = '${source.id}' AND location = '${old.replaceAll("'", "''")}'`,
            );
      signal.throwIfAborted();
      await atomicWrite(
        join(this.root, 'cache', `${source.id}.md`),
        previews.join('\n---\n').slice(0, 600000),
      );
      await atomicWrite(cache, JSON.stringify(next));
      Object.assign(source, {
        status: 'ready',
        documentCount: documents,
        chunkCount: chunks,
        lastSyncedAt: Date.now(),
        embeddingModel: model,
      });
    } catch (e) {
      await this.deleteVectors(source.id);
      await rm(cache, { force: true });
      await rm(join(this.root, 'cache', `${source.id}.md`), { force: true });
      source.status = 'error';
      source.chunkCount = 0;
      source.error = signal.aborted ? 'Indexing cancelled. Sync to retry.' : errorMessage(e);
    } finally {
      source.updatedAt = Date.now();
      this.jobs.delete(source.id);
      await this.persist();
      this.emit({ type: 'knowledge', id: source.id, status: source.status, error: source.error });
      if (this.pendingResync.delete(source.id)) await this.sync(source.id);
    }
  }
  async search(
    query: string,
    mode: 'semantic' | 'keyword',
    scope = 'all',
  ): Promise<SearchResult[]> {
    const settings = this.settings();
    const eligible = this.sources.filter(
      (s) =>
        s.status === 'ready' &&
        (scope === 'all' || s.id === scope || scope === `collection:${s.collection}`),
    );
    if (!eligible.length) return [];
    const table = await this.table(settings.embeddingModel);
    if (!table) return [];
    const ids = eligible.map((s) => `'${s.id}'`).join(',');
    const where = `sourceId IN (${ids})`;
    if (mode === 'semantic') {
      const vector = await this.embeddings.embed(query);
      const rows = await table.vectorSearch(vector).where(where).limit(settings.topK).toArray();
      return rows.map((r) => ({
        id: r.id,
        sourceId: r.sourceId,
        name: r.name,
        location: r.location,
        content: r.content,
        score: 1 / (1 + Math.max(0, r._distance ?? 0)),
      }));
    }
    const escaped = query.replaceAll("'", "''");
    const rows = await table
      .query()
      .where(`${where} AND strpos(lower(content), '${escaped.toLowerCase()}') > 0`)
      .limit(settings.topK)
      .toArray();
    return rows.map((r) => ({
      id: r.id,
      sourceId: r.sourceId,
      name: r.name,
      location: r.location,
      content: r.content,
      score: 1,
    }));
  }
}
