import { it, expect } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../src/main/services/filesystem/library';
import { librarySchema, settingsSchema } from '../src/shared/schemas';
it.each(['agents', 'mcp', 'skills', 'tools', 'saved-text'] as const)(
  'persists portable groups for %s without changing definitions',
  async (kind) => {
    const root = await mkdtemp(join(tmpdir(), 'library-groups-'));
    const library = new LibraryService(root);
    try {
      const original = await library.save(
        kind,
        librarySchema.parse({
          id: 'one',
          name: 'One',
          description: 'Group fixture',
          content: kind === 'mcp' ? '' : 'return input;',
          env: { TOKEN: '${TOKEN}' },
          tools: ['filesystem.read'],
          toolConfig: kind === 'tools' ? { type: 'javascript', parameters: [] } : undefined,
        }),
      );
      await library.save(kind, { ...original, id: 'two', name: 'Two' });
      await expect(library.setGroup(kind, ['one', 'missing'], 'Video')).rejects.toThrow();
      expect((await library.get(kind, 'one')).group).toBe('');
      await library.setGroup(kind, ['one', 'two'], '  Video Studio  ');
      const reloaded = new LibraryService(root);
      expect((await reloaded.list(kind)).map((item) => item.group)).toEqual([
        'Video Studio',
        'Video Studio',
      ]);
      const updated = await reloaded.get(kind, 'one');
      expect(updated).toEqual({ ...original, group: 'Video Studio', updatedAt: updated.updatedAt });
      expect(reloaded.parse(kind, reloaded.serialize(kind, updated), 'imported').group).toBe(
        'Video Studio',
      );
      await reloaded.setGroup(kind, ['one'], 'Research');
      expect((await reloaded.get(kind, 'one')).group).toBe('Research');
      expect((await reloaded.get(kind, 'two')).group).toBe('Video Studio');
      await reloaded.setGroup(kind, ['one'], '');
      expect((await reloaded.get(kind, 'one')).group).toBe('');
      expect((await reloaded.get(kind, 'two')).group).toBe('Video Studio');
      await expect(reloaded.setGroup(kind, ['../outside'], 'Video')).rejects.toThrow();
      await expect(reloaded.setGroup(kind, ['one'], 'x'.repeat(101))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
it('round trips saved text and skills as portable markdown, with edits and delete', async () => {
  const root = await mkdtemp(join(tmpdir(), 'library-'));
  const lib = new LibraryService(root);
  for (const kind of ['saved-text', 'skills', 'agents', 'mcp'] as const) {
    await mkdir(join(root, kind), { recursive: true });
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
it('rejects path traversal, invalid environment names and invalid chunking', () => {
  expect(() => librarySchema.parse({ id: '../outside', name: 'Bad' })).toThrow();
  expect(() =>
    librarySchema.parse({ id: 'ok', name: 'Bad', env: { 'INVALID-NAME': 'value' } }),
  ).toThrow();
  expect(() => settingsSchema.parse({ chunkSize: 200, chunkOverlap: 200 })).toThrow();
});
it('rejects executable frontmatter engines', () => {
  const library = new LibraryService('/unused');
  expect(() => library.parse('skills', '---javascript\n({name:"malicious"})\n---\ntext')).toThrow(
    'YAML frontmatter',
  );
});

it('accepts execution iteration limits through 500 for settings and agents', () => {
  for (const maxIterations of [1, 50, 51, 500]) {
    expect(settingsSchema.parse({ maxIterations }).maxIterations).toBe(maxIterations);
    expect(librarySchema.parse({ id: 'agent', name: 'Agent', maxIterations }).maxIterations).toBe(
      maxIterations,
    );
  }
  for (const maxIterations of [0, 501, 1.5]) {
    expect(() => settingsSchema.parse({ maxIterations })).toThrow();
    expect(() => librarySchema.parse({ id: 'agent', name: 'Agent', maxIterations })).toThrow();
  }
});
