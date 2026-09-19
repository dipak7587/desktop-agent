import { it, expect } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMCPConfig } from '../src/shared/mcp-config';
import { librarySchema } from '../src/shared/schemas';
import { LibraryService } from '../src/main/services/filesystem/library';
import { MCPService } from '../src/main/services/mcp/mcp';

it('accepts direct and wrapped MCP configs, including an optional command', () => {
  const config = { command: 'node', args: ['server.js'], env: { TOKEN: '${TOKEN}' } };
  expect(parseMCPConfig(JSON.stringify(config))).toEqual(config);
  expect(parseMCPConfig(JSON.stringify({ mcpServers: { example: config } }))).toEqual(config);
  expect(parseMCPConfig('{}')).toEqual({ command: '', args: [], env: {} });
});

it('rejects malformed, ambiguous, unsupported and unsafe MCP JSON', () => {
  for (const raw of [
    '{',
    'null',
    '[]',
    '{"args":"bad"}',
    '{"env":{"TOKEN":"secret"}}',
    '{"url":"https://example.com"}',
    '{"mcpServers":{}}',
    '{"mcpServers":{"one":{},"two":{}}}',
  ]) {
    expect(() => parseMCPConfig(raw)).toThrow();
  }
});

it('requires MCP name and description but saves without a command and rejects starting it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcp-draft-'));
  await mkdir(join(root, 'mcp'));
  const library = new LibraryService(root);
  try {
    const item = librarySchema.parse({
      id: 'draft',
      name: 'Draft',
      description: 'Configure later',
    });
    expect(() => librarySchema.parse({ ...item, name: ' ' })).toThrow();
    await expect(library.save('mcp', { ...item, description: ' ' })).rejects.toThrow('description');
    await library.save('mcp', item);
    expect((await library.get('mcp', item.id)).command).toBe('');
    const service = new MCPService(library, { resolve: () => '', redact: (s) => s }, () => {});
    await expect(service.start(item.id)).rejects.toThrow('Add an executable command');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
