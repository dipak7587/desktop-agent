import type { SettingsService } from '../settings/settings';
import { createLLMProvider, type LLMProvider } from '../ollama/provider';
export interface SelectedProvider {
  llm: LLMProvider;
  providerId: string;
  providerNameSnapshot: string;
  modelId: string;
}
export class ProviderRouter {
  constructor(private settings: SettingsService) {}
  capture(providerId: string | undefined, model: string): SelectedProvider {
    const p = this.settings.validateSelection(
      providerId ?? this.settings.get().activeProviderId,
      model,
    );
    const snapshot = this.settings.forProvider(p.id);
    return {
      llm: createLLMProvider(() => snapshot),
      providerId: p.id,
      providerNameSnapshot: p.name,
      modelId: model,
    };
  }
  async discover(id?: string) {
    const revision = this.settings.getRevision();
    const profile = this.settings.profile(id);
    const snapshot = this.settings.forProvider(profile.id);
    snapshot.timeout = Math.min(snapshot.timeout ?? 10000, 10000);
    const models = await createLLMProvider(() => snapshot).listModels();
    await this.settings.updateModels(
      profile.id,
      models
        .filter((m) => !m.capabilities || m.capabilities.includes('completion'))
        .map((m) => m.name),
      revision,
    );
    return models;
  }
}
