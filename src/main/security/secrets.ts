import { safeStorage } from 'electron';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { readText } from '../services/filesystem/walk';
import { atomicWrite, readJSON } from '../services/filesystem/storage';
export class SecretStore {
  private values: Record<string, string> = {};
  private environment: Record<string, string | undefined> = {};
  private environmentError = '';
  constructor(private root: string) {}
  async init() {
    this.values = await readJSON(join(this.root, 'credentials.json'), {});
    const source = await readJSON<{ path?: string }>(
      join(this.root, 'environment-source.json'),
      {},
    );
    if (source.path) {
      try {
        this.environment = parseEnv(await readText(source.path, 100000));
      } catch (error) {
        this.environmentError = `Configured environment file is unavailable: ${(error as Error).message}`;
      }
    }
  }
  async loadEnvironment(path: string) {
    const values = parseEnv(await readText(path, 100000));
    await atomicWrite(join(this.root, 'environment-source.json'), JSON.stringify({ path }));
    this.environment = values;
    this.environmentError = '';
    return Object.keys(values);
  }
  async clearEnvironment() {
    await atomicWrite(join(this.root, 'environment-source.json'), '{}');
    this.environment = {};
    this.environmentError = '';
  }
  list() {
    return Object.keys(this.values);
  }
  private supported() {
    return (
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
    );
  }
  async set(name: string, value: string) {
    if (!this.supported())
      throw new Error(
        'OS secure storage is unavailable. Configure an environment variable reference instead.',
      );
    const next = { ...this.values, [name]: safeStorage.encryptString(value).toString('base64') };
    await atomicWrite(join(this.root, 'credentials.json'), JSON.stringify(next));
    this.values = next;
  }
  async remove(name: string) {
    const next = { ...this.values };
    delete next[name];
    await atomicWrite(join(this.root, 'credentials.json'), JSON.stringify(next));
    this.values = next;
  }
  resolve(name: string) {
    if (Object.hasOwn(this.values, name)) {
      if (!this.supported()) throw new Error('OS secure storage is unavailable');
      return safeStorage.decryptString(Buffer.from(this.values[name], 'base64'));
    }
    const value = this.environment[name] ?? process.env[name];
    if (!value)
      throw new Error(
        this.environmentError ||
          `Environment variable or stored credential ${name} is not configured`,
      );
    return value;
  }
  redact(text: string) {
    let result = text;
    for (const name of new Set([...this.list(), ...Object.keys(this.environment)])) {
      try {
        const secret = this.resolve(name);
        if (secret) result = result.split(secret).join('[REDACTED]');
      } catch {
        result = '[Output unavailable: credential store locked]';
      }
    }
    return result;
  }
}
