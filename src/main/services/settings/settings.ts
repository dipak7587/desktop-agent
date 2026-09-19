import { join } from 'node:path';
import { settingsSchema } from '../../../shared/schemas';
import type { Settings } from '../../../shared/types';
import { atomicWrite, readJSON } from '../filesystem/storage';
export class SettingsService {
  private value: Settings = settingsSchema.parse({});
  constructor(readonly root: string) {}
  async init() {
    this.value = settingsSchema.parse(await readJSON(join(this.root, 'settings.json'), {}));
  }
  get() {
    return structuredClone(this.value);
  }
  async save(input: Settings) {
    const value = settingsSchema.parse(input);
    await atomicWrite(join(this.root, 'settings.json'), JSON.stringify(value, null, 2));
    this.value = value;
    return this.get();
  }
}
