import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../src/main/services/filesystem/library';
import { readBuiltInDefaults } from '../src/main/services/filesystem/built-in';
import { SettingsService } from '../src/main/services/settings/settings';
import { KnowledgeService } from '../src/main/services/rag/knowledge';
import { librarySchema, settingsSchema } from '../src/shared/schemas';
import { generateToolSource, toolExamples } from '../src/shared/tool-definition';
import { toolItemFromSource } from '../src/main/services/tools/files';
import { CustomToolService } from '../src/main/services/tools/custom';

const roots: string[] = [];
async function temporary() {
  const root = await mkdtemp(join(tmpdir(), 'built-in-'));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it('loads every library kind without copying, protects originals, and picks up release updates', async () => {
  const bundleRoot = await temporary();
  const userRoot = await temporary();
  const author = new LibraryService(bundleRoot);
  const library = new LibraryService(userRoot);
  for (const kind of ['agents', 'skills', 'mcp', 'tools'] as const) {
    const item =
      kind === 'tools'
        ? toolItemFromSource(generateToolSource(toolExamples.calculator), { id: 'builtin-example' })
        : librarySchema.parse({
            id: 'builtin-example',
            name: 'Bundled example',
            content: 'Instructions',
            command: 'node',
          });
    await author.save(kind, item);
    await library.save(kind, { ...item, id: 'personal', name: 'Personal example' });
  }
  await library.loadBuiltIns(bundleRoot);
  for (const kind of ['agents', 'skills', 'mcp', 'tools'] as const) {
    expect(await library.list(kind)).toHaveLength(2);
    const item = await library.get(kind, 'builtin-example');
    expect(item).toMatchObject({ builtIn: true, group: 'Built-in' });
    await expect(library.save(kind, { ...item, name: 'Changed' })).rejects.toThrow('Built-in');
    await expect(library.remove(kind, item.id)).rejects.toThrow('Built-in');
    await expect(library.setGroup(kind, ['personal', item.id], 'Moved')).rejects.toThrow(
      'Built-in',
    );
    expect((await library.get(kind, 'personal')).group).toBe('');
    await expect(readFile(library.path(kind, item.id))).rejects.toMatchObject({ code: 'ENOENT' });
    item.name = 'Changed locally';
    expect((await library.get(kind, item.id)).name).not.toBe('Changed locally');
  }
  const tools = new CustomToolService(library, { resolve: () => '', redact: (s) => s }, () => 3000);
  try {
    expect(await tools.run('builtin-example', { a: 2, b: 3, operation: 'add' })).toBe('5');
  } finally {
    tools.stopAll();
  }
  await author.save('agents', {
    ...(await author.get('agents', 'builtin-example')),
    name: 'Updated release',
  });
  await library.loadBuiltIns(bundleRoot);
  expect((await library.get('agents', 'builtin-example')).name).toBe('Updated release');
  await author.remove('agents', 'builtin-example');
  await library.loadBuiltIns(bundleRoot);
  expect((await library.list('agents')).map((item) => item.id)).toEqual(['personal']);
});

it('applies bundled General and Landing defaults only on first install', async () => {
  const bundle = await temporary();
  const root = await temporary();
  await writeFile(
    join(bundle, 'general.json'),
    JSON.stringify({ appName: 'Team App', theme: 'light' }),
  );
  await writeFile(join(bundle, 'landing.json'), JSON.stringify({ title: 'Welcome to Team App' }));
  const defaults = await readBuiltInDefaults(bundle);
  const settings = new SettingsService(root, undefined, undefined, defaults);
  await settings.init();
  expect(settings.get()).toMatchObject({
    appName: 'Team App',
    theme: 'light',
    landing: { title: 'Welcome to Team App' },
  });
  await settings.save({ ...settings.get(), appName: 'Personal name' });
  const restarted = new SettingsService(root, undefined, undefined, {
    ...defaults,
    appName: 'New release name',
  });
  await restarted.init();
  expect(restarted.get().appName).toBe('Personal name');
  await writeFile(join(bundle, 'general.json'), JSON.stringify({ apiKey: 'must-not-distribute' }));
  await expect(readBuiltInDefaults(bundle)).rejects.toThrow();
});

it('registers bundled knowledge, previews before indexing, and protects its source', async () => {
  const bundle = await temporary();
  const root = await temporary();
  await mkdir(join(bundle, 'product-guide'));
  await writeFile(
    join(bundle, 'product-guide', 'intro.md'),
    '# Product guide\nFind the launch button.',
  );
  const settings = () => settingsSchema.parse({ embeddingModel: 'fixture' });
  const kb = new KnowledgeService(
    root,
    settings,
    {
      embed: async () => [1, 2, 3],
      embedBatch: async (texts) => texts.map(() => [1, 2, 3]),
    },
    () => {},
  );
  await kb.init();
  await kb.loadBuiltIns(bundle);
  const [source] = kb.list();
  expect(source).toMatchObject({
    id: 'builtin-kb-product-guide',
    builtIn: true,
    group: 'Built-in',
    status: 'idle',
  });
  expect(await kb.preview(source.id)).toContain('launch button');
  await expect(kb.remove(source.id)).rejects.toThrow('Built-in');
  await expect(kb.setGroup([source.id], 'Moved')).rejects.toThrow('Built-in');
  try {
    await kb.sync(source.id);
    await expect.poll(() => kb.list()[0].status).toBe('ready');
    expect(await kb.search('launch', 'keyword')).toHaveLength(1);
    await kb.loadBuiltIns(bundle);
    expect(kb.list()).toHaveLength(1);
    expect(kb.list()[0].status).toBe('ready');
    await rm(join(bundle, 'product-guide'), { recursive: true });
    await kb.loadBuiltIns(bundle);
    expect(kb.list()).toEqual([]);
    expect(await kb.search('launch', 'keyword')).toEqual([]);
  } finally {
    await kb.stopAll();
  }
});
