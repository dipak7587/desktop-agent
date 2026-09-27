import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentTools } from '../src/main/services/agents/tools';
import { AgentLoopGraph } from '../src/main/services/ai/agent-graph';
import { capabilityToolName } from '../src/main/services/ai/capability-tools';
import { DeepAgentEngine } from '../src/main/services/ai/deep-agents';
import { workspaceToolSchemas } from '../src/main/services/ai/tool-schemas';
import {
  CapabilityRouter,
  CapabilityDecisionEngine,
} from '../src/main/services/agents/capabilities';
import { settingsSchema, librarySchema, capabilityConfigSchema } from '../src/shared/schemas';
import type { RunState } from '../src/shared/types';
import type { LLMProvider, ChatMessage, ChatRequest } from '../src/main/services/ollama/provider';
import { CheckpointDatabase } from '../src/main/database/checkpoints';
import { toolReply, useProviderBridge } from './fixtures/scripted-provider';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});
const yes = { relevant: true, necessary: true, canAnswerDirectly: false, userForbids: false };

async function setup(
  script: ChatMessage[],
  deep: boolean,
  mode: 'auto' | 'none' = 'auto',
  checkpointer?: CheckpointDatabase,
) {
  const root = await mkdtemp(join(tmpdir(), 'native-agent-'));
  roots.push(root);
  const settings = () => settingsSchema.parse({});
  const controller = new AbortController();
  const approve = vi.fn(async () => false);
  const execute = vi.fn(async (args: Record<string, unknown>) =>
    new AgentTools(settings).execute('filesystem.write', args, root, controller.signal, approve),
  );
  const router = new CapabilityRouter(
    new CapabilityDecisionEngine(async () => yes),
    'Create a file',
    capabilityConfigSchema.parse({ mode }),
    { project: root, signal: controller.signal },
    approve,
  );
  router.register({
    capability: { id: 'filesystem.write', name: 'Write', type: 'tool', enabled: true },
    schema: workspaceToolSchemas['filesystem.write'],
    confirmDuringExecution: true,
    execute,
  });
  const requests: ChatRequest[] = [];
  const provider: LLMProvider = useProviderBridge({
    listModels: async () => [],
    complete: async (request) => {
      requests.push(request);
      return script[Math.min(requests.length - 1, script.length - 1)];
    },
    chat: async function* () {
      yield { message: { content: 'Unexpected streaming call' } };
    },
  });
  const run: RunState = {
    id: crypto.randomUUID(),
    agentId: 'a',
    agentName: 'A',
    status: 'Running',
    events: [],
    tools: [],
    mcps: [],
    iterationsUsed: 0,
    maxIterations: 3,
    userPrompt: 'Create a file',
    startedAt: new Date().toISOString(),
  };
  const events = vi.fn();
  const graph = new AgentLoopGraph(provider, settings, events, (s) => s, checkpointer);
  const invoke = () =>
    graph.run({
      run,
      router,
      agent: librarySchema.parse({ id: 'a', name: 'A' }),
      task: run.userPrompt,
      project: root,
      model: 'selected-model',
      maxIterations: run.maxIterations,
      signal: controller.signal,
      systemPrompt: 'Use the permitted workspace tools.',
      deep: deep ? new DeepAgentEngine() : undefined,
    });
  return { root, invoke, run, requests, execute, approve, controller, events };
}
const write = () =>
  toolReply('filesystem.write', { path: 'new.md', content: 'hello', expectedHash: 'missing' });
const final: ChatMessage = { role: 'assistant', content: 'Done.' };

it.each([false, true])(
  'preserves approval rejection, run IDs and model selection (deep=%s)',
  async (deep) => {
    const s = await setup([write(), final], deep);
    expect(await s.invoke()).toEqual({ result: 'Done.', reason: 'completed' });
    expect(s.approve).toHaveBeenCalledOnce();
    await expect(readFile(join(s.root, 'new.md'))).rejects.toThrow();
    expect(s.requests.every((r) => r.model === 'selected-model')).toBe(true);
    expect(s.run.iterationsUsed).toBe(2);
    expect(s.run.tools[0].status).toBe('failed');
    expect(s.events.mock.calls.every(([event]) => event.id === s.run.id)).toBe(true);
  },
);
it.each([false, true])('hides and blocks unavailable tools (deep=%s)', async (deep) => {
  const s = await setup([write(), final], deep, 'none');
  await s.invoke();
  expect(s.execute).not.toHaveBeenCalled();
  expect(s.approve).not.toHaveBeenCalled();
  expect(JSON.stringify(s.requests[0].tools ?? [])).not.toContain(
    capabilityToolName('filesystem.write'),
  );
});
it('blocks deep harness filesystem and delegation bypasses', async () => {
  for (const name of ['write_file', 'read_file', 'execute', 'task']) {
    const s = await setup(
      [
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: name,
              function: { name, arguments: { file_path: '/new.md', content: 'bypass' } },
            },
          ],
        },
        final,
      ],
      true,
    );
    await s.invoke();
    expect(s.execute).not.toHaveBeenCalled();
    expect(s.requests[0].tools).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ function: expect.objectContaining({ name }) }),
      ]),
    );
    expect(
      s.requests[1].messages.some((m) => m.role === 'tool' && m.content.includes('not permitted')),
    ).toBe(true);
  }
});
it.each([false, true])('counts model calls and reports exhaustion (deep=%s)', async (deep) => {
  const s = await setup([write()], deep);
  s.run.maxIterations = 2;
  expect(await s.invoke()).toEqual({ result: '', reason: 'max-iterations' });
  expect(s.requests).toHaveLength(2);
  expect(s.run.iterationsUsed).toBe(2);
});
it.each([false, true])('cancels a pending approval without writing (deep=%s)', async (deep) => {
  const s = await setup([write(), final], deep);
  s.approve.mockImplementation(async () => {
    s.controller.abort();
    return false;
  });
  await expect(s.invoke()).rejects.toThrow();
  await expect(readFile(join(s.root, 'new.md'))).rejects.toThrow();
  expect(s.requests).toHaveLength(1);
});

it.each([false, true])(
  'applies approved hash-checked writes through the same tool boundary (deep=%s)',
  async (deep) => {
    const s = await setup([write(), final], deep);
    s.approve.mockResolvedValue(true);
    await s.invoke();
    expect(await readFile(join(s.root, 'new.md'), 'utf8')).toBe('hello');
    expect(s.run.tools[0].status).toBe('completed');
  },
);

it('supports more than LangGraph’s default step limit without truncating model iterations', async () => {
  const s = await setup(
    [...Array.from({ length: 29 }, () => toolReply('unavailable')), final],
    false,
  );
  s.run.maxIterations = 30;
  expect(await s.invoke()).toEqual({ result: 'Done.', reason: 'completed' });
  expect(s.run.iterationsUsed).toBe(30);
});

it('rejects invalid tool arguments before reaching a privileged executor', async () => {
  const s = await setup([toolReply('filesystem.write', { path: 123 }), final], false);
  expect(await s.invoke()).toEqual({ result: 'Done.', reason: 'completed' });
  expect(s.execute).not.toHaveBeenCalled();
});

it.each([false, true])(
  'persists framework messages and call counters in SQLite (deep=%s)',
  async (deep) => {
    const root = await mkdtemp(join(tmpdir(), 'agent-checkpoint-'));
    roots.push(root);
    const path = join(root, 'checkpoints.sqlite');
    let saver = new CheckpointDatabase(path);
    try {
      const s = await setup([write(), final], deep, 'auto', saver);
      await s.invoke();
      saver.close();
      saver = new CheckpointDatabase(path);
      const checkpoint = await saver.getTuple({ configurable: { thread_id: s.run.id } });
      expect(checkpoint?.checkpoint.channel_values.threadModelCallCount).toBe(2);
      const messages = checkpoint?.checkpoint.channel_values.messages as { content: string }[];
      expect(messages.at(-1)?.content).toBe('Done.');
      expect(JSON.stringify(checkpoint)).not.toContain('apiKey');
      await saver.deleteThread(s.run.id);
      expect(await saver.getTuple({ configurable: { thread_id: s.run.id } })).toBeUndefined();
    } finally {
      saver.close();
    }
  },
);
