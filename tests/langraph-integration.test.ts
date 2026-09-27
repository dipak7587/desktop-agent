import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatDatabase } from '../src/main/database/chat';
import { CheckpointDatabase } from '../src/main/database/checkpoints';
import { ChatService } from '../src/main/services/ollama/chat';
import { AgentLoopGraph } from '../src/main/services/ai/agent-graph';
import {
  CapabilityDecisionEngine,
  CapabilityRouter,
} from '../src/main/services/agents/capabilities';
import { settingsSchema, capabilityConfigSchema, librarySchema } from '../src/shared/schemas';
import type { AppEvent, RunState } from '../src/shared/types';
import type { LLMProvider, ChatChunk } from '../src/main/services/ollama/provider';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

const yes = {
  relevant: true,
  necessary: true,
  canAnswerDirectly: false,
  userForbids: false,
};

it('chat turns run as LangGraph threads keyed by conversation id with durable checkpoints', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chatgraph-'));
  roots.push(root);
  const db = new ChatDatabase(join(root, 'chat.sqlite'));
  const saver = new CheckpointDatabase(join(root, 'checkpoints.sqlite'));
  let turn = 0;
  const llm = {
    chat: async function* () {
      turn += 1;
      yield { message: { content: `Answer ${turn}` } } as ChatChunk;
    },
  } as unknown as LLMProvider;
  const chat = new ChatService(
    db,
    llm,
    () => {},
    async () => [],
    () => 8192,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { checkpointer: saver },
  );
  const c = db.create('test-model');
  await chat.send({ id: c.id, text: 'First question', model: 'test-model', knowledge: 'none' });
  await expect.poll(() => chat.isActive(c.id)).toBe(false);
  expect(db.messages(c.id).at(-1)?.content).toBe('Answer 1');
  const first = await saver.getTuple({ configurable: { thread_id: c.id } });
  expect(first).toBeDefined();
  await chat.send({ id: c.id, text: 'Second question', model: 'test-model', knowledge: 'none' });
  await expect.poll(() => chat.isActive(c.id)).toBe(false);
  expect(db.messages(c.id).at(-1)?.content).toBe('Answer 2');
  const listed: string[] = [];
  for await (const entry of saver.list({ configurable: { thread_id: c.id } }))
    listed.push(entry.checkpoint.id);
  expect(listed.length).toBeGreaterThanOrEqual(2);
  expect(new Set(listed).size).toBe(listed.length);
  await saver.deleteThread(c.id);
  expect(await saver.getTuple({ configurable: { thread_id: c.id } })).toBeUndefined();
  db.close();
  saver.close();
});

it('the agent loop executes as a plan/act graph until a final answer', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentgraph-'));
  roots.push(root);
  const scripted = [
    JSON.stringify({ tool: 'filesystem.list' }),
    JSON.stringify({ final: 'All done' }),
  ];
  let call = 0;
  const llm = {
    listModels: async () => [],
    complete: async () => ({ role: 'assistant', content: scripted[Math.min(call++, 1)] }),
    chat: async function* () {
      yield { message: { content: scripted[Math.min(call++, 1)] } } as ChatChunk;
    },
  } as unknown as LLMProvider;
  const execute = vi.fn(async () => 'file list');
  const router = new CapabilityRouter(
    new CapabilityDecisionEngine(async () => yes),
    'List the workspace',
    capabilityConfigSchema.parse({ mode: 'auto' }),
    { project: root },
    async () => false,
  );
  router.register({
    capability: { id: 'filesystem.list', name: 'filesystem.list', type: 'tool', enabled: true },
    execute,
  });
  const run: RunState = {
    id: 'run-1',
    status: 'Running',
    events: [],
    agentId: 'agent',
    agentName: 'Agent',
    userPrompt: 'List the workspace',
    maxIterations: 5,
    iterationsUsed: 0,
    startedAt: new Date().toISOString(),
    tools: [],
    mcps: [],
  };
  const persists: number[] = [];
  const graph = new AgentLoopGraph(
    llm,
    () => settingsSchema.parse({}),
    () => {},
    (text) => text,
  );
  const outcome = await graph.run({
    run,
    agent: librarySchema.parse({ id: 'agent', name: 'Agent' }),
    task: 'List the workspace',
    project: root,
    model: 'test-model',
    maxIterations: 5,
    router,
    signal: new AbortController().signal,
    systemPrompt: 'SYS',
    persist: (current) => persists.push(current.tools.length),
  });
  expect(outcome).toEqual({ result: 'All done', reason: 'completed' });
  expect(run.iterationsUsed).toBe(2);
  expect(execute).toHaveBeenCalledExactlyOnceWith({});
  expect(run.tools[0]).toMatchObject({ toolId: 'filesystem.list', status: 'completed' });
  expect(persists).toEqual([1]);
});

it('stops the plan/act graph at the iteration cap without executing a final tool', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agentgraph-'));
  roots.push(root);
  const llm = {
    listModels: async () => [],
    complete: async () => ({ role: 'assistant', content: '{"tool":"filesystem.list"}' }),
    chat: async function* () {
      yield { message: { content: '{"tool":"filesystem.list"}' } } as ChatChunk;
    },
  } as unknown as LLMProvider;
  const execute = vi.fn(async () => 'file list');
  const router = new CapabilityRouter(
    new CapabilityDecisionEngine(async () => yes),
    'Loop forever',
    capabilityConfigSchema.parse({ mode: 'auto' }),
    { project: root },
    async () => false,
  );
  router.register({
    capability: { id: 'filesystem.list', name: 'filesystem.list', type: 'tool', enabled: true },
    execute,
  });
  const run: RunState = {
    id: 'run-2',
    status: 'Running',
    events: [],
    agentId: 'agent',
    agentName: 'Agent',
    userPrompt: 'Loop forever',
    maxIterations: 2,
    iterationsUsed: 0,
    startedAt: new Date().toISOString(),
    tools: [],
    mcps: [],
  };
  const graph = new AgentLoopGraph(
    llm,
    () => settingsSchema.parse({}),
    () => {},
    (text) => text,
  );
  const outcome = await graph.run({
    run,
    agent: librarySchema.parse({ id: 'agent', name: 'Agent' }),
    task: 'Loop forever',
    project: root,
    model: 'test-model',
    maxIterations: 2,
    router,
    signal: new AbortController().signal,
    systemPrompt: 'SYS',
  });
  expect(outcome.reason).toBe('max-iterations');
  expect(outcome.result).toBe('');
  expect(run.iterationsUsed).toBe(2);
  expect(execute).toHaveBeenCalledTimes(2);
});

it('events from chat graph nodes stay visible on the activity stream', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chatgraph-'));
  roots.push(root);
  const db = new ChatDatabase(join(root, 'chat.sqlite'));
  const events: AppEvent[] = [];
  const llm = {
    chat: async function* (request: { messages: { content: string }[] }) {
      if (request.messages[0].content.includes('CAPABILITY_RELEVANCE_CHECK')) {
        yield { message: { content: JSON.stringify(yes) } } as ChatChunk;
        return;
      }
      yield { message: { content: 'KB answer' } } as ChatChunk;
    },
  } as unknown as LLMProvider;
  const chat = new ChatService(
    db,
    llm,
    (e) => events.push(e),
    async () => [
      {
        id: 'chunk',
        sourceId: 'kb',
        name: 'Architecture',
        content: 'Stored facts',
        score: 1,
        location: '',
      },
    ],
    () => 8192,
    undefined,
    (s) => s,
    () => [
      {
        id: 'kb',
        name: 'Project KB',
        collection: '',
        status: 'ready' as const,
        type: 'file' as const,
        location: '',
        createdAt: 0,
        updatedAt: 0,
        documentCount: 1,
        chunkCount: 1,
      },
    ],
  );
  const c = db.create('test-model');
  await chat.send({ id: c.id, text: 'Question', model: 'test-model', knowledge: 'kb' });
  await expect.poll(() => chat.isActive(c.id)).toBe(false);
  expect(
    events.some((e) => e.activity?.content?.includes('Retrieved 1 passages')),
  ).toBe(true);
  expect(db.messages(c.id).at(-1)?.metadata?.sources).toHaveLength(1);
  db.close();
});
