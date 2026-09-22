import { useState } from 'react';
import { GitBranch, Plus } from 'lucide-react';
import { type AgentWorkflow, workflowEdges, validateWorkflow } from '../../shared/workflows';
import { useWorkflows } from '../stores/workflows';
import { useAgents, attempt, useUI } from '../stores';
import { Modal } from '../components/common';
import { FolderSelection } from '../components/folder-selection';
import { AgentRuns } from './libraries';
const fresh = (): AgentWorkflow => ({
  id: crypto.randomUUID(),
  name: '',
  description: '',
  executionMode: 'sequential',
  agents: [],
  connections: [],
  maxDepth: 20,
  maxIterations: 100,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

export function Workflows() {
  const { items, runs, load } = useWorkflows();
  const [editing, setEditing] = useState<AgentWorkflow | null>(null);
  const [running, setRunning] = useState<AgentWorkflow | null>(null);
  const [deleting, setDeleting] = useState<AgentWorkflow | null>(null);
  return (
    <div className="page workflows-page">
      <div className="page-heading">
        <div>
          <h1>Agent Workflows</h1>
          <p className="muted">Connect agents, combine results, and follow every execution.</p>
        </div>
        <button className="primary" onClick={() => setEditing(fresh())}>
          <Plus size={16} />
          New workflow
        </button>
      </div>
      {!items.length && (
        <div className="empty">
          <GitBranch size={32} />
          <h2>Create your first workflow</h2>
          <p>Run agents in sequence, in parallel, or connect a mix of both.</p>
        </div>
      )}
      <div className="workflow-list">
        {items.map((workflow) => (
          <article className="workflow-card" key={workflow.id}>
            <h2>{workflow.name}</h2>
            <p className="muted">{workflow.description}</p>
            <p>
              {workflow.agents.length} agents · {workflow.executionMode}
            </p>
            <WorkflowGraph workflow={workflow} />
            <div className="actions">
              <button onClick={() => setRunning(workflow)}>Run workflow</button>
              <button onClick={() => setEditing(structuredClone(workflow))}>Edit</button>
              <button
                onClick={() =>
                  void attempt(async () => {
                    await window.workspace.workflows.duplicate(workflow.id);
                    await load();
                  })
                }
              >
                Duplicate
              </button>
              <button onClick={() => setDeleting(workflow)}>Delete</button>
            </div>
          </article>
        ))}
      </div>
      <section className="runs">
        <h2>Workflow execution history</h2>
        {!runs.length && <p className="muted">Workflow runs will appear here.</p>}
        {[...runs].reverse().map((run) => (
          <details className="run" key={run.id}>
            <summary>
              <strong>
                {run.workflow.name} · {new Date(run.startedAt).toLocaleString()}
              </strong>
              <span className="badge">{run.status}</span>
            </summary>
            <p role="status">
              {run.nodes.filter((n) => n.status === 'completed').length} / {run.nodes.length} agents
              completed · Duration:{' '}
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
            <p>Task: {run.task || 'Configured agent instructions'}</p>
            <p className="folder-path">Folder: {run.folderPath || 'No folder selected'}</p>
            {!['completed', 'failed', 'cancelled'].includes(run.status) && (
              <button onClick={() => void attempt(() => window.workspace.workflows.stop(run.id))}>
                Cancel workflow
              </button>
            )}
            {run.error && <p className="error-text">{run.error}</p>}
            {run.nodes.map((node) => (
              <div key={node.nodeId} className="workflow-node-history">
                <p>
                  <strong>{node.agentName}</strong> · {node.status} · {node.iterationsUsed}{' '}
                  iterations
                </p>
                {node.error && <p className="error-text">{node.error}</p>}
                {node.runId && <AgentRuns ids={[node.runId]} />}
              </div>
            ))}
          </details>
        ))}
      </section>
      {editing && <WorkflowEditor initial={editing} onClose={() => setEditing(null)} />}
      {running && <WorkflowRunner workflow={running} onClose={() => setRunning(null)} />}
      {deleting && (
        <Modal title="Delete workflow" onClose={() => setDeleting(null)}>
          <p>Delete {deleting.name}? Execution history is retained.</p>
          <button
            onClick={() =>
              void attempt(async () => {
                await window.workspace.workflows.remove(deleting.id);
                await load();
                setDeleting(null);
              })
            }
          >
            Delete workflow
          </button>
        </Modal>
      )}
    </div>
  );
}

function WorkflowGraph({ workflow }: { workflow: AgentWorkflow }) {
  const edges = workflowEdges(workflow);
  // A bounded layout also renders an invalid draft so the user can correct it.
  const levels = new Map(workflow.agents.map((node) => [node.id, 0]));
  for (let i = 0; i < workflow.agents.length; i++)
    for (const edge of edges)
      levels.set(
        edge.to,
        Math.min(
          workflow.agents.length - 1,
          Math.max(levels.get(edge.to) ?? 0, (levels.get(edge.from) ?? 0) + 1),
        ),
      );
  const rows = new Map<number, number>();
  const positions = new Map(
    workflow.agents.map((node) => {
      const level = levels.get(node.id) ?? 0,
        row = rows.get(level) ?? 0;
      rows.set(level, row + 1);
      return [node.id, { x: level * 220 + 10, y: row * 80 + 10 }];
    }),
  );
  const width = Math.max(220, ...[...positions.values()].map((p) => p.x + 210));
  const height = Math.max(80, ...[...positions.values()].map((p) => p.y + 70));
  return (
    <div className="workflow-graph" tabIndex={0} aria-label="Workflow graph">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${workflow.executionMode} workflow: ${workflow.agents.map((n) => n.name).join(', ')}`}
      >
        {edges.map((edge) => {
          const from = positions.get(edge.from),
            to = positions.get(edge.to);
          return from && to ? (
            <g key={`${edge.from}-${edge.to}`}>
              <path
                d={`M${from.x + 190},${from.y + 25} C${from.x + 210},${from.y + 25} ${to.x - 20},${to.y + 25} ${to.x},${to.y + 25}`}
              />
              <text x={to.x - 12} y={to.y + 29}>
                ›
              </text>
            </g>
          ) : null;
        })}
        {workflow.agents.map((node, i) => {
          const p = positions.get(node.id)!;
          return (
            <g key={node.id} transform={`translate(${p.x},${p.y})`}>
              <title>{node.name}</title>
              <rect width="190" height="50" rx="8" />
              <text x="10" y="30">
                {i + 1}. {node.name.length > 21 ? `${node.name.slice(0, 20)}…` : node.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function WorkflowEditor({ initial, onClose }: { initial: AgentWorkflow; onClose(): void }) {
  const [workflow, setWorkflow] = useState(initial);
  const agents = useAgents((s) => s.items);
  const [agentId, setAgentId] = useState(agents.find((a) => a.enabled)?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const patch = (value: Partial<AgentWorkflow>) => setWorkflow((w) => ({ ...w, ...value }));
  const reorder = (i: number, offset: number) => {
    const nodes = [...workflow.agents];
    [nodes[i], nodes[i + offset]] = [nodes[i + offset], nodes[i]];
    patch({ agents: nodes });
  };
  return (
    <Modal title={initial.name ? 'Edit workflow' : 'New workflow'} wide onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          setBusy(true);
          void (async () => {
            try {
              await window.workspace.workflows.save(validateWorkflow(workflow));
              await useWorkflows.getState().load();
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        <label>
          Name (required)
          <input
            name="name"
            required
            maxLength={200}
            value={workflow.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </label>
        <label>
          Description
          <textarea
            name="description"
            maxLength={2000}
            value={workflow.description}
            onChange={(e) => patch({ description: e.target.value })}
          />
        </label>
        <label>
          Execution mode
          <select
            name="executionMode"
            value={workflow.executionMode}
            onChange={(e) =>
              patch({
                executionMode: e.target.value as AgentWorkflow['executionMode'],
                connections: [],
              })
            }
          >
            <option value="sequential">Sequential — listed order</option>
            <option value="parallel">Parallel — independent agents</option>
            <option value="mixed">Mixed — connect dependencies</option>
          </select>
        </label>
        <p className="small muted">
          Changing mode clears connections. Mixed mode runs each agent after all its connected
          predecessors succeed. Ready agents share three execution slots.
        </p>
        <div className="form-grid">
          <label>
            Maximum depth
            <input
              name="maxDepth"
              type="number"
              min={1}
              max={100}
              required
              value={workflow.maxDepth}
              onChange={(e) => patch({ maxDepth: Number(e.target.value) })}
            />
          </label>
          <label>
            Maximum agent executions
            <input
              name="maxIterations"
              type="number"
              min={1}
              max={100}
              required
              value={workflow.maxIterations}
              onChange={(e) => patch({ maxIterations: Number(e.target.value) })}
            />
          </label>
        </div>
        <WorkflowGraph workflow={workflow} />
        <div className="actions workflow-add-agent">
          <div>
            <label htmlFor="workflow-add-agent">Add agent</label>
            <select
              id="workflow-add-agent"
              name="agent"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
            >
              <option value="">Select an agent</option>
              {agents
                .filter((a) => a.enabled)
                .map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
            </select>
          </div>
          <button
            type="button"
            disabled={!agentId || workflow.agents.length >= 100}
            onClick={() => {
              const agent = agents.find((a) => a.id === agentId)!;
              patch({
                agents: [
                  ...workflow.agents,
                  { id: crypto.randomUUID(), agentId, name: agent.name, prompt: '' },
                ],
              });
            }}
          >
            Add Agent
          </button>
        </div>
        {!agents.length && <p>Create an agent in the Agents menu first.</p>}
        {workflow.agents.map((node, i) => (
          <fieldset className="workflow-node-editor" key={node.id}>
            <legend>
              {i + 1}. {node.name}
            </legend>
            <div className="actions">
              <button type="button" disabled={i === 0} onClick={() => reorder(i, -1)}>
                Move up
              </button>
              <button
                type="button"
                disabled={i === workflow.agents.length - 1}
                onClick={() => reorder(i, 1)}
              >
                Move down
              </button>
              <button
                type="button"
                onClick={() =>
                  patch({
                    agents: workflow.agents.filter((n) => n.id !== node.id),
                    connections: workflow.connections.filter(
                      (e) => e.from !== node.id && e.to !== node.id,
                    ),
                  })
                }
              >
                Remove Agent
              </button>
            </div>
            <label>
              Task for {node.name}
              <textarea
                name={`prompt-${node.id}`}
                maxLength={20000}
                value={node.prompt}
                onChange={(e) =>
                  patch({
                    agents: workflow.agents.map((n) =>
                      n.id === node.id ? { ...n, prompt: e.target.value } : n,
                    ),
                  })
                }
              />
            </label>
            {workflow.executionMode === 'mixed' && (
              <fieldset>
                <legend>Wait for output from</legend>
                {workflow.agents
                  .filter((n) => n.id !== node.id)
                  .map((source) => (
                    <label className="check" key={source.id}>
                      <input
                        type="checkbox"
                        name={`edge-${source.id}-${node.id}`}
                        checked={workflow.connections.some(
                          (e) => e.from === source.id && e.to === node.id,
                        )}
                        onChange={(e) =>
                          patch({
                            connections: e.target.checked
                              ? [
                                  ...workflow.connections,
                                  { from: source.id, to: node.id, mode: 'parallel' },
                                ]
                              : workflow.connections.filter(
                                  (c) => c.from !== source.id || c.to !== node.id,
                                ),
                          })
                        }
                      />
                      {source.name}
                    </label>
                  ))}
              </fieldset>
            )}
            {workflowEdges(workflow)
              .filter((e) => e.to === node.id)
              .map((edge) => {
                const mapping = edge.inputMapping ?? {
                  sourceOutput: 'result',
                  targetInput: 'previousAgentOutput' as const,
                };
                const update = (next: typeof mapping) =>
                  patch({
                    connections: [
                      ...workflow.connections.filter(
                        (c) => c.from !== edge.from || c.to !== edge.to,
                      ),
                      { ...edge, inputMapping: next },
                    ],
                  });
                return (
                  <div className="form-grid" key={edge.from}>
                    <label>
                      Output from {workflow.agents.find((n) => n.id === edge.from)?.name}
                      <input
                        name={`source-${edge.from}-${node.id}`}
                        value={mapping.sourceOutput}
                        onChange={(e) => update({ ...mapping, sourceOutput: e.target.value })}
                      />
                    </label>
                    <label>
                      Target input
                      <select
                        name={`target-${edge.from}-${node.id}`}
                        value={mapping.targetInput}
                        onChange={(e) =>
                          update({
                            ...mapping,
                            targetInput: e.target.value as typeof mapping.targetInput,
                          })
                        }
                      >
                        <option value="previousAgentOutput">Previous agent output</option>
                        <option value="prompt">Prompt</option>
                      </select>
                    </label>
                  </div>
                );
              })}
          </fieldset>
        ))}
        <p className="small muted">
          Use result for the full output or result.issues for a JSON field. Each agent keeps its own
          model, permissions, and iteration limit.
        </p>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save workflow'}
        </button>
      </form>
    </Modal>
  );
}
function WorkflowRunner({ workflow, onClose }: { workflow: AgentWorkflow; onClose(): void }) {
  const [task, setTask] = useState(''),
    [project, setProject] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal title={`Run ${workflow.name}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          void attempt(async () => {
            try {
              await window.workspace.workflows.run({
                workflowId: workflow.id,
                task,
                project: project || undefined,
              });
              await useWorkflows.getState().load();
              useUI.setState({ notice: 'Workflow started' });
              onClose();
            } finally {
              setBusy(false);
            }
          });
        }}
      >
        <label>
          Task (optional)
          <textarea
            name="task"
            maxLength={20000}
            value={task}
            onChange={(e) => setTask(e.target.value)}
          />
        </label>
        <FolderSelection value={project} onChange={setProject} />
        <button className="primary" disabled={busy}>
          Start workflow
        </button>
      </form>
    </Modal>
  );
}
