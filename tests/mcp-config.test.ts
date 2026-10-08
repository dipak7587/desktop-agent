import { it, expect } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseMCPConfig } from '../src/shared/mcp-config';
import { librarySchema } from '../src/shared/schemas';
import { LibraryService } from '../src/main/services/filesystem/library';

it('accepts direct and wrapped MCP configs, including an optional command', () => {
  const config = {
    command: 'node',
    args: ['server.js'],
    env: { TOKEN: '${TOKEN}', MODE: 'production', EMPTY: '', TEXT: 'prefix-${TOKEN}' },
  };
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
    '{"env":{"TOKEN":123}}',
    JSON.stringify({ env: { TOKEN: 'bad\0value' } }),
    '{"url":"https://example.com"}',
    '{"mcpServers":{}}',
    '{"mcpServers":{"one":{},"two":{}}}',
  ]) {
    expect(() => parseMCPConfig(raw)).toThrow();
  }
});

it('validates before saving and stores the new schema as JSON', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mcp-config-'));
  await mkdir(join(root, 'mcp'));
  const library = new LibraryService(root);
  try {
    const item = librarySchema.parse({
      id: 'files',
      name: 'Files',
      enabled: true,
      transport: 'stdio',
      connection: { type: 'stdio', command: 'node', args: ['server.js'] },
    });
    await expect(
      library.save('mcp', { ...item, connection: { type: 'stdio', command: '\0' } }),
    ).rejects.toThrow();
    await library.save('mcp', item);
    expect((await library.get('mcp', item.id)).connection).toEqual(item.connection);
    expect(JSON.parse(library.serialize('mcp', item))).toMatchObject({
      transport: 'stdio',
      connection: item.connection,
    });
    expect(JSON.parse(library.serialize('mcp', item))).not.toHaveProperty('command');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('validates transports, nested sections, and malformed connection fields', () => {
  const config = {
    id: 'remote',
    name: 'Remote',
    enabled: true,
    transport: 'streamable-http',
    connection: {
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      headers: { Authorization: '${TOKEN}' },
    },
    runtime: { timeoutMs: 10000 },
    permissions: { allowRead: true },
    capabilities: { tools: true },
  };
  expect(parseMCPConfig(JSON.stringify(config))).toEqual(config);
  for (const bad of [
    { ...config, transport: 'stdio' },
    { ...config, runtime: { timeoutMs: -1 } },
    { ...config, connection: { type: 'streamable-http', url: 'file:///tmp/server' } },
    { ...config, permissions: { allowRead: 'yes' } },
    { ...config, unknown: true },
  ])
    expect(() => parseMCPConfig(JSON.stringify(bad))).toThrow();
});
