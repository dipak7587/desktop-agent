import { randomUUID } from 'node:crypto';
import type { AppEvent, RunState } from '../../../shared/types';
import {
  mappedOutput,
  validateWorkflow,
  workflowEdges,
  workflowRunInputSchema,
  type WorkflowRun,
  type WorkflowRunInput,
} from '../../../shared/workflows';
import type { WorkflowRunStore } from '../../database/workflow-runs';
import type { WorkflowDefinitions } from './definitions';
interface WorkflowAgents {
  runWorkflowNode(
    input: { agentId: string; task: string; project?: string },
    signal: AbortSignal,
    observe: (event: AppEvent) => void,
  ): Promise<RunState>;
}
export class WorkflowService {
  private history = new Map<string, WorkflowRun>();
  private controllers = new Map<string, AbortController>();
  private jobs = new Map<string, Promise<void>>();
  constructor(
    public definitions: WorkflowDefinitions,
    private agents: WorkflowAgents,
    private store: WorkflowRunStore,
    private emit: (event: AppEvent) => void,
    private redact = (text: string) => text,
  ) {
    for (const run of store.list()) {
      if (!['completed', 'failed', 'cancelled'].includes(run.status)) {
        run.status = 'cancelled';
        run.completedAt = new Date().toISOString();
        run.error = 'Application closed before this workflow finished.';
        for (const node of run.nodes)
          if (['pending', 'running', 'waiting'].includes(node.status)) {
            node.status = 'cancelled';
            node.error = run.error;
          }
        store.save(run);
      }
      this.history.set(run.id, run);
    }
  }
  runs() {
    return [...this.history.values()];
  }
  async run(input: WorkflowRunInput, observe?: (event: AppEvent) => void) {
    input = workflowRunInputSchema.parse(input);
    const workflow = validateWorkflow(await this.definitions.get(input.workflowId));
    if (this.controllers.size >= 3) throw new Error('At most three workflows may run at once.');
    const run: WorkflowRun = {
      id: randomUUID(),
      workflow,
      status: 'pending',
      task: this.redact(input.task),
      folderPath: input.project,
      startedAt: new Date().toISOString(),
      nodes: workflow.agents.map((n) => ({
        nodeId: n.id,
        agentId: n.agentId,
        agentName: n.name,
        status: 'waiting',
        iterationsUsed: 0,
      })),
    };
    const controller = new AbortController();
    this.history.set(run.id, run);
    this.controllers.set(run.id, controller);
    const publish = (content?: string) => {
      if (run.status === 'running' || run.status === 'waiting')
        run.status = run.nodes.some((node) => node.status === 'running') ? 'running' : 'waiting';
      this.store.save(run);
      const event: AppEvent = {
        type: 'workflow',
        id: run.id,
        status: run.status,
        content: this.redact(content ?? `Workflow ${workflow.name}: ${run.status}`),
      };
      this.emit(event);
      observe?.(event);
    };
    publish();
    const job = this.execute(run, input, controller.signal, publish, observe).finally(() => {
      this.controllers.delete(run.id);
      this.jobs.delete(run.id);
    });
    this.jobs.set(run.id, job);
    return run.id;
  }
  async runInChat(
    input: WorkflowRunInput,
    signal: AbortSignal,
    observe: (event: AppEvent) => void,
  ) {
    signal.throwIfAborted();
    const id = await this.run(input, observe);
    const stop = () => this.stop(id);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    try {
      await this.jobs.get(id);
      signal.throwIfAborted();
      const run = this.history.get(id)!;
      if (run.status !== 'completed') throw new Error(run.error ?? `Workflow ${run.status}`);
      const edges = workflowEdges(run.workflow);
      return run.nodes
        .filter((n) => !edges.some((e) => e.from === n.nodeId))
        .map(
          (n) =>
            `Results from ${n.agentName}:\n${typeof n.result === 'string' ? n.result : JSON.stringify(n.result, null, 2)}`,
        )
        .join('\n\n');
    } finally {
      signal.removeEventListener('abort', stop);
    }
  }
  stop(id: string) {
    this.controllers.get(id)?.abort();
  }
  async stopAll() {
    for (const id of this.controllers.keys()) this.stop(id);
    await Promise.allSettled(this.jobs.values());
  }
  private async execute(
    run: WorkflowRun,
    input: WorkflowRunInput,
    signal: AbortSignal,
    publish: (content?: string) => void,
    observe?: (event: AppEvent) => void,
  ) {
    const edges = workflowEdges(run.workflow);
    const jobs = new Map<string, Promise<void>>();
    let executions = 0;
    run.status = 'running';
    publish();
    const executeNode = (id: string): Promise<void> => {
      if (jobs.has(id)) return jobs.get(id)!;
      const node = run.nodes.find((n) => n.nodeId === id)!;
      const definition = run.workflow.agents.find((n) => n.id === id)!;
      const incoming = edges.filter((e) => e.to === id);
      const job = (async () => {
        await Promise.all(incoming.map((e) => executeNode(e.from)));
        try {
          signal.throwIfAborted();
          const blocked = incoming
            .map((e) => run.nodes.find((n) => n.nodeId === e.from)!)
            .find((n) => n.status !== 'completed');
          if (blocked)
            throw new Error(`Required upstream agent ${blocked.agentName} ${blocked.status}.`);
          if (++executions > run.workflow.maxIterations)
            throw new Error('Maximum workflow agent executions reached.');
          const context = incoming.map((edge) => {
            const source = run.nodes.find((n) => n.nodeId === edge.from)!;
            return {
              nodeId: source.nodeId,
              agentId: source.agentId,
              agentName: source.agentName,
              runId: source.runId,
              status: source.status,
              targetInput: edge.inputMapping?.targetInput ?? 'previousAgentOutput',
              result: mappedOutput(source.result, edge.inputMapping?.sourceOutput),
            };
          });
          const previousOutputs = context.filter((c) => c.targetInput === 'previousAgentOutput');
          const promptOutputs = context.filter((c) => c.targetInput === 'prompt');
          const task = [
            input.task,
            definition.prompt,
            ...promptOutputs.map(
              (c) =>
                `Prompt from ${c.agentName} (${c.nodeId}):\n${typeof c.result === 'string' ? c.result : JSON.stringify(c.result, null, 2)}`,
            ),
            previousOutputs.length
              ? `Previous Agent Output (source-labelled data):\n${JSON.stringify(previousOutputs, null, 2)}`
              : '',
          ]
            .filter(Boolean)
            .join('\n\n');
          if (task.length > 200000)
            throw new Error(
              'Combined workflow input exceeds 200,000 characters. Reduce upstream output.',
            );
          const child = await this.agents.runWorkflowNode(
            { agentId: definition.agentId, task, project: input.project },
            signal,
            (event) => {
              node.runId = event.id;
              node.iterationsUsed = event.iterationsUsed ?? node.iterationsUsed;
              node.status = event.status === 'Waiting for approval' ? 'waiting' : 'running';
              publish(`${node.agentName}: ${event.status}`);
              observe?.(event);
            },
          );
          node.runId = child.id;
          node.iterationsUsed = child.iterationsUsed;
          if (child.status !== 'Completed')
            throw new Error(child.error ?? `${node.agentName}: ${child.status}`);
          let result: unknown = child.result ?? '';
          try {
            result = JSON.parse(child.result ?? '') as unknown;
          } catch {
            /* Text reports are valid outputs. */
          }
          node.result = JSON.parse(this.redact(JSON.stringify(result))) as unknown;
          node.status = 'completed';
        } catch (error) {
          node.status = signal.aborted ? 'cancelled' : 'failed';
          node.error = this.redact(error instanceof Error ? error.message : String(error));
        }
        publish(`${node.agentName}: ${node.status}${node.error ? ` — ${node.error}` : ''}`);
      })();
      jobs.set(id, job);
      return job;
    };
    try {
      await Promise.all(run.nodes.map((node) => executeNode(node.nodeId)));
      run.status = signal.aborted
        ? 'cancelled'
        : run.nodes.some((n) => n.status === 'failed')
          ? 'failed'
          : 'completed';
      if (run.status === 'failed')
        run.error = run.nodes
          .filter((n) => n.status === 'failed')
          .map((n) => `${n.agentName}: ${n.error}`)
          .join('\n');
    } catch (error) {
      run.status = 'failed';
      run.error = this.redact(String(error));
    }
    run.completedAt = new Date().toISOString();
    publish();
  }
}
