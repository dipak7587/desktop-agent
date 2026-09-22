import { it, expect } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LibraryService } from '../src/main/services/filesystem/library';
import { MCPService } from '../src/main/services/mcp/mcp';
import { librarySchema } from '../src/shared/schemas';
it.each(['${TEST_SECRET}', 'private-test-token'])(
  'starts a real stdio MCP process with env %s, redacts secrets and stops',
  async (value) => {
    const root = await mkdtemp(join(tmpdir(), 'mcp-integration-'));
    await mkdir(join(root, 'mcp'));
    const lib = new LibraryService(root);
    await lib.save(
      'mcp',
      librarySchema.parse({
        id: 'test-server',
        name: 'Test server',
        description: 'Test MCP server',
        command: process.execPath,
        args: [resolve('tests/fixtures/mcp-server.mjs')],
        env: { TEST_SECRET: value },
      }),
    );
    const service = new MCPService(
      lib,
      {
        resolve: (name) => {
          expect(value).toBe('${TEST_SECRET}');
          expect(name).toBe('TEST_SECRET');
          return 'private-test-token';
        },
        redact: (s) => s,
      },
      () => {},
    );
    try {
      await service.start('test-server');
      expect(service.states()[0].status).toBe('connected');
      expect(service.states()[0].tools[0].name).toBe('echo');
      const result = await service.call(
        'test-server',
        'echo',
        { message: 'Hello' },
        new AbortController().signal,
      );
      expect(result).toContain('Hello [REDACTED]');
      expect(result).not.toContain('private-test-token');
      expect(JSON.stringify(service.states())).not.toContain('private-test-token');
      await service.action('test-server', 'test');
      await service.stop('test-server');
      expect(service.states()[0].status).toBe('stopped');
    } finally {
      await service.stopAll();
      await rm(root, { recursive: true, force: true });
    }
  },
);
