import { LandingEditor } from './landing-settings';
import { defaultLanding } from '../../shared/landing';
import { AIProviders } from './ai-providers';
import { useEffect, useRef, useState } from 'react';
import { KeyRound, Download, Upload } from 'lucide-react';
import { useSettings, useAgents, useUI, attempt } from '../stores';
import type { Settings as SettingsType } from '../../shared/types';
import type { WorkspaceBackupFormat } from '../../shared/workspace-backup';
import { PageHeader } from '../components/common';
export function Settings() {
  const state = useSettings();
  const { items: agents } = useAgents();
  const [value, setValue] = useState<SettingsType | null>(state.settings);
  const [keys, setKeys] = useState<string[]>([]);
  const [keyName, setKeyName] = useState('');
  const [secret, setSecret] = useState('');
  const [path, setPath] = useState('');
  const logoInput = useRef<HTMLInputElement>(null);
  const [readingLogo, setReadingLogo] = useState(false);
  const [tab, setTab] = useState<
    'general' | 'kbase' | 'providers' | 'landing' | 'credentials' | 'backup'
  >('general');
  const [refreshingEmbeddings, setRefreshingEmbeddings] = useState(false);
  const [backupFormat, setBackupFormat] = useState<WorkspaceBackupFormat>('json');
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    setValue(state.settings);
  }, [state.settings]);
  useEffect(() => {
    void attempt(async () => {
      setPath(await window.workspace.settings.dataPath());
    });
  }, []);
  useEffect(() => {
    if (tab === 'credentials')
      void attempt(async () => setKeys(await window.workspace.secrets.list()));
  }, [tab]);
  if (!value) return null;
  const embeddingProvider = value.providers.find((p) => p.id === value.activeProviderId);
  const embeddingModels = [
    ...new Set(
      [...(embeddingProvider?.modelIds ?? []), embeddingProvider?.embeddingModel ?? ''].filter(
        Boolean,
      ),
    ),
  ];
  const update = (key: keyof SettingsType, v: unknown) => setValue((s) => s && { ...s, [key]: v });
  return (
    <div className="page settings-page">
      <PageHeader
        eyebrow="MAKE IT YOURS"
        title="Settings"
        description="Your workspace, models, and local preferences."
      />
      <nav className="actions settings-tabs" aria-label="Settings pages">
        <button type="button" aria-pressed={tab === 'general'} onClick={() => setTab('general')}>
          General
        </button>
        <button
          type="button"
          aria-pressed={tab === 'providers'}
          onClick={() => setTab('providers')}
        >
          AI Providers
        </button>
        <button type="button" aria-pressed={tab === 'kbase'} onClick={() => setTab('kbase')}>
          KBase
        </button>
        <button type="button" aria-pressed={tab === 'landing'} onClick={() => setTab('landing')}>
          Landing
        </button>
        <button
          type="button"
          aria-pressed={tab === 'credentials'}
          onClick={() => setTab('credentials')}
        >
          Credentials
        </button>
        <button type="button" aria-pressed={tab === 'backup'} onClick={() => setTab('backup')}>
          Import / Export
        </button>
      </nav>
      {tab === 'landing' ? (
        <LandingEditor
          value={value.landing ?? defaultLanding}
          onChange={(landing) => update('landing', landing)}
          onSave={async (landing) => {
            const current = useSettings.getState().settings;
            if (!current) return;
            await state.save({ ...current, landing });
            useUI.setState({ notice: 'Landing page saved' });
          }}
        />
      ) : tab === 'credentials' ? null : tab === 'providers' ? (
        <AIProviders />
      ) : tab === 'backup' ? (
        <section className="settings-section workspace-backup">
          <div>
            <h2>Workspace backup</h2>
            <p>Export or restore your app-managed workspace data.</p>
          </div>
          <div className="settings-fields">
            <p>
              Includes settings, chat history, agents, skills, saved text, MCP server definitions,
              custom tool definitions and code, and workflows. Same-ID records are replaced on
              import; other local records are kept.
            </p>
            <p className="callout">
              Backups include private chat content, executable MCP/tool definitions, and literal
              values saved in MCP environment configuration. OS-stored API keys and imported .env
              contents are not included. External project/server folders are not copied, so
              gitignored folders are never copied either. Matching provider IDs keep credentials
              already stored on this device.
            </p>
            <div className="field-row backup-controls">
              <label>
                Export format
                <select
                  aria-label="Export format"
                  value={backupFormat}
                  onChange={(e) => setBackupFormat(e.target.value as WorkspaceBackupFormat)}
                >
                  <option value="json">JSON</option>
                  <option value="yaml">YAML</option>
                  <option value="md">Markdown</option>
                </select>
              </label>
              <div className="actions">
                <button
                  className="primary"
                  onClick={() =>
                    void attempt(() => window.workspace.system.exportWorkspace(backupFormat))
                  }
                >
                  <Download size={15} /> Export workspace
                </button>
                <button
                  disabled={importing}
                  onClick={() =>
                    void attempt(async () => {
                      setImporting(true);
                      try {
                        const result = await window.workspace.system.importWorkspace();
                        if (!result) return;
                        await Promise.all([state.load(), useAgents.getState().load()]);
                        useUI.setState({
                          notice: `Imported ${result.conversations} chats, ${result.workflows} workflows, and ${Object.values(result.libraries).reduce((sum, count) => sum + count, 0)} definitions.`,
                        });
                      } finally {
                        setImporting(false);
                      }
                    })
                  }
                >
                  <Upload size={15} /> {importing ? 'Importing…' : 'Import backup'}
                </button>
              </div>
            </div>
            <p className="small muted">
              Import accepts `.json`, `.yaml`, `.yml`, or `.md` workspace backups. Chat histories
              with matching IDs are replaced; histories not present in the backup remain unchanged.
            </p>
          </div>
        </section>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void attempt(async () => {
              await state.save({
                ...value,
                providers: (await window.workspace.settings.get()).providers.map((provider) =>
                  provider.id === embeddingProvider?.id
                    ? { ...provider, embeddingModel: embeddingProvider.embeddingModel }
                    : provider,
                ),
              });
              await state.refresh();
              useUI.setState({ notice: 'Settings saved' });
            });
          }}
        >
          {tab === 'kbase' ? (
            <>
              <section className="settings-section">
                <div>
                  <h2>Embedding</h2>
                  <p>Shared across all knowledge bases.</p>
                </div>
                <div className="settings-fields">
                  <p>Provider: {embeddingProvider?.name ?? 'No application default selected'}</p>
                  {embeddingProvider?.provider === 'anthropic' ? (
                    <p>
                      Anthropic does not support embeddings. Choose an application default with
                      embedding support in AI Providers.
                    </p>
                  ) : (
                    <>
                      <label>
                        Embedding model
                        <select
                          name="kbEmbeddingModel"
                          aria-label="Embedding model"
                          value={embeddingProvider?.embeddingModel ?? ''}
                          disabled={!embeddingProvider || embeddingProvider.enabled === false}
                          aria-describedby="kb-embedding-help"
                          onChange={(e) =>
                            update(
                              'providers',
                              value.providers.map((provider) =>
                                provider.id === embeddingProvider?.id
                                  ? { ...provider, embeddingModel: e.target.value }
                                  : provider,
                              ),
                            )
                          }
                        >
                          <option value="">Select embedding model</option>
                          {embeddingModels.map((model) => (
                            <option key={model} value={model}>
                              {model}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        disabled={
                          !embeddingProvider ||
                          embeddingProvider.enabled === false ||
                          refreshingEmbeddings
                        }
                        onClick={() =>
                          void attempt(async () => {
                            if (!embeddingProvider) return;
                            setRefreshingEmbeddings(true);
                            try {
                              const models = await window.workspace.models.list(
                                embeddingProvider.id,
                              );
                              setValue(
                                (current) =>
                                  current && {
                                    ...current,
                                    providers: current.providers.map((provider) =>
                                      provider.id === embeddingProvider.id
                                        ? {
                                            ...provider,
                                            modelIds: models.map((model) => model.name),
                                          }
                                        : provider,
                                    ),
                                  },
                              );
                            } finally {
                              setRefreshingEmbeddings(false);
                            }
                          })
                        }
                      >
                        {refreshingEmbeddings ? 'Refreshing…' : 'Refresh embedding models'}
                      </button>
                      <p id="kb-embedding-help" className="small muted">
                        Choose a model that supports embeddings from your application default
                        provider. After changing the model, reindex existing knowledge sources.
                      </p>
                    </>
                  )}
                </div>
              </section>
              <section className="settings-section">
                <div>
                  <h2>Knowledge retrieval</h2>
                  <p>Control how documents are split and retrieved.</p>
                </div>
                <div className="settings-fields">
                  <div className="field-row">
                    {(['topK', 'chunkSize', 'chunkOverlap'] as const).map((key) => (
                      <label key={key}>
                        {{ topK: 'Top K', chunkSize: 'Chunk size', chunkOverlap: 'Overlap' }[key]}
                        <input
                          type="number"
                          value={value[key]}
                          onChange={(e) => update(key, Number(e.target.value))}
                        />
                      </label>
                    ))}
                  </div>
                  <label>
                    Custom ignore patterns · one per line
                    <textarea
                      rows={3}
                      value={value.ignorePatterns.join('\n')}
                      onChange={(e) =>
                        update('ignorePatterns', e.target.value.split('\n').filter(Boolean))
                      }
                      placeholder={'**/generated/**\n**/private/**'}
                    />
                  </label>
                </div>
              </section>
            </>
          ) : (
            <>
              <section className="settings-section">
                <div>
                  <h2>General</h2>
                  <p>The way your workspace looks and starts.</p>
                </div>
                <div className="settings-fields">
                  <label>
                    Application name
                    <input
                      required
                      value={value.appName}
                      onChange={(e) => update('appName', e.target.value)}
                    />
                  </label>
                  <div className="app-logo-setting">
                    <span className="small muted">Application logo</span>
                    <div className="app-logo-control">
                      <div className="app-logo-preview">
                        {value.appLogo ? (
                          <img src={value.appLogo} alt="Current application logo" />
                        ) : null}
                      </div>
                      <div>
                        <input
                          ref={logoInput}
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          hidden
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = '';
                            if (!file) return;
                            setReadingLogo(true);
                            void attempt(async () => {
                              try {
                                if (
                                  file.size > 1_048_576 ||
                                  !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
                                )
                                  throw new Error('Choose a PNG, JPEG, or WebP logo up to 1 MB.');
                                const appLogo = await new Promise<string>((resolve, reject) => {
                                  const reader = new FileReader();
                                  reader.onload = () => resolve(String(reader.result));
                                  reader.onerror = () =>
                                    reject(new Error('Could not read the logo.'));
                                  reader.readAsDataURL(file);
                                });
                                const image = new Image();
                                image.src = appLogo;
                                await image.decode();
                                update('appLogo', appLogo);
                              } finally {
                                setReadingLogo(false);
                              }
                            });
                          }}
                        />
                        <div className="actions">
                          <button
                            type="button"
                            disabled={readingLogo}
                            onClick={() => logoInput.current?.click()}
                          >
                            <Upload size={14} /> {readingLogo ? 'Loading…' : 'Choose logo'}
                          </button>
                          {value.appLogo && (
                            <button
                              type="button"
                              disabled={readingLogo}
                              onClick={() => update('appLogo', '')}
                            >
                              Remove logo
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    <p className="small muted">
                      PNG, JPEG, or WebP, up to 1 MB. Save settings to apply.
                    </p>
                  </div>
                  <div className="field-row">
                    <label>
                      Theme
                      <select
                        aria-label="Theme"
                        value={value.theme}
                        onChange={(e) => update('theme', e.target.value)}
                      >
                        <option value="system">System</option>
                        <option value="dark">Dark</option>
                        <option value="light">Light</option>
                      </select>
                    </label>
                    <label>
                      Language
                      <select value="en" onChange={() => {}}>
                        <option value="en">English</option>
                      </select>
                    </label>
                  </div>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={value.startAtLogin}
                      onChange={(e) => update('startAtLogin', e.target.checked)}
                    />
                    Open at login
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={value.memoryEnabled}
                      onChange={(e) => update('memoryEnabled', e.target.checked)}
                    />
                    Enable long-term agent memory
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={value.memoryAutomatic}
                      onChange={(e) => update('memoryAutomatic', e.target.checked)}
                    />
                    Allow automatic memory capture (explicit “remember …” always works)
                  </label>
                </div>
              </section>
              <section className="settings-section">
                <div>
                  <h2>Generation defaults</h2>
                  <p>Used for new requests across providers.</p>
                </div>
                <div className="settings-fields">
                  <label>
                    Temperature
                    <input
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      value={value.temperature}
                      onChange={(e) => update('temperature', e.target.valueAsNumber)}
                    />
                  </label>
                  <label>
                    Context size
                    <input
                      type="number"
                      min={1024}
                      max={131072}
                      step={1024}
                      value={value.contextSize}
                      onChange={(e) => update('contextSize', e.target.valueAsNumber)}
                    />
                  </label>
                </div>
              </section>
              <section className="settings-section">
                <div>
                  <h2>Agents</h2>
                  <p>Bound execution and decide when approval is needed.</p>
                </div>
                <div className="settings-fields">
                  <label>
                    Default agent
                    <select
                      value={value.defaultAgent}
                      onChange={(e) => update('defaultAgent', e.target.value)}
                    >
                      <option value="">None</option>
                      {agents.map((a) => (
                        <option value={a.id} key={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Agent engine
                    <select
                      value={value.deepAgentMode}
                      onChange={(e) =>
                        update('deepAgentMode', e.target.value as SettingsType['deepAgentMode'])
                      }
                    >
                      <option value="classic">Classic loop (JSON actions)</option>
                      <option value="deep">Deep Agents (autonomous, selected folder)</option>
                    </select>
                  </label>
                  <label>
                    Approval mode
                    <select
                      value={value.approvalMode}
                      onChange={(e) => update('approvalMode', e.target.value)}
                    >
                      <option value="ask">Ask before changes</option>
                      <option value="safe">Auto approve safe file changes</option>
                      <option value="auto">Full auto for allowed tools</option>
                    </select>
                  </label>
                  {value.approvalMode !== 'ask' && (
                    <p className="callout">
                      Files may be changed without confirmation. Full auto also runs project
                      scripts. MCP operations still require approval; destructive commands are
                      blocked.
                    </p>
                  )}
                  <div className="field-row">
                    <label>
                      Command timeout (ms)
                      <input
                        type="number"
                        value={value.commandTimeout}
                        onChange={(e) => update('commandTimeout', Number(e.target.value))}
                      />
                    </label>
                    <label>
                      Maximum iterations
                      <input
                        type="number"
                        min={1}
                        max={500}
                        value={value.maxIterations}
                        onChange={(e) => update('maxIterations', Number(e.target.value))}
                      />
                    </label>
                  </div>
                </div>
              </section>
            </>
          )}
          <div className="settings-save">
            <button className="primary">Save settings</button>
          </div>
        </form>
      )}
      {tab === 'credentials' && (
        <>
          <section className="settings-section">
            <div>
              <h2>Credentials</h2>
              <p>Encrypted using your operating system. Values never return to the interface.</p>
            </div>
            <div className="settings-fields">
              {!keys.length && <p className="small muted">No stored credentials yet.</p>}
              {keys.map((k) => (
                <div className="secret-row" key={k}>
                  <KeyRound size={16} />
                  <strong>{k}</strong>
                  <span>••••••••</span>
                  <button
                    onClick={() =>
                      void attempt(async () => {
                        await window.workspace.secrets.remove(k);
                        setKeys(await window.workspace.secrets.list());
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void attempt(async () => {
                    await window.workspace.secrets.set(keyName, secret);
                    setSecret('');
                    setKeys(await window.workspace.secrets.list());
                    useUI.setState({ notice: 'Credential stored securely' });
                  });
                }}
              >
                <label>
                  Reference name
                  <input
                    required
                    pattern="[A-Za-z_][A-Za-z0-9_]*"
                    placeholder="GITHUB_TOKEN"
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                  />
                </label>
                <label>
                  API key
                  <input
                    required
                    type="password"
                    autoComplete="new-password"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                  />
                </label>
                <button>Store / update key</button>
              </form>
              <p className="small muted">
                MCP resolves {'${NAME}'} from stored credentials, a selected .env file, then the
                application process environment. No environment values are displayed.
              </p>
              <div className="actions">
                <button
                  onClick={() =>
                    void attempt(async () => {
                      const names = await window.workspace.secrets.importEnv();
                      useUI.setState({
                        notice: `Environment file loaded: ${names.length} references. Restart MCP servers to use it.`,
                      });
                    })
                  }
                >
                  Use .env file
                </button>
                <button
                  onClick={() =>
                    void attempt(async () => {
                      await window.workspace.secrets.clearEnv();
                      useUI.setState({ notice: 'Environment file disconnected' });
                    })
                  }
                >
                  Disconnect .env file
                </button>
              </div>
            </div>
          </section>
        </>
      )}
      {tab === 'general' && (
        <section className="settings-section">
          <div>
            <h2>Local data</h2>
            <p>Portable definitions and private local history.</p>
          </div>
          <code className="data-path">{path}</code>
        </section>
      )}
    </div>
  );
}
