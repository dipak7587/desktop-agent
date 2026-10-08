import { expect, it, vi } from 'vitest';
const adapter = vi.hoisted(() => ({
  create: vi.fn(),
  listTools: vi.fn(async () => []),
  getClient: vi.fn(async () => ({})),
}));
vi.mock('@langchain/mcp-adapters', () => ({
  MCPAdapter: class {
    constructor(options: unknown) {
      adapter.create(options);
    }
    listTools = adapter.listTools;
    getClient = adapter.getClient;
  },
}));
import { MCPService } from '../src/main/services/mcp/mcp';
import { LibraryService } from '../src/main/services/filesystem/library';
import { librarySchema } from '../src/shared/schemas';

it('resolves HTTP URL and embedded headers before connecting and rejects unsafe resolved URLs', async () => {
  const item = librarySchema.parse({
    id: 'deepwiki',
    name: 'DeepWiki',
    transport: 'streamable-http',
    connection: {
      type: 'streamable-http',
      url: '${DEEPWIKI_MCP_URL}',
      headers: { Authorization: 'Bearer ${TOKEN}' },
    },
  });
  const library = new LibraryService('/unused');
  vi.spyOn(library, 'get').mockResolvedValue(item);
  const resolve = vi.fn((name: string): string =>
    name === 'TOKEN' ? 'test-token' : 'https://example.com/mcp',
  );
  const service = new MCPService(library, { resolve, redact: (s) => s }, () => {});
  await service.start('deepwiki');
  expect(adapter.create).toHaveBeenLastCalledWith(
    expect.objectContaining({
      servers: {
        deepwiki: expect.objectContaining({
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer test-token' },
        }),
      },
    }),
  );
  resolve.mockReturnValue('file:///tmp/private');
  const unsafe = new MCPService(library, { resolve, redact: (s) => s }, () => {});
  await expect(unsafe.start('deepwiki')).rejects.toThrow('HTTP(S)');
});
