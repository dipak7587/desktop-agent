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
  FolderOpen,
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
  useKnowledge,
  useMCPStatus,
  useRuns,
  useUI,
  useChat,
  attempt,
} from '../stores';
import { PageHeader, Empty, Modal, Confirm, Markdown, CopyButton } from '../components/common';
const descriptions = {
  skills: 'Reusable instructions that make your models work your way.',
  'saved-text': 'Notes and prompts, automatically indexed in your local knowledge base.',
  agents: 'Purpose-built workers for your local projects.',
  mcp: 'Connect local tools through the Model Context Protocol.',
};
const titles = { skills: 'Skills', 'saved-text': 'Saved Text', agents: 'Agents', mcp: 'MCP' };
const icons = { skills: Zap, 'saved-text': FileText, agents: Bot, mcp: Plug };
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
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<LibraryItem | null>(null);
  const [remove, setRemove] = useState<LibraryItem | null>(null);
  const [run, setRun] = useState<LibraryItem | null>(null);
  const { states, load: loadStates } = useMCPStatus();
  const Icon = icons[kind];
  const create = () =>
    setEditing({
      ...librarySchema.parse({ id: crypto.randomUUID(), name: 'Untitled' }),
      name: '',
      model: useSettings.getState().settings?.chatModel ?? '',
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
                  {kind === 'agents' && (
                    <button className="primary" onClick={() => setRun(item)}>
                      <Play size={13} />
                      Run
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
                      <span>{item.model || 'Default model'}</span>
                      <span>
                        {item.skills.length} skills · {item.tools.length} tools
                      </span>
                    </div>
                  )}
                  {kind === 'mcp' && (
                    <>
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
                        ? (state?.status ?? 'stopped')
                        : item.enabled
                          ? 'Local'
                          : 'Disabled'}
                    </span>
                  </div>
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
  const [args, setArgs] = useState(initial.args.join('\n'));
  const [env, setEnv] = useState(JSON.stringify(initial.env, null, 2));
  const [fromJSON, setFromJSON] = useState(false);
  const [configJSON, setConfigJSON] = useState(
    JSON.stringify({ command: initial.command, args: initial.args, env: initial.env }, null, 2),
  );
  const [busy, setBusy] = useState(false);
  const { models } = useSettings();
  const { items: skills } = useSkills();
  const { sources } = useKnowledge();
  const { states } = useMCPStatus();
  const tools = [
    ...builtinTools,
    ...states.flatMap((s) => s.tools.map((t) => `mcp:${s.id}:${t.name}`)),
  ];
  const update = (key: keyof LibraryItem, value: unknown) =>
    setItem((i) => ({ ...i, [key]: value }));
  const checks = (
    key: 'skills' | 'tools' | 'knowledgeSources',
    options: { id: string; name: string }[],
  ) => (
    <div className="check-grid">
      {options.length ? (
        options.map((o) => (
          <label key={o.id} className="check">
            <input
              type="checkbox"
              checked={item[key].includes(o.id)}
              onChange={(e) =>
                update(
                  key,
                  e.target.checked ? [...item[key], o.id] : item[key].filter((id) => id !== o.id),
                )
              }
            />
            {o.name}
          </label>
        ))
      ) : (
        <span className="muted small">None available yet.</span>
      )}
    </div>
  );
  return (
    <Modal
      wide
      title={`${initial.createdAt ? 'Edit' : 'Create'} ${kind === 'saved-text' ? 'saved text' : kind === 'skills' ? 'skill' : kind === 'agents' ? 'agent' : 'MCP server'}`}
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
              Model
              <select value={item.model} onChange={(e) => update('model', e.target.value)}>
                <option value="">Use default chat model</option>
                {models
                  .filter((m) => !m.capabilities || m.capabilities.includes('completion'))
                  .map((m) => (
                    <option key={m.name}>{m.name}</option>
                  ))}
              </select>
            </label>
            <fieldset>
              <legend>Skills</legend>
              {checks(
                'skills',
                skills.map((s) => ({ id: s.id, name: s.name })),
              )}
            </fieldset>
            <fieldset>
              <legend>Tools</legend>
              {checks(
                'tools',
                tools.map((t) => ({ id: t, name: t })),
              )}
            </fieldset>
            <fieldset>
              <legend>Knowledge sources</legend>
              {checks(
                'knowledgeSources',
                sources.map((s) => ({ id: s.id, name: s.name })),
              )}
            </fieldset>
          </>
        )}
        {kind === 'mcp' ? (
          <>
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
            {kind === 'saved-text' ? 'Text' : 'Instructions'}
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
  return (
    <Modal title={`Run ${agent.name}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void attempt(async () => {
            await window.workspace.agents.run({ agentId: agent.id, project, task });
            await useRuns.getState().load();
            onClose();
          });
        }}
      >
        <label>
          Project folder
          <div className="inline-field">
            <input
              readOnly
              value={project}
              placeholder="Choose the project this agent can access"
            />
            <button
              type="button"
              aria-label="Select project folder"
              onClick={() =>
                void attempt(async () => {
                  const selected = await window.workspace.agents.project();
                  if (selected) setProject(selected);
                })
              }
            >
              <FolderOpen size={18} />
            </button>
          </div>
        </label>
        <label>
          Task
          <textarea
            required
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
          <button className="primary" disabled={!project || !task.trim()}>
            <Play size={16} />
            Start agent
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
        <details key={run.id} open className="run">
          <summary>
            <strong>Agent run</strong>
            <span className="badge">{run.status}</span>
          </summary>
          {!['Completed', 'Stopped', 'Failed'].includes(run.status) && (
            <button onClick={() => void attempt(() => window.workspace.agents.stop(run.id))}>
              <Square size={13} />
              Stop run
            </button>
          )}
          {run.events.map((e, index) => (
            <div className="run-event" key={index}>
              <span className="small muted">{e.status}</span>
              {e.content && <pre className="log">{e.content}</pre>}
              {e.error && <p className="error-text">{e.error}</p>}
              {e.approval && (
                <div className="approval">
                  <h3>{e.approval.description}</h3>
                  {e.approval.diff && <pre className="diff">{e.approval.diff}</pre>}
                  {!resolved.includes(e.approval.id) && run.status === 'Waiting for approval' ? (
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
