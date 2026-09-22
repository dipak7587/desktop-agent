import { useEffect, useState } from 'react';
import type { ProviderProfile, LLMProviderName } from '../../shared/types';
import { providerProfileSchema } from '../../shared/schemas';
import { useSettings, useUI, attempt } from '../stores';
import { Confirm, Modal } from '../components/common';
const defaults: Record<LLMProviderName, string> = {
  ollama: 'http://localhost:11434',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  custom: '',
};
const labels: Record<LLMProviderName, string> = {
  ollama: 'Ollama',
  openai: 'OpenAI',
  anthropic: 'Anthropic Claude',
  google: 'Google Gemini',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  custom: 'Custom compatible API',
};
export function AIProviders() {
  const { settings, load, save } = useSettings();
  const [editing, setEditing] = useState<ProviderProfile | null>(null);
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [blockedRemoval, setBlockedRemoval] = useState<{ name: string; agents: string[] } | null>(
    null,
  );
  const [removal, setRemoval] = useState<{ id: string; detail: string } | null>(null);
  useEffect(() => {
    if (!settings) return;
    for (const p of settings.providers.filter((p) => p.enabled !== false)) {
      void window.workspace.models
        .list(p.id)
        .then((models) => {
          setStatuses((s) => ({ ...s, [p.id]: `Connected · ${models.length} models` }));
          return load();
        })
        .catch((e) =>
          setStatuses((s) => ({ ...s, [p.id]: `Unavailable: ${(e as Error).message}` })),
        );
    }
    // Probe saved configurations when the page opens; edits explicitly trigger another test.
  }, []);
  if (!settings) return null;
  async function persist(profile: ProviderProfile) {
    const current = useSettings.getState().settings!;
    const parsed = providerProfileSchema.parse(profile);
    await save({
      ...current,
      providers: current.providers.some((p) => p.id === parsed.id)
        ? current.providers.map((p) => (p.id === parsed.id ? parsed : p))
        : [...current.providers, parsed],
    });
    const result = useSettings.getState().settings!.providers.find((p) => p.id === profile.id)!;
    setEditing(result);
    return result;
  }
  async function check() {
    if (!editing) return;
    setBusy(true);
    try {
      const profile = await persist(editing);
      const models = await window.workspace.models.list(profile.id);
      await load();
      setEditing(useSettings.getState().settings!.providers.find((p) => p.id === profile.id)!);
      setStatuses((s) => ({ ...s, [profile.id]: `Connected · ${models.length} models` }));
    } catch (e) {
      setStatuses((s) => ({ ...s, [editing.id]: `Unavailable: ${(e as Error).message}` }));
    } finally {
      setBusy(false);
    }
  }
  function update(patch: Partial<ProviderProfile>) {
    setEditing((p) => p && { ...p, ...patch });
  }
  return (
    <section aria-label="AI Providers" className="settings-fields ai-providers">
      <div className="ai-providers-heading">
        <h2>AI Providers</h2>
        <button
          type="button"
          onClick={() => {
            setManual('');
            setEditing(
              providerProfileSchema.parse({
                id: crypto.randomUUID(),
                name: 'Local Ollama',
                authMethod: 'none',
              }),
            );
          }}
        >
          Add provider
        </button>
      </div>
      <p>
        Configure accounts and servers. The application default applies to new chats and agents.
      </p>
      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            void attempt(async () => {
              await persist(editing);
              setEditing(null);
              setManual('');
            }).finally(() => setBusy(false));
          }}
        >
          <fieldset disabled={busy}>
            <legend>
              {settings.providers.some((p) => p.id === editing.id)
                ? 'Edit provider'
                : 'New provider'}
            </legend>
            <label>
              Display name
              <input
                name="providerName"
                required
                maxLength={200}
                value={editing.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </label>
            <label>
              Provider type
              <select
                name="providerType"
                value={editing.provider}
                onChange={(e) => {
                  const provider = e.target.value as LLMProviderName;
                  update({
                    provider,
                    apiBaseUrl: provider === 'ollama' ? '' : defaults[provider],
                    ollamaUrl: defaults.ollama,
                    chatModel: '',
                    embeddingModel: '',
                    modelIds: [],
                    manualModelIds: [],
                    apiKey: '',
                    authMethod: provider === 'ollama' ? 'none' : 'bearer',
                  });
                }}
              >
                {Object.entries(labels).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              API base URL
              <input
                name="baseUrl"
                type="url"
                required
                value={
                  editing.provider === 'ollama'
                    ? editing.ollamaUrl
                    : editing.apiBaseUrl || defaults[editing.provider]
                }
                onChange={(e) =>
                  update(
                    editing.provider === 'ollama'
                      ? { ollamaUrl: e.target.value }
                      : { apiBaseUrl: e.target.value },
                  )
                }
              />
            </label>
            {(editing.provider === 'ollama' ? editing.ollamaUrl : editing.apiBaseUrl).startsWith(
              'http:',
            ) && (
              <p className="small">
                HTTP is unencrypted. Use HTTPS for remote servers, especially when sending
                credentials.
              </p>
            )}
            {editing.provider === 'custom' && (
              <>
                <label>
                  Authentication
                  <select
                    name="authMethod"
                    value={editing.authMethod}
                    onChange={(e) =>
                      update({ authMethod: e.target.value as ProviderProfile['authMethod'] })
                    }
                  >
                    <option value="none">None</option>
                    <option value="bearer">Bearer token</option>
                    <option value="header">API key header</option>
                  </select>
                </label>
                {editing.authMethod === 'header' && (
                  <label>
                    Header name
                    <input
                      required
                      name="authHeader"
                      value={editing.authHeader}
                      onChange={(e) => update({ authHeader: e.target.value })}
                    />
                  </label>
                )}
              </>
            )}
            <label>
              {editing.hasCredential
                ? 'Replace API credential (leave blank to retain)'
                : 'API credential'}
              <input
                name="credential"
                type="password"
                autoComplete="new-password"
                value={editing.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
              />
            </label>
            <p className="small muted">
              Credentials are encrypted using your operating system and are never loaded back into
              this form.
            </p>
            {editing.hasCredential && (
              <button
                type="button"
                onClick={() =>
                  void attempt(async () => {
                    await window.workspace.providers.clearCredential(editing.id);
                    await load();
                    update({ hasCredential: false, apiKey: '' });
                  })
                }
              >
                Remove stored credential
              </button>
            )}
            <label>
              Request timeout (milliseconds)
              <input
                name="timeout"
                required
                type="number"
                min={1}
                max={600000}
                value={editing.timeout ?? 300000}
                onChange={(e) => update({ timeout: e.target.valueAsNumber })}
              />
            </label>
            <label className="check">
              <input
                name="enabled"
                type="checkbox"
                checked={editing.enabled !== false}
                onChange={(e) => update({ enabled: e.target.checked })}
              />
              Enabled
            </label>
            <div className="actions">
              <button
                type="button"
                disabled={editing.enabled === false}
                onClick={() => void check()}
              >
                Test connection / Refresh models
              </button>
            </div>
            <p role="status">{statuses[editing.id]}</p>
            {!editing.modelIds?.length && (
              <p>No models available. Refresh discovery or add a model ID manually.</p>
            )}
            <label>
              Manual model ID
              <input
                name="manualModel"
                value={manual}
                maxLength={200}
                onChange={(e) => setManual(e.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={!manual.trim()}
              onClick={() => {
                update({
                  modelIds: [...new Set([...(editing.modelIds ?? []), manual.trim()])],
                  manualModelIds: [...new Set([...(editing.manualModelIds ?? []), manual.trim()])],
                });
                setManual('');
              }}
            >
              Add model
            </button>
            <label>
              Default chat model
              <select
                name="defaultModel"
                value={editing.chatModel}
                onChange={(e) => update({ chatModel: e.target.value })}
              >
                <option value="">Select model</option>
                {editing.modelIds?.map((id) => (
                  <option key={id}>{id}</option>
                ))}
              </select>
            </label>
            <label>
              Embedding model ID
              <input
                name="embeddingModel"
                value={editing.embeddingModel}
                onChange={(e) => update({ embeddingModel: e.target.value })}
              />
            </label>
            {editing.provider === 'anthropic' && (
              <p>
                Anthropic does not support embeddings. Knowledge indexing requires a default
                provider with embedding support.
              </p>
            )}
            {!!editing.modelIds?.length && (
              <details>
                <summary>Registered models</summary>
                {editing.modelIds.map((id) => (
                  <div key={id} className="field-row">
                    <span>{id}</span>
                    <button
                      type="button"
                      onClick={() =>
                        update({
                          modelIds: editing.modelIds?.filter((m) => m !== id),
                          manualModelIds: editing.manualModelIds?.filter((m) => m !== id),
                          chatModel: editing.chatModel === id ? '' : editing.chatModel,
                        })
                      }
                    >
                      Remove {id}
                    </button>
                  </div>
                ))}
              </details>
            )}
            <div className="actions">
              <button className="primary" type="submit">
                Save provider
              </button>
              <button type="button" onClick={() => setEditing(null)}>
                Close
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {!settings.providers.length && <p>No providers configured. Add a provider to get started.</p>}
      {settings.providers.map((p) => (
        <article key={p.id} className="settings-section">
          <div>
            <h3>
              {p.name}{' '}
              {settings.activeProviderId === p.id && (
                <span className="badge">Application default</span>
              )}
            </h3>
            <p>
              {labels[p.provider]} · {p.chatModel || 'No default model'}
            </p>
            <p className="small" role="status">
              {p.enabled === false ? 'Disabled' : (statuses[p.id] ?? 'Connection not tested')}
            </p>
          </div>
          <div className="actions">
            <button
              type="button"
              onClick={() => {
                setEditing({ ...p, apiKey: '' });
                setManual('');
              }}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() =>
                void attempt(async () => {
                  await persist({ ...p, enabled: p.enabled === false });
                  setEditing(null);
                })
              }
            >
              {p.enabled === false ? 'Enable' : 'Disable'}
            </button>
            <button
              type="button"
              disabled={p.enabled === false || settings.activeProviderId === p.id}
              onClick={() => void attempt(() => save({ ...settings, activeProviderId: p.id }))}
            >
              Set default
            </button>
            <button
              type="button"
              onClick={() =>
                void attempt(async () => {
                  const usage = await window.workspace.providers.usage(p.id);
                  if (usage.agents.length) {
                    setBlockedRemoval({ name: p.name, agents: usage.agents });
                    return;
                  }
                  setRemoval({
                    id: p.id,
                    detail: `Delete ${p.name}? Historical messages remain readable. Affected chats: ${usage.conversations.join(', ') || 'none'}. These will require reassignment. ${settings.activeProviderId === p.id ? 'Select another application default afterward.' : ''}`,
                  });
                })
              }
            >
              Delete
            </button>
          </div>
        </article>
      ))}
      {blockedRemoval && (
        <Modal title="Cannot delete provider" onClose={() => setBlockedRemoval(null)}>
          <p role="alert">
            “{blockedRemoval.name}” is used by{' '}
            {blockedRemoval.agents.length === 1
              ? 'this agent'
              : `these ${blockedRemoval.agents.length} agents`}
            :
          </p>
          <ul className="provider-dependent-agents">
            {blockedRemoval.agents.map((name, index) => (
              <li key={index}>{name}</li>
            ))}
          </ul>
          <p>
            Assign {blockedRemoval.agents.length === 1 ? 'this agent' : 'these agents'} to another
            provider before deleting it.
          </p>
          <div className="actions">
            <button type="button" onClick={() => setBlockedRemoval(null)}>
              Close
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => useUI.setState({ section: 'Agents' })}
            >
              Manage agents
            </button>
          </div>
        </Modal>
      )}
      {removal && (
        <Confirm
          title="Delete provider?"
          detail={removal.detail}
          onClose={() => setRemoval(null)}
          onConfirm={async () => {
            const current = useSettings.getState().settings!;
            await save({
              ...current,
              activeProviderId:
                current.activeProviderId === removal.id ? '' : current.activeProviderId,
              providers: current.providers.filter((p) => p.id !== removal.id),
            });
            if (editing?.id === removal.id) setEditing(null);
            setRemoval(null);
          }}
        />
      )}
    </section>
  );
}
