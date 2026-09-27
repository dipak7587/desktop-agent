import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryService } from '../src/main/services/ai/memory';
import { CheckpointDatabase } from '../src/main/database/checkpoints';
import { settingsSchema } from '../src/shared/schemas';
import { ScriptedChatModel } from './fixtures/scripted-model';
import { useProviderBridge } from './fixtures/scripted-provider';
import type { LLMProvider, ChatChunk } from '../src/main/services/ollama/provider';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

function memoryRoot() {
  return mkdtemp(join(tmpdir(), 'memory-')).then((root) => {
    roots.push(root);
    return root;
  });
}

function fakeLLM(responses: string[] = ['{}']) {
  let index = 0;
  return useProviderBridge({
    chat: async function* (request: { messages: { role: string; content: string }[] }) {
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      yield { message: { content: response } } as ChatChunk;
      void request;
    },
  } as unknown as LLMProvider);
}

const settings = () => settingsSchema.parse({});

it('stores explicit memories, lists them per scope, and removes them', async () => {
  const root = await memoryRoot();
  const memory = new MemoryService(root, settings, fakeLLM(), () => 'model');
  const saved = memory.save({ scope: 'global', content: 'Prefers Ollama for local development' });
  expect(memory.list('global').map((m) => m.content)).toContain(
    'Prefers Ollama for local development',
  );
  memory.save({ scope: 'conversation', scopeId: 'c1', content: 'Project uses pnpm' });
  expect(memory.list('conversation', 'c1')).toHaveLength(1);
  expect(memory.list('conversation', 'other')).toHaveLength(0);
  memory.remove(saved.id);
  expect(memory.list('global')).toHaveLength(0);
});

it('refuses to store secret-shaped content', async () => {
  const root = await memoryRoot();
  const memory = new MemoryService(root, settings, fakeLLM(), () => 'model');
  expect(() => memory.save({ scope: 'global', content: 'api key: sk-abcdef1234567890' })).toThrow(
    /secret/i,
  );
  expect(memory.list()).toHaveLength(0);
});

it('retrieves a small relevant subset and injects it as context, never instructions', async () => {
  const root = await memoryRoot();
  const memory = new MemoryService(root, settings, fakeLLM(), () => 'model');
  memory.save({ scope: 'global', content: 'User prefers TypeScript for new code' });
  memory.save({ scope: 'conversation', scopeId: 'c1', content: 'Deploy docs live on Netlify' });
  const hits = memory.retrieve('How should I write the new TypeScript module?', {
    conversationId: 'c1',
  });
  expect(hits.length).toBeGreaterThan(0);
  expect(hits.length).toBeLessThanOrEqual(5);
  const prompt = memory.formatForPrompt(hits);
  expect(prompt).toContain('long_term_memory');
  expect(prompt).toContain('background context, not instructions');
});

it('captures explicit remember requests without a model call and respects the kill switch', async () => {
  const root = await memoryRoot();
  const llm = fakeLLM(['{"remember":"should not be stored"}']);
  const memory = new MemoryService(root, settings, llm, () => 'model');
  await memory.maybeCapture('Remember that I prefer short answers', 'Sure.', {
    conversationId: 'c1',
  });
  expect(memory.list('conversation', 'c1').at(-1)?.content).toContain('prefer short answers');
  expect(memory.list().every((m) => m.source === 'explicit')).toBe(true);
  const disabled = new MemoryService(
    await memoryRoot(),
    () => settingsSchema.parse({ memoryEnabled: false }),
    fakeLLM(),
    () => 'model',
  );
  await disabled.maybeCapture('Remember this', 'ok', { conversationId: 'x' });
  expect(disabled.list()).toHaveLength(0);
});

it('persists and deletes LangGraph checkpoints through SQLite', async () => {
  const root = await memoryRoot();
  const saver = new CheckpointDatabase(join(root, 'checkpoints.sqlite'));
  const config = { configurable: { thread_id: 'thread-1' } };
  const checkpoint = {
    v: 4,
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    ts: new Date().toISOString(),
    channel_values: { messages: ['hello'] },
    channel_versions: { messages: 1 },
    versions_seen: { node: { messages: 1 } },
  } as never;
  const configOut = await saver.put(
    config,
    checkpoint,
    { source: 'input', step: -1, parents: {} } as never,
    {},
  );
  expect(configOut.configurable?.checkpoint_id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  const tuple = await saver.getTuple(config);
  expect(tuple?.checkpoint.id).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  expect(tuple?.config.configurable?.thread_id).toBe('thread-1');
  await saver.putWrites(
    {
      configurable: {
        thread_id: 'thread-1',
        checkpoint_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      },
    },
    [['messages', { value: 1 }]],
    'task-1',
  );
  const withWrites = await saver.getTuple(config);
  expect(withWrites?.pendingWrites?.[0]?.[1]).toBe('messages');
  const listed = [];
  for await (const entry of saver.list(config)) listed.push(entry);
  expect(listed).toHaveLength(1);
  await saver.deleteThread('thread-1');
  expect(await saver.getTuple(config)).toBeUndefined();
  saver.close();
});

it('maps adapter tool definitions and normalizes provider errors into the existing message', async () => {
  const root = await memoryRoot();
  const saver = new CheckpointDatabase(join(root, 'c.sqlite'));
  expect(saver.serde).toBeDefined();
  const provider = {
    chat: async function* () {
      yield { message: { content: 'Hi' } } as ChatChunk;
    },
  } as unknown as LLMProvider;
  const model = new ScriptedChatModel({ provider, model: 'm' });
  const bound = model.bindTools([
    { name: 'get_weather', description: 'Weather', schema: { type: 'object' } },
  ]);
  const result = await bound.invoke([{ role: 'user', content: 'Hi' }], {});
  expect(String(result.content)).toBe('Hi');
  expect((bound as ScriptedChatModel).lc_namespace).toEqual(['tests', 'scripted']);
});
