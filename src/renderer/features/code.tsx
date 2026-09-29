import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Bot, FolderOpen, Play, Settings2 } from 'lucide-react';
import { FolderSelection } from '../components/folder-selection';
import { PageHeader } from '../components/common';
import { useAgents, useChat, useRuns, useSettings, useUI, attempt } from '../stores';
import { AgentRuns } from './libraries';

const testFixTask =
  'Inspect the project and identify the failing test. Reproduce the failure, trace it to the root cause, make the smallest correct code change, then rerun the relevant test and report the exact command and result. Do not weaken or delete the test to make it pass.';

function isLoopbackOllama(url: string) {
  try {
    const hostname = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1')
      return true;
    const octets = hostname.split('.').map(Number);
    return (
      octets.length === 4 &&
      octets[0] === 127 &&
      octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    );
  } catch {
    return false;
  }
}

export function CodeWorkspace() {
  const chat = useChat((state) => state);
  const agents = useAgents((state) => state.items);
  const settings = useSettings((state) => state.settings);
  const runs = useRuns((state) => state.runs);
  const [agentId, setAgentId] = useState('');
  const [project, setProject] = useState('');
  const [task, setTask] = useState('');
  const [busy, setBusy] = useState(false);
  const [workspaces, setWorkspaces] = useState<
    Awaited<ReturnType<typeof window.workspace.code.list>>
  >([]);
  const localProviders = (settings?.providers ?? []).filter(
    (provider) =>
      provider.provider === 'ollama' &&
      provider.enabled !== false &&
      isLoopbackOllama(provider.ollamaUrl),
  );
  const localAgents = agents.filter(
    (agent) =>
      agent.enabled &&
      localProviders.some(
        (provider) => provider.id === agent.providerId && provider.modelIds?.includes(agent.model),
      ),
  );
  const selectedAgent = localAgents.find((agent) => agent.id === agentId) ?? localAgents[0];
  const provider = localProviders.find((item) => item.id === selectedAgent?.providerId);
  const agentRunIds = runs.filter((run) => run.agentId === selectedAgent?.id).map((run) => run.id);

  useEffect(() => {
    if (!localAgents.some((agent) => agent.id === agentId)) setAgentId(localAgents[0]?.id ?? '');
  }, [agentId, localAgents]);

  useEffect(() => {
    void attempt(async () => setWorkspaces(await window.workspace.code.list()));
  }, [chat.current, chat.workspace]);

  async function connectFolder() {
    await chat.connectWorkspace();
    setWorkspaces(await window.workspace.code.list());
  }

  async function openWorkspace(workspaceId: string) {
    await chat.reconnectWorkspace(workspaceId);
    useUI.getState().setSection('Chat');
    setWorkspaces(await window.workspace.code.list());
  }

  async function relinkWorkspace(workspaceId: string) {
    await chat.relinkWorkspace(workspaceId);
    useUI.getState().setSection('Chat');
    setWorkspaces(await window.workspace.code.list());
  }

  async function startRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAgent) throw new Error('Choose an enabled local Ollama agent.');
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
        eyebrow="LOCAL DEVELOPMENT"
        title="Code"
        description="Connect a project to Chat, then optionally run an agent."
      />
      <section className="code-workspaces" aria-label="Project workspaces">
        <div className="code-workspaces-heading">
          <div>
            <h2>Project workspaces</h2>
            <p className="small muted">Folder selection does not grant file or command access.</p>
          </div>
          <button className="secondary" onClick={() => void attempt(connectFolder)}>
            <FolderOpen size={14} /> Open folder
          </button>
        </div>
        {workspaces.length ? (
          <div className="code-workspace-list">
            {workspaces.map((workspace) => (
              <div className="code-workspace-row" key={workspace.id}>
                <div>
                  <strong>{workspace.name}</strong>
                  <span className="small muted" title={workspace.canonicalPath}>
                    {workspace.canonicalPath}
                  </span>
                  <span className="small muted">
                    {workspace.available ? 'Folder available' : 'Folder missing or inaccessible'}
                    {' · '}
                    No project permissions granted
                  </span>
                </div>
                {workspace.available ? (
                  <button
                    className="secondary"
                    onClick={() => void attempt(() => openWorkspace(workspace.id))}
                  >
                    Open in Chat <ArrowRight size={14} />
                  </button>
                ) : (
                  <button
                    className="secondary"
                    onClick={() => void attempt(() => relinkWorkspace(workspace.id))}
                  >
                    Relink folder <FolderOpen size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="small muted">No linked projects yet.</p>
        )}
      </section>
      <h2 className="code-agent-heading">Optional agent task</h2>
      {selectedAgent ? (
        <div className="code-workspace-layout">
          <form
            className="code-task-form"
            onSubmit={(event) => void attempt(() => startRun(event))}
          >
            <label>
              Local coding agent
              <select
                aria-label="Local coding agent"
                value={selectedAgent.id}
                onChange={(event) => setAgentId(event.target.value)}
              >
                {localAgents.map((agent) => {
                  const profile = localProviders.find((item) => item.id === agent.providerId);
                  return (
                    <option value={agent.id} key={agent.id}>
                      {agent.name} · {profile?.name} / {agent.model}
                    </option>
                  );
                })}
              </select>
            </label>
            <div className="code-model-status">
              <span className="status-dot" />
              {provider?.name} · {selectedAgent.model} · Ollama local
            </div>
            <FolderSelection value={project} onChange={setProject} />
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
              placeholder="Describe the code change or failing test to work on…"
            />
            <div className="actions code-submit">
              <span className="small muted">
                Changes follow the selected agent's approval policy.
              </span>
              <button className="primary" disabled={busy || !project || !task.trim()}>
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
          <Settings2 size={22} />
          <div>
            <h2>No local coding agent is ready</h2>
            <p>
              Create an enabled agent with an installed Ollama model and project tools for reading,
              editing, writing, and running tests.
            </p>
            <button className="primary" onClick={() => useUI.getState().setSection('Agents')}>
              Configure local agent <ArrowRight size={15} />
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
