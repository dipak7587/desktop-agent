import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentTools, safePath } from '../src/main/services/agents/tools';
import { settingsSchema } from '../src/shared/schemas';
import { hash } from '../src/main/services/filesystem/storage';

function git(root: string, ...args: string[]) {
  return execFileSync('git', ['-c', 'safe.bareRepository=all', '-C', root, ...args], {
    encoding: 'utf8',
  }).trim();
}

function initGit(root: string) {
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Agent test');
  git(root, 'config', 'user.email', 'agent-test@example.invalid');
  git(root, 'branch', '-M', 'main');
}

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

it('stages only explicitly selected files after approval', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-git-add-'));
  const tools = new AgentTools(() => settingsSchema.parse({ approvalMode: 'auto' }));
  const signal = new AbortController().signal;
  try {
    initGit(root);
    await writeFile(join(root, 'selected.txt'), 'before\n');
    await writeFile(join(root, 'unrelated.txt'), 'before\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-m', 'initial');
    await writeFile(join(root, 'selected.txt'), 'selected update\n');
    await writeFile(join(root, 'unrelated.txt'), 'unrelated update\n');
    const args = { paths: ['selected.txt'] };

    expect(
      await tools.execute(
        'git.add',
        args,
        root,
        signal,
        async (tool, description) => {
          expect(tool).toBe('git.add');
          expect(description).toContain('selected.txt');
          return false;
        },
        'always_allow',
      ),
    ).toEqual({ rejected: true });
    expect(git(root, 'diff', '--cached', '--name-only')).toBe('');

    expect(await tools.execute('git.add', args, root, signal, async () => true)).toMatchObject({
      exitCode: 0,
    });
    expect(git(root, 'diff', '--cached', '--name-only')).toBe('selected.txt');
    expect(git(root, 'status', '--short')).toContain(' M unrelated.txt');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('commits only explicitly selected files after approval', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-git-commit-'));
  const tools = new AgentTools(() => settingsSchema.parse({ approvalMode: 'auto' }));
  const signal = new AbortController().signal;
  try {
    initGit(root);
    await writeFile(join(root, 'selected.txt'), 'before\n');
    await writeFile(join(root, 'unrelated.txt'), 'before\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-m', 'initial');
    await writeFile(join(root, 'selected.txt'), 'selected update\n');
    await writeFile(join(root, 'unrelated.txt'), 'unrelated update\n');
    git(root, 'add', '--', 'unrelated.txt');
    const before = git(root, 'rev-parse', 'HEAD');
    const args = { message: 'Update selected file', paths: ['selected.txt'] };

    expect(
      await tools.execute(
        'git.commit',
        args,
        root,
        signal,
        async (tool, description) => {
          expect(tool).toBe('git.commit');
          expect(description).toContain('selected.txt');
          return false;
        },
        'always_allow',
      ),
    ).toEqual({ rejected: true });
    expect(git(root, 'rev-parse', 'HEAD')).toBe(before);

    const result = await tools.execute(
      'git.commit',
      args,
      root,
      signal,
      async (_tool, description) => {
        expect(description).toContain('Update selected file');
        return true;
      },
    );
    expect(result).toMatchObject({ exitCode: 0 });
    expect(git(root, 'show', '--format=', '--name-only', 'HEAD')).toBe('selected.txt');
    expect(git(root, 'diff', '--cached', '--name-only')).toBe('unrelated.txt');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('pushes only after explicit approval to the configured upstream', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-git-push-'));
  const remote = join(root, 'remote.git');
  const repository = join(root, 'repo');
  const tools = new AgentTools(() => settingsSchema.parse({ approvalMode: 'auto' }));
  const signal = new AbortController().signal;
  try {
    git(root, 'init', '--bare', '-q', remote);
    await mkdir(repository);
    initGit(repository);
    await writeFile(join(repository, 'tracked.txt'), 'initial\n');
    git(repository, 'add', '-A');
    git(repository, 'commit', '-m', 'initial');
    git(repository, 'remote', 'add', 'origin', remote);
    git(repository, 'push', '-u', 'origin', 'main');
    const before = git(remote, 'rev-parse', 'refs/heads/main');
    await writeFile(join(repository, 'tracked.txt'), 'next\n');
    git(repository, 'add', '-A');
    git(repository, 'commit', '-m', 'next');

    expect(
      await tools.execute(
        'git.push',
        {},
        repository,
        signal,
        async (tool, description) => {
          expect(tool).toBe('git.push');
          expect(description).toContain('main');
          expect(description).toContain('origin:refs/heads/main');
          return false;
        },
        'always_allow',
      ),
    ).toEqual({ rejected: true });
    expect(git(remote, 'rev-parse', 'refs/heads/main')).toBe(before);

    expect(await tools.execute('git.push', {}, repository, signal, async () => true)).toMatchObject(
      { exitCode: 0 },
    );
    expect(git(remote, 'rev-parse', 'refs/heads/main')).toBe(git(repository, 'rev-parse', 'HEAD'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
