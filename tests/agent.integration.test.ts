import { it, expect, vi } from 'vitest';
import { DeepAgentEngine } from '../src/main/services/ai/deep-agents';
import { useProviderBridge } from './fixtures/scripted-provider';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentService } from '../src/main/services/agents/agents';
import { LibraryService } from '../src/main/services/filesystem/library';
import { OllamaLLMProvider } from '../src/main/services/ollama/provider';
import { KnowledgeService } from '../src/main/services/rag/knowledge';
import { MCPService } from '../src/main/services/mcp/mcp';
import { librarySchema, settingsSchema } from '../src/shared/schemas';
import type { AppEvent } from '../src/shared/types';
import { CustomToolService } from '../src/main/services/tools/custom';
it('a real model reads, proposes a diff, waits for approval, writes and verifies a project file', async () => {
  if (!process.env.LOCALAI_LIVE_TEST) return;
  const root = await mkdtemp(join(tmpdir(), 'agent-live-'));
  for (const d of ['agents', 'skills', 'mcp', 'project']) await mkdir(join(root, d));
  const project = join(root, 'project');
  await writeFile(join(project, 'greeting.txt'), 'hello\n');
  const settings = () =>
    settingsSchema.parse({ chatModel: 'qwen3-coder:latest', temperature: 0, maxIterations: 10 });
  const lib = new LibraryService(root);
  await lib.save(
    'agents',
    librarySchema.parse({
      id: 'editor',
      name: 'Editor',
      model: settings().chatModel,
      tools: ['filesystem.read', 'filesystem.write', 'filesystem.exists'],
      content:
        'Complete the task with allowed tools. Before writing read the file and use its hash. After writing read it again. Then give a final summary. Do not merely describe changes.',
    }),
  );

  it('runs attached pre, success and post hooks in lifecycle order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agent-hooks-'));
    for (const dir of ['agents', 'skills', 'tools', 'mcp', 'hooks', 'project'])
      await mkdir(join(root, dir));
    const project = join(root, 'project');
    const log = join(project, 'hook-log.txt');
    const settings = () => settingsSchema.parse({ chatModel: 'test-model' });
    const library = new LibraryService(root);
    for (const [id, hookType] of [
      ['before', 'pre'],
      ['after-success', 'success'],
      ['after-error', 'error'],
      ['after', 'post'],
    ] as const) {
      await library.save('hooks', {
        ...librarySchema.parse({ id, name: id, hookType }),
        content: `export default async function hook(context) {
    require('node:fs').appendFileSync(${JSON.stringify(log)}, '${hookType},');
  }`,
      });
    }
    const agent = librarySchema.parse({
      id: 'hooked-agent',
      name: 'Hooked agent',
      model: 'test-model',
      hooks: ['before', 'after-success', 'after-error', 'after'],
    });
    await library.save('agents', agent);
    const llm = new OllamaLLMProvider(settings);
    useProviderBridge(llm);
    const complete = vi
      .spyOn(llm, 'complete')
      .mockResolvedValue({ role: 'assistant', content: 'Done.' });
    const knowledge = new KnowledgeService(
      root,
      settings,
      { embed: async () => [], embedBatch: async () => [] },
      () => {},
    );
    const customTools = new CustomToolService(
      library,
      { resolve: () => '', redact: (text) => text },
      () => 3000,
    );
    const service = new AgentService(
      library,
      llm,
      knowledge,
      new MCPService(library, { resolve: () => '', redact: (text) => text }, () => {}),
      settings,
      () => {},
      undefined,
      customTools,
    );
    try {
      await expect(
        service.runInChat(agent, 'Do the task', project, new AbortController().signal, () => {}),
      ).resolves.toBe('Done.');
      expect(await readFile(log, 'utf8')).toBe('pre,success,post,');
      complete.mockRejectedValueOnce(new Error('Model failed'));
      await expect(
        service.runInChat(agent, 'Fail the task', project, new AbortController().signal, () => {}),
      ).rejects.toThrow('Model failed');
      expect(await readFile(log, 'utf8')).toBe('pre,success,post,pre,error,post,');
    } finally {
      await service.stopAll();
      await rm(root, { recursive: true, force: true });
    }
  });
  const llm = new OllamaLLMProvider(settings);
  const kb = new KnowledgeService(
    root,
    settings,
    { embed: async () => [], embedBatch: async () => [] },
    () => {},
  );
  await kb.init();
  const mcp = new MCPService(lib, { resolve: () => '', redact: (s) => s }, () => {});
  const events: AppEvent[] = [];
  const service = new AgentService(lib, llm, kb, mcp, settings, (e) => {
    events.push(e);
    if (e.approval) setTimeout(() => service.approve(e.approval!.id, true), 20);
  });
  try {
    const id = await service.run({
      agentId: 'editor',
      project,
      task: 'Change greeting.txt to exactly "hello local workspace" followed by a newline. Read the file first, write using the expected hash, read again to verify, then finish.',
    });
    await expect
      .poll(() => service.runs().find((r) => r.id === id)?.status, {
        timeout: 140000,
        interval: 500,
      })
      .toMatch(/Completed|Failed|Stopped/);
    expect(service.runs().find((r) => r.id === id)?.status).toBe('Completed');
    expect(events.some((e) => e.approval?.diff?.includes('+hello local workspace'))).toBe(true);
    expect(await readFile(join(project, 'greeting.txt'), 'utf8')).toBe('hello local workspace\n');
  } finally {
    await service.stopAll();
    await rm(root, { recursive: true, force: true });
  }
}, 160000);

it.each([false, true])(
  'attaches permitted RAG before generation and exposes allowed tools (deep=%s)',
  async (deep) => {
    const root = await mkdtemp(join(tmpdir(), 'agent-rag-'));
    for (const dir of ['agents', 'skills', 'tools', 'mcp']) await mkdir(join(root, dir));
    const settings = () => settingsSchema.parse({ deepAgentMode: deep ? 'deep' : 'classic' });
    const library = new LibraryService(root);
    await library.save(
      'skills',
      librarySchema.parse({ id: 'review', name: 'Review', content: 'Review carefully.' }),
    );
    await library.save(
      'tools',
      librarySchema.parse({
        id: 'lookup',
        name: 'Lookup',
        content: 'return 1;',
        toolConfig: { type: 'javascript', parameters: [] },
      }),
    );
    await library.save(
      'mcp',
      librarySchema.parse({ id: 'server', name: 'Server', description: 'Search server' }),
    );
    const llm = new OllamaLLMProvider(settings);
    useProviderBridge(llm);
    const kb = new KnowledgeService(
      root,
      settings,
      { embed: async () => [], embedBatch: async () => [] },
      () => {},
    );
    vi.spyOn(kb, 'list').mockReturnValue([]);
    const search = vi.spyOn(kb, 'search').mockResolvedValue([
      {
        id: 'chunk',
        sourceId: 'docs',
        name: 'Handbook',
        content: 'UPFRONT RAG FACT',
        score: 1,
        location: '',
      },
    ]);
    const complete = vi.spyOn(llm, 'complete').mockImplementation(async (request) => {
      expect(search).toHaveBeenCalled();
      expect(request.messages[0].content).toContain('UPFRONT RAG FACT');
      const names = JSON.stringify(request.tools ?? []);
      expect(names).toContain('custom_lookup');
      expect(names).toContain('mcp_server_echo');
      expect(names).toContain('skill_review');
      return { role: 'assistant', content: 'Answer from Handbook.' };
    });
    const mcp = new MCPService(library, { resolve: () => '', redact: (text) => text }, () => {});
    vi.spyOn(mcp, 'states').mockReturnValue([
      {
        id: 'server',
        status: 'connected',
        tools: [{ name: 'echo', inputSchema: { type: 'object' } }],
        logs: [],
      },
    ]);
    const service = new AgentService(
      library,
      llm,
      kb,
      mcp,
      settings,
      () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new DeepAgentEngine(),
    );
    const agent = librarySchema.parse({
      id: 'test',
      name: 'Test',
      model: 'test',
      skills: ['review'],
      tools: ['custom:lookup', 'mcp:server:echo'],
      knowledgeSources: ['all'],
    });
    try {
      expect(
        await service.runInChat(
          agent,
          'Explain the handbook',
          '',
          new AbortController().signal,
          () => {},
        ),
      ).toBe('Answer from Handbook.');
      expect(search).toHaveBeenCalledExactlyOnceWith('Explain the handbook', 'semantic', 'all');
      expect(complete).toHaveBeenCalledOnce();
      search.mockClear();
      complete.mockImplementation(async (request) => {
        expect(search).not.toHaveBeenCalled();
        expect(request.messages[0].content).not.toContain('UPFRONT RAG FACT');
        return { role: 'assistant', content: 'Direct answer.' };
      });
      await service.runInChat(
        {
          ...agent,
          capabilityConfig: {
            mode: 'none',
            skills: [],
            tools: [],
            mcpServers: [],
            knowledgeBases: ['all'],
            allowSkills: true,
            allowMCP: true,
            allowTools: true,
            allowKnowledgeBase: true,
            permissions: {},
            trace: false,
          },
        },
        'Explain the handbook',
        '',
        new AbortController().signal,
        () => {},
      );
    } finally {
      await service.stopAll();
      vi.restoreAllMocks();
      await rm(root, { recursive: true, force: true });
    }
  },
);
