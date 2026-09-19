import { hash } from '../filesystem/storage';
export function chunkText(text: string, size: number, overlap: number) {
  if (size <= 0 || overlap < 0 || overlap >= size) throw new Error('Invalid chunk settings');
  const normalized = text.replace(/\r\n/g, '\n').trim();
  const result: {
    content: string;
    startLine: number;
    endLine: number;
    hash: string;
    chunkIndex: number;
  }[] = [];
  let startLine = 1;
  for (let start = 0; start < normalized.length;) {
    let end = Math.min(start + size, normalized.length);
    if (end < normalized.length) {
      const boundary = normalized.lastIndexOf('\n', end);
      if (boundary > start + size / 2) end = boundary;
    }
    const content = normalized.slice(start, end);
    const endLine = startLine + (content.match(/\n/g)?.length ?? 0);
    result.push({ content, startLine, endLine, hash: hash(content), chunkIndex: result.length });
    if (end === normalized.length) break;
    const next = end - overlap;
    startLine += normalized.slice(start, next).match(/\n/g)?.length ?? 0;
    start = next;
  }
  return result;
}
