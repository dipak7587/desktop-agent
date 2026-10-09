import { lstat, realpath, readFile, readdir, mkdir, unlink } from 'node:fs/promises';
import { resolve, relative, join, dirname, isAbsolute, sep, extname, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { createTwoFilesPatch } from 'diff';
import { z } from 'zod';
import { hash, atomicWrite } from '../filesystem/storage';
import { ignored, walk, readText } from '../filesystem/walk';
import type { Settings, PermissionMode } from '../../../shared/types';
export const localTools = [
  'filesystem.read',
  'filesystem.write',
  'filesystem.edit',
  'filesystem.delete',
  'filesystem.list',
  'filesystem.search',
  'filesystem.exists',
  'project.detect',
  'git.status',
  'git.diff',
  'git.log',
  'git.add',
  'git.commit',
  'git.push',
  'shell.execute',
];
/** Known inspection operations never mutate the selected workspace. */
export const readOnlyLocalTools = new Set([
  'filesystem.read',
  'filesystem.list',
  'filesystem.search',
  'filesystem.exists',
  'project.detect',
  'git.status',
  'git.diff',
  'git.log',
]);
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
    permission?: PermissionMode,
  ): Promise<unknown> {
    signal.throwIfAborted();
    if (permission === 'deny') throw new Error('Permission denies this tool');
    const approvalMode =
      permission === 'always_allow'
        ? 'auto'
        : permission === 'ask'
          ? 'ask'
          : this.settings().approvalMode;
    const pathArg = z
      .string()
      .max(4096)
      .parse(args.path ?? '.');
    const target = await safePath(root, pathArg);
    switch (tool) {
      case 'filesystem.read': {
        const content = await readText(target, 200000);
        const offset = z
          .number()
          .int()
          .min(0)
          .parse(args.offset ?? 0);
        const limit = z
          .number()
          .int()
          .min(1)
          .max(1000)
          .parse(args.limit ?? 200);
        const lines = content.split('\n');
        const excerpt = lines.slice(offset, offset + limit).join('\n');
        return {
          path: pathArg,
          content: excerpt,
          hash: hash(content),
          ...(offset || lines.length > limit
            ? { offset, totalLines: lines.length, truncated: offset + limit < lines.length }
            : {}),
        };
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
        const patterns = [...this.settings().ignorePatterns];
        try {
          const gitignore = await readText(await safePath(root, '.gitignore'), 30000);
          for (const rule of gitignore
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))) {
            const pattern = rule.replace(/^\//, '').replace(/\/$/, '');
            patterns.push(
              pattern,
              `${pattern}/**`,
              ...(pattern.includes('/') ? [] : [`**/${pattern}`, `**/${pattern}/**`]),
            );
          }
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        for await (const file of walk(root, patterns, signal)) {
          if (results.length >= 60) break;
          const filePath = relative(root, file);
          if (filePath.toLowerCase().includes(query.toLowerCase()))
            results.push({ path: filePath, line: 0, content: 'Path match' });
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
      case 'filesystem.delete': {
        const expected = z.string().min(1).parse(args.expectedHash);
        if (!(await lstat(target)).isFile())
          throw new Error('Only individual files can be deleted');
        const original = await readText(target, 1_000_000);
        if (hash(original) !== expected) throw new Error('File changed since it was read');
        const diff = createTwoFilesPatch(pathArg, '/dev/null', original, '');
        // Deletion always needs explicit approval, even under full-auto settings.
        if (!(await approve(tool, `Delete file ${pathArg} from ${root}`, diff)))
          return { rejected: true };
        signal.throwIfAborted();
        await safePath(root, pathArg);
        if ((await this.currentHash(target)) !== expected)
          throw new Error('File changed while awaiting approval; deletion aborted');
        await unlink(target);
        return { path: pathArg, deleted: true, diff };
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
        const mode = approvalMode;
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
      case 'git.add': {
        const paths = z.array(z.string().min(1).max(4096)).min(1).max(100).parse(args.paths);
        const base = await realpath(root);
        const literalPaths = await Promise.all(
          [...new Set(paths)].map(async (path) => {
            const target = await safePath(base, path);
            try {
              if ((await lstat(target)).isDirectory())
                throw new Error('Git staging must name individual files, not directories');
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
            return `:(literal)${relative(base, target).split(sep).join('/')}`;
          }),
        );
        if (literalPaths.length !== paths.length)
          throw new Error('Git staging paths must be unique');
        const description = `Stage only these workspace files: ${paths.join(', ')}.`;
        if (!(await approve(tool, description))) return { rejected: true };
        signal.throwIfAborted();
        return runCommand(
          'git',
          ['add', '-A', '--', ...literalPaths],
          base,
          this.settings().commandTimeout,
          signal,
        );
      }
      case 'git.commit': {
        const message = z.string().trim().min(1).max(2000).parse(args.message);
        const paths = z.array(z.string().min(1).max(4096)).min(1).max(100).parse(args.paths);
        const literalPaths = await Promise.all(
          [...new Set(paths)].map(async (path) => {
            const target = await safePath(root, path);
            try {
              if ((await lstat(target)).isDirectory())
                throw new Error('Git commits must name individual files, not directories');
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }
            return `:(literal)${relative(root, target).split(sep).join('/')}`;
          }),
        );
        if (literalPaths.length !== paths.length)
          throw new Error('Git commit paths must be unique');
        const description = `Commit only these workspace files: ${paths.join(', ')}. Commit message: ${message}`;
        if (!(await approve(tool, description))) return { rejected: true };
        signal.throwIfAborted();
        const staged = await runCommand(
          'git',
          ['add', '-A', '--', ...literalPaths],
          root,
          this.settings().commandTimeout,
          signal,
        );
        if (staged.exitCode !== 0) return staged;
        return runCommand(
          'git',
          ['commit', '--only', '-m', message, '--', ...literalPaths],
          root,
          this.settings().commandTimeout,
          signal,
        );
      }
      case 'git.push': {
        const branch = await runCommand(
          'git',
          ['branch', '--show-current'],
          root,
          this.settings().commandTimeout,
          signal,
        );
        if (branch.exitCode !== 0 || !branch.stdout.trim())
          throw new Error('Cannot push because the workspace is not on a named branch.');
        const upstream = await runCommand(
          'git',
          ['rev-parse', '--symbolic-full-name', '@{upstream}'],
          root,
          this.settings().commandTimeout,
          signal,
        );
        if (upstream.exitCode !== 0 || !upstream.stdout.trim())
          throw new Error('Cannot push because the current branch has no configured upstream.');
        const remoteName = await runCommand(
          'git',
          ['config', '--get', `branch.${branch.stdout.trim()}.remote`],
          root,
          this.settings().commandTimeout,
          signal,
        );
        const remoteBranch = await runCommand(
          'git',
          ['config', '--get', `branch.${branch.stdout.trim()}.merge`],
          root,
          this.settings().commandTimeout,
          signal,
        );
        const remote = remoteName.stdout.trim();
        const target = remoteBranch.stdout.trim();
        if (
          remoteName.exitCode !== 0 ||
          remoteBranch.exitCode !== 0 ||
          !remote ||
          !target.startsWith('refs/heads/')
        )
          throw new Error('Cannot determine the current branch’s configured upstream.');
        const description = `Push local branch ${branch.stdout.trim()} to ${remote}:${target} (no force options).`;
        if (!(await approve(tool, description))) return { rejected: true };
        signal.throwIfAborted();
        return runCommand(
          'git',
          ['push', '--', remote, `HEAD:${target}`],
          root,
          this.settings().commandTimeout,
          signal,
        );
      }
      case 'shell.execute': {
        const command = z
          .enum([
            'npm',
            'pnpm',
            'yarn',
            'node',
            'python',
            'python3',
            'pytest',
            'uv',
            'ruff',
            'cargo',
            'go',
            'dotnet',
            'java',
            'javac',
            'mvn',
            'gradle',
            'make',
            'cmake',
            'ctest',
            'ruby',
            'bundle',
            'php',
            'composer',
          ])
          .parse(args.command);
        const commandArgs = z
          .array(
            z
              .string()
              .max(4096)
              .refine((arg) => !arg.includes('\0')),
          )
          .min(1)
          .max(100)
          .parse(args.args);
        const cwd = await safePath(
          root,
          z
            .string()
            .max(4096)
            .parse(args.cwd ?? '.'),
        );
        if (!(await lstat(cwd)).isDirectory())
          throw new Error('Working directory must be a folder');
        const reason = z
          .string()
          .max(2000)
          .parse(args.reason ?? 'Run a project development command');
        const familiarScript =
          ['npm', 'pnpm', 'yarn'].includes(command) &&
          ((commandArgs.length === 1 &&
            ['test', 'lint', 'build', 'typecheck'].includes(commandArgs[0])) ||
            (commandArgs.length === 2 &&
              commandArgs[0] === 'run' &&
              ['test', 'lint', 'build', 'typecheck'].includes(commandArgs[1])));
        const description = `${JSON.stringify([command, ...commandArgs])} in ${cwd}. ${reason}. Commands can execute arbitrary code and are not an operating-system sandbox.`;
        // Only the existing narrow script categories may use remembered automatic approval.
        if ((!familiarScript || approvalMode !== 'auto') && !(await approve(tool, description)))
          return { rejected: true };
        signal.throwIfAborted();
        await safePath(root, z.string().parse(args.cwd ?? '.'));
        return runCommand(
          process.platform === 'win32' && ['npm', 'pnpm', 'yarn', 'mvn', 'gradle'].includes(command)
            ? `${command}.cmd`
            : command,
          commandArgs,
          cwd,
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
