import { CrewCustomTools } from './crewai-custom-tools';
import { useEffect, useState } from 'react';
import { Plus, Users, ArrowLeft, Play, Download, Save } from 'lucide-react';
import {
  crewTools,
  crewProjectSchema,
  newCrewProject,
  type CrewProject,
  type CrewRun,
} from '../../shared/crewai';
import { useSettings, useUI, attempt } from '../stores';
import { Modal } from '../components/common';
import { ProviderSelector } from '../components/provider-selector';
import { FolderSelection } from '../components/folder-selection';

type Tab = 'Overview' | 'Agents' | 'Tasks' | 'Tools' | 'Runs';
export default function CrewAIProjects() {
  const settings = useSettings((s) => s.settings);
  const [projects, setProjects] = useState<CrewProject[]>([]);
  const [runs, setRuns] = useState<CrewRun[]>([]);
  const [draft, setDraft] = useState<CrewProject | null>(null);
  const [tab, setTab] = useState<Tab>('Overview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [runDialog, setRunDialog] = useState(false);
  const [deleting, setDeleting] = useState<CrewProject | null>(null);
  const [input, setInput] = useState('');
  const [folder, setFolder] = useState('');
  const load = async () => {
    const [nextProjects, nextRuns] = await Promise.all([
      window.workspace.crewai.list(),
      window.workspace.crewai.runs(),
    ]);
    setProjects(nextProjects);
    setRuns(nextRuns);
  };
  useEffect(() => {
    void attempt(load);
    return window.workspace.onEvent((event) => {
      if (event.type === 'crewai') void attempt(load);
    });
  }, []);
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!draft) throw new Error('Choose a project first');
    const parsed = crewProjectSchema.safeParse(draft);
    if (!parsed.success)
      throw new Error(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'),
      );
    const project = await window.workspace.crewai.save(parsed.data);
    setDraft(project);
    await load();
    return project;
  };
  const patch = (value: Partial<CrewProject>) => setDraft((old) => old && { ...old, ...value });
  const create = () => {
    const provider = settings?.providers.find(
      (p) => p.id === settings.activeProviderId && p.enabled !== false,
    );
    setDraft(newCrewProject(provider?.id, provider?.chatModel));
    setTab('Overview');
    setError('');
  };
  return (
    <div className="page crew-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">CREWAI PROJECT BUILDER</p>
          <h1>{draft?.name || 'CrewAI Projects'}</h1>
          <p className="muted">Design a team, define its work, and build a runnable CrewAI app.</p>
        </div>
        <div className="actions">
          {draft ? (
            <>
              <button
                disabled={busy}
                onClick={() => {
                  setDraft(null);
                  setError('');
                }}
              >
                <ArrowLeft size={16} /> Projects
              </button>
              <button
                disabled={busy || !settings?.crewAIEnabled}
                onClick={() =>
                  void act(async () => {
                    await save();
                    useUI.setState({ notice: 'CrewAI project saved' });
                  })
                }
              >
                <Save size={16} /> Save project
              </button>
              <button
                disabled={busy || !settings?.crewAIEnabled}
                onClick={() =>
                  void act(async () => {
                    const project = await save();
                    const path = await window.workspace.crewai.export(project.id);
                    if (path) useUI.setState({ notice: `Project exported to ${path}` });
                  })
                }
              >
                <Download size={16} /> Export Python project
              </button>
              <button
                className="primary"
                disabled={busy || !settings?.crewAIEnabled}
                onClick={() =>
                  void act(async () => {
                    await save();
                    setRunDialog(true);
                  })
                }
              >
                <Play size={16} /> Run crew
              </button>
            </>
          ) : (
            <button className="primary" onClick={create} disabled={!settings?.crewAIEnabled}>
              <Plus size={16} /> New crew project
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="error-text crew-error">
          {error}
        </p>
      )}
      {!settings?.crewAIEnabled && (
        <p role="status" className="callout">
          CrewAI is disabled. Saved projects and history are retained. Enable it in Settings to edit
          or run.
        </p>
      )}
      {!draft ? (
        <>
          <div className="callout">
            Start with an analyst and a writer, customize their roles, then connect task outputs.
            Runs use the providers configured in Settings.{' '}
            <button onClick={() => useUI.setState({ section: 'Settings' })}>
              Runtime settings
            </button>
          </div>
          {!projects.length && (
            <div className="empty">
              <Users size={32} />
              <h2>Build your first crew</h2>
              <p>A starter project includes two agents and two connected tasks.</p>
              <button onClick={create}>Create starter project</button>
            </div>
          )}
          <div className="crew-project-grid">
            {projects.map((project) => (
              <article className="workflow-card" key={project.id}>
                <span className="badge">CrewAI · Sequential</span>
                <h2>{project.name}</h2>
                <p className="muted">{project.description || 'A local CrewAI project'}</p>
                <p>
                  {project.agents.length} agents · {project.tasks.length} tasks ·{' '}
                  {project.agents.reduce((n, a) => n + a.tools.length, 0)} tool assignments
                </p>
                <div className="actions">
                  <button
                    onClick={() => {
                      setDraft(structuredClone(project));
                      setTab('Overview');
                    }}
                  >
                    Open project
                  </button>
                  <button
                    disabled={!settings?.crewAIEnabled || busy}
                    onClick={() =>
                      void act(async () => {
                        await window.workspace.crewai.duplicate(project.id);
                        await load();
                      })
                    }
                  >
                    Duplicate
                  </button>
                  <button onClick={() => setDeleting(project)}>Delete</button>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : (
        <>
          <nav className="actions crew-tabs" aria-label="Crew project sections">
            {(['Overview', 'Agents', 'Tasks', 'Tools', 'Runs'] as Tab[]).map((name) => (
              <button key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>
                {name}
                {name === 'Agents'
                  ? ` (${draft.agents.length})`
                  : name === 'Tasks'
                    ? ` (${draft.tasks.length})`
                    : ''}
              </button>
            ))}
          </nav>
          {tab === 'Overview' && (
            <section className="crew-panel">
              <div className="crew-stats">
                <div>
                  <strong>{draft.agents.length}</strong>
                  <span>Agents</span>
                </div>
                <div>
                  <strong>{draft.tasks.length}</strong>
                  <span>Tasks in sequence</span>
                </div>
                <div>
                  <strong>{draft.maxModelCalls}</strong>
                  <span>Maximum model calls</span>
                </div>
              </div>
              <label>
                Project name
                <input
                  maxLength={200}
                  value={draft.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </label>
              <label>
                Project description
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={draft.description}
                  onChange={(e) => patch({ description: e.target.value })}
                />
              </label>
              <div className="field-row">
                <label>
                  Process
                  <select value="sequential" onChange={() => {}}>
                    <option value="sequential">Sequential — tasks run in order</option>
                  </select>
                </label>
                <label>
                  Total model-call budget
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={draft.maxModelCalls}
                    onChange={(e) => patch({ maxModelCalls: e.target.valueAsNumber })}
                  />
                </label>
              </div>
              <p className="small muted">
                Each run has a 15-minute deadline. Agent budgets apply across all tasks assigned to
                that agent. Manager-led delegation and persistent memory are not included in this
                version.
              </p>
              <h2>Task sequence</h2>
              <ol className="crew-sequence">
                {draft.tasks.map((task) => (
                  <li key={task.id}>
                    <strong>{task.name}</strong>
                    <span>
                      {draft.agents.find((a) => a.id === task.agentId)?.name || 'Choose an agent'}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {tab === 'Agents' && (
            <section className="crew-panel">
              <div className="page-heading">
                <div>
                  <h2>Your team</h2>
                  <p className="muted">Each agent has a role, a goal, and a model.</p>
                </div>
                <button
                  disabled={draft.agents.length >= 20}
                  onClick={() => {
                    const p = settings?.providers.find((p) => p.id === settings.activeProviderId);
                    patch({
                      agents: [
                        ...draft.agents,
                        {
                          id: crypto.randomUUID(),
                          name: 'New agent',
                          role: 'Specialist',
                          goal: 'Complete the assigned task.',
                          backstory: '',
                          providerId: p?.id ?? '',
                          model: p?.chatModel ?? '',
                          maxIterations: 15,
                          tools: [],
                        },
                      ],
                    });
                  }}
                >
                  <Plus size={16} /> Add crew agent
                </button>
              </div>
              {draft.agents.map((agent, index) => (
                <fieldset className="crew-agent" key={agent.id}>
                  <legend>{agent.name || `Agent ${index + 1}`}</legend>
                  <label>
                    Agent name
                    <input
                      maxLength={200}
                      value={agent.name}
                      onChange={(e) =>
                        patch({
                          agents: draft.agents.map((a) =>
                            a.id === agent.id ? { ...a, name: e.target.value } : a,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Role
                    <input
                      maxLength={2000}
                      value={agent.role}
                      onChange={(e) =>
                        patch({
                          agents: draft.agents.map((a) =>
                            a.id === agent.id ? { ...a, role: e.target.value } : a,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Goal
                    <textarea
                      rows={2}
                      maxLength={10000}
                      value={agent.goal}
                      onChange={(e) =>
                        patch({
                          agents: draft.agents.map((a) =>
                            a.id === agent.id ? { ...a, goal: e.target.value } : a,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Backstory
                    <textarea
                      rows={2}
                      maxLength={20000}
                      value={agent.backstory}
                      onChange={(e) =>
                        patch({
                          agents: draft.agents.map((a) =>
                            a.id === agent.id ? { ...a, backstory: e.target.value } : a,
                          ),
                        })
                      }
                    />
                  </label>
                  <ProviderSelector
                    providerId={agent.providerId}
                    model={agent.model}
                    onChange={(providerId, model) =>
                      patch({
                        agents: draft.agents.map((a) =>
                          a.id === agent.id ? { ...a, providerId, model } : a,
                        ),
                      })
                    }
                  />
                  <label>
                    Maximum model calls
                    <input
                      type="number"
                      min={1}
                      max={500}
                      value={agent.maxIterations}
                      onChange={(e) =>
                        patch({
                          agents: draft.agents.map((a) =>
                            a.id === agent.id ? { ...a, maxIterations: e.target.valueAsNumber } : a,
                          ),
                        })
                      }
                    />
                  </label>
                  <button
                    disabled={
                      draft.agents.length === 1 || draft.tasks.some((t) => t.agentId === agent.id)
                    }
                    onClick={() => patch({ agents: draft.agents.filter((a) => a.id !== agent.id) })}
                  >
                    Remove agent
                  </button>
                  {draft.tasks.some((t) => t.agentId === agent.id) && (
                    <p className="small muted">Reassign this agent’s tasks before removing it.</p>
                  )}
                </fieldset>
              ))}
            </section>
          )}
          {tab === 'Tasks' && (
            <section className="crew-panel">
              <div className="page-heading">
                <div>
                  <h2>Task workflow</h2>
                  <p className="muted">
                    Define success and select which earlier results each task receives.
                  </p>
                </div>
                <button
                  disabled={draft.tasks.length >= 50}
                  onClick={() =>
                    patch({
                      tasks: [
                        ...draft.tasks,
                        {
                          id: crypto.randomUUID(),
                          name: 'New task',
                          agentId: draft.agents[0].id,
                          description: 'Describe the work to perform.',
                          expectedOutput: 'Describe the expected result.',
                          context: [],
                        },
                      ],
                    })
                  }
                >
                  <Plus size={16} /> Add task
                </button>
              </div>
              {draft.tasks.map((task, index) => (
                <fieldset className="crew-agent" key={task.id}>
                  <legend>
                    {index + 1}. {task.name}
                  </legend>
                  <label>
                    Task name
                    <input
                      maxLength={200}
                      value={task.name}
                      onChange={(e) =>
                        patch({
                          tasks: draft.tasks.map((t) =>
                            t.id === task.id ? { ...t, name: e.target.value } : t,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Assigned agent
                    <select
                      value={task.agentId}
                      onChange={(e) =>
                        patch({
                          tasks: draft.tasks.map((t) =>
                            t.id === task.id ? { ...t, agentId: e.target.value } : t,
                          ),
                        })
                      }
                    >
                      {draft.agents.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Task instructions
                    <textarea
                      rows={3}
                      maxLength={20000}
                      value={task.description}
                      onChange={(e) =>
                        patch({
                          tasks: draft.tasks.map((t) =>
                            t.id === task.id ? { ...t, description: e.target.value } : t,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Expected output
                    <textarea
                      rows={2}
                      maxLength={10000}
                      value={task.expectedOutput}
                      onChange={(e) =>
                        patch({
                          tasks: draft.tasks.map((t) =>
                            t.id === task.id ? { ...t, expectedOutput: e.target.value } : t,
                          ),
                        })
                      }
                    />
                  </label>
                  <fieldset>
                    <legend>Use results from</legend>
                    {index === 0 && <p className="small muted">This is the first task.</p>}
                    {draft.tasks
                      .filter((t) => t.id !== task.id)
                      .map((earlier) => (
                        <label className="check" key={earlier.id}>
                          <input
                            type="checkbox"
                            disabled={
                              draft.tasks.indexOf(earlier) >= index &&
                              !task.context.includes(earlier.id)
                            }
                            checked={task.context.includes(earlier.id)}
                            onChange={(e) =>
                              patch({
                                tasks: draft.tasks.map((t) =>
                                  t.id === task.id
                                    ? {
                                        ...t,
                                        context: e.target.checked
                                          ? [...t.context, earlier.id]
                                          : t.context.filter((id) => id !== earlier.id),
                                      }
                                    : t,
                                ),
                              })
                            }
                          />
                          {earlier.name}
                        </label>
                      ))}
                  </fieldset>
                  <div className="actions">
                    {[-1, 1].map((offset) => (
                      <button
                        key={offset}
                        disabled={index + offset < 0 || index + offset >= draft.tasks.length}
                        onClick={() => {
                          const tasks = [...draft.tasks];
                          [tasks[index], tasks[index + offset]] = [
                            tasks[index + offset],
                            tasks[index],
                          ];
                          patch({ tasks });
                        }}
                      >
                        {offset === -1 ? 'Move up' : 'Move down'}
                      </button>
                    ))}
                    <button
                      disabled={draft.tasks.length === 1}
                      onClick={() =>
                        patch({
                          tasks: draft.tasks
                            .filter((t) => t.id !== task.id)
                            .map((t) => ({
                              ...t,
                              context: t.context.filter((id) => id !== task.id),
                            })),
                        })
                      }
                    >
                      Remove task
                    </button>
                  </div>
                </fieldset>
              ))}
            </section>
          )}
          {tab === 'Tools' && (
            <section className="crew-panel">
              <h2>Supported CrewAI tools</h2>
              <p className="muted">
                Assign tools to each agent. These CrewAI BaseTools run through the app and ask for
                approval on every call. Select a folder when starting the crew.
              </p>
              <div className="crew-project-grid">
                {crewTools.map((tool) => (
                  <article className="workflow-card" key={tool.id}>
                    <h3>{tool.name}</h3>
                    <p>{tool.description}</p>
                    <span className="badge">Read only · approval required</span>
                    <fieldset>
                      <legend>Available to</legend>
                      {draft.agents.map((agent) => (
                        <label className="check" key={agent.id}>
                          <input
                            type="checkbox"
                            checked={agent.tools.includes(tool.id)}
                            onChange={(e) =>
                              patch({
                                agents: draft.agents.map((a) =>
                                  a.id === agent.id
                                    ? {
                                        ...a,
                                        tools: e.target.checked
                                          ? [...a.tools, tool.id]
                                          : a.tools.filter((id) => id !== tool.id),
                                      }
                                    : a,
                                ),
                              })
                            }
                          />
                          {agent.name}
                        </label>
                      ))}
                    </fieldset>
                  </article>
                ))}
              </div>
              <CrewCustomTools
                project={draft}
                onChange={patch}
                busy={busy}
                onTest={async (tool, args) => {
                  await act(async () => {
                    const project = await save();
                    await window.workspace.crewai.testTool({
                      projectId: project.id,
                      toolId: tool.id,
                      args,
                    });
                    setTab('Runs');
                    await load();
                  });
                }}
              />
            </section>
          )}
        </>
      )}
      {(!draft || tab === 'Runs') && (
        <section className="runs">
          <h2>Run history</h2>
          {!runs.filter((r) => !draft || r.project.id === draft.id).length && (
            <p className="muted">Run your crew to see task results and tool activity here.</p>
          )}
          {[...runs]
            .reverse()
            .filter((r) => !draft || r.project.id === draft.id)
            .map((run) => (
              <details
                className="run"
                key={run.id}
                open={['running', 'waiting', 'queued'].includes(run.status)}
              >
                <summary>
                  <strong>
                    {run.kind === 'tool-test' ? `Tool test: ${run.input}` : run.project.name} ·{' '}
                    {new Date(run.startedAt).toLocaleString()}
                  </strong>
                  <span className="badge">{run.status}</span>
                </summary>
                <p>
                  {run.modelCalls} / {run.project.maxModelCalls} model calls · CrewAI{' '}
                  {run.kind === 'tool-test'
                    ? 'Python tool test (no model)'
                    : run.runtimeVersion || 'starting'}
                </p>
                <p>Input: {run.input || 'Task instructions'}</p>
                {run.error && <p className="error-text">{run.error}</p>}
                {!['completed', 'failed', 'cancelled'].includes(run.status) && (
                  <button onClick={() => void attempt(() => window.workspace.crewai.stop(run.id))}>
                    Stop crew
                  </button>
                )}
                {run.tasks.map((task) => (
                  <div className="crew-task-result" key={task.id}>
                    <strong>{task.name}</strong> · {task.status} · {task.modelCalls} calls
                    {task.result && <pre>{task.result}</pre>}
                  </div>
                ))}
                {run.tools.map((tool) => (
                  <div className="crew-tool-request" key={tool.id}>
                    <strong>
                      {crewTools.find((t) => t.id === tool.tool)?.name ??
                        run.project.customTools?.find((t) => `custom.${t.id}` === tool.tool)
                          ?.name ??
                        tool.tool}{' '}
                      · {tool.status}
                    </strong>
                    {tool.tool.startsWith('custom.') ? (
                      <>
                        <p>
                          Python code runs with your user permissions. The selected folder does not
                          restrict its filesystem or network access.
                        </p>
                        <p>
                          Timeout:{' '}
                          {
                            run.project.customTools?.find((t) => `custom.${t.id}` === tool.tool)
                              ?.timeoutSeconds
                          }{' '}
                          seconds
                        </p>
                        <pre>
                          {
                            run.project.customTools?.find((t) => `custom.${t.id}` === tool.tool)
                              ?.code
                          }
                        </pre>
                      </>
                    ) : (
                      <p>Folder: {run.folder}</p>
                    )}
                    <pre>{JSON.stringify(tool.args, null, 2)}</pre>
                    {tool.status === 'waiting' && (
                      <div className="actions">
                        <button
                          onClick={() =>
                            void attempt(() => window.workspace.crewai.approve(tool.id, true))
                          }
                        >
                          Allow tool
                        </button>
                        <button
                          onClick={() =>
                            void attempt(() => window.workspace.crewai.approve(tool.id, false))
                          }
                        >
                          Deny tool
                        </button>
                      </div>
                    )}
                    {tool.output && (
                      <details>
                        <summary>Tool output</summary>
                        <pre>{tool.output}</pre>
                      </details>
                    )}
                  </div>
                ))}
              </details>
            ))}
        </section>
      )}
      {runDialog && draft && (
        <Modal title={`Run ${draft.name}`} onClose={() => setRunDialog(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                await window.workspace.crewai.run({
                  projectId: draft.id,
                  input,
                  folder: folder || undefined,
                });
                setRunDialog(false);
                setTab('Runs');
                await load();
              });
            }}
          >
            <label>
              Run input
              <textarea
                rows={4}
                maxLength={20000}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="The topic, source text, or question for this run"
              />
            </label>
            <FolderSelection value={folder} onChange={setFolder} />
            <p className="small muted">
              A configured Python environment is required. Each tool request waits for your approval
              in Runs.
            </p>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <button className="primary" disabled={busy}>
              Start crew
            </button>
          </form>
        </Modal>
      )}
      {deleting && (
        <Modal title="Delete crew project" onClose={() => setDeleting(null)}>
          <p>Delete {deleting.name}? Run history will be retained.</p>
          <button
            onClick={() =>
              void act(async () => {
                await window.workspace.crewai.remove(deleting.id);
                setDeleting(null);
                await load();
              })
            }
          >
            Delete project
          </button>
        </Modal>
      )}
    </div>
  );
}
