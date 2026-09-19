import { it, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentTools, safePath } from '../src/main/services/agents/tools';
import { settingsSchema } from '../src/shared/schemas';
import { hash } from '../src/main/services/filesystem/storage';
it('rejects traversal, symlinks, secrets and shell injection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-tools-'));
  await symlink(tmpdir(), join(root, 'escape'));
  for (const path of ['../outside', '.env', 'escape/file'])
    await expect(safePath(root, path)).rejects.toThrow();
  const tools = new AgentTools(() => settingsSchema.parse({}));
  await expect(
    tools.execute(
      'shell.execute',
      { command: 'sh', args: ['-c', 'echo bad'] },
      root,
      new AbortController().signal,
      async () => true,
    ),
  ).rejects.toThrow();
  await rm(root, { recursive: true, force: true });
});
it('requires approval and rejects files changed while review was open', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-write-'));
  const path = join(root, 'file.txt');
  await writeFile(path, 'original');
  const tools = new AgentTools(() => settingsSchema.parse({}));
  const args = { path: 'file.txt', content: 'new', expectedHash: hash('original') };
  const signal = new AbortController().signal;
  expect(await tools.execute('filesystem.write', args, root, signal, async () => false)).toEqual({
    rejected: true,
  });
  expect(await readFile(path, 'utf8')).toBe('original');
  await expect(
    tools.execute('filesystem.write', args, root, signal, async (_tool, _description, diff) => {
      expect(diff).toContain('+new');
      await writeFile(path, 'external change');
      return true;
    }),
  ).rejects.toThrow('changed');
  expect(await readFile(path, 'utf8')).toBe('external change');
  await tools.execute(
    'filesystem.write',
    { ...args, expectedHash: hash('external change') },
    root,
    signal,
    async () => true,
  );
  expect(await readFile(path, 'utf8')).toBe('new');
  await rm(root, { recursive: true, force: true });
});
it('applies replacement content literally, including dollar substitution characters', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-literal-'));
  const path = join(root, 'file.txt');
  await writeFile(path, 'original');
  try {
    const tools = new AgentTools(() => settingsSchema.parse({}));
    await tools.execute(
      'filesystem.edit',
      { path: 'file.txt', find: 'original', replace: '$& $$ $1', expectedHash: hash('original') },
      root,
      new AbortController().signal,
      async () => true,
    );
    expect(await readFile(path, 'utf8')).toBe('$& $$ $1');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
