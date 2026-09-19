import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { minimatch } from 'minimatch';
export const ignoredNames = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.ssh',
  '.aws',
  '.gnupg',
]);
export const supportedExtensions = new Set(['.md', '.txt']);
export function ignored(path: string, patterns: string[] = []) {
  const segments = path.split(/[\\/]/);
  return (
    segments.some(
      (s) =>
        ignoredNames.has(s) ||
        s === '.env' ||
        s.startsWith('.env.') ||
        /\.(pem|key|p12|pfx)$/i.test(s),
    ) ||
    patterns.some((p) => minimatch(path.replaceAll('\\', '/'), p, { dot: true, matchBase: true }))
  );
}
export async function* walk(
  root: string,
  patterns: string[] = [],
  signal?: AbortSignal,
  limit = 10000,
): AsyncGenerator<string> {
  let count = 0;
  async function* visit(dir: string): AsyncGenerator<string> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      signal?.throwIfAborted();
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink() || ignored(relative(root, path), patterns)) continue;
      if (entry.isDirectory()) yield* visit(path);
      else if (entry.isFile()) {
        if (++count > limit)
          throw new Error(
            `Repository exceeds ${limit} files. Add ignore patterns or select a narrower folder.`,
          );
        yield path;
      }
    }
  }
  yield* visit(root);
}
export async function readText(path: string, limit = 2_000_000) {
  const info = await stat(path);
  if (info.size > limit) throw new Error(`File exceeds ${limit} byte limit: ${path}`);
  const buffer = await readFile(path);
  if (buffer.includes(0)) throw new Error('Binary content is not supported');
  return buffer.toString('utf8');
}
