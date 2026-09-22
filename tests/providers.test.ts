import { LibraryService } from '../src/main/services/filesystem/library';
import { librarySchema } from '../src/shared/schemas';
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsService, type ProviderSecrets } from '../src/main/services/settings/settings';
import { ProviderRouter } from '../src/main/services/providers/router';
import { ChatDatabase } from '../src/main/database/chat';
import { ChatService } from '../src/main/services/ollama/chat';
import { providerProfileSchema, providerURLSchema, settingsSchema } from '../src/shared/schemas';
import { createLLMProvider, parseSSE } from '../src/main/services/ollama/provider';
import type { AppEvent } from '../src/shared/types';
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});
async function setup(legacy?: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'providers-'));
  roots.push(root);
  const values = new Map<string, string>();
  const secrets: ProviderSecrets = {
    set: async (k, v) => {
      values.set(k, v);
    },
    remove: async (k) => {
      values.delete(k);
    },
    resolve: (k) => {
      if (!values.has(k)) throw new Error('Locked');
      return values.get(k)!;
    },
  };
  if (legacy) await writeFile(join(root, 'settings.json'), JSON.stringify(legacy));
  const settings = new SettingsService(root, secrets, () =>
    new LibraryService(root).list('agents'),
  );
  await settings.init();
  return { root, settings, secrets, values };
}
const profile = (id: string, patch = {}) =>
  providerProfileSchema.parse({
    id,
    name: id,
    provider: 'openai',
    apiBaseUrl: `https://${id}.example/v1`,
    chatModel: 'model-a',
    modelIds: ['model-a', 'model-b'],
    ...patch,
  });
it('creates and persists a model-free Ollama default on first launch', async () => {
  const { settings, root, secrets } = await setup();
  expect(settings.get().providers[0]).toMatchObject({
    id: 'ollama-local',
    provider: 'ollama',
    modelIds: [],
    ollamaUrl: 'http://localhost:11434',
  });
  const reopened = new SettingsService(root, secrets);
  await reopened.init();
  expect(reopened.get()).toEqual(settings.get());
});
it('migrates plaintext legacy credentials and never returns or persists them in metadata', async () => {
  const key = 'legacy-provider-secret';
  const { settings, root, secrets } = await setup({
    provider: 'openai',
    apiKey: key,
    chatModel: 'legacy-model',
  });
  expect(JSON.stringify(settings.get())).not.toContain(key);
  expect(settings.forProvider().apiKey).toBe(key);
  for (const path of ['settings.json', 'config/providers.json'])
    expect(await readFile(join(root, path), 'utf8')).not.toContain(key);
  const reopened = new SettingsService(root, secrets);
  await reopened.init();
  expect(reopened.forProvider().apiKey).toBe(key);
  expect(reopened.get().providers[0].modelIds).toContain('legacy-model');
});
it('retains credentials on blank edits, accepts replacements, and does not change the default when adding accounts', async () => {
  const { settings } = await setup();
  await settings.save({
    ...settings.get(),
    providers: [
      ...settings.get().providers,
      profile('account-a', { apiKey: 'one' }),
      profile('account-b', { apiKey: 'two' }),
    ],
  });
  expect(settings.get().activeProviderId).toBe('ollama-local');
  await settings.save(settings.get());
  expect(settings.forProvider('account-a').apiKey).toBe('one');
  expect(settings.forProvider('account-b').apiKey).toBe('two');
  const next = settings.get();
  next.providers[1].apiKey = 'replacement';
  await settings.save(next);
  expect(settings.forProvider('account-a').apiKey).toBe('replacement');
  await settings.clearCredential('account-a');
  expect(settings.forProvider('account-a').apiKey).toBe('');
});
it('fails closed when secure storage is unavailable and validates duplicate IDs/default model membership', async () => {
  const { settings, secrets } = await setup();
  secrets.set = async () => {
    throw new Error('Secure storage unavailable');
  };
  await expect(
    settings.save({ ...settings.get(), providers: [profile('a', { apiKey: 'secret' })] }),
  ).rejects.toThrow('Secure storage');
  expect(settings.get().providers[0].id).toBe('ollama-local');
  await expect(
    settings.save({ ...settings.get(), providers: [profile('a'), profile('a')] }),
  ).rejects.toThrow('unique');
  await expect(
    settings.save({ ...settings.get(), providers: [profile('a', { chatModel: 'wrong' })] }),
  ).rejects.toThrow('must belong');
});
it('blocks missing/disabled providers and removed models without fallback', async () => {
  const { settings } = await setup();
  await settings.save({
    ...settings.get(),
    providers: [profile('a'), profile('b', { enabled: false })],
    activeProviderId: 'a',
  });
  const router = new ProviderRouter(settings);
  expect(() => router.capture('missing', 'model-a')).toThrow('removed');
  expect(() => router.capture('b', 'model-a')).toThrow('disabled');
  expect(() => router.capture('a', 'missing')).toThrow('available model');
});
it('discovery is configuration-specific, retains manual models, and clears unavailable defaults', async () => {
  const { settings } = await setup();
  await settings.save({
    ...settings.get(),
    providers: [profile('a', { manualModelIds: ['manual'] }), profile('b')],
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ data: [{ id: 'discovered' }] })),
  );
  await new ProviderRouter(settings).discover('a');
  expect(settings.get().providers[0]).toMatchObject({
    modelIds: ['discovered', 'manual'],
    chatModel: '',
  });
  expect(settings.get().providers[1].modelIds).toEqual(['model-a', 'model-b']);
});
it('captures routing, credential, and historical attribution at send time while selection changes', async () => {
  const { settings, root } = await setup();
  await settings.save({
    ...settings.get(),
    providers: [profile('a', { apiKey: 'a-secret' }), profile('b', { apiKey: 'b-secret' })],
    activeProviderId: 'a',
  });
  const db = new ChatDatabase(join(root, 'chat.sqlite'));
  const c = db.create('model-a', 'a');
  let stream!: ReadableStreamDefaultController<Uint8Array>;
  const fetcher = vi.fn(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            stream = c;
          },
        }),
      ),
  );
  vi.stubGlobal('fetch', fetcher);
  let finish!: (e: AppEvent) => void;
  const done = new Promise<AppEvent>((resolve) => {
    finish = resolve;
  });
  const router = new ProviderRouter(settings);
  const chat = new ChatService(
    db,
    router.capture('a', 'model-a').llm,
    (e) => {
      if (e.message) finish(e);
    },
    async () => [],
    undefined,
    undefined,
    undefined,
    undefined,
    router,
  );
  await chat.send({
    id: c.id,
    providerId: 'a',
    model: 'model-a',
    text: 'Hello',
    knowledge: 'none',
  });
  db.setSelection(c.id, 'b', 'model-b');
  const next = settings.get();
  next.providers[0].name = 'Renamed';
  next.activeProviderId = 'b';
  await settings.save(next);
  await vi.waitFor(() => expect(stream).toBeDefined());
  stream.enqueue(
    new TextEncoder().encode(
      'data: {"choices":[{"delta":{"content":"Answer"}}]}\n\ndata: [DONE]\n\n',
    ),
  );
  stream.close();
  const result = await done;
  expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe(
    'https://a.example/v1/chat/completions',
  );
  expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({
    Authorization: 'Bearer a-secret',
  });
  expect(result.message?.metadata).toMatchObject({
    providerId: 'a',
    providerNameSnapshot: 'a',
    modelId: 'model-a',
    status: 'completed',
  });
  expect(db.get(c.id)).toMatchObject({ providerId: 'b', model: 'model-b' });
  await settings.save({ ...settings.get(), providers: [settings.get().providers[1]] });
  db.close();
  const reopened = new ChatDatabase(join(root, 'chat.sqlite'));
  expect(reopened.messages(c.id).at(-1)?.metadata?.providerNameSnapshot).toBe('a');
  reopened.close();
});
it('parses SSE split at every UTF-8 byte including CRLF, comments and a final unterminated event', async () => {
  const bytes = new TextEncoder().encode(
    ': ping\r\ndata: {"delta":{"text":"héllo"}}\r\n\r\ndata: {"done":true}',
  );
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const byte of bytes) c.enqueue(Uint8Array.of(byte));
      c.close();
    },
  });
  const events = [];
  for await (const e of parseSSE(stream)) events.push(e);
  expect(events).toEqual([{ delta: { text: 'héllo' } }, { done: true }]);
});
it.each(['anthropic', 'google'] as const)(
  'uses native %s endpoints and separates system instructions',
  async (provider) => {
    const fetcher = vi.fn(
      async (_url: unknown, _init: RequestInit) =>
        new Response(
          provider === 'anthropic'
            ? 'data: {"delta":{"text":"Hello"}}\n\n'
            : 'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n',
        ),
    );
    vi.stubGlobal('fetch', fetcher);
    const llm = createLLMProvider(() => settingsSchema.parse({ provider, apiKey: 'hidden' }));
    expect(
      await llm.complete!({
        model: 'test-model',
        messages: [
          { role: 'system', content: 'Instructions' },
          { role: 'user', content: 'Hello' },
        ],
      }),
    ).toMatchObject({ content: 'Hello' });
    const [url, init] = fetcher.mock.calls[0];
    const body = JSON.parse(String(init.body));
    if (provider === 'anthropic') {
      expect(String(url)).toContain('/v1/messages');
      expect(body.system).toBe('Instructions');
      expect(body.messages).toHaveLength(1);
    } else {
      expect(String(url)).toContain('/models/test-model:streamGenerateContent?alt=sse');
      expect(body.systemInstruction.parts[0].text).toBe('Instructions');
      expect(body.contents).toHaveLength(1);
    }
    expect(String(url)).not.toContain('hidden');
  },
);
it('lists Anthropic models with GET and handles HTTP errors without echoing secrets', async () => {
  const fetcher = vi.fn(async () => Response.json({ data: [{ id: 'model' }] }));
  vi.stubGlobal('fetch', fetcher);
  const llm = createLLMProvider(() =>
    settingsSchema.parse({ provider: 'anthropic', apiKey: 'hidden' }),
  );
  expect(await llm.listModels()).toHaveLength(1);
  expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1]).toMatchObject({
    method: 'GET',
    redirect: 'error',
  });
  fetcher.mockImplementation(async () => new Response('echo hidden', { status: 401 }));
  await expect(llm.listModels()).rejects.toThrow('credential');
  await expect(llm.listModels()).rejects.not.toThrow('hidden');
});
it.each([
  'file:///tmp/private',
  'https://user:key@example.com',
  'http://169.254.169.254',
  'https://api.example.com?key=secret',
])('rejects unsafe endpoint %s', (url) => {
  expect(providerURLSchema.safeParse(url).success).toBe(false);
});

it('does not install a stale model list after endpoint or account settings change', async () => {
  const { settings } = await setup();
  await settings.save({ ...settings.get(), providers: [profile('a')] });
  const revision = settings.getRevision();
  const next = settings.get();
  next.providers[0].apiBaseUrl = 'https://new.example/v1';
  await settings.save(next);
  await expect(settings.updateModels('a', ['stale-model'], revision)).rejects.toThrow(
    'changed during discovery',
  );
  expect(settings.get().providers[0].modelIds).not.toContain('stale-model');
});
it('preserves partial responses and recovers interrupted streams on restart', async () => {
  const { root } = await setup();
  const file = join(root, 'chat.sqlite');
  const db = new ChatDatabase(file);
  const c = db.create('model-a', 'a');
  db.add(c.id, 'assistant', 'Partial answer', {
    providerId: 'a',
    providerNameSnapshot: 'Original',
    modelId: 'model-a',
    status: 'streaming',
  });
  db.close();
  const reopened = new ChatDatabase(file);
  expect(reopened.messages(c.id)[0]).toMatchObject({
    content: 'Partial answer',
    metadata: { status: 'canceled', providerNameSnapshot: 'Original', stopped: true },
  });
  reopened.close();
});
it('marks upstream failures without deleting conversation history or switching providers', async () => {
  const { root, settings } = await setup();
  await settings.save({ ...settings.get(), providers: [profile('a')] });
  const router = new ProviderRouter(settings);
  const db = new ChatDatabase(join(root, 'chat.sqlite'));
  const c = db.create('model-a', 'a');
  db.add(c.id, 'user', 'Earlier question');
  db.add(c.id, 'assistant', 'Earlier answer');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('sensitive upstream body', { status: 429 })),
  );
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const chat = new ChatService(
    db,
    router.capture('a', 'model-a').llm,
    (e) => {
      if (e.message) finish();
    },
    async () => [],
    undefined,
    undefined,
    undefined,
    undefined,
    router,
  );
  await chat.send({
    id: c.id,
    providerId: 'a',
    model: 'model-a',
    text: 'New question',
    knowledge: 'none',
  });
  await done;
  expect(db.messages(c.id)).toHaveLength(4);
  expect(db.messages(c.id).at(-1)?.metadata).toMatchObject({
    status: 'failed',
    providerId: 'a',
    modelId: 'model-a',
  });
  expect(db.messages(c.id).at(-1)?.metadata?.error).toContain('Rate limit');
  expect(JSON.stringify(db.messages(c.id))).not.toContain('sensitive upstream body');
  db.close();
});

it('blocks provider deletion for all dependent agents, including disabled agents, until reassigned', async () => {
  const { settings, root } = await setup();
  await settings.save({
    ...settings.get(),
    providers: [profile('a'), profile('b')],
    activeProviderId: 'a',
  });
  const library = new LibraryService(root);
  const reviewer = librarySchema.parse({
    id: 'reviewer',
    name: 'Code Reviewer',
    providerId: 'a',
    model: 'model-a',
  });
  const writer = librarySchema.parse({
    id: 'writer',
    name: 'Writer',
    providerId: 'a',
    model: 'model-a',
    enabled: false,
  });
  await library.save('agents', reviewer);
  const remove = () =>
    settings.save({
      ...settings.get(),
      providers: settings.get().providers.filter((p) => p.id !== 'a'),
      activeProviderId: 'b',
    });
  await expect(remove()).rejects.toThrow('used by an agent: “Code Reviewer”');
  await library.save('agents', writer);
  const before = await readFile(join(root, 'config/providers.json'), 'utf8');
  await expect(remove()).rejects.toThrow('used by 2 agents:');
  await expect(remove()).rejects.toThrow('“Writer”');
  expect(await readFile(join(root, 'config/providers.json'), 'utf8')).toBe(before);
  expect(settings.get().activeProviderId).toBe('a');
  await library.save('agents', { ...reviewer, providerId: 'b' });
  await library.save('agents', { ...writer, providerId: 'b' });
  await remove();
  expect(settings.get().providers.map((p) => p.id)).toEqual(['b']);
});
