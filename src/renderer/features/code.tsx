import { useEffect, useState, type FormEvent } from 'react';
import {
  Bot,
  Brain,
  ExternalLink,
  Folder,
  FolderOpen,
  Pencil,
  Play,
  Plug,
  Plus,
  Sparkles,
  Trash2,
  Wrench,
  MoreHorizontal,
} from 'lucide-react';
import { FolderSelection } from '../components/folder-selection';
import { Confirm, Modal, PageHeader } from '../components/common';
import {
  useAgents,
  useChat,
  useKnowledge,
  useMCP,
  useRuns,
  useSettings,
  useSkills,
  useTools,
  useUI,
  attempt,
} from '../stores';
import { AgentRuns, builtinTools, LibraryEditor, type AgentConfigSection } from './libraries';
import {
  BUILTIN_CODING_AGENT_ID,
  codeAgentTemplates,
  createCodeAgent,
} from '../../shared/code-agent-templates';
import type { CodeWorkspace as CodeWorkspaceInfo, LibraryItem } from '../../shared/types';

const testFixTask =
  'Inspect the project and identify the failing test. Reproduce the failure, trace it to the root cause, make the smallest correct code change, then rerun the relevant test and report the exact command and result. Do not weaken or delete the test to make it pass.';

export function CodeWorkspace() {
  const chat = useChat((state) => state);
  const agents = useAgents((state) => state.items);
  const settings = useSettings((state) => state.settings);
  const runs = useRuns((state) => state.runs);
  const skills = useSkills((state) => state.items);
  const tools = useTools((state) => state.items);
  const mcpServers = useMCP((state) => state.items);
  const knowledgeBases = useKnowledge((state) => state.sources);
  const [agentId, setAgentId] = useState('');
  const [project, setProject] = useState('');
  const [task, setTask] = useState('');
  const [busy, setBusy] = useState(false);
  const [templateId, setTemplateId] = useState('coding');
  const [editing, setEditing] = useState<LibraryItem | null>(null);
  const [editingFocus, setEditingFocus] = useState<AgentConfigSection>('agent');
  const [removingWorkspace, setRemovingWorkspace] = useState<CodeWorkspaceInfo | null>(null);
  const [accessWorkspace, setAccessWorkspace] = useState<CodeWorkspaceInfo | null>(null);
  const [accessFocus, setAccessFocus] = useState<AgentConfigSection>('agent');
  const [workspaceAgentIds, setWorkspaceAgentIds] = useState<string[]>([]);
  const [workspaceSkillIds, setWorkspaceSkillIds] = useState<string[]>([]);
  const [workspaceToolIds, setWorkspaceToolIds] = useState<string[]>([]);
  const [workspaceMCPIds, setWorkspaceMCPIds] = useState<string[]>([]);
  const [workspaceKnowledgeIds, setWorkspaceKnowledgeIds] = useState<string[]>([]);
  const [savingWorkspaceAccess, setSavingWorkspaceAccess] = useState(false);
  const [openWorkspaceOptions, setOpenWorkspaceOptions] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<
    Awaited<ReturnType<typeof window.workspace.code.list>>
  >([]);
  const enabledProviders = (settings?.providers ?? []).filter(
    (provider) => provider.enabled !== false,
  );
  const allAgents = agents;
  const enabledAgents = allAgents.filter((agent) => agent.enabled);
  const selectedWorkspace = workspaces.find((workspace) => workspace.canonicalPath === project);
  const folderAgents = selectedWorkspace?.allowedAgentIds
    ? enabledAgents.filter((agent) => selectedWorkspace.allowedAgentIds!.includes(agent.id))
    : enabledAgents;
  const selectedAgent = folderAgents.find((agent) => agent.id === agentId) ?? folderAgents[0];
  const provider = enabledProviders.find((item) => item.id === selectedAgent?.providerId);
  const ready = selectedAgent?.enabled && provider?.modelIds?.includes(selectedAgent.model);
  const agentRunIds = runs.filter((run) => run.agentId === selectedAgent?.id).map((run) => run.id);
  const editAgent = (agent: LibraryItem, focus: AgentConfigSection = 'agent') => {
    setEditingFocus(focus);
    setEditing(agent);
  };
  const configureFolder = (workspace: CodeWorkspaceInfo, focus: AgentConfigSection) => {
    setAccessWorkspace(workspace);
    setAccessFocus(focus);
    setWorkspaceAgentIds(
      workspace.allowedAgentIds ?? [...allAgents.map((agent) => agent.id), BUILTIN_CODING_AGENT_ID],
    );
    setWorkspaceSkillIds(
      workspace.allowedSkills ?? skills.filter((skill) => skill.enabled).map((skill) => skill.id),
    );
    setWorkspaceToolIds(
      workspace.allowedTools ?? [
        ...builtinTools,
        ...tools.filter((tool) => tool.enabled).map((tool) => `custom:${tool.id}`),
      ],
    );
    setWorkspaceMCPIds(
      workspace.allowedMCPServers ??
        mcpServers.filter((server) => server.enabled).map((server) => server.id),
    );
    setWorkspaceKnowledgeIds(
      workspace.allowedKnowledgeBases ??
        knowledgeBases.filter((source) => source.status === 'ready').map((source) => source.id),
    );
    setOpenWorkspaceOptions(null);
  };
  const saveFolderAgentAccess = async () => {
    if (!accessWorkspace) return;
    setSavingWorkspaceAccess(true);
    try {
      await window.workspace.code.setAccess(accessWorkspace.id, {
        agentIds: workspaceAgentIds,
        skills: workspaceSkillIds,
        tools: workspaceToolIds,
        mcpServers: workspaceMCPIds,
        knowledgeBases: workspaceKnowledgeIds,
      });
      setWorkspaces(await window.workspace.code.list());
      setAccessWorkspace(null);
    } finally {
      setSavingWorkspaceAccess(false);
    }
  };

  useEffect(() => {
    if (!folderAgents.some((agent) => agent.id === agentId)) setAgentId(folderAgents[0]?.id ?? '');
  }, [agentId, folderAgents]);

  useEffect(() => {
    if (!openWorkspaceOptions) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Element && !event.target.closest('.code-workspace-options'))
        setOpenWorkspaceOptions(null);
    };
    document.addEventListener('click', closeOnOutsideClick);
    return () => document.removeEventListener('click', closeOnOutsideClick);
  }, [openWorkspaceOptions]);

  useEffect(() => {
    void attempt(async () => setWorkspaces(await window.workspace.code.list()));
  }, [chat.current, chat.workspace]);

  async function connectFolder() {
    await chat.connectWorkspace();
    setWorkspaces(await window.workspace.code.list());
  }

  async function openWorkspace(workspaceId: string) {
    await chat.reconnectWorkspace(workspaceId);
    useUI.setState((state) => ({
      chatModes: state.chatModes.includes('code') ? state.chatModes : [...state.chatModes, 'code'],
    }));
    useUI.getState().setSection('Chat');
    setWorkspaces(await window.workspace.code.list());
  }

  async function relinkWorkspace(workspaceId: string) {
    const relinked = await chat.relinkWorkspace(workspaceId);
    if (relinked) {
      useUI.setState((state) => ({
        chatModes: state.chatModes.includes('code')
          ? state.chatModes
          : [...state.chatModes, 'code'],
      }));
      useUI.getState().setSection('Chat');
    }
    setWorkspaces(await window.workspace.code.list());
  }

  async function startRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAgent || !ready) throw new Error('Enable the agent and configure its model.');
    if (!project) throw new Error('Select a project folder before starting a coding task.');
    setBusy(true);
    try {
      await window.workspace.agents.run({
        agentId: selectedAgent.id,
        project,
        task: task.trim(),
      });
      await useRuns.getState().load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page code-page">
      <PageHeader
        eyebrow="DEVELOPMENT"
        title="Code | AI-assisted coding agents | Project workspaces"
        description="Connect a project to Chat or run a specialist coding agent. | Use Chat to inspect and edit this project through reviewed operations."
        right={
          <button className="secondary" onClick={() => void attempt(connectFolder)}>
            <FolderOpen size={14} /> Add Folder
          </button>
        }
      />
      <section className="code-workspaces" aria-label="Project workspaces">
        {workspaces.length ? (
          <div className="code-workspace-list">
            {workspaces.map((workspace) => (
              <div className="code-workspace-row" key={workspace.id}>
                <div className="code-workspace-info">
                  <div className="code-workspace-title">
                    <Folder size={16} aria-hidden="true" />
                    <strong>{workspace.name}</strong>
                  </div>
                  <span className="code-workspace-path small muted" title={workspace.canonicalPath}>
                    {workspace.canonicalPath}
                  </span>
                  <span className="code-workspace-status small muted">
                    {workspace.available ? 'Folder available' : 'Folder missing or inaccessible'}
                    {workspace.available && ' · Reads run automatically; changes require approval'}
                  </span>
                  <span className="code-workspace-status small muted">
                    Folder permissions · {workspace.allowedAgentIds?.length ?? allAgents.length + 1}{' '}
                    agents ·{' '}
                    {workspace.allowedSkills?.length ??
                      skills.filter((skill) => skill.enabled).length}{' '}
                    skills ·{' '}
                    {workspace.allowedTools?.length ??
                      builtinTools.length + tools.filter((tool) => tool.enabled).length}{' '}
                    tools ·{' '}
                    {workspace.allowedMCPServers?.length ??
                      mcpServers.filter((server) => server.enabled).length}{' '}
                    MCP ·{' '}
                    {workspace.allowedKnowledgeBases?.length ??
                      knowledgeBases.filter((source) => source.status === 'ready').length}{' '}
                    KB
                  </span>
                </div>
                <div className="code-workspace-actions">
                  {workspace.available ? (
                    <button
                      className="secondary"
                      aria-label="Open in Chat"
                      title="Open in Chat"
                      onClick={() => void attempt(() => openWorkspace(workspace.id))}
                    >
                      <ExternalLink size={14} aria-hidden="true" />
                    </button>
                  ) : (
                    <button
                      className="secondary"
                      onClick={() => void attempt(() => relinkWorkspace(workspace.id))}
                    >
                      Relink folder <FolderOpen size={14} aria-hidden="true" />
                    </button>
                  )}
                  <div className="code-workspace-options">
                    <button
                      type="button"
                      className="code-workspace-options-trigger"
                      aria-label={`Folder options for ${workspace.name}`}
                      aria-expanded={openWorkspaceOptions === workspace.id}
                      aria-controls={`folder-options-${workspace.id}`}
                      onClick={() =>
                        setOpenWorkspaceOptions((current) =>
                          current === workspace.id ? null : workspace.id,
                        )
                      }
                    >
                      <MoreHorizontal size={17} aria-hidden="true" />
                    </button>
                    <div
                      className="code-workspace-menu"
                      id={`folder-options-${workspace.id}`}
                      role="group"
                      aria-label={`Folder actions for ${workspace.name}`}
                      hidden={openWorkspaceOptions !== workspace.id}
                    >
                      {(
                        [
                          { label: 'Configure Agent', focus: 'agent', Icon: Bot },
                          { label: 'Configure Skills', focus: 'skills', Icon: Sparkles },
                          { label: 'Configure Tools', focus: 'tools', Icon: Wrench },
                          { label: 'Configure MCP', focus: 'mcp', Icon: Plug },
                          { label: 'Configure KB', focus: 'knowledge', Icon: Brain },
                        ] as const
                      ).map(({ label, focus, Icon }) => (
                        <>
                          <button
                            type="button"
                            key={label}
                            onClick={() => configureFolder(workspace, focus)}
                          >
                            <Icon size={14} aria-hidden="true" />
                            {label}
                          </button>
                          <span className="separator"></span>
                        </>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setOpenWorkspaceOptions(null);
                          void attempt(() => relinkWorkspace(workspace.id));
                        }}
                      >
                        <FolderOpen size={14} aria-hidden="true" /> Relink folder
                      </button>
                      <span className="separator"></span>

                      <button
                        type="button"
                        // className="danger"
                        onClick={() => {
                          setOpenWorkspaceOptions(null);
                          setRemovingWorkspace(workspace);
                        }}
                      >
                        <Trash2 size={14} aria-hidden="true" /> Remove folder
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="small muted">No linked projects yet.</p>
        )}
      </section>
      <div className="code-agent-toolbar">
        <h2 className="code-agent-heading">
          Coding Agent{selectedAgent ? ` · ${selectedAgent.name}` : ''}
        </h2>
        <div className="actions">
          <label>
            Agent template
            <select
              aria-label="Agent template"
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
            >
              {codeAgentTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="primary"
            onClick={() => {
              const profile =
                enabledProviders.find((entry) => entry.id === settings?.activeProviderId) ??
                enabledProviders[0];
              editAgent(
                createCodeAgent(
                  templateId,
                  crypto.randomUUID(),
                  profile?.id,
                  profile?.chatModel,
                  settings?.maxIterations,
                ),
              );
            }}
          >
            <Plus size={15} /> Add agent
          </button>
          {selectedAgent && (
            <button type="button" onClick={() => editAgent(selectedAgent)}>
              <Pencil size={15} /> Edit agent
            </button>
          )}
        </div>
      </div>
      <div className="code-folder-selector">
        <FolderSelection value={project} onChange={setProject} required />
      </div>
      {selectedAgent ? (
        <div className="code-workspace-layout">
          <form
            className="code-task-form"
            onSubmit={(event) => void attempt(() => startRun(event))}
          >
            <label>
              Coding agent for selected folder
              <select
                aria-label="Coding agent for selected folder"
                value={selectedAgent.id}
                onChange={(event) => setAgentId(event.target.value)}
              >
                {folderAgents.map((agent) => {
                  const profile = enabledProviders.find((item) => item.id === agent.providerId);
                  return (
                    <option value={agent.id} key={agent.id}>
                      {agent.name} · {profile?.name ?? 'Configure provider'} /{' '}
                      {agent.model || 'Select model'}
                      {!agent.enabled ? ' (disabled)' : ''}
                    </option>
                  );
                })}
              </select>
            </label>
            <div className="code-model-status">
              {ready ? (
                <>
                  <span className="status-dot" />
                  {provider?.name} · {selectedAgent.model}
                </>
              ) : (
                'Edit this agent to enable it and select an available model.'
              )}
            </div>
            <p className="small muted">{selectedAgent.description}</p>
            <div className="code-task-heading">
              <label htmlFor="code-task">Task</label>
              <button type="button" onClick={() => setTask(testFixTask)}>
                Fix failing tests
              </button>
            </div>
            <textarea
              id="code-task"
              aria-label="Coding task"
              className="editor"
              rows={8}
              required
              maxLength={50000}
              value={task}
              onChange={(event) => setTask(event.target.value)}
              placeholder="Describe the code change, tests, review, or merge-request draft…"
            />
            <div className="actions code-submit">
              <span className="small muted">
                Changes follow the selected agent's approval policy.
              </span>
              <button className="primary" disabled={busy || !ready || !project || !task.trim()}>
                <Play size={15} /> {busy ? 'Starting…' : 'Run coding task'}
              </button>
            </div>
          </form>
          <section className="code-history" aria-label="Coding task history">
            {agentRunIds.length ? (
              <AgentRuns ids={agentRunIds} />
            ) : (
              <div className="code-empty-history">
                <Bot size={21} />
                <h2>No coding runs yet</h2>
                <p>Choose a project and start a task.</p>
              </div>
            )}
          </section>
        </div>
      ) : (
        <section className="code-agent-empty">
          <Bot size={22} />
          <div>
            <h2>
              {enabledAgents.length
                ? 'No agents have folder access'
                : 'Add your first coding agent'}
            </h2>
            <p>
              {enabledAgents.length
                ? 'Configure Agent permissions on the selected folder card, or choose a different project folder.'
                : 'Choose a template above and select Add agent. Create separate agents for code, test cases, reviews, merge-request drafts, or your own tasks. Each agent uses a configured local model.'}
            </p>
          </div>
        </section>
      )}
      {editing && (
        <LibraryEditor
          kind="agents"
          groups={useAgents.getState().groups}
          initial={editing}
          focusCapability={editingFocus}
          onClose={() => setEditing(null)}
          onSave={async (item) => {
            await window.workspace.library.save('agents', {
              ...item,
              agentRuntime: 'deepagents-acp',
            });
            await useAgents.getState().load();
            setAgentId(item.id);
            setEditing(null);
          }}
        />
      )}
      {removingWorkspace && (
        <Confirm
          title="Remove folder from Code?"
          detail={`“${removingWorkspace.name}” will be removed from your saved project folders. The folder and its files on disk will not be deleted.`}
          confirmLabel="Remove folder"
          onClose={() => setRemovingWorkspace(null)}
          onConfirm={async () => {
            await window.workspace.code.remove(removingWorkspace.id);
            setWorkspaces(await window.workspace.code.list());
            setRemovingWorkspace(null);
          }}
        />
      )}
      {accessWorkspace && (
        <Modal
          title={`${accessFocus === 'agent' ? 'Configure Agent' : accessFocus === 'skills' ? 'Configure Skills' : accessFocus === 'tools' ? 'Configure Tools' : accessFocus === 'mcp' ? 'Configure MCP' : 'Configure Knowledge Base'} · ${accessWorkspace.name}`}
          onClose={() => {
            if (!savingWorkspaceAccess) setAccessWorkspace(null);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void attempt(saveFolderAgentAccess);
            }}
          >
            <p className="small muted">
              Folder permissions are an upper limit. An agent can use only resources permitted here
              and selected in its own configuration. Project file changes still follow the folder
              approval policy.
            </p>
            {accessFocus === 'agent' && (
              <ResourceChecks
                resources={[
                  {
                    id: BUILTIN_CODING_AGENT_ID,
                    name: 'Coding assistant (Built-in)',
                  },
                  ...allAgents.map(({ id, name, enabled }) => ({
                    id,
                    name: `${name}${enabled ? '' : ' (disabled)'}`,
                  })),
                ]}
                selectedIds={workspaceAgentIds}
                onChange={setWorkspaceAgentIds}
                disabled={savingWorkspaceAccess}
              />
            )}
            {accessFocus === 'skills' && (
              <ResourceChecks
                resources={skills
                  .filter((skill) => skill.enabled)
                  .map(({ id, name }) => ({ id, name }))}
                selectedIds={workspaceSkillIds}
                onChange={setWorkspaceSkillIds}
                disabled={savingWorkspaceAccess}
              />
            )}
            {accessFocus === 'tools' && (
              <ResourceChecks
                resources={[
                  ...builtinTools.map((id) => ({ id, name: id })),
                  ...tools
                    .filter((tool) => tool.enabled)
                    .map((tool) => ({ id: `custom:${tool.id}`, name: tool.name })),
                ]}
                selectedIds={workspaceToolIds}
                onChange={setWorkspaceToolIds}
                disabled={savingWorkspaceAccess}
              />
            )}
            {accessFocus === 'mcp' && (
              <ResourceChecks
                resources={mcpServers
                  .filter((server) => server.enabled)
                  .map(({ id, name }) => ({ id, name }))}
                selectedIds={workspaceMCPIds}
                onChange={setWorkspaceMCPIds}
                disabled={savingWorkspaceAccess}
              />
            )}
            {accessFocus === 'knowledge' && (
              <ResourceChecks
                resources={knowledgeBases
                  .filter((source) => source.status === 'ready')
                  .map(({ id, name }) => ({ id, name }))}
                selectedIds={workspaceKnowledgeIds}
                onChange={setWorkspaceKnowledgeIds}
                disabled={savingWorkspaceAccess}
              />
            )}
            <div className="actions">
              <button
                type="button"
                disabled={savingWorkspaceAccess}
                onClick={() => setAccessWorkspace(null)}
              >
                Cancel
              </button>
              <button className="primary" disabled={savingWorkspaceAccess}>
                {savingWorkspaceAccess ? 'Saving…' : 'Save folder permissions'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function ResourceChecks({
  resources,
  selectedIds,
  onChange,
  disabled,
}: {
  resources: { id: string; name: string }[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
}) {
  return (
    <div className="check-grid">
      {resources.map((resource) => (
        <label className="check" key={resource.id}>
          <input
            type="checkbox"
            checked={selectedIds.includes(resource.id)}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...selectedIds, resource.id]
                  : selectedIds.filter((id) => id !== resource.id),
              )
            }
          />
          {resource.name}
        </label>
      ))}
      {!resources.length && <p className="small muted">No enabled resources are available.</p>}
    </div>
  );
}
