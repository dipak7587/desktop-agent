import { GroupInput } from '../components/group-input';
import { ToolEditor } from './tool-editor';
import { mcpConfigFromItem, mcpDefinitionFromItem } from '../../shared/mcp-schema';
import { ProviderSelector } from '../components/provider-selector';
import { CommandPreview } from '../components/command-preview';
import { CapabilitySettings } from '../components/capability-settings';
import { FolderSelection } from '../components/folder-selection';
import { useRef, useState } from 'react';
import { errorMessage } from '../../shared/error-message';
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
  ChevronDown,
  X,
  CircleStop,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { LibraryKind, LibraryItem } from '../../shared/types';
import { librarySchema } from '../../shared/schemas';
import {
  parseLibraryDefinition,
  stringifyLibraryDefinition,
  type LibraryDefinitionFormat,
} from '../../shared/library-definition';
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
export const builtinTools = [
  'filesystem.read',
  'filesystem.write',
  'filesystem.edit',
  'filesystem.delete',
  'filesystem.list',
  'filesystem.search',
  'filesystem.exists',
  'project.detect',
  'git.status',
  'git.diff',
  'git.log',
  'shell.execute',
];
export type AgentConfigSection = 'agent' | 'skills' | 'tools' | 'mcp' | 'knowledge';
export function Library({ kind }: { kind: LibraryKind }) {
  const { items, groups, load } = libraryStores[kind]();
  const providerSettings = useSettings((s) => s.settings);
  const enabledProviders = providerSettings?.providers.filter((p) => p.enabled !== false) ?? [];
  const defaultProvider =
    enabledProviders.length === 1
      ? enabledProviders[0]
      : enabledProviders.find((p) => p.id === providerSettings?.activeProviderId);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const grouped = true;
  const [group, setGroup] = useState<string | null>(null);
  const [grouping, setGrouping] = useState(false);
  const [groupingAction, setGroupingAction] = useState<'assign' | 'rename'>('assign');
  const [groupName, setGroupName] = useState('');
  const [groupBeingRenamed, setGroupBeingRenamed] = useState('');
  const [groupToDelete, setGroupToDelete] = useState<string | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);
  const removeFromGroup = async (ids: string[]) => {
    setSavingGroup(true);
    try {
      await window.workspace.library.setGroup(kind, ids, '');
      setSelected([]);
      setGroup('');
      await load();
    } finally {
      setSavingGroup(false);
    }
  };
  const openGrouping = (name = group ?? '', action: 'assign' | 'rename' = 'assign') => {
    setSelected(
      action === 'rename'
        ? items.filter((item) => item.group === name).map((item) => item.id)
        : selected,
    );
    setGroupBeingRenamed(action === 'rename' ? name : '');
    setGroupName(name);
    setGroupingAction(action);
    setGrouping(true);
  };
  const visible = items.filter(
    (item) =>
      (group === null || (item.group ?? '') === group) &&
      `${item.name} ${item.description} ${item.content}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const [testTool, setTestTool] = useState<LibraryItem | null>(null);
  const [editing, setEditing] = useState<LibraryItem | null>(null);
  const [remove, setRemove] = useState<LibraryItem | null>(null);
  const [run, setRun] = useState<LibraryItem | null>(null);
  const { states, load: loadStates } = useMCPStatus();
  const Icon = icons[kind];
  const create = () => {
    setEditing({
      ...librarySchema.parse({ id: crypto.randomUUID(), name: 'Untitled' }),
      name: '',
      group: group ?? '',
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
  };
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
                  if (kind === 'tools') {
                    const value = await window.workspace.tools.importSource();
                    if (value)
                      setEditing(
                        librarySchema.parse({
                          id: crypto.randomUUID(),
                          name: value.name,
                          description: value.description,
                          content: value.source,
                          toolSource: value.source,
                          group: group ?? '',
                          toolConfig: {
                            type: 'langchain',
                            parameters: [],
                            inputSchema: value.inputSchema,
                            exportName: value.exportName,
                          },
                        }),
                      );
                  } else {
                    await window.workspace.library.import(kind);
                    await load();
                  }
                })
              }
            >
              <Upload size={16} />
              {kind === 'tools' ? 'Import Tool' : 'Import'}
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
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected([]);
            }}
          />
        </div>
        <span className="muted small">
          {items.length} {items.length === 1 ? 'item' : 'items'} · stored as{' '}
          {kind === 'mcp' ? 'JSON' : kind === 'tools' ? 'TypeScript' : 'Markdown'}
        </span>
      </div>
      {grouped && (!!items.length || !!groups.length) && (
        <nav className="library-groups" aria-label={`${titles[kind]} groups`}>
          {[null, '', ...groups].map((name) => {
            const label = name === null ? 'All' : name || 'Ungrouped';
            const count = items.filter(
              (item) => name === null || (item.group ?? '') === name,
            ).length;
            return (
              <div className="library-group-tab" key={name === null ? 'all' : `group:${name}`}>
                <button
                  type="button"
                  aria-pressed={group === name}
                  onClick={() => {
                    setGroup(name);
                    setSelected([]);
                  }}
                >
                  {label} <span className="badge">{count}</span>
                </button>
              </div>
            );
          })}
        </nav>
      )}
      {grouped && (!!items.length || !!groups.length) && (
        <div className="section-toolbar library-selection-toolbar">
          <label className="check">
            <input
              type="checkbox"
              checked={!!visible.length && visible.every((i) => selected.includes(i.id))}
              disabled={!visible.length}
              onChange={(e) => setSelected(e.target.checked ? visible.map((i) => i.id) : [])}
            />
            Select all {titles[kind]}
          </label>
          <span>
            {selected.length} {titles[kind]} selected
          </span>
          <div className="mcp-group-actions">
            <button disabled={!selected.length} onClick={() => openGrouping()}>
              Move to group
            </button>
            <button
              disabled={
                savingGroup ||
                !selected.some((id) => items.some((item) => item.id === id && item.group))
              }
              onClick={() => void attempt(() => removeFromGroup(selected))}
            >
              Remove from group
            </button>
            {!!group && (
              <button
                className="edit"
                aria-label={`Edit ${group} group`}
                title={`Edit ${group} group`}
                disabled={savingGroup}
                onClick={() => openGrouping(group, 'rename')}
              >
                <Pencil size={14} />
                Edit Group
              </button>
            )}
            {!!group && (
              <button
                className="danger"
                disabled={savingGroup}
                onClick={() => setGroupToDelete(group)}
              >
                <Trash2 size={14} />
                Delete group
              </button>
            )}
          </div>
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
        <div
          className={
            kind === 'skills'
              ? 'accordions'
              : kind === 'saved-text'
                ? 'library-list'
                : 'library-grid'
          }
        >
          {!visible.length && <p className="small muted">No items match this group and search.</p>}
          {visible.map((item) => {
            const state = states.find((s) => s.id === item.id);
            const actions = (
              <div className="card-actions">
                <button onClick={() => setEditing(item)}>Edit</button>
                {kind === 'mcp' && (
                  <div className="mcp-group-actions">
                    <button
                      disabled={savingGroup}
                      onClick={() => {
                        setSelected([item.id]);
                        setGroupName(item.group ?? '');
                        setGrouping(true);
                      }}
                    >
                      Move to group
                    </button>
                    {!!item.group && (
                      <button
                        disabled={savingGroup}
                        onClick={() => void attempt(() => removeFromGroup([item.id]))}
                      >
                        Remove from group
                      </button>
                    )}
                  </div>
                )}
                {kind === 'tools' && <button onClick={() => setTestTool(item)}>Test / Run</button>}
                {kind === 'agents' && (
                  <button className="primary" onClick={() => setRun(item)}>
                    <Play size={13} />
                    Run
                  </button>
                )}
                {kind === 'agents' && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        void attempt(async () => {
                          await window.workspace.library.save('agents', {
                            ...item,
                            enabled: !item.enabled,
                          });
                          await load();
                        })
                      }
                    >
                      {item.enabled ? 'Disable agent' : 'Enable agent'}
                    </button>
                  </>
                )}
                {kind === 'agents' && (
                  <button
                    onClick={() =>
                      void attempt(async () => {
                        await useChat.getState().newChat({
                          providerId: item.providerId ?? '',
                          model: item.model,
                          agentId: item.id,
                        });
                        useUI.setState({
                          section: 'Chat',
                          draft: '',
                          chatModes: ['agent'],
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
                  onClick={() => void attempt(() => window.workspace.library.export(kind, item.id))}
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
                {grouped && item.group && (
                  <span className="badge library-group-badge">{item.group}</span>
                )}
                {(kind === 'skills' || kind === 'saved-text') && (
                  <p className="muted">{item.description || 'No description'}</p>
                )}
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
                    <p className="small muted">
                      Auto start: {(item.runtime?.autoConnect ?? item.autoStart) ? 'On' : 'Off'}
                    </p>
                    <CommandPreview
                      command={
                        item.connection?.type === 'streamable-http'
                          ? item.connection.url
                          : [
                              item.connection?.type === 'stdio'
                                ? item.connection.command
                                : item.command,
                              ...(item.connection?.type === 'stdio'
                                ? (item.connection.args ?? [])
                                : item.args),
                            ]
                              .join(' ')
                              .trim()
                      }
                    />
                    <p className="small muted">
                      {Object.keys(item.env)
                        .map((k) => `${k} = ********`)
                        .join(' · ') || 'No environment variables'}
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
                  <label className="check skill-group-select" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${item.name}`}
                      checked={selected.includes(item.id)}
                      onChange={(e) =>
                        setSelected((ids) =>
                          e.target.checked ? [...ids, item.id] : ids.filter((id) => id !== item.id),
                        )
                      }
                    />
                    Select
                  </label>
                  <ChevronDown size={16} />
                </summary>
                <div className="skill-body">{details}</div>
              </details>
            ) : (
              <details
                className={`library-card${grouped ? ' library-card-compact' : ''}`}
                key={item.id}
              >
                <summary>
                  <div className="item-icon">
                    <Icon size={21} />
                  </div>
                  <div className="library-card-heading">
                    <h2>{item.name}</h2>
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
                  {grouped && (
                    <label className="check" onClick={(e) => e.stopPropagation()}>
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
                    </label>
                  )}
                  <ChevronDown size={16} className="collapse-chevron" />
                  {grouped && (
                    <p className="library-card-description">
                      {item.description || 'No description'}
                    </p>
                  )}
                </summary>
                <div className="library-card-body">{details}</div>
              </details>
            );
          })}
        </div>
      )}
      {editing && kind === 'tools' && (
        <ToolEditor
          initial={editing}
          groups={groups}
          onClose={() => setEditing(null)}
          onSave={async (item) => {
            await window.workspace.library.save('tools', item);
            await load();
            setEditing(null);
          }}
        />
      )}
      {editing && kind !== 'tools' && (
        <LibraryEditor
          kind={kind}
          groups={groups}
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={async (item) => {
            await window.workspace.library.save(kind, item);
            await load();
            setEditing(null);
          }}
        />
      )}
      {grouping && (
        <Modal
          title={groupingAction === 'rename' ? 'Rename group' : 'Move selected items to group'}
          onClose={() => {
            if (!savingGroup) setGrouping(false);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setSavingGroup(true);
              void attempt(async () => {
                try {
                  const name = groupName.trim();
                  if (groupingAction === 'rename') {
                    await window.workspace.library.renameGroup(kind, groupBeingRenamed, name);
                  } else {
                    await window.workspace.library.setGroup(kind, selected, name);
                  }
                  setSelected([]);
                  setGroup(name);
                  setGrouping(false);
                } finally {
                  try {
                    await load();
                  } finally {
                    setSavingGroup(false);
                  }
                }
              });
            }}
          >
            <p>
              {groupingAction === 'rename'
                ? `Rename this group for ${selected.length} items.`
                : `Move ${selected.length} selected items to a group. Enter a new name to add a group.`}
            </p>
            {groupingAction === 'rename' ? (
              <label>
                Group
                <input
                  autoFocus
                  required
                  maxLength={100}
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                  disabled={savingGroup}
                />
              </label>
            ) : (
              <GroupInput
                value={groupName}
                onChange={setGroupName}
                groups={groups}
                disabled={savingGroup}
              />
            )}
            <div className="actions">
              <button type="button" disabled={savingGroup} onClick={() => setGrouping(false)}>
                Cancel
              </button>
              <button className="primary" disabled={savingGroup}>
                {savingGroup ? 'Saving…' : groupingAction === 'rename' ? 'Rename group' : 'Move'}
              </button>
            </div>
          </form>
        </Modal>
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
      {groupToDelete && (
        <Confirm
          title={`Delete ${groupToDelete} group?`}
          detail="Items in this group will become ungrouped. Their definitions will not be deleted."
          onClose={() => setGroupToDelete(null)}
          onConfirm={async () => {
            await window.workspace.library.deleteGroup(kind, groupToDelete);
            if (group === groupToDelete) setGroup('');
            await load();
          }}
        />
      )}
      {testTool && <TestTool tool={testTool} onClose={() => setTestTool(null)} />}
      {run && <RunAgent agent={run} onClose={() => setRun(null)} />}
      {kind === 'agents' && <AgentRuns />}
    </div>
  );
}
export function LibraryEditor({
  kind,
  groups,
  initial,
  focusCapability,
  onClose,
  onSave,
}: {
  kind: LibraryKind;
  groups: string[];
  initial: LibraryItem;
  focusCapability?: AgentConfigSection;
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
  const [args, setArgs] = useState(
    (initial.connection?.type === 'stdio' ? (initial.connection.args ?? []) : initial.args).join(
      '\n',
    ),
  );
  const [mcpHeaders, setMcpHeaders] = useState(
    JSON.stringify(
      initial.connection?.type === 'streamable-http' ? (initial.connection.headers ?? {}) : {},
      null,
      2,
    ),
  );
  const [mcpOptions, setMcpOptions] = useState(
    JSON.stringify(
      Object.fromEntries(
        ['capabilities', 'permissions', 'metadata', 'runtime', 'discovered']
          .filter((key) => initial[key as keyof LibraryItem] !== undefined)
          .map((key) => [key, initial[key as keyof LibraryItem]]),
      ),
      null,
      2,
    ),
  );
  const [env, setEnv] = useState(
    JSON.stringify(
      initial.connection?.type === 'stdio' ? (initial.connection.env ?? {}) : initial.env,
      null,
      2,
    ),
  );
  const [editorError, setEditorError] = useState('');
  const errorSummary = useRef<HTMLDivElement>(null);
  const editorAttempt = async (action: () => Promise<void>) => {
    setEditorError('');
    try {
      await action();
    } catch (error) {
      const issues =
        error && typeof error === 'object' && 'issues' in error ? error.issues : undefined;
      setEditorError(
        Array.isArray(issues)
          ? issues
              .map((issue) => `${issue.path.join('.') || 'Definition'}: ${issue.message}`)
              .join('\n')
          : errorMessage(error),
      );
      requestAnimationFrame(() => {
        errorSummary.current?.focus();
        errorSummary.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
    }
  };
  const [editorMode, setEditorMode] = useState<'form' | LibraryDefinitionFormat>('form');
  const [definition, setDefinition] = useState('');
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
  const formDraft = () => ({
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
    ...(kind === 'mcp'
      ? {
          ...JSON.parse(mcpOptions),
          transport: item.transport ?? 'stdio',
          connection:
            (item.transport ?? 'stdio') === 'stdio'
              ? {
                  type: 'stdio',
                  command:
                    item.connection?.type === 'stdio' ? item.connection.command : item.command,
                  args: args.split('\n').filter(Boolean),
                  cwd: item.connection?.type === 'stdio' ? item.connection.cwd : undefined,
                  env: JSON.parse(env),
                }
              : {
                  type: 'streamable-http',
                  url: item.connection?.type === 'streamable-http' ? item.connection.url : '',
                  headers: JSON.parse(mcpHeaders),
                },
        }
      : {}),
  });
  const formValue = () => {
    const draft = formDraft();
    return librarySchema.parse(kind === 'mcp' ? { ...draft, ...mcpConfigFromItem(draft) } : draft);
  };
  const definitionValue = (value: Partial<LibraryItem>) => {
    if (kind !== 'skills') return value;
    const { skills, capabilityConfig, ...rest } = value;
    const config = capabilityConfig
      ? (({ skills: selectedSkills, ...options }) => ({
          ...options,
          ...(selectedSkills.length ? { skills: selectedSkills } : {}),
        }))(capabilityConfig)
      : undefined;
    return {
      ...rest,
      ...(skills?.length ? { skills } : {}),
      ...(config ? { capabilityConfig: config } : {}),
    };
  };
  const setMode = (mode: 'form' | LibraryDefinitionFormat) => {
    void editorAttempt(async () => {
      if (mode === editorMode) return;
      if (mode === 'form') {
        if (editorMode === 'form') return;
        const imported = parseLibraryDefinition(definition, editorMode, kind, { validate: false });
        const next = { ...item, ...imported, id: item.id, createdAt: item.createdAt };
        setItem(next);
        if (kind === 'tools') {
          setParameters(JSON.stringify(next.toolConfig?.parameters ?? [], null, 2));
          setHeaders(JSON.stringify(next.toolConfig?.headers ?? {}, null, 2));
        }
        if (kind === 'mcp') {
          setArgs(
            (next.connection?.type === 'stdio' ? (next.connection.args ?? []) : next.args).join(
              '\n',
            ),
          );
          setEnv(
            JSON.stringify(
              next.connection?.type === 'stdio' ? (next.connection.env ?? {}) : next.env,
              null,
              2,
            ),
          );
          setMcpHeaders(
            JSON.stringify(
              next.connection?.type === 'streamable-http' ? (next.connection.headers ?? {}) : {},
              null,
              2,
            ),
          );
          setMcpOptions(
            JSON.stringify(
              Object.fromEntries(
                ['capabilities', 'permissions', 'metadata', 'runtime', 'discovered']
                  .filter((key) => next[key as keyof LibraryItem] !== undefined)
                  .map((key) => [key, next[key as keyof LibraryItem]]),
              ),
              null,
              2,
            ),
          );
        }
      } else {
        const value =
          editorMode === 'form'
            ? formDraft()
            : parseLibraryDefinition(definition, editorMode, kind, { validate: false });
        const formattedValue =
          editorMode !== 'form'
            ? value
            : kind === 'mcp'
              ? mcpDefinitionFromItem({ ...item, ...value })
              : { ...item, ...value };
        setDefinition(stringifyLibraryDefinition(definitionValue(formattedValue), mode));
      }
      setEditorMode(mode);
    });
  };
  return (
    <Modal
      wide
      title={`${initial.createdAt ? 'Edit' : 'Create'} ${kind === 'saved-text' ? 'saved text' : kind === 'skills' ? 'skill' : kind === 'agents' ? 'agent' : kind === 'tools' ? 'tool' : 'MCP server'}`}
      onClose={onClose}
    >
      <form
        onInvalidCapture={() => {
          setEditorError('Complete the required fields before saving.');
          requestAnimationFrame(() =>
            errorSummary.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
          );
        }}
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void editorAttempt(async () => {
            try {
              const value =
                editorMode === 'form'
                  ? formValue()
                  : librarySchema.parse({
                      ...item,
                      ...parseLibraryDefinition(definition, editorMode, kind),
                      id: item.id,
                      createdAt: item.createdAt,
                    });
              await onSave(value);
            } finally {
              setBusy(false);
            }
          });
        }}
      >
        {editorError && (
          <div
            ref={errorSummary}
            className="callout error-text"
            role="alert"
            tabIndex={-1}
            style={{ whiteSpace: 'pre-wrap' }}
          >
            {editorError}
          </div>
        )}
        {kind !== 'saved-text' && (
          <nav className="actions settings-tabs" role="group" aria-label="Definition format">
            {(['form', 'md', 'json', 'yaml'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={editorMode === mode}
                onClick={() => setMode(mode)}
              >
                {mode === 'form' ? 'Form' : mode === 'md' ? 'Markdown' : mode.toUpperCase()}
              </button>
            ))}
          </nav>
        )}
        {editorMode !== 'form' ? (
          <label>
            Definition · {editorMode === 'md' ? 'Markdown' : editorMode.toUpperCase()}
            <textarea
              required
              className="editor"
              rows={20}
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
              placeholder={
                kind === 'mcp'
                  ? stringifyLibraryDefinition(
                      {
                        id: 'filesystem',
                        name: 'Filesystem',
                        enabled: true,
                        transport: 'stdio',
                        connection: {
                          type: 'stdio',
                          command: 'npx',
                          args: [
                            '-y',
                            '@modelcontextprotocol/server-filesystem',
                            '/path/to/project',
                          ],
                          env: {},
                        },
                        runtime: { autoConnect: false, timeoutMs: 60000 },
                      },
                      editorMode,
                    )
                  : undefined
              }
              spellCheck={false}
            />
          </label>
        ) : (
          <>
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
            <GroupInput
              value={item.group ?? ''}
              onChange={(value) => update('group', value)}
              groups={groups}
            />
            {kind !== 'saved-text' && (
              <label>
                Description
                <input
                  required={false}
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
                    max={500}
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
                {focusCapability !== 'agent' && (
                  <CapabilitySettings
                    item={item}
                    focus={focusCapability}
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
                )}
              </>
            )}
            {kind === 'skills' && (
              <CapabilitySettings
                item={item}
                title="Skill Capabilities"
                onChange={(config) =>
                  setItem((current) => ({
                    ...current,
                    capabilityConfig: config,
                    skills: config.skills,
                    tools: config.tools,
                    knowledgeSources: config.knowledgeBases,
                  }))
                }
                skills={skills.filter((skill) => skill.id !== item.id)}
                servers={servers}
                knowledge={sources}
                tools={[...new Set(tools)].map((id) => ({
                  id,
                  name: customTools.find((tool) => id === `custom:${tool.id}`)?.name ?? id,
                }))}
              />
            )}
            {kind === 'tools' && (
              <>
                <p className="small muted">
                  Custom tools run trusted local code or make API calls. Agent calls require
                  approval.
                </p>
                <label>
                  Execution type
                  <select
                    value={item.toolConfig?.type ?? 'javascript'}
                    onChange={(e) =>
                      update('toolConfig', { ...item.toolConfig, type: e.target.value })
                    }
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
                      <textarea
                        rows={4}
                        value={headers}
                        onChange={(e) => setHeaders(e.target.value)}
                      />
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
                <label>
                  Transport
                  <select
                    value={item.transport ?? 'stdio'}
                    onChange={(e) => {
                      const transport = e.target.value as 'stdio' | 'streamable-http';
                      setItem((i) => ({
                        ...i,
                        transport,
                        connection:
                          transport === 'stdio'
                            ? { type: 'stdio', command: i.command }
                            : { type: 'streamable-http', url: '' },
                      }));
                    }}
                  >
                    <option value="stdio">stdio</option>
                    <option value="streamable-http">Streamable HTTP</option>
                  </select>
                </label>
                {(item.transport ?? 'stdio') === 'stdio' ? (
                  <>
                    <label>
                      Executable (needed to start)
                      <input
                        placeholder="npx"
                        value={
                          item.connection?.type === 'stdio' ? item.connection.command : item.command
                        }
                        onChange={(e) =>
                          update('connection', {
                            ...(item.connection?.type === 'stdio' ? item.connection : {}),
                            type: 'stdio',
                            command: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      Working directory (optional)
                      <input
                        placeholder="/path/to/project"
                        value={item.connection?.type === 'stdio' ? (item.connection.cwd ?? '') : ''}
                        onChange={(e) =>
                          update('connection', {
                            ...(item.connection?.type === 'stdio'
                              ? item.connection
                              : { command: item.command }),
                            type: 'stdio',
                            cwd: e.target.value || undefined,
                          })
                        }
                      />
                    </label>
                    <label>
                      Arguments · one per line
                      <textarea
                        rows={4}
                        value={args}
                        placeholder={
                          '-y\n@modelcontextprotocol/server-filesystem\n/path/to/project'
                        }
                        onChange={(e) => setArgs(e.target.value)}
                      />
                    </label>
                    <label>
                      Environment variables · JSON
                      <textarea rows={4} value={env} onChange={(e) => setEnv(e.target.value)} />
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      Server URL (required)
                      <input
                        required
                        type="url"
                        placeholder="https://example.com/mcp"
                        value={
                          item.connection?.type === 'streamable-http' ? item.connection.url : ''
                        }
                        onChange={(e) =>
                          update('connection', { type: 'streamable-http', url: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Headers · JSON
                      <textarea
                        rows={4}
                        placeholder={'{"Authorization":"Bearer ${API_TOKEN}"}'}
                        value={mcpHeaders}
                        onChange={(e) => setMcpHeaders(e.target.value)}
                      />
                    </label>
                  </>
                )}
                <label>
                  Optional settings · JSON
                  <textarea
                    rows={8}
                    value={mcpOptions}
                    placeholder={
                      '{"capabilities":{"tools":true},"permissions":{"allowRead":true},"metadata":{"tags":[]},"runtime":{"autoConnect":false,"timeoutMs":60000}}'
                    }
                    onChange={(e) => setMcpOptions(e.target.value)}
                  />
                </label>
                <p className="small muted">
                  Configure capabilities, permissions, metadata, runtime, and discovered entries
                  above. JSON, YAML, and Markdown with YAML frontmatter are validated and saved as
                  JSON.
                </p>
                <p className="small muted">
                  Use literal values or references, for example{' '}
                  {'{"MODE":"production","GITHUB_TOKEN":"${GITHUB_TOKEN}"}'}. References use
                  Settings credentials, the selected .env file, or the process environment. Literal
                  values are saved in the server configuration and included in exports.
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
          </>
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
export function AgentRuns({ ids }: { ids?: string[] } = {}) {
  const { runs: allRuns, load } = useRuns();
  const runs = ids ? allRuns.filter((run) => ids.includes(run.id)) : allRuns;
  const [resolved, setResolved] = useState<string[]>([]);
  const [clearingHistory, setClearingHistory] = useState(false);
  if (!runs.length) return null;
  return (
    <section className="runs">
      <div className="runs-heading">
        <h2>Execution history</h2>
        {!ids && (
          <button
            className="secondary"
            disabled={runs.some((run) => run.status === 'Running')}
            onClick={() => setClearingHistory(true)}
          >
            Clear all history
          </button>
        )}
      </div>
      {clearingHistory && (
        <Confirm
          title="Clear agent history?"
          detail="This permanently removes all agent execution history. Agent definitions are kept. This cannot be undone."
          confirmLabel="Clear history"
          onClose={() => setClearingHistory(false)}
          onConfirm={async () => {
            await window.workspace.agents.clearRuns();
            await load();
          }}
        />
      )}
      {[...runs].reverse().map((run) => (
        <details key={run.id} className="run">
          <summary>
            <div className="run-summary">
              <div>
                <strong>
                  {run.agentName} · {new Date(run.startedAt).toLocaleString()}
                </strong>
                <span
                  style={{
                    marginLeft: '1rem',
                  }}
                >
                  Iterations: {run.iterationsUsed} / {run.maxIterations}
                </span>
                <span
                  className="badge"
                  style={{
                    marginLeft: '1rem',
                  }}
                >
                  {run.status}
                </span>
              </div>
              <div>
                {![
                  'Completed',
                  'Stopped',
                  'Failed',
                  'Cancelled',
                  'Max iterations reached',
                ].includes(run.status) && (
                  <button onClick={() => void attempt(() => window.workspace.agents.stop(run.id))}>
                    <CircleStop size={16} />
                  </button>
                )}
                {['Completed', 'Stopped', 'Failed', 'Cancelled', 'Max iterations reached'].includes(
                  run.status,
                ) && (
                  <button
                    // className="danger"
                    onClick={() =>
                      void attempt(async () => {
                        await window.workspace.agents.removeRun(run.id);
                        await load();
                      })
                    }
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>
          </summary>

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
