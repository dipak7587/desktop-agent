import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { settingsSchema, providerProfileSchema } from '../../../shared/schemas';
import {
  resolveProviderSettings,
  type Settings,
  type ProviderProfile,
  type LibraryItem,
} from '../../../shared/types';
import { atomicWrite, readJSON } from '../filesystem/storage';
import { z } from 'zod';

export interface ProviderSecrets {
  set(name: string, value: string): Promise<void>;
  resolve(name: string): string;
  remove(name: string): Promise<void>;
}
const registrySchema = z.object({
  schemaVersion: z.literal(1),
  defaultProviderId: z.string(),
  providers: z.array(providerProfileSchema),
});
export class SettingsService {
  private value: Settings = settingsSchema.parse({});
  private queue: Promise<unknown> = Promise.resolve();
  private revision = 0;
  getRevision() {
    return this.revision;
  }
  constructor(
    readonly root: string,
    private secrets?: ProviderSecrets,
    private listAgents: () => Promise<Pick<LibraryItem, 'name' | 'providerId'>[]> = async () => [],
  ) {}
  async init() {
    const loaded = settingsSchema.parse(await readJSON(join(this.root, 'settings.json'), {}));
    const registry = await readJSON<unknown>(join(this.root, 'config', 'providers.json'), null);
    if (registry) {
      const saved = registrySchema.parse(registry);
      loaded.providers = saved.providers;
      loaded.activeProviderId = saved.defaultProviderId;
    } else if (!loaded.providers.length) {
      loaded.providers = [
        providerProfileSchema.parse({
          id: 'ollama-local',
          name: loaded.provider === 'ollama' ? 'Local Ollama' : loaded.provider,
          provider: loaded.provider,
          apiKey: loaded.apiKey,
          apiBaseUrl: loaded.apiBaseUrl,
          ollamaUrl: loaded.ollamaUrl,
          chatModel: loaded.chatModel,
          embeddingModel: loaded.embeddingModel,
        }),
      ];
      loaded.activeProviderId = loaded.providers[0].id;
    }
    if (!registry) {
      for (const p of loaded.providers) {
        p.modelIds = [
          ...new Set([...(p.modelIds ?? []), p.chatModel, p.embeddingModel].filter(Boolean)),
        ];
        p.manualModelIds = p.modelIds;
      }
      if (!loaded.activeProviderId) loaded.activeProviderId = loaded.providers[0]?.id ?? '';
    }
    this.value = loaded;
    await this.save(loaded);
  }
  get(): Settings {
    return structuredClone(resolveProviderSettings(this.value));
  }
  profile(id = this.value.activeProviderId): ProviderProfile {
    const profile = this.value.providers.find((p) => p.id === id);
    if (!profile) throw new Error('Provider was removed. Select a provider in AI Providers.');
    if (profile.enabled === false)
      throw new Error(`${profile.name} is disabled. Enable it or select another provider.`);
    return structuredClone(profile);
  }
  // Main-process only. The public settings getter never resolves credentials.
  forProvider(id = this.value.activeProviderId): Settings {
    const p = this.profile(id);
    return {
      ...this.get(),
      ...p,
      providers: [],
      activeProviderId: p.id,
      apiKey: p.credentialRef ? (this.secrets?.resolve(p.credentialRef) ?? '') : '',
    };
  }
  validateSelection(id: string, model: string) {
    const p = this.profile(id);
    if (!model || !p.modelIds?.includes(model))
      throw new Error(
        `Select an available model for ${p.name}. Refresh or add a model in AI Providers.`,
      );
    return p;
  }
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const job = this.queue.then(work);
    this.queue = job.catch(() => {});
    return job;
  }
  save(input: Settings): Promise<Settings> {
    return this.exclusive(async () => {
      const value = settingsSchema.parse(input);
      const removed = this.value.providers.filter(
        (p) => !value.providers.some((next) => next.id === p.id),
      );
      if (removed.length) {
        const agents = await this.listAgents();
        const errors = removed.flatMap((provider) => {
          const usedBy = agents.filter((agent) => agent.providerId === provider.id);
          if (!usedBy.length) return [];
          return [
            `Cannot delete “${provider.name}”. This provider is used by ${usedBy.length === 1 ? 'an agent' : `${usedBy.length} agents`}: ${usedBy.map((a) => `“${a.name}”`).join(', ')}. Reassign ${usedBy.length === 1 ? 'this agent' : 'these agents'} to another provider before deleting it.`,
          ];
        });
        if (errors.length) throw new Error(errors.join('\n'));
      }
      if (new Set(value.providers.map((p) => p.id)).size !== value.providers.length)
        throw new Error('Provider configuration IDs must be unique');
      for (const p of value.providers) {
        if (p.chatModel && !p.modelIds.includes(p.chatModel))
          throw new Error(`Default model must belong to ${p.name}`);
        if (p.provider === 'custom' && !p.apiBaseUrl)
          throw new Error('Enter a custom API base URL');
      }
      for (const p of value.providers) {
        const previous = this.value.providers.find((v) => v.id === p.id);
        // References are assigned by the main process, never accepted from an imported file.
        p.credentialRef = previous?.credentialRef;
        if (p.apiKey) {
          if (!this.secrets) throw new Error('Secure credential storage is unavailable');
          const reference = `provider_${createHash('sha256').update(p.id).digest('hex')}`;
          await this.secrets.set(reference, p.apiKey);
          p.credentialRef = reference;
        }
        p.apiKey = '';
        p.hasCredential = Boolean(p.credentialRef);
      }
      value.apiKey = '';
      await this.persist(value);
      this.value = value;
      this.revision++;
      return this.get();
    });
  }
  private async persist(value: Settings) {
    await atomicWrite(
      join(this.root, 'config', 'providers.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          defaultProviderId: value.activeProviderId,
          providers: value.providers,
        },
        null,
        2,
      ),
    );
    const { providers: _providers, ...metadata } = value;
    await atomicWrite(
      join(this.root, 'settings.json'),
      JSON.stringify({ ...metadata, apiKey: '', schemaVersion: 1 }, null, 2),
    );
  }
  updateModels(id: string, discovered: string[], revision = this.revision) {
    return this.exclusive(async () => {
      if (revision !== this.revision)
        throw new Error('Provider settings changed during discovery. Refresh models again.');
      const value = this.get();
      const p = value.providers.find((p) => p.id === id);
      if (!p) throw new Error('Provider was removed during discovery');
      p.modelIds = [...new Set([...discovered, ...(p.manualModelIds ?? [])])];
      if (p.chatModel && !p.modelIds.includes(p.chatModel)) p.chatModel = '';
      await this.persist(value);
      this.value = value;
      return this.get();
    });
  }
  clearCredential(id: string) {
    return this.exclusive(async () => {
      const value = this.get();
      const p = value.providers.find((p) => p.id === id);
      if (!p) throw new Error('Provider not found');
      if (p.credentialRef) await this.secrets?.remove(p.credentialRef);
      delete p.credentialRef;
      p.hasCredential = false;
      this.revision++;
      await this.persist(value);
      this.value = value;
    });
  }
}
