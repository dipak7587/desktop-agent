import { it, expect } from 'vitest';
import { chunkText } from '../src/main/services/rag/chunker';
import { ignored } from '../src/main/services/filesystem/walk';
it('chunks with overlap, stable hashes and line metadata', () => {
  const text = Array.from({ length: 100 }, (_, i) => `line ${i} with useful information`).join(
    '\n',
  );
  const chunks = chunkText(text, 200, 30);
  expect(chunks.length).toBeGreaterThan(10);
  expect(chunks[0].content.slice(-30)).toBe(chunks[1].content.slice(0, 30));
  expect(chunks.at(-1)?.content).toContain('line 99');
  expect(chunkText(text, 200, 30)).toEqual(chunks);
  expect(() => chunkText(text, 20, 20)).toThrow();
});
it('excludes secrets, generated files and custom ignore patterns', () => {
  for (const path of [
    'node_modules/a.md',
    '.env',
    '.env.production',
    '.git/config',
    'src/private.key',
    'dist/x.txt',
  ])
    expect(ignored(path)).toBe(true);
  expect(ignored('src/custom.md', ['**/custom.*'])).toBe(true);
  expect(ignored('docs/auth.md')).toBe(false);
});
