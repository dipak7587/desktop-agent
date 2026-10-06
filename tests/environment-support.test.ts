import { expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }));
import { SecretStore } from '../src/main/security/secrets';
import { LibraryService } from '../src/main/services/filesystem/library';
import { CustomToolService } from '../src/main/services/tools/custom';
import { librarySchema } from '../src/shared/schemas';
import { expandEnvironment } from '../src/shared/environment';
import { generateToolSource } from '../src/shared/tool-definition';
import { toolItemFromSource } from '../src/main/services/tools/files';

it('expands once and reports missing references', () => {
  expect(expandEnvironment('Bearer ${TOKEN}', () => '${OTHER}')).toBe('Bearer ${OTHER}');
  expect(() =>
    expandEnvironment('${MISSING}', () => {
      throw new Error('not configured');
    }),
  ).toThrow('not configured');
});

it('keeps MCP, skill and agent templates on disk and provides env to executable tools', async () => {
  const root = await mkdtemp(join(tmpdir(), 'env-support-'));
  try {
    const envFile = join(root, '.env');
    await writeFile(envFile, 'SERVICE_URL=https://example.com/mcp\nTOKEN=private-value\nEMPTY=\n');
    const secrets = new SecretStore(root);
    await secrets.init();
    await secrets.loadEnvironment(envFile);
    const library = new LibraryService(root, undefined, secrets);
    expect(secrets.resolve('EMPTY')).toBe('');
    await library.save(
      'mcp',
      librarySchema.parse({
        id: 'remote',
        name: 'Remote',
        transport: 'streamable-http',
        connection: { type: 'streamable-http', url: '${SERVICE_URL}' },
      }),
    );
    expect((await library.get('mcp', 'remote')).connection).toMatchObject({
      url: '${SERVICE_URL}',
    });
    for (const kind of ['agents', 'skills'] as const) {
      await library.save(
        kind,
        librarySchema.parse({ id: 'template', name: 'Template', content: 'Use ${SERVICE_URL}' }),
      );
      const item = await library.get(kind, 'template');
      expect(library.resolveInstructions(item.content)).toBe('Use https://example.com/mcp');
      expect(await readFile(library.path(kind, item.id), 'utf8')).toContain('${SERVICE_URL}');
    }
    const source = generateToolSource({
      name: 'env_tool',
      description: 'Read env',
      inputs: [],
      functionBody: 'return [process.env.TOKEN, process.env.ALIAS, process.env.EMPTY];',
    });
    await library.save(
      'tools',
      toolItemFromSource(source, { id: 'env-tool', env: { ALIAS: '${SERVICE_URL}' } }),
    );
    expect((await library.get('tools', 'env-tool')).env).toEqual({ ALIAS: '${SERVICE_URL}' });
    const tools = new CustomToolService(library, secrets, () => 10000);
    expect(await tools.run('env-tool', {})).toBe('["[REDACTED]","[REDACTED]",""]');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('redacts referenced host environment variables', async () => {
  const root = await mkdtemp(join(tmpdir(), 'env-redaction-'));
  vi.stubEnv('TEST_HOST_SECRET', 'host-private-value');
  try {
    const secrets = new SecretStore(root);
    expect(secrets.resolve('TEST_HOST_SECRET')).toBe('host-private-value');
    expect(secrets.redact('host-private-value')).toBe('[REDACTED]');
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});
