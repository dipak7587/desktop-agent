import { it, expect } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { KnowledgeService } from '../src/main/services/rag/knowledge';
import { settingsSchema } from '../src/shared/schemas';
import type { AppEvent } from '../src/shared/types';
import { OllamaLLMProvider, OllamaEmbeddingProvider } from '../src/main/services/ollama/provider';
it('indexes real LanceDB vectors, replaces URL content, skips unchanged files and removes sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rag-integration-'));
  let page =
    '<html><body><h1>Authentication</h1><p>obsoleteword sessions expire in one hour.</p></body></html>';
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(page);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address() as { port: number };
  const settings = () => settingsSchema.parse({ embeddingModel: 'nomic-embed-text:latest' });
  const real = new OllamaEmbeddingProvider(new OllamaLLMProvider(settings), settings);
  let calls = 0;
  const embedding = {
    embed: async (text: string) =>
      process.env.LOCALAI_LIVE_TEST ? real.embed(text) : [text.length % 7, 1, 2],
    embedBatch: async (texts: string[]) => {
      calls++;
      return process.env.LOCALAI_LIVE_TEST
        ? real.embedBatch(texts)
        : texts.map((t) => [t.length % 7, 1, 2]);
    },
  };
  const events: AppEvent[] = [];
  const kb = new KnowledgeService(root, settings, embedding, (e) => events.push(e));
  await kb.init();
  const finish = async (id: string) => {
    await kb.sync(id);
    await expect
      .poll(() => kb.list().find((s) => s.id === id)?.status, { timeout: 90000 })
      .not.toMatch(/syncing|indexing/);
    expect(kb.list().find((s) => s.id === id)?.error).toBeUndefined();
  };
  try {
    await kb.add('url', `http://127.0.0.1:${address.port}`);
    const id = kb.list()[0].id;
    await finish(id);
    expect(await kb.preview(id)).toContain('# Authentication');
    expect(await kb.search('obsoleteword', 'keyword')).toHaveLength(1);
    expect(await kb.search('authentication', 'semantic')).toHaveLength(1);
    page =
      '<html><body><h1>Authentication</h1><p>replacementword sessions expire in two hours.</p></body></html>';
    await finish(id);
    expect(await kb.search('obsoleteword', 'keyword')).toHaveLength(0);
    expect(await kb.search('replacementword', 'keyword')).toHaveLength(1);
    await kb.remove(id);
    expect(await kb.search('replacementword', 'keyword')).toEqual([]);
    const folder = join(root, 'docs');
    await mkdir(folder);
    await writeFile(join(folder, 'doc.md'), '# Project\nAuthentication uses session tokens.');
    await writeFile(join(folder, '.env'), 'SECRET=do not index');
    await kb.add('folder', folder);
    const fileId = kb.list()[0].id;
    await finish(fileId);
    const previous = calls;
    await finish(fileId);
    expect(calls).toBe(previous);
    expect(kb.list()[0].documentCount).toBe(1);
    await kb.remove(fileId);
    expect(kb.list()).toHaveLength(0);
  } finally {
    server.close();
    await rm(root, { recursive: true, force: true });
  }
}, 120000);
