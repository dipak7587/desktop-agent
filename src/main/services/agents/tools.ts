import { lstat, realpath, readFile, readdir, mkdir } from 'node:fs/promises';
import { resolve, relative, join, dirname, isAbsolute, sep, extname, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { createTwoFilesPatch } from 'diff';
import { z } from 'zod';
import { hash, atomicWrite } from '../filesystem/storage';
import { ignored, walk, readText } from '../filesystem/walk';
import type { Settings } from '../../../shared/types';
export const localTools = [
  'filesystem.read',
  'filesystem.write',
  'filesystem.edit',
  'filesystem.list',
  'filesystem.search',
  'filesystem.exists',
  'project.detect',
  'git.status',
  'git.diff',
  'git.log',
  'shell.execute',
];
export type Approve = (tool: string, description: string, diff?: string) => Promise<boolean>;
export async function safePath(root: string, input: string) {
  const base = await realpath(root);
  const target = resolve(base, input || '.');
  const rel = relative(base, target);
  if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel) || ignored(rel))
    throw new Error('Path is outside the workspace or is protected');
  let current = base;
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error('Symbolic links are not allowed in agent paths');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  return target;
}
export async function runCommand(
  executable: string,
  args: string[],
  cwd: string,
  timeout: number,
  signal: AbortSignal,
) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number | null; duration: number }>(
    (resolvePromise, reject) => {
      const started = Date.now();
      let stdout = '',
        stderr = '',
        settled = false;
      const child = spawn(executable, args, {
        cwd,
        shell: false,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
          LANG: process.env.LANG,
        },
        signal,
        timeout,
        killSignal: 'SIGKILL',
      });
      child.stdout.on('data', (b) => {
        stdout = (stdout + b.toString()).slice(-50000);
      });
      child.stderr.on('data', (b) => {
        stderr = (stderr + b.toString()).slice(-50000);
      });
      child.on('error', (e) => {
        settled = true;
        reject(e);
      });
      child.on('close', (code, termination) => {
        if (!settled) {
          if (termination && !signal.aborted)
            stderr += `\nTerminated (${termination}); command may have timed out.`;
          resolvePromise({ stdout, stderr, exitCode: code, duration: Date.now() - started });
        }
      });
    },
  );
}
export class AgentTools {
  constructor(private settings: () => Settings) {}
  async execute(
    tool: string,
    args: Record<string, unknown>,
    root: string,
    signal: AbortSignal,
    approve: Approve,
  ): Promise<unknown> {
    signal.throwIfAborted();
    const pathArg = z
      .string()
      .max(4096)
      .parse(args.path ?? '.');
    const target = await safePath(root, pathArg);
    switch (tool) {
      case 'filesystem.read': {
        const content = await readText(target, 200000);
        return { path: pathArg, content, hash: hash(content) };
      }
      case 'filesystem.exists':
        try {
          await lstat(target);
          return { exists: true };
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT')
            return { exists: false, hash: 'missing' };
          throw e;
        }
      case 'filesystem.list':
        return (await readdir(target, { withFileTypes: true }))
          .filter((e) => !e.isSymbolicLink() && !ignored(e.name))
          .slice(0, 500)
          .map((e) => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' }));
      case 'project.detect': {
        const result: Record<string, unknown> = {
          entries: (await readdir(root)).filter((n) => !ignored(n)).slice(0, 100),
        };
        for (const name of ['package.json', 'README.md', 'AGENTS.md']) {
          try {
            result[name] = await readText(await safePath(root, name), 30000);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') result[name] = (e as Error).message;
          }
        }
        return result;
      }
      case 'filesystem.search': {
        const query = z.string().min(1).max(300).parse(args.query);
        const results: { path: string; line: number; content: string }[] = [];
        for await (const file of walk(root, this.settings().ignorePatterns, signal)) {
          if (results.length >= 60) break;
          try {
            const content = await readText(file, 150000);
            const lines = content.split('\n');
            for (let i = 0; i < lines.length && results.length < 60; i++)
              if (lines[i].toLowerCase().includes(query.toLowerCase()))
                results.push({
                  path: relative(root, file),
                  line: i + 1,
                  content: lines[i].slice(0, 500),
                });
          } catch (e) {
            if ((e as Error).message.includes('limit') || (e as Error).message.includes('Binary'))
              continue;
            throw e;
          }
        }
        return results;
      }
      case 'filesystem.write':
      case 'filesystem.edit': {
        const expected = z.string().min(1).parse(args.expectedHash);
        let original: string;
        try {
          original = await readText(target, 1_000_000);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
          original = '';
          if (expected !== 'missing')
            throw new Error('File does not exist. Use expectedHash: missing.');
        }
        const actual = await this.currentHash(target);
        if (actual !== expected)
          throw new Error(
            'File changed since it was read. Read it again before proposing a change.',
          );
        let content: string;
        if (tool === 'filesystem.edit') {
          const find = z.string().min(1).parse(args.find);
          const replacement = z.string().parse(args.replace);
          if (original.split(find).length !== 2)
            throw new Error('Edit text must match exactly once');
          content = original.replace(find, () => replacement);
        } else content = z.string().max(1_000_000).parse(args.content);
        const diff = createTwoFilesPatch(pathArg, pathArg, original, content);
        const mode = this.settings().approvalMode;
        const safeExtension = [
          '.md',
          '.txt',
          '.css',
          '.tsx',
          '.ts',
          '.jsx',
          '.js',
          '.html',
          '.json',
          '.yaml',
          '.yml',
        ].includes(extname(target));
        const sensitiveConfig =
          /^(package|tsconfig|vite|electron|eslint|\.npmrc|\.pnpmfile|Makefile|Dockerfile)/i.test(
            basename(target),
          );
        if (
          (mode === 'ask' || (mode === 'safe' && (!safeExtension || sensitiveConfig))) &&
          !(await approve(tool, `Apply change to ${pathArg}`, diff))
        )
          return { rejected: true };
        signal.throwIfAborted();
        await safePath(root, pathArg);
        if ((await this.currentHash(target)) !== expected)
          throw new Error('File changed while awaiting approval; modification aborted');
        await mkdir(dirname(target), { recursive: true });
        await atomicWrite(target, content);
        const verified = await readFile(target, 'utf8');
        if (hash(verified) !== hash(content))
          throw new Error('File changed during write verification');
        return { path: pathArg, hash: hash(content), diff, applied: true };
      }
      case 'git.status':
      case 'git.diff':
      case 'git.log': {
        const gitArgs: Record<string, string[]> = {
          'git.status': ['--no-optional-locks', 'status', '--short'],
          'git.diff': ['--no-pager', 'diff', '--no-ext-diff', '--no-textconv'],
          'git.log': ['--no-pager', 'log', '-10', '--oneline'],
        };
        return runCommand('git', gitArgs[tool], root, this.settings().commandTimeout, signal);
      }
      case 'shell.execute': {
        const command = z.enum(['npm', 'pnpm', 'yarn']).parse(args.command);
        const commandArgs = z.array(z.string()).min(1).max(2).parse(args.args);
        const action = commandArgs[0] === 'run' ? commandArgs[1] : commandArgs[0];
        if (
          !['test', 'lint', 'build', 'typecheck'].includes(action) ||
          !(commandArgs.length === 1 || commandArgs[0] === 'run')
        )
          throw new Error('Only test, lint, build and typecheck scripts are allowed');
        const description = `${command} ${commandArgs.join(' ')} in ${root}. Project scripts can execute arbitrary code.`;
        if (this.settings().approvalMode !== 'auto' && !(await approve(tool, description)))
          return { rejected: true };
        signal.throwIfAborted();
        return runCommand(
          process.platform === 'win32' ? `${command}.cmd` : command,
          commandArgs,
          root,
          this.settings().commandTimeout,
          signal,
        );
      }
      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }
  private async currentHash(path: string) {
    try {
      return hash(await readFile(path, 'utf8'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
      throw e;
    }
  }
}
