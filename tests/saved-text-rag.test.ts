import { it, expect } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KnowledgeService } from '../src/main/services/rag/knowledge';
import { LibraryService } from '../src/main/services/filesystem/library';
import { settingsSchema, librarySchema } from '../src/shared/schemas';

it('saved text is indexed, replaced on edit and removed on deletion without embedding metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'saved-rag-'));
  await mkdir(join(root, 'saved-text'));
  const embedded: string[] = [];
  const kb = new KnowledgeService(
    root,
    () => settingsSchema.parse({ embeddingModel: 'test' }),
    {
      embed: async () => [1, 2, 3],
      embedBatch: async (texts) => {
        embedded.push(...texts);
        return texts.map(() => [1, 2, 3]);
      },
    },
    () => {},
  );
  await kb.init();
  const library = new LibraryService(root, () => kb.syncSavedText());
  const settle = async () => {
    await expect.poll(() => kb.list().find((s) => s.id === 'saved-text')?.status).toBe('ready');
  };
  try {
    const item = librarySchema.parse({
      id: 'note',
      name: 'Release handbook',
      content: 'obsoleteword release on Monday',
    });
    await library.save('saved-text', item);
    await settle();
    expect((await kb.search('obsoleteword', 'keyword'))[0].name).toBe('Release handbook');
    expect(embedded.join('')).not.toContain('createdAt:');
    await library.save('saved-text', {
      ...item,
      name: 'New handbook',
      content: 'replacementword release on Tuesday',
    });
    await settle();
    expect(await kb.search('obsoleteword', 'keyword')).toEqual([]);
    expect((await kb.search('replacementword', 'semantic'))[0].name).toBe('New handbook');
    await library.remove('saved-text', item.id);
    await settle();
    expect(await kb.search('replacementword', 'keyword')).toEqual([]);
    expect(kb.list()[0].chunkCount).toBe(0);
  } finally {
    await kb.stopAll();
    await rm(root, { recursive: true, force: true });
  }
});

it('folder sources index only Markdown and TXT files, recursively', async () => {
  const root = await mkdtemp(join(tmpdir(), 'folder-types-'));
  const docs = join(root, 'docs');
  await mkdir(join(docs, 'nested'), { recursive: true });
  const kb = new KnowledgeService(
    root,
    () => settingsSchema.parse({ embeddingModel: 'test' }),
    { embed: async () => [1, 2, 3], embedBatch: async (texts) => texts.map(() => [1, 2, 3]) },
    () => {},
  );
  await kb.init();
  try {
    await writeFile(join(docs, 'readme.md'), 'markdownword');
    await writeFile(join(docs, 'nested', 'NOTES.TXT'), 'textword');
    for (const ext of ['json', 'yaml', 'yml', 'csv', 'js', 'pdf'])
      await writeFile(join(docs, `ignored.${ext}`), 'excludedword');
    await kb.add('folder', docs);
    const id = kb.list()[0].id;
    await kb.sync(id);
    await expect.poll(() => kb.list()[0].status).toBe('ready');
    expect(kb.list()[0].documentCount).toBe(2);
    expect(await kb.search('excludedword', 'keyword')).toEqual([]);
    expect(await kb.search('textword', 'keyword')).toHaveLength(1);
    await expect(kb.add('file', join(docs, 'ignored.json'))).rejects.toThrow('supported text');
  } finally {
    await kb.stopAll();
    await rm(root, { recursive: true, force: true });
  }
});

it('retains saved text when no embedding model is configured', async () => {
  const root = await mkdtemp(join(tmpdir(), 'saved-rag-offline-'));
  await mkdir(join(root, 'saved-text'));
  const kb = new KnowledgeService(
    root,
    () => settingsSchema.parse({}),
    { embed: async () => [], embedBatch: async () => [] },
    () => {},
  );
  await kb.init();
  const library = new LibraryService(root, () => kb.syncSavedText());
  try {
    await library.save(
      'saved-text',
      librarySchema.parse({ id: 'offline-note', name: 'Offline note', content: 'Keep this note' }),
    );
    await expect.poll(() => kb.list()[0]?.status).toBe('error');
    expect((await library.get('saved-text', 'offline-note')).content).toBe('Keep this note');
    expect(kb.list()[0].error).toContain('embedding model');
  } finally {
    await kb.stopAll();
    await rm(root, { recursive: true, force: true });
  }
});
