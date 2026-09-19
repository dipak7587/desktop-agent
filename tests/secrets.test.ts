import { it, expect, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => 'basic_text',
  },
}));
import { SecretStore } from '../src/main/security/secrets';
it('loads an explicitly selected environment file without copying values into app metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localai-secret-test-'));
  const file = join(root, '.env');
  await writeFile(file, 'TEST_LOCALAI_TOKEN=private-test-value\n');
  try {
    const store = new SecretStore(root);
    await store.init();
    expect(await store.loadEnvironment(file)).toEqual(['TEST_LOCALAI_TOKEN']);
    expect(store.resolve('TEST_LOCALAI_TOKEN')).toBe('private-test-value');
    expect(store.redact('value private-test-value')).toBe('value [REDACTED]');
    expect(await readFile(join(root, 'environment-source.json'), 'utf8')).not.toContain(
      'private-test-value',
    );
    const reopened = new SecretStore(root);
    await reopened.init();
    expect(reopened.resolve('TEST_LOCALAI_TOKEN')).toBe('private-test-value');
    await reopened.clearEnvironment();
    expect(() => reopened.resolve('TEST_LOCALAI_TOKEN')).toThrow('not configured');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('refuses plaintext fallback when OS encryption is unavailable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'localai-insecure-test-'));
  try {
    const store = new SecretStore(root);
    await store.init();
    await expect(store.set('TEST_TOKEN', 'secret')).rejects.toThrow(
      'OS secure storage is unavailable',
    );
    expect(store.list()).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
