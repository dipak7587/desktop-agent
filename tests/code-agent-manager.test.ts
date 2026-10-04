import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, realpath, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CodeAgentManager,
  type CodeSessionContext,
} from '../src/main/services/agents/code-agent-manager';
import {
  CapabilityRouter,
  CapabilityDecisionEngine,
} from '../src/main/services/agents/capabilities';
import { AgentTools } from '../src/main/services/agents/tools';
import { workspaceToolSchemas } from '../src/main/services/ai/tool-schemas';
import { capabilityConfig } from '../src/shared/capabilities';
import { librarySchema, settingsSchema } from '../src/shared/schemas';
import type { AgentLoopInput } from '../src/main/services/ai/agent-graph';
import type { AppEvent } from '../src/shared/types';
import type { ChatRequest, LLMProvider } from '../src/main/services/ollama/provider';
import { useProviderBridge, toolReply } from './fixtures/scripted-provider';
import { ScriptedChatModel } from './fixtures/scripted-model';

let root: string;
let manager: CodeAgentManager;
let events: AppEvent[];
let provider: LLMProvider;
const complete = vi.fn();
const approve = vi.fn();
const settings = () => settingsSchema.parse({ chatModel: 'local', contextSize: 16000 });
const context = (conversationId = 'conversation'): CodeSessionContext => ({
  conversationId,
  workspaceId: 'workspace',
  providerId: 'local',
  history: '',
});
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'code-acp-')));
  events = [];
  manager = new CodeAgentManager(
    settings,
    (e) => events.push(e),
    (text) => text,
  );
  complete.mockReset().mockResolvedValue({ role: 'assistant', content: 'Answer' });
  approve.mockReset().mockResolvedValue(true);
  provider = useProviderBridge({ listModels: async () => [], complete, async *chat() {} });
});
afterEach(async () => {
  await manager.closeAll();
  await rm(root, { recursive: true, force: true });
});
function input(ctx = context(), controller = new AbortController()): AgentLoopInput {
  const toolIds = [
    'filesystem.write',
    'filesystem.read',
    'filesystem.edit',
    'filesystem.search',
    'shell.execute',
  ];
  const agent = librarySchema.parse({
    id: 'code',
    name: 'Code',
    tools: toolIds,
    capabilityConfig: { mode: 'selected', tools: toolIds, permissions: { tool: 'ask' } },
  });
  const tools = new AgentTools(settings);
  const confirm = (id: string, description: string, diff?: string) =>
    manager.requestPermission(ctx, id, description, diff);
  const router = new CapabilityRouter(
    new CapabilityDecisionEngine(async () => ({
      relevant: true,
      necessary: true,
      canAnswerDirectly: false,
      userForbids: false,
    })),
    'Perform requested task',
    capabilityConfig(agent),
    { project: root, signal: controller.signal },
    confirm,
    () => {},
  );
  for (const id of toolIds)
    router.register({
      capability: { id, name: id, type: 'tool', enabled: true, requiresProject: true },
      schema: workspaceToolSchemas[id],
      confirmDuringExecution: ['filesystem.write', 'filesystem.edit', 'shell.execute'].includes(id),
      execute: (args) => tools.execute(id, args, root, controller.signal, confirm, 'ask'),
    });
  return {
    agent,
    task: 'Hello',
    project: root,
    model: 'local',
    maxIterations: 4,
    signal: controller.signal,
    router,
    systemPrompt: 'Use the selected workspace. General questions need no tools.',
    run: {
      id: crypto.randomUUID(),
      agentId: agent.id,
      agentName: agent.name,
      userPrompt: 'Hello',
      status: 'Running',
      startedAt: '',
      maxIterations: 4,
      iterationsUsed: 0,
      tools: [],
      mcps: [],
      events: [],
    },
  };
}
it('uses real ACP sessions, retains turns, streams text and isolates conversations', async () => {
  const first = input();
  first.task = 'Remember ALPHA';
  await manager.run(first, provider, context(), approve);
  await manager.run(input(), provider, context(), approve);
  expect(
    complete.mock.calls[1][0].messages.map((m: { content: string }) => m.content).join('\n'),
  ).toContain('ALPHA');
  await manager.run(input(context('other')), provider, context('other'), approve);
  expect(
    complete.mock.calls[2][0].messages.map((m: { content: string }) => m.content).join('\n'),
  ).not.toContain('ALPHA');
  expect(events.some((e) => e.status === 'Streaming' && e.content === 'Answer')).toBe(true);
  expect(approve).not.toHaveBeenCalled();
});
it('replaces sessions when workspace or model changes', async () => {
  const first = input();
  first.task = 'OLD_WORKSPACE';
  await manager.run(first, provider, context(), approve);
  const next = input();
  next.project = join(root, 'next');
  await mkdir(next.project);
  await manager.run(next, provider, { ...context(), workspaceId: 'next' }, approve);
  expect(
    complete.mock.calls[1][0].messages.map((m: { content: string }) => m.content).join('\n'),
  ).not.toContain('OLD_WORKSPACE');
  const final = input();
  final.model = 'different';
  await manager.run(final, provider, context(), approve);
  expect(complete.mock.calls[2][0].model).toBe('different');
});
it.each([true, false])(
  'routes hash-checked file review through ACP (approved=%s)',
  async (approved) => {
    approve.mockResolvedValue(approved);
    complete.mockResolvedValueOnce(
      toolReply('filesystem.write', {
        path: 'created.txt',
        content: 'hello',
        expectedHash: 'missing',
      }),
    );
    await manager.run(input(), provider, context(), approve);
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve.mock.calls[0][2]).toContain('+hello');
    if (approved) expect(await readFile(join(root, 'created.txt'), 'utf8')).toBe('hello');
    else await expect(readFile(join(root, 'created.txt'))).rejects.toThrow();
  },
);
it('blocks traversal before approval or disk writes', async () => {
  complete.mockResolvedValueOnce(
    toolReply('filesystem.write', {
      path: '../escape.txt',
      content: 'hello',
      expectedHash: 'missing',
    }),
  );
  const run = input();
  await manager.run(run, provider, context(), approve);
  expect(run.run.tools[0].error).toContain('outside the workspace');
  expect(approve).not.toHaveBeenCalled();
});
it('never exposes or executes DeepAgents default filesystem and delegation tools', async () => {
  complete.mockResolvedValueOnce({
    role: 'assistant',
    content: '',
    tool_calls: [
      {
        id: 'bad',
        function: { name: 'write_file', arguments: { path: '/bad.txt', content: 'bad' } },
      },
    ],
  });
  await manager.run(input(), provider, context(), approve).catch(() => {});
  const request = complete.mock.calls[0][0] as ChatRequest;
  expect(JSON.stringify(request.tools)).not.toMatch(/"name":"(write_file|read_file|execute|task)"/);
  await expect(readFile(join(root, 'bad.txt'))).rejects.toThrow();
  expect(approve).not.toHaveBeenCalled();
});
it('cancels a pending ACP approval without applying the edit', async () => {
  const controller = new AbortController();
  approve.mockImplementation(async () => {
    controller.abort();
    return false;
  });
  complete.mockResolvedValueOnce(
    toolReply('filesystem.write', {
      path: 'cancel.txt',
      content: 'hello',
      expectedHash: 'missing',
    }),
  );
  await expect(
    manager.run(input(context(), controller), provider, context(), approve),
  ).rejects.toThrow();
  await expect(readFile(join(root, 'cancel.txt'))).rejects.toThrow();
  expect((await manager.run(input(), provider, context(), approve)).result).toBe('Answer');
});
it('enforces model iteration limits', async () => {
  complete.mockResolvedValue(
    toolReply('filesystem.write', { path: '../escape', content: '', expectedHash: 'missing' }),
  );
  const run = input();
  run.maxIterations = 1;
  expect((await manager.run(run, provider, context(), approve)).reason).toBe('max-iterations');
  expect(complete).toHaveBeenCalledTimes(1);
});
it('keeps text Q&A available when Ollama declares no tool support', async () => {
  provider.info = vi.fn().mockResolvedValue({ capabilities: ['completion'] });
  provider.createChatModel = () => {
    const model = new ScriptedChatModel({ provider, model: 'local', disableStreaming: true });
    vi.spyOn(model, '_llmType').mockReturnValue('ollama');
    return model;
  };
  await manager.run(input(), provider, context(), approve);
  expect(complete.mock.calls[0][0].tools).toBeUndefined();
  expect(events.some((e) => e.content?.includes('does not appear to support tool calling'))).toBe(
    true,
  );
});
it('reports unavailable Ollama/model without invoking generation', async () => {
  provider.info = vi.fn().mockRejectedValue(new Error('offline'));
  provider.createChatModel = () => {
    const model = new ScriptedChatModel({ provider, model: 'local', disableStreaming: true });
    vi.spyOn(model, '_llmType').mockReturnValue('ollama');
    return model;
  };
  await expect(manager.run(input(), provider, context(), approve)).rejects.toThrow(
    'Check that Ollama is running',
  );
  expect(complete).not.toHaveBeenCalled();
});

it.each([true, false])(
  'runs commands in the selected root only after ACP approval (%s)',
  async (approved) => {
    approve.mockResolvedValue(approved);
    complete.mockResolvedValueOnce(
      toolReply('shell.execute', { command: 'node', args: ['-e', 'console.log(process.cwd())'] }),
    );
    const run = input();
    await manager.run(run, provider, context(), approve);
    expect(approve.mock.calls[0][1]).toContain(root);
    if (approved) expect(run.run.tools[0].output).toContain(root);
    else expect(run.run.tools[0].output).toContain('rejected');
  },
);
it('searches filenames, skips ignored output, and reads bounded sections with the full-file hash', async () => {
  await writeFile(
    join(root, 'feature.ts'),
    Array.from({ length: 250 }, (_, i) => `line ${i}`).join('\n'),
  );
  await writeFile(join(root, '.gitignore'), 'ignored/\n');
  await mkdir(join(root, 'ignored'));
  await writeFile(join(root, 'ignored', 'feature.ts'), 'secret result');
  complete
    .mockResolvedValueOnce(toolReply('filesystem.search', { query: 'feature' }))
    .mockResolvedValueOnce(
      toolReply('filesystem.read', { path: 'feature.ts', offset: 210, limit: 2 }),
    );
  const run = input();
  await manager.run(run, provider, context(), approve);
  expect(run.run.tools[0].output).toContain('feature.ts');
  expect(run.run.tools[0].output).not.toContain('ignored/');
  expect(JSON.parse(String(run.run.tools[1].output))).toMatchObject({
    content: 'line 210\nline 211',
    totalLines: 250,
    truncated: true,
  });
});
it('reads a bug, reviews a minimal edit and executes a focused check', async () => {
  await writeFile(join(root, 'bug.cjs'), 'module.exports = 1 + 1;');
  complete.mockImplementation(async (request: ChatRequest) => {
    const results = request.messages.filter((message) => message.role === 'tool');
    if (results.length === 0) return toolReply('filesystem.read', { path: 'bug.cjs' });
    if (results.length === 1)
      return toolReply('filesystem.edit', {
        path: 'bug.cjs',
        find: '1 + 1',
        replace: '1 + 2',
        expectedHash: JSON.parse(results[0].content).hash,
      });
    if (results.length === 2)
      return toolReply('shell.execute', {
        command: 'node',
        args: [
          '-e',
          "require('node:assert').equal(require('./bug.cjs'), 3); console.log('check passed')",
        ],
      });
    return { role: 'assistant', content: 'Fixed bug.cjs; focused check passed.' };
  });
  const run = input();
  expect((await manager.run(run, provider, context(), approve)).result).toContain(
    'focused check passed',
  );
  expect(await readFile(join(root, 'bug.cjs'), 'utf8')).toBe('module.exports = 1 + 2;');
  expect(run.run.tools[2].output).toContain('check passed');
});

it.skipIf(!process.env.CODE_AGENT_LIVE_MODEL)(
  'live local Ollama: normal chat, project read and session follow-up',
  async () => {
    const { OllamaLLMProvider } = await import('../src/main/services/ollama/provider');
    const model = process.env.CODE_AGENT_LIVE_MODEL!;
    const local = new OllamaLLMProvider(() =>
      settingsSchema.parse({
        chatModel: model,
        ollamaUrl: 'http://localhost:11434',
        contextSize: 16000,
        temperature: 0,
        timeout: 120000,
      }),
    );
    await writeFile(join(root, 'project-info.txt'), 'Project label: amber-orchid-731.\n');
    const first = input();
    first.model = model;
    first.task = 'Explain dependency injection in one sentence. No tools are needed.';
    const general = await manager.run(first, local, context(), approve);
    expect(general.result.length).toBeGreaterThan(10);
    expect(first.run.tools).toHaveLength(0);
    const second = input();
    second.model = model;
    second.task =
      'Read project-info.txt with the filesystem read tool and report the exact project label. Do not guess.';
    const result = await manager.run(second, local, context(), approve);
    expect(result.result).toContain('amber-orchid-731');
    expect(
      second.run.tools.some((t) => t.toolId === 'filesystem.read' && t.status === 'completed'),
    ).toBe(true);
    const third = input();
    third.model = model;
    third.task = 'Repeat the project label you just read. No tools are needed.';
    expect((await manager.run(third, local, context(), approve)).result).toContain(
      'amber-orchid-731',
    );
  },
  240000,
);
