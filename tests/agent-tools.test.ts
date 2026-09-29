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

it('always reviews individual file deletion and rejects stale content or directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-delete-'));
  const path = join(root, 'obsolete.txt');
  const tools = new AgentTools(() => settingsSchema.parse({ approvalMode: 'auto' }));
  const signal = new AbortController().signal;
  const args = { path: 'obsolete.txt', expectedHash: hash('old') };
  try {
    await writeFile(path, 'old');
    expect(
      await tools.execute(
        'filesystem.delete',
        args,
        root,
        signal,
        async () => false,
        'always_allow',
      ),
    ).toEqual({ rejected: true });
    expect(await readFile(path, 'utf8')).toBe('old');
    await expect(
      tools.execute('filesystem.delete', args, root, signal, async (_tool, _reason, diff) => {
        expect(diff).toContain('-old');
        await writeFile(path, 'changed');
        return true;
      }),
    ).rejects.toThrow('changed');
    await expect(
      tools.execute(
        'filesystem.delete',
        { path: '.', expectedHash: hash('') },
        root,
        signal,
        async () => true,
      ),
    ).rejects.toThrow('individual files');
    expect(
      await tools.execute(
        'filesystem.delete',
        { ...args, expectedHash: hash('changed') },
        root,
        signal,
        async () => true,
      ),
    ).toMatchObject({ deleted: true });
    await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('requires approval for broader commands and confines their working directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-command-'));
  const tools = new AgentTools(() => settingsSchema.parse({ approvalMode: 'auto' }));
  const signal = new AbortController().signal;
  try {
    const args = {
      command: 'node',
      args: ['-e', 'process.stdout.write(process.cwd())'],
      reason: 'Check command working directory',
    };
    expect(
      await tools.execute('shell.execute', args, root, signal, async () => false, 'always_allow'),
    ).toEqual({ rejected: true });
    const result = await tools.execute(
      'shell.execute',
      args,
      root,
      signal,
      async (_tool, description) => {
        expect(description).toContain(root);
        expect(description).toContain(args.reason);
        return true;
      },
    );
    expect(result).toMatchObject({ exitCode: 0 });
    await expect(
      tools.execute('shell.execute', { ...args, cwd: '..' }, root, signal, async () => true),
    ).rejects.toThrow('outside');
    expect(
      await tools.execute(
        'shell.execute',
        { command: 'pnpm', args: ['run', 'format'] },
        root,
        signal,
        async () => false,
      ),
    ).toEqual({ rejected: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
