import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowDefinitions } from '../src/main/services/workflows/definitions';
import { WorkflowService } from '../src/main/services/workflows/workflows';
import { WorkflowRunDatabase } from '../src/main/database/workflow-runs';
import { LibraryService } from '../src/main/services/filesystem/library';
import { librarySchema, settingsSchema, sendSchema } from '../src/shared/schemas';
import {
  validateWorkflow,
  workflowRunInputSchema,
  type AgentWorkflow,
} from '../src/shared/workflows';
import { resolveSlash } from '../src/shared/slash-commands';
import type { AppEvent, RunState } from '../src/shared/types';
import { AgentService } from '../src/main/services/agents/agents';
import { OllamaLLMProvider } from '../src/main/services/ollama/provider';
import { KnowledgeService } from '../src/main/services/rag/knowledge';
import { MCPService } from '../src/main/services/mcp/mcp';
import { AgentRunDatabase } from '../src/main/database/agent-runs';
import { ChatCommands } from '../src/main/services/ollama/commands';
let root: string,
  definitions: WorkflowDefinitions,
  store: WorkflowRunDatabase,
  library: LibraryService;
const definition = (executionMode: AgentWorkflow['executionMode'] = 'mixed'): AgentWorkflow => ({
  id: 'quality',
  name: 'Code quality',
  description: '',
  executionMode,
  agents: ['a', 'b', 'c', 'd'].map((id) => ({
    id,
    agentId: id,
    name: id.toUpperCase(),
    prompt: '',
  })),
  connections: [
    { from: 'a', to: 'b', mode: 'parallel' },
    { from: 'a', to: 'c', mode: 'parallel' },
    { from: 'b', to: 'd', mode: 'sequential' },
    { from: 'c', to: 'd', mode: 'sequential' },
  ],
  maxDepth: 10,
  maxIterations: 10,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'workflow-test-'));
  library = new LibraryService(root);
  definitions = new WorkflowDefinitions(root, library);
  store = new WorkflowRunDatabase(join(root, 'runs.sqlite'));
  for (const id of ['a', 'b', 'c', 'd'])
    await library.save(
      'agents',
      librarySchema.parse({
        id,
        name: id.toUpperCase(),
        model: 'test',
        maxIterations: 3,
        content: 'Complete the task.',
      }),
    );
});
afterEach(async () => {
  store.close();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});
function child(
  id: string,
  status: RunState['status'] = 'Completed',
  result = JSON.stringify({ from: id }),
): RunState {
  return {
    id: `run-${id}`,
    agentId: id,
    agentName: id,
    status,
    result,
    iterationsUsed: 2,
    maxIterations: 3,
    userPrompt: '',
    startedAt: new Date().toISOString(),
    events: [],
    tools: [],
    mcps: [],
  };
}
async function finished(service: WorkflowService, id: string) {
  await expect
    .poll(() => service.runs().find((r) => r.id === id)?.status)
    .toMatch(/completed|failed|cancelled/);
  return service.runs().find((r) => r.id === id)!;
}
it('rejects cycles with agent names, missing nodes, duplicates, unsafe mapping, and execution limits', () => {
  const w = definition();
  expect(() =>
    validateWorkflow({
      ...w,
      connections: [...w.connections, { from: 'd', to: 'a', mode: 'sequential' }],
    }),
  ).toThrow(/Circular Agent dependency.*A.*D/);
  expect(() => validateWorkflow({ ...w, maxDepth: 2 })).toThrow(/depth/);
  expect(() => validateWorkflow({ ...w, maxIterations: 3 })).toThrow(/executions/);
  expect(() => validateWorkflow({ ...w, agents: [w.agents[0], w.agents[0]] })).toThrow(/unique/);
  expect(() =>
    validateWorkflow({ ...w, connections: [{ from: 'no', to: 'a', mode: 'parallel' }] }),
  ).toThrow(/missing/);
  expect(() =>
    validateWorkflow({ ...w, connections: [...w.connections, w.connections[0]] }),
  ).toThrow(/Duplicate/);
  expect(() =>
    validateWorkflow({
      ...w,
      connections: [
        {
          ...w.connections[0],
          inputMapping: { sourceOutput: 'result.__proto__', targetInput: 'prompt' },
        },
      ],
    }),
  ).toThrow(/safe/);
  expect(() => workflowRunInputSchema.parse({ workflowId: '../../outside' })).toThrow();
  expect(() => workflowRunInputSchema.parse({ workflowId: '../outside' })).toThrow();
});
it('persists file definitions, duplicates them, and keeps history after deletion and restart', async () => {
  await definitions.save(definition());
  expect(await readdir(join(root, 'workflows'))).toEqual(['quality.json']);
  const copy = await definitions.duplicate('quality');
  expect(copy.id).not.toBe('quality');
  expect(copy.name).toBe('Code quality copy');
  const service = new WorkflowService(
    definitions,
    { runWorkflowNode: async (input) => child(input.agentId) },
    store,
    () => {},
  );
  const id = await service.run({ workflowId: 'quality', task: '' });
  await finished(service, id);
  await definitions.remove('quality');
  expect(
    new WorkflowService(definitions, { runWorkflowNode: vi.fn() }, store, () => {}).runs()[0]
      .status,
  ).toBe('completed');
  expect(await definitions.list()).toHaveLength(1);
});
it('runs a fork concurrently, waits for both branches, maps structured output and keeps source identities', async () => {
  const w = definition();
  w.connections[2].inputMapping = { sourceOutput: 'result.from', targetInput: 'prompt' };
  await definitions.save(w);
  const calls: { agentId: string; task: string; project?: string }[] = [];
  const releases = new Map<string, () => void>();
  const service = new WorkflowService(
    definitions,
    {
      runWorkflowNode: async (input, _signal, observe) => {
        calls.push(input);
        observe({ type: 'agent', id: `run-${input.agentId}`, status: 'Planning' });
        if (['b', 'c'].includes(input.agentId))
          await new Promise<void>((resolve) => releases.set(input.agentId, resolve));
        return child(input.agentId);
      },
    },
    store,
    () => {},
  );
  const id = await service.run({
    workflowId: 'quality',
    task: 'Review',
    project: '/selected/project',
  });
  await expect.poll(() => calls.length).toBe(3);
  expect(calls.map((c) => c.agentId)).toEqual(['a', 'b', 'c']);
  expect(calls[1].task).toContain('"agentName": "A"');
  releases.get('b')!();
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(calls).toHaveLength(3);
  releases.get('c')!();
  const run = await finished(service, id);
  expect(calls[3].task).toContain('Prompt from B (b):\nb');
  expect(calls[3].task).toContain('"agentName": "C"');
  expect(calls.every((c) => c.project === '/selected/project')).toBe(true);
  expect(run.nodes.every((n) => n.iterationsUsed === 2 && !!n.runId)).toBe(true);
});
it.each(['Failed', 'Max iterations reached'] as const)(
  'blocks dependents after %s and lets independent branches finish',
  async (status) => {
    await definitions.save(definition());
    const calls: string[] = [];
    const service = new WorkflowService(
      definitions,
      {
        runWorkflowNode: async (input) => {
          calls.push(input.agentId);
          return child(input.agentId, input.agentId === 'b' ? status : 'Completed');
        },
      },
      store,
      () => {},
    );
    const run = await finished(service, await service.run({ workflowId: 'quality', task: '' }));
    expect(calls).toEqual(['a', 'b', 'c']);
    expect(run.status).toBe('failed');
    expect(run.error).toContain('B');
    expect(run.nodes.find((n) => n.nodeId === 'c')?.status).toBe('completed');
  },
);
it('cancels every running branch and never starts dependent nodes', async () => {
  await definitions.save(definition('parallel'));
  const started: string[] = [],
    aborted: string[] = [];
  const service = new WorkflowService(
    definitions,
    {
      runWorkflowNode: async (input, signal) => {
        started.push(input.agentId);
        await new Promise<void>((resolve) =>
          signal.addEventListener(
            'abort',
            () => {
              aborted.push(input.agentId);
              resolve();
            },
            { once: true },
          ),
        );
        return child(input.agentId, 'Cancelled');
      },
    },
    store,
    () => {},
  );
  const id = await service.run({ workflowId: 'quality', task: '' });
  await expect.poll(() => started.length).toBe(4);
  service.stop(id);
  const run = await finished(service, id);
  expect(aborted).toHaveLength(4);
  expect(run.status).toBe('cancelled');
  expect(run.nodes.every((n) => n.status === 'cancelled')).toBe(true);
});
it('uses the actual bounded agent runtime, preserves individual history, and runs from the chat command', async () => {
  await definitions.save(definition('sequential'));
  const settings = () => settingsSchema.parse({ chatModel: 'test', maxIterations: 3 });
  const llm = new OllamaLLMProvider(settings);
  vi.spyOn(llm, 'complete').mockResolvedValue({
    role: 'assistant',
    content: JSON.stringify({ final: 'Reviewed' }),
  });
  const mcp = new MCPService(library, { resolve: () => '', redact: (s) => s }, () => {});
  const kb = new KnowledgeService(
    root,
    settings,
    { embed: async () => [], embedBatch: async () => [] },
    () => {},
  );
  const agentStore = new AgentRunDatabase(join(root, 'agents.sqlite'));
  const agents = new AgentService(
    library,
    llm,
    kb,
    mcp,
    settings,
    () => {},
    undefined,
    undefined,
    agentStore,
  );
  const workflow = new WorkflowService(definitions, agents, store, () => {});
  try {
    const command = resolveSlash('/workflow Code quality', [
      { id: 'quality', name: 'Code quality', enabled: true },
    ]);
    expect(
      sendSchema.parse({
        id: 'chat',
        text: command.query,
        model: 'test',
        knowledge: 'none',
        command: command.command,
      }).command?.kind,
    ).toBe('workflow');
    const prepared = await new ChatCommands(library, mcp, agents, workflow).prepare(
      command.command,
      'test',
      'none',
    );
    const events: AppEvent[] = [];
    const result = await prepared.execute!('', new AbortController().signal, (event) =>
      events.push(event),
    );
    expect(result).toContain('Results from D:\nReviewed');
    expect(agentStore.list()).toHaveLength(4);
    expect(agentStore.list().every((r) => r.iterationsUsed === 1 && r.status === 'Completed')).toBe(
      true,
    );
    expect(events.some((e) => e.type === 'workflow' && e.status === 'completed')).toBe(true);
  } finally {
    await workflow.stopAll();
    await agents.stopAll();
    agentStore.close();
  }
});
it('marks interrupted workflow history cancelled on restart', () => {
  store.save({
    id: 'interrupted',
    workflow: definition(),
    task: '',
    status: 'running',
    startedAt: new Date().toISOString(),
    nodes: [{ nodeId: 'a', agentId: 'a', agentName: 'A', status: 'running', iterationsUsed: 0 }],
  });
  const service = new WorkflowService(definitions, { runWorkflowNode: vi.fn() }, store, () => {});
  expect(service.runs()[0].status).toBe('cancelled');
  expect(store.list()[0].nodes[0].status).toBe('cancelled');
});

it('reports missing mapped fields without starting the receiving agent', async () => {
  const w = definition();
  w.connections[0].inputMapping = {
    sourceOutput: 'result.missing',
    targetInput: 'previousAgentOutput',
  };
  await definitions.save(w);
  const calls: string[] = [];
  const service = new WorkflowService(
    definitions,
    {
      runWorkflowNode: async (input) => {
        calls.push(input.agentId);
        return child(input.agentId);
      },
    },
    store,
    () => {},
  );
  const run = await finished(service, await service.run({ workflowId: 'quality', task: '' }));
  expect(calls).toEqual(['a', 'c']);
  expect(run.nodes.find((n) => n.nodeId === 'b')?.error).toContain('result.missing');
});

it('queues a fourth child behind the real three-agent limit and cancels queued children', async () => {
  await definitions.save(definition('parallel'));
  const settings = () => settingsSchema.parse({ chatModel: 'test', maxIterations: 3 });
  const llm = new OllamaLLMProvider(settings);
  let calls = 0;
  vi.spyOn(llm, 'complete').mockImplementation(async (request) => {
    calls++;
    await new Promise<void>((_resolve, reject) =>
      request.signal!.addEventListener('abort', () => reject(new Error('cancelled')), {
        once: true,
      }),
    );
    return { role: 'assistant', content: '{"final":"done"}' };
  });
  const mcp = new MCPService(library, { resolve: () => '', redact: (s) => s }, () => {});
  const kb = new KnowledgeService(
    root,
    settings,
    { embed: async () => [], embedBatch: async () => [] },
    () => {},
  );
  const agents = new AgentService(library, llm, kb, mcp, settings, () => {});
  const service = new WorkflowService(definitions, agents, store, () => {});
  try {
    const id = await service.run({ workflowId: 'quality', task: '' });
    await expect.poll(() => calls).toBe(3);
    expect(agents.runs()).toHaveLength(3);
    service.stop(id);
    const run = await finished(service, id);
    expect(calls).toBe(3);
    expect(run.nodes.every((n) => n.status === 'cancelled')).toBe(true);
    expect(agents.runs().every((r) => r.status === 'Cancelled')).toBe(true);
  } finally {
    await service.stopAll();
    await agents.stopAll();
  }
});

it('shares the three execution slots with an external sequential crew', async () => {
  await definitions.save(definition('parallel'));
  const settings = () => settingsSchema.parse({ chatModel: 'test', maxIterations: 3 });
  const llm = new OllamaLLMProvider(settings);
  let calls = 0;
  vi.spyOn(llm, 'complete').mockImplementation(async (request) => {
    calls++;
    await new Promise<void>((_resolve, reject) =>
      request.signal!.addEventListener('abort', () => reject(new Error('cancelled')), {
        once: true,
      }),
    );
    return { role: 'assistant', content: '{"final":"done"}' };
  });
  const mcp = new MCPService(library, { resolve: () => '', redact: (s) => s }, () => {});
  const kb = new KnowledgeService(
    root,
    settings,
    { embed: async () => [], embedBatch: async () => [] },
    () => {},
  );
  const agents = new AgentService(library, llm, kb, mcp, settings, () => {});
  const service = new WorkflowService(definitions, agents, store, () => {});
  let release!: () => void;
  const external = agents.withExternalSlot(
    new AbortController().signal,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  try {
    const id = await service.run({ workflowId: 'quality', task: '' });
    await expect.poll(() => calls).toBe(2);
    expect(agents.runs()).toHaveLength(2);
    release();
    await external;
    await expect.poll(() => calls).toBe(3);
    service.stop(id);
    expect((await finished(service, id)).status).toBe('cancelled');
  } finally {
    release();
    await external;
    await service.stopAll();
    await agents.stopAll();
  }
});
