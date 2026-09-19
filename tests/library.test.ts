import { it, expect } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../src/main/services/filesystem/library';
import { librarySchema, settingsSchema } from '../src/shared/schemas';
it('round trips saved text and skills as portable markdown, with edits and delete', async () => {
  const root = await mkdtemp(join(tmpdir(), 'library-'));
  const lib = new LibraryService(root);
  for (const kind of ['saved-text', 'skills', 'agents', 'mcp'] as const) {
    await mkdir(join(root, kind));
    const item = librarySchema.parse({
      id: 'example',
      name: 'Example',
      description: 'Example definition',
      content: '# Useful\n\nInstructions',
      command: 'node',
      env: { TOKEN: '${TOKEN}' },
    });
    await lib.save(kind, item);
    expect((await lib.list(kind))[0].name).toBe('Example');
    if (kind === 'saved-text')
      expect(await readFile(lib.path(kind, item.id), 'utf8')).toContain('title: Example');
    await lib.save(kind, { ...item, name: 'Edited' });
    expect((await lib.get(kind, item.id)).name).toBe('Edited');
    await lib.remove(kind, item.id);
    expect(await lib.list(kind)).toEqual([]);
  }
  await rm(root, { recursive: true, force: true });
});
it('rejects path traversal, literal secrets and invalid chunking', () => {
  expect(() => librarySchema.parse({ id: '../outside', name: 'Bad' })).toThrow();
  expect(() => librarySchema.parse({ id: 'ok', name: 'Bad', env: { TOKEN: 'secret' } })).toThrow();
  expect(() => settingsSchema.parse({ chunkSize: 200, chunkOverlap: 200 })).toThrow();
});
it('rejects executable frontmatter engines', () => {
  const library = new LibraryService('/unused');
  expect(() => library.parse('skills', '---javascript\n({name:"malicious"})\n---\ntext')).toThrow(
    'YAML frontmatter',
  );
});
