import { AIProviders } from './ai-providers';
import { useEffect, useState } from 'react';
import { KeyRound, Download, Upload } from 'lucide-react';
import { useSettings, useAgents, useUI, attempt } from '../stores';
import type { Settings as SettingsType } from '../../shared/types';
import { PageHeader } from '../components/common';
export function Settings() {
  const state = useSettings();
  const { items: agents } = useAgents();
  const [value, setValue] = useState<SettingsType | null>(state.settings);
  const [keys, setKeys] = useState<string[]>([]);
  const [keyName, setKeyName] = useState('');
  const [secret, setSecret] = useState('');
  const [path, setPath] = useState('');
  const [tab, setTab] = useState<'general' | 'providers'>('general');
  useEffect(() => {
    setValue(state.settings);
  }, [state.settings]);
  useEffect(() => {
    void attempt(async () => {
      setKeys(await window.workspace.secrets.list());
      setPath(await window.workspace.settings.dataPath());
    });
  }, []);
  if (!value) return null;
  const update = (key: keyof SettingsType, v: unknown) => setValue((s) => s && { ...s, [key]: v });
  return (
    <div className="page settings-page">
      <PageHeader
        eyebrow="MAKE IT YOURS"
        title="Settings"
        description="Your workspace, models, and local preferences."
        actions={
          <>
            <button
              onClick={() =>
                void attempt(async () => {
                  await window.workspace.system.importSettings();
                  await state.load();
                })
              }
            >
              <Upload size={15} />
              Import
            </button>
            <button onClick={() => void attempt(() => window.workspace.system.exportSettings())}>
              <Download size={15} />
              Export
            </button>
          </>
        }
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
      </nav>
      {tab === 'providers' ? (
        <AIProviders />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void attempt(async () => {
              await state.save({
                ...value,
                providers: useSettings.getState().settings?.providers ?? value.providers,
              });
              await state.refresh();
              useUI.setState({ notice: 'Settings saved' });
            });
          }}
        >
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
                  Files may be changed without confirmation. Full auto also runs project scripts.
                  MCP operations still require approval; destructive commands are blocked.
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
                    max={50}
                    value={value.maxIterations}
                    onChange={(e) => update('maxIterations', Number(e.target.value))}
                  />
                </label>
              </div>
            </div>
          </section>
          <div className="settings-save">
            <button className="primary">Save settings</button>
          </div>
        </form>
      )}
      <section className="settings-section">
        <div>
          <h2>Credentials</h2>
          <p>Encrypted using your operating system. Values never return to the interface.</p>
        </div>
        <div className="settings-fields">
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
      <section className="settings-section">
        <div>
          <h2>Local data</h2>
          <p>Portable definitions and private local history.</p>
        </div>
        <code className="data-path">{path}</code>
      </section>
    </div>
  );
}
