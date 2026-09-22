import { ProviderSelector } from '../components/provider-selector';
import { CapabilitySettings } from '../components/capability-settings';
import { FolderSelection } from '../components/folder-selection';
import { useState } from 'react';
import {
  Plus,
  Search,
  Zap,
  FileText,
  Bot,
  Plug,
  Upload,
  Play,
  Wrench,
  Square,
  ChevronDown,
} from 'lucide-react';
import type { LibraryKind, LibraryItem } from '../../shared/types';
import { librarySchema } from '../../shared/schemas';
import { parseMCPConfig } from '../../shared/mcp-config';
import {
  libraryStores,
  useSettings,
  useSkills,
  useTools,
  useKnowledge,
  useMCPStatus,
  useRuns,
  useUI,
  useChat,
  attempt,
} from '../stores';
import { PageHeader, Empty, Modal, Confirm, Markdown, CopyButton } from '../components/common';
const descriptions = {
  tools: 'Reusable API calls and custom Node.js logic for your agents.',
  skills: 'Reusable instructions that make your models work your way.',
  'saved-text': 'Notes and prompts, automatically indexed in your local knowledge base.',
  agents: 'Purpose-built workers for your local projects.',
  mcp: 'Connect local tools through the Model Context Protocol.',
};
const titles = {
  tools: 'Tools',
  skills: 'Skills',
  'saved-text': 'Saved Text',
  agents: 'Agents',
  mcp: 'MCP',
};
const icons = { tools: Wrench, skills: Zap, 'saved-text': FileText, agents: Bot, mcp: Plug };
const builtinTools = [
  'filesystem.read',
  'filesystem.write',
  'filesystem.edit',
  'filesystem.list',
  'filesystem.search',
  'filesystem.exists',
  'project.detect',
  'git.status',
  'git.diff',
  'git.log',
  'shell.execute',
];
export function Library({ kind }: { kind: LibraryKind }) {
  const { items, load } = libraryStores[kind]();
  const providerSettings = useSettings((s) => s.settings);
  const enabledProviders = providerSettings?.providers.filter((p) => p.enabled !== false) ?? [];
  const defaultProvider =
    enabledProviders.length === 1
      ? enabledProviders[0]
      : enabledProviders.find((p) => p.id === providerSettings?.activeProviderId);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkDelete, setBulkDelete] = useState(false);
  const [testTool, setTestTool] = useState<LibraryItem | null>(null);
  const [editing, setEditing] = useState<LibraryItem | null>(null);
  const [remove, setRemove] = useState<LibraryItem | null>(null);
  const [run, setRun] = useState<LibraryItem | null>(null);
  const { states, load: loadStates } = useMCPStatus();
  const Icon = icons[kind];
  const create = () =>
    setEditing({
      ...librarySchema.parse({ id: crypto.randomUUID(), name: 'Untitled' }),
      name: '',
      maxIterations: useSettings.getState().settings?.maxIterations ?? 15,
      toolConfig:
        kind === 'tools'
          ? { type: 'javascript', parameters: [], url: '', method: 'GET', headers: {} }
          : undefined,
      providerId: defaultProvider?.id,
      model: defaultProvider?.chatModel ?? '',
      tools:
        kind === 'agents'
          ? ['project.detect', 'filesystem.read', 'filesystem.search', 'filesystem.list']
          : [],
    });
  return (
    <div className="page">
      <PageHeader
        eyebrow="YOUR WORKSPACE"
        title={titles[kind]}
        description={descriptions[kind]}
        actions={
          <>
            <button
              onClick={() =>
                void attempt(async () => {
                  await window.workspace.library.import(kind);
                  await load();
                })
              }
            >
              <Upload size={16} />
              Import
            </button>
            <button className="primary" onClick={create}>
              <Plus size={17} />
              New{' '}
              {kind === 'saved-text'
                ? 'text'
                : kind === 'mcp'
                  ? 'server'
                  : kind === 'skills'
                    ? 'skill'
                    : kind === 'tools'
                      ? 'tool'
                      : 'agent'}
            </button>
          </>
        }
      />
      <div className="section-toolbar">
        <div className="search-input">
          <Search size={16} />
          <input
            aria-label={`Search ${titles[kind]}`}
            placeholder={`Search ${titles[kind].toLowerCase()}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <span className="muted small">
          {items.length} {items.length === 1 ? 'item' : 'items'} · stored as{' '}
          {kind === 'mcp' ? 'JSON' : 'Markdown'}
        </span>
      </div>
      {kind === 'agents' && !!items.length && (
        <div className="section-toolbar">
          <label className="check">
            <input
              type="checkbox"
              checked={items.every((i) => selected.includes(i.id))}
              onChange={(e) => setSelected(e.target.checked ? items.map((i) => i.id) : [])}
            />
            Select all Agents
          </label>
          <span>{selected.length} Agents selected</span>
          <button
            className="danger"
            disabled={!selected.length}
            onClick={() => setBulkDelete(true)}
          >
            Delete Selected
          </button>
        </div>
      )}
      {!items.length ? (
        <Empty
          icon={<Icon size={30} />}
          title={`Your ${titles[kind].toLowerCase()} start here`}
          description={descriptions[kind]}
          action={
            <button onClick={create}>
              <Plus size={16} />
              Create your first{' '}
              {kind === 'skills'
                ? 'skill'
                : kind === 'agents'
                  ? 'agent'
                  : kind === 'mcp'
                    ? 'server'
                    : kind === 'tools'
                      ? 'tool'
                      : 'note'}
            </button>
          }
        />
      ) : (
        <div className={kind === 'skills' ? 'accordions' : 'library-grid'}>
          {items
            .filter((i) =>
              (i.name + ' ' + i.description + ' ' + i.content)
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .map((item) => {
              const state = states.find((s) => s.id === item.id);
              const actions = (
                <div className="card-actions">
                  <button onClick={() => setEditing(item)}>Edit</button>
                  {kind === 'tools' && (
                    <button onClick={() => setTestTool(item)}>Test / Run</button>
                  )}
                  {kind === 'agents' && (
                    <button className="primary" onClick={() => setRun(item)}>
                      <Play size={13} />
                      Run
                    </button>
                  )}
                  {kind === 'agents' && (
                    <button
                      onClick={() =>
                        void attempt(async () => {
                          await useChat
                            .getState()
                            .newChat({
                              providerId: item.providerId ?? '',
                              model: item.model,
                              agentId: item.id,
                            });
                          useUI.setState({
                            section: 'Chat',
                            draft: '',
                            chatCommand: { kind: 'agent', id: item.id, name: item.name },
                          });
                        })
                      }
                    >
                      Open in Chat
                    </button>
                  )}
                  {kind === 'saved-text' && (
                    <>
                      <CopyButton text={item.content} />
                      <button
                        onClick={() =>
                          void attempt(async () => {
                            await useChat.getState().newChat();
                            useUI.setState({ section: 'Chat', draft: item.content });
                          })
                        }
                      >
                        Send to Chat
                      </button>
                    </>
                  )}
                  <button
                    onClick={() =>
                      void attempt(() => window.workspace.library.export(kind, item.id))
                    }
                  >
                    Export
                  </button>
                  <button className="text-button danger-text" onClick={() => setRemove(item)}>
                    Delete
                  </button>
                </div>
              );
              const details = (
                <>
                  <p className="muted">{item.description || 'No description'}</p>
                  {kind === 'skills' && (
                    <>
                      <div className="small muted">Version {item.version}</div>
                      <Markdown text={item.content} />
                    </>
                  )}
                  {kind === 'saved-text' && (
                    <div className="note-preview">
                      <Markdown text={item.content.slice(0, 500)} />
                    </div>
                  )}
                  {kind === 'agents' && (
                    <div className="agent-meta">
                      <span>
                        {useSettings
                          .getState()
                          .settings?.providers.find((p) => p.id === item.providerId)?.name ??
                          'Unavailable provider'}{' '}
                        / {item.model || 'Select model'}
                      </span>
                      <span>
                        {item.skills.length} skills · {item.tools.length} tools
                      </span>
                    </div>
                  )}
                  {kind === 'mcp' && (
                    <>
                      <p className="small muted">Auto start: {item.autoStart ? 'On' : 'Off'}</p>
                      <code className="command-line">
                        {item.command} {item.args.join(' ')}
                      </code>
                      <p className="small muted">
                        {Object.keys(item.env)
                          .map((k) => `${k} = ********`)
                          .join(' · ') || 'No environment references'}
                      </p>
                      <div className="actions">
                        {(['start', 'stop', 'restart', 'test'] as const).map((action) => (
                          <button
                            key={action}
                            onClick={() =>
                              void attempt(async () => {
                                await window.workspace.mcp.action(item.id, action);
                                await loadStates();
                              })
                            }
                          >
                            {action[0].toUpperCase() + action.slice(1)}
                          </button>
                        ))}
                      </div>
                      <details>
                        <summary>Tools & logs ({state?.tools.length ?? 0})</summary>
                        {state?.tools.map((t) => (
                          <p className="small" key={t.name}>
                            <strong>{t.name}</strong> {t.description}
                          </p>
                        ))}
                        <pre className="log">
                          {state?.logs.join('\n') || 'Start this server to discover its tools.'}
                        </pre>
                      </details>
                    </>
                  )}
                  {actions}
                </>
              );
              return kind === 'skills' ? (
                <details className="skill-card" key={item.id}>
                  <summary>
                    <div className="item-icon">
                      <Icon size={20} />
                    </div>
                    <div>
                      <strong>{item.name}</strong>
                      <p>{item.description || 'Reusable model instructions'}</p>
                    </div>
                    <span className="badge">{item.enabled ? 'Enabled' : 'Disabled'}</span>
                    <ChevronDown size={16} />
                  </summary>
                  <div className="skill-body">{details}</div>
                </details>
              ) : (
                <article className="library-card" key={item.id}>
                  <div className="card-top">
                    <div className="item-icon">
                      <Icon size={21} />
                    </div>
                    <span className="badge">
                      {kind === 'mcp'
                        ? state?.status === 'connected'
                          ? 'Running'
                          : (state?.status ?? 'stopped')
                        : item.enabled
                          ? 'Local'
                          : 'Disabled'}
                    </span>
                  </div>
                  {kind === 'agents' && (
                    <label className="check">
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.name}`}
                        checked={selected.includes(item.id)}
                        onChange={(e) =>
                          setSelected((ids) =>
                            e.target.checked
                              ? [...ids, item.id]
                              : ids.filter((id) => id !== item.id),
                          )
                        }
                      />
                      Select
                    </label>
                  )}
                  <h2>{item.name}</h2>
                  {details}
                </article>
              );
            })}
        </div>
      )}
      {editing && (
        <LibraryEditor
          kind={kind}
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={async (item) => {
            await window.workspace.library.save(kind, item);
            await load();
            setEditing(null);
          }}
        />
      )}
      {remove && (
        <Confirm
          title={`Delete ${remove.name}?`}
          detail="This removes the local definition file. Export a copy first if you need a backup."
          onClose={() => setRemove(null)}
          onConfirm={async () => {
            await window.workspace.library.remove(kind, remove.id);
            await load();
          }}
        />
      )}
      {testTool && <TestTool tool={testTool} onClose={() => setTestTool(null)} />}
      {bulkDelete && (
        <Confirm
          title={`Delete ${selected.length} agents?`}
          detail="This action cannot be undone."
          onClose={() => setBulkDelete(false)}
          onConfirm={async () => {
            try {
              for (const id of selected) {
                await window.workspace.library.remove('agents', id);
                setSelected((ids) => ids.filter((value) => value !== id));
              }
            } finally {
              await load();
            }
          }}
        />
      )}
      {run && <RunAgent agent={run} onClose={() => setRun(null)} />}
      {kind === 'agents' && <AgentRuns />}
    </div>
  );
}
function LibraryEditor({
  kind,
  initial,
  onClose,
  onSave,
}: {
  kind: LibraryKind;
  initial: LibraryItem;
  onClose: () => void;
  onSave: (item: LibraryItem) => Promise<void>;
}) {
  const [item, setItem] = useState(initial);
  const [parameters, setParameters] = useState(
    JSON.stringify(initial.toolConfig?.parameters ?? [], null, 2),
  );
  const [headers, setHeaders] = useState(
    JSON.stringify(initial.toolConfig?.headers ?? {}, null, 2),
  );
  const { items: customTools } = useTools();
  const [args, setArgs] = useState(initial.args.join('\n'));
  const [env, setEnv] = useState(JSON.stringify(initial.env, null, 2));
  const [fromJSON, setFromJSON] = useState(false);
  const [configJSON, setConfigJSON] = useState(
    JSON.stringify({ command: initial.command, args: initial.args, env: initial.env }, null, 2),
  );
  const [busy, setBusy] = useState(false);
  const { settings } = useSettings();
  const enabled = settings?.providers.filter((p) => p.enabled !== false) ?? [];
  const effectiveProviderId =
    item.providerId ?? (enabled.length === 1 ? enabled[0].id : (settings?.activeProviderId ?? ''));
  const { items: skills } = useSkills();
  const { items: servers } = libraryStores.mcp();
  const { sources } = useKnowledge();
  const { states } = useMCPStatus();
  const tools = [
    ...builtinTools,
    ...customTools.map((t) => `custom:${t.id}`),
    ...item.tools,
    ...states.flatMap((s) => s.tools.map((t) => `mcp:${s.id}:${t.name}`)),
  ];
  const update = (key: keyof LibraryItem, value: unknown) =>
    setItem((i) => ({ ...i, [key]: value }));
  return (
    <Modal
      wide
      title={`${initial.createdAt ? 'Edit' : 'Create'} ${kind === 'saved-text' ? 'saved text' : kind === 'skills' ? 'skill' : kind === 'agents' ? 'agent' : kind === 'tools' ? 'tool' : 'MCP server'}`}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void attempt(async () => {
            try {
              await onSave(
                librarySchema.parse({
                  ...item,
                  ...(kind === 'agents' ? { providerId: effectiveProviderId } : {}),
                  ...(kind === 'tools'
                    ? {
                        toolConfig: {
                          ...item.toolConfig,
                          parameters: JSON.parse(parameters),
                          headers: JSON.parse(headers),
                        },
                      }
                    : {}),
                  ...(kind === 'mcp' && fromJSON
                    ? parseMCPConfig(configJSON)
                    : { args: args.split('\n').filter(Boolean), env: JSON.parse(env) }),
                }),
              );
            } finally {
              setBusy(false);
            }
          });
        }}
      >
        <label>
          {kind === 'saved-text' ? 'Title' : kind === 'mcp' ? 'Name (required)' : 'Name'}
          <input
            autoFocus
            required
            maxLength={200}
            value={item.name}
            onChange={(e) => update('name', e.target.value)}
          />
        </label>
        {kind !== 'saved-text' && (
          <label>
            {kind === 'mcp' ? 'Description (required)' : 'Description'}
            <input
              required={kind === 'mcp'}
              maxLength={2000}
              value={item.description}
              onChange={(e) => update('description', e.target.value)}
            />
          </label>
        )}
        {kind === 'skills' && (
          <label>
            Version
            <input value={item.version} onChange={(e) => update('version', e.target.value)} />
          </label>
        )}
        {kind === 'agents' && (
          <>
            <label>
              Maximum execution iterations
              <input
                type="number"
                min={1}
                max={50}
                required
                value={item.maxIterations ?? 15}
                onChange={(e) => update('maxIterations', e.target.valueAsNumber)}
              />
            </label>
            <ProviderSelector
              providerId={effectiveProviderId}
              model={item.model}
              onChange={(providerId, model) => setItem((i) => ({ ...i, providerId, model }))}
            />
            <CapabilitySettings
              item={item}
              onChange={(config) =>
                setItem((current) => ({
                  ...current,
                  capabilityConfig: config,
                  skills: config.skills,
                  tools: config.tools,
                  knowledgeSources: config.knowledgeBases,
                }))
              }
              skills={skills}
              servers={servers}
              knowledge={sources}
              tools={[...new Set(tools)].map((id) => ({
                id,
                name: customTools.find((t) => id === `custom:${t.id}`)?.name ?? id,
              }))}
            />
          </>
        )}
        {kind === 'tools' && (
          <>
            <p className="small muted">
              Custom tools run trusted local code or make API calls. Agent calls require approval.
            </p>
            <label>
              Execution type
              <select
                value={item.toolConfig?.type ?? 'javascript'}
                onChange={(e) => update('toolConfig', { ...item.toolConfig, type: e.target.value })}
              >
                <option value="javascript">Node.js / JavaScript</option>
                <option value="api">API call</option>
              </select>
            </label>
            <label>
              Input parameters · JSON
              <textarea
                rows={5}
                value={parameters}
                onChange={(e) => setParameters(e.target.value)}
                placeholder={'[{"name":"query","type":"string","required":true}]'}
              />
            </label>
            <p className="small muted">
              Parameters have name, type (string, number, boolean, object, array), and required.
            </p>
            {item.toolConfig?.type === 'api' && (
              <>
                <label>
                  API URL
                  <input
                    type="url"
                    required
                    value={item.toolConfig.url}
                    onChange={(e) =>
                      update('toolConfig', { ...item.toolConfig, url: e.target.value })
                    }
                  />
                </label>
                <label>
                  HTTP method
                  <select
                    value={item.toolConfig.method}
                    onChange={(e) =>
                      update('toolConfig', { ...item.toolConfig, method: e.target.value })
                    }
                  >
                    {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => (
                      <option key={method}>{method}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Headers · JSON
                  <textarea rows={4} value={headers} onChange={(e) => setHeaders(e.target.value)} />
                </label>
                <p className="small muted">
                  Use Settings secret references such as {'${API_TOKEN}'} in headers. GET sends
                  inputs as query parameters; other methods send JSON.
                </p>
              </>
            )}
          </>
        )}
        {kind === 'mcp' ? (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={item.autoStart}
                onChange={(e) => update('autoStart', e.target.checked)}
              />
              Start automatically when application starts
            </label>
            <div className="callout mcp-config-heading">
              <span>
                Starting a server executes this program on your machine. Add only servers you trust.
              </span>
              <label className="check">
                <input
                  type="checkbox"
                  checked={fromJSON}
                  onChange={(e) => setFromJSON(e.target.checked)}
                />
                Import from JSON
              </label>
            </div>
            {fromJSON ? (
              <label>
                MCP configuration JSON
                <textarea
                  required
                  rows={10}
                  value={configJSON}
                  onChange={(e) => setConfigJSON(e.target.value)}
                  spellCheck={false}
                />
              </label>
            ) : (
              <>
                <label>
                  Executable (optional)
                  <input
                    placeholder="npx"
                    value={item.command}
                    onChange={(e) => update('command', e.target.value)}
                  />
                </label>
                <label>
                  Arguments · one per line
                  <textarea
                    rows={4}
                    value={args}
                    placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/path/to/project'}
                    onChange={(e) => setArgs(e.target.value)}
                  />
                </label>
                <label>
                  Environment references · JSON
                  <textarea rows={4} value={env} onChange={(e) => setEnv(e.target.value)} />
                </label>
              </>
            )}
            <p className="small muted">
              A command is needed to start a server, but you can save it without one. JSON accepts
              one server object or an mcpServers object containing one server. Name and description
              above are used for the saved definition.
            </p>
            <p className="small muted">
              Use references such as {'{"GITHUB_TOKEN":"${GITHUB_TOKEN}"}'}. Add keys in Settings or
              configure the process environment.
            </p>
          </>
        ) : (
          <label>
            {kind === 'saved-text'
              ? 'Text'
              : kind === 'tools'
                ? 'JavaScript logic · use input, return the result (Node.js require available)'
                : 'Instructions'}
            <textarea
              className="editor"
              rows={10}
              value={item.content}
              onChange={(e) => update('content', e.target.value)}
              placeholder="Write in plain text or Markdown…"
            />
          </label>
        )}
        {kind !== 'saved-text' && (
          <label className="check">
            <input
              type="checkbox"
              checked={item.enabled}
              onChange={(e) => update('enabled', e.target.checked)}
            />
            Enabled
          </label>
        )}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function RunAgent({ agent, onClose }: { agent: LibraryItem; onClose: () => void }) {
  const [project, setProject] = useState('');
  const [task, setTask] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Run ${agent.name}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void attempt(async () => {
            setBusy(true);
            try {
              await window.workspace.agents.run({
                agentId: agent.id,
                project: project || undefined,
                task: task.trim() || 'Run your configured instructions.',
              });
              await useRuns.getState().load();
              onClose();
            } finally {
              setBusy(false);
            }
          });
        }}
      >
        <FolderSelection value={project} onChange={setProject} />
        <label>
          Task (optional)
          <textarea
            rows={5}
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Describe the work and how success should be verified…"
          />
        </label>
        <p className="small muted">
          Approval mode: {useSettings.getState().settings?.approvalMode}. You can stop the run at
          any time.
        </p>
        <div className="actions">
          <button className="primary" disabled={busy}>
            <Play size={16} />
            {busy ? 'Starting…' : 'Start agent'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function AgentRuns() {
  const { runs, load } = useRuns();
  const [resolved, setResolved] = useState<string[]>([]);
  if (!runs.length) return null;
  return (
    <section className="runs">
      <h2>Execution history</h2>
      {[...runs].reverse().map((run) => (
        <details key={run.id} className="run">
          <summary>
            <strong>
              {run.agentName} · {new Date(run.startedAt).toLocaleString()}
            </strong>
            <span>
              Iterations: {run.iterationsUsed} / {run.maxIterations}
            </span>
            <span className="badge">{run.status}</span>
          </summary>
          {!['Completed', 'Stopped', 'Failed', 'Cancelled', 'Max iterations reached'].includes(
            run.status,
          ) && (
            <button onClick={() => void attempt(() => window.workspace.agents.stop(run.id))}>
              <Square size={13} />
              Stop run
            </button>
          )}
          <p>
            Started: {new Date(run.startedAt).toLocaleString()} · Ended:{' '}
            {run.completedAt ? new Date(run.completedAt).toLocaleString() : 'Running'}
          </p>
          <p>
            Duration:{' '}
            {Math.max(
              0,
              Math.round(
                ((run.completedAt ? Date.parse(run.completedAt) : Date.now()) -
                  Date.parse(run.startedAt)) /
                  1000,
              ),
            )}
            s
          </p>
          <p className="folder-path">Folder: {run.folderPath || 'No folder selected'}</p>
          <p>Request: {run.userPrompt}</p>
          <p>MCPs: {run.mcps.map((m) => m.mcpName).join(', ') || 'None'}</p>
          <p>Tools: {run.tools.map((t) => `${t.toolName} (${t.status})`).join(', ') || 'None'}</p>
          {run.tools.map((tool, index) => (
            <details key={index}>
              <summary>
                {tool.toolName} · {tool.status}
              </summary>
              <p className="small muted">Input</p>
              <pre className="log">{JSON.stringify(tool.input, null, 2)}</pre>
              <p className="small muted">Output</p>
              <pre className="log">
                {typeof tool.output === 'string'
                  ? tool.output
                  : JSON.stringify(tool.output, null, 2)}
              </pre>
              {tool.error && <p className="error-text">{tool.error}</p>}
            </details>
          ))}
          {run.result && <Markdown text={run.result} />}
          {run.error && <p className="error-text">{run.error}</p>}
          {run.events.map((e, index) => (
            <div className="run-event" key={index}>
              <span className="small muted">{e.status}</span>
              {e.content && <pre className="log">{e.content}</pre>}
              {e.error && <p className="error-text">{e.error}</p>}
              {e.approval && (
                <div className="approval">
                  <h3>{e.approval.description}</h3>
                  {e.approval.diff && <pre className="diff">{e.approval.diff}</pre>}
                  {!resolved.includes(e.approval.id) &&
                  run.phase === 'Waiting for approval' &&
                  run.status === 'Running' ? (
                    <div className="actions">
                      <button
                        onClick={() =>
                          void attempt(async () => {
                            await window.workspace.agents.approve(e.approval!.id, false);
                            setResolved((r) => [...r, e.approval!.id]);
                            await load();
                          })
                        }
                      >
                        Reject
                      </button>
                      <button
                        className="primary"
                        onClick={() =>
                          void attempt(async () => {
                            await window.workspace.agents.approve(e.approval!.id, true);
                            setResolved((r) => [...r, e.approval!.id]);
                            await load();
                          })
                        }
                      >
                        Approve {e.approval.diff ? 'change' : 'operation'}
                      </button>
                    </div>
                  ) : (
                    <p className="small muted">Approval handled or no longer pending.</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </details>
      ))}
    </section>
  );
}

function TestTool({ tool, onClose }: { tool: LibraryItem; onClose: () => void }) {
  const [input, setInput] = useState('{}');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Test ${tool.name}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          setResult('');
          void (async () => {
            try {
              setResult(await window.workspace.tools.run(tool.id, JSON.parse(input)));
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <label>
          Input · JSON
          <textarea rows={6} value={input} onChange={(e) => setInput(e.target.value)} />
        </label>
        <button className="primary" disabled={busy}>
          {busy ? 'Running…' : 'Run tool'}
        </button>
        {result && (
          <pre className="log" role="status">
            {result}
          </pre>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
