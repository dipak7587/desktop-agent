import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  CapabilityDecisionEngine,
  CapabilityRouter,
  modelEvaluator,
  restrictCapabilities,
} from '../src/main/services/agents/capabilities';
import { capabilityConfigSchema, librarySchema, settingsSchema } from '../src/shared/schemas';
import { capabilityConfig } from '../src/shared/capabilities';
import type { Capability } from '../src/shared/types';
import { AgentService } from '../src/main/services/agents/agents';
import { LibraryService } from '../src/main/services/filesystem/library';
import { OllamaLLMProvider } from '../src/main/services/ollama/provider';
import { KnowledgeService } from '../src/main/services/rag/knowledge';
import { MCPService } from '../src/main/services/mcp/mcp';
import { AgentTools } from '../src/main/services/agents/tools';
const yes = { relevant: true, necessary: true, canAnswerDirectly: false, userForbids: false };
const no = { ...yes, relevant: false, necessary: false, canAnswerDirectly: true };
const skill: Capability = {
  id: 'skill:code-review',
  selectionId: 'code-review',
  name: 'Code Review',
  type: 'skill',
  enabled: true,
};
const github: Capability = {
  id: 'mcp:github:repos',
  selectionId: 'github',
  name: 'GitHub repositories',
  type: 'mcp',
  enabled: true,
  defaultPermission: 'ask',
};
const kb: Capability = {
  id: 'knowledge:carbon',
  selectionId: 'carbon',
  name: 'Carbon Platform',
  type: 'knowledge',
  enabled: true,
};
const terminal: Capability = {
  id: 'shell.execute',
  name: 'Terminal',
  type: 'tool',
  enabled: true,
  requiresProject: true,
};
afterEach(() => vi.restoreAllMocks());

it.each([
  ['No skills, no MCP, no tools. Explain React.', skill, {}, yes, false],
  ['Explain React.', skill, {}, no, false],
  ['Review this code.', skill, {}, yes, true],
  ['Explain GitHub.', github, {}, no, false],
  ['Show my repositories.', github, {}, yes, true],
  ['What is our Carbon architecture?', kb, {}, yes, true],
  ['What is React?', kb, {}, no, false],
  ['Review this code.', skill, { mode: 'none' }, yes, false],
  ['Get Jira ticket CRBN-123.', github, {}, no, false],
  ['Run npm install.', terminal, { permissions: { 'shell.execute': 'deny' } }, yes, false],
] as const)('spec scenario: %s', async (request, capability, patch, verdict, expected) => {
  const config = capabilityConfigSchema.parse({
    skills: ['code-review'],
    mcpServers: ['github'],
    tools: ['shell.execute'],
    knowledgeBases: ['carbon'],
    ...patch,
  });
  const evaluate = vi.fn().mockResolvedValue(verdict);
  const execute = vi.fn().mockResolvedValue('real result');
  const confirm = vi.fn().mockResolvedValue(true);
  const router = new CapabilityRouter(
    new CapabilityDecisionEngine(evaluate),
    request,
    config,
    { project: '/project' },
    confirm,
  );
  router.register({ capability, execute });
  await router.execute(capability.id, {});
  expect(execute).toHaveBeenCalledTimes(expected ? 1 : 0);
  expect(confirm).toHaveBeenCalledTimes(expected && capability.type === 'mcp' ? 1 : 0);
  // An unrelated, unselected server remains forbidden even if the model requests it.
  if (request.includes('CRBN')) {
    const jira = { ...github, id: 'mcp:jira:ticket', selectionId: 'jira' };
    router.register({ capability: jira, execute });
    await router.execute(jira.id, {});
    expect(execute).not.toHaveBeenCalled();
  }
});

it.each(['No tools.', "Don't use tools.", 'Do not use tools.'])(
  'enforces restriction before consulting the model: %s',
  async (request) => {
    const evaluate = vi.fn().mockResolvedValue(yes);
    const engine = new CapabilityDecisionEngine(evaluate);
    expect(
      (
        await engine.decide(request, terminal, capabilityConfigSchema.parse({ mode: 'auto' }), {
          project: '/project',
        })
      ).shouldCall,
    ).toBe(false);
    expect(evaluate).not.toHaveBeenCalled();
  },
);
it('recognizes all documented explicit restrictions', () => {
  const config = capabilityConfigSchema.parse({ mode: 'auto' });
  for (const request of ["Don't call MCP.", 'No MCP.'])
    expect(restrictCapabilities(request, config).allowMCP).toBe(false);
  for (const request of ["Don't use skills.", 'No skills.'])
    expect(restrictCapabilities(request, config).allowSkills).toBe(false);
  for (const request of ["Don't search the knowledge base.", "Don't access the project."])
    expect(restrictCapabilities(request, config).allowKnowledgeBase).toBe(false);
  for (const request of ['Answer directly.', 'Use only the model.'])
    expect(restrictCapabilities(request, config).mode).toBe('none');
});
it('blocks disabled capabilities in auto and none without relevance calls', async () => {
  const evaluate = vi.fn().mockResolvedValue(yes);
  const engine = new CapabilityDecisionEngine(evaluate);
  for (const c of [skill, github, kb, terminal]) {
    expect(
      (
        await engine.decide(
          'Do work',
          { ...c, enabled: false },
          capabilityConfigSchema.parse({ mode: 'auto' }),
        )
      ).shouldCall,
    ).toBe(false);
    expect(
      (await engine.decide('Do work', c, capabilityConfigSchema.parse({ mode: 'none' })))
        .shouldCall,
    ).toBe(false);
  }
  expect(evaluate).not.toHaveBeenCalled();
});
it('fails closed on malformed decisions and respects semantic user restrictions', async () => {
  const config = capabilityConfigSchema.parse({ mode: 'auto' });
  for (const value of [{}, { ...yes, userForbids: true }, { ...yes, necessary: false }]) {
    const engine = new CapabilityDecisionEngine(async () => value as typeof yes);
    expect((await engine.decide('Request', skill, config)).shouldCall).toBe(false);
  }
  const engine = new CapabilityDecisionEngine(async () => {
    throw new Error('offline');
  });
  expect((await engine.decide('Request', skill, config)).shouldCall).toBe(false);
});
it('rejects denied permissions even when a specific permission says allow', async () => {
  const engine = new CapabilityDecisionEngine(async () => yes);
  const config = capabilityConfigSchema.parse({
    mode: 'auto',
    permissions: { mcp: 'deny', [github.id]: 'always_allow' },
  });
  expect((await engine.decide('Show repos', github, config)).shouldCall).toBe(false);
});
it.each(['reject', 'disabled', 'cancelled'] as const)(
  'does not execute after approval is %s',
  async (condition) => {
    const controller = new AbortController();
    let enabled = true;
    const execute = vi.fn();
    const trace = vi.fn();
    const router = new CapabilityRouter(
      new CapabilityDecisionEngine(async () => yes),
      'Show repos',
      capabilityConfigSchema.parse({ mode: 'auto' }),
      { signal: controller.signal },
      async () => {
        if (condition === 'disabled') enabled = false;
        if (condition === 'cancelled') controller.abort();
        return condition !== 'reject';
      },
      trace,
    );
    router.register({ capability: github, execute, available: async () => enabled });
    if (condition === 'cancelled') await expect(router.execute(github.id, {})).rejects.toThrow();
    else {
      await router.execute(github.id, {});
      expect(trace).toHaveBeenCalledWith(expect.objectContaining({ shouldCall: false }), false);
    }
    expect(execute).not.toHaveBeenCalled();
  },
);
it('auto considers unselected capabilities and always_allow skips confirmation', async () => {
  const execute = vi.fn().mockResolvedValue('result');
  const confirm = vi.fn();
  const router = new CapabilityRouter(
    new CapabilityDecisionEngine(async () => yes),
    'Show repos',
    capabilityConfigSchema.parse({ mode: 'auto', permissions: { [github.id]: 'always_allow' } }),
    {},
    confirm,
  );
  router.register({ capability: github, execute });
  expect(router.catalog()).toHaveLength(1);
  expect(await router.execute(github.id, {})).toBe('result');
  expect(confirm).not.toHaveBeenCalled();
});
it('legacy definitions retain individual MCP selections instead of granting the entire server', () => {
  const config = capabilityConfig(
    librarySchema.parse({ id: 'old', name: 'Old', tools: ['mcp:github:repos'] }),
  );
  const engine = new CapabilityDecisionEngine(async () => yes);
  expect(engine.eligibility('List repos', github, config)).toBeUndefined();
  expect(
    engine.eligibility('Delete repo', { ...github, id: 'mcp:github:delete' }, config),
  ).toContain('not selected');
});
it('model evaluator sends the policy, request and bounded context and validates JSON', async () => {
  const chat = vi.fn(async function* () {
    yield { message: { content: JSON.stringify(no) } };
  });
  const evaluate = modelEvaluator({ chat, listModels: async () => [] }, 'test');
  expect(await evaluate('What is React?', kb, {})).toEqual(no);
  expect(chat.mock.calls[0]).toBeDefined();
});

it.each(['none', 'selected'] as const)(
  'runtime routes skills, knowledge and tools; mode %s cannot bypass the gate',
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), 'capability-runtime-'));
    const settings = () => settingsSchema.parse({ chatModel: 'test', maxIterations: 5 });
    const library = new LibraryService(root);
    const llm = new OllamaLLMProvider(settings);
    const knowledge = new KnowledgeService(
      root,
      settings,
      { embed: async () => [], embedBatch: async () => [] },
      () => {},
    );
    const mcp = new MCPService(library, { resolve: () => '', redact: (s) => s }, () => {});
    const tools = new AgentTools(settings);
    const execute = vi.spyOn(tools, 'execute').mockResolvedValue('file list');
    const search = vi.spyOn(knowledge, 'search').mockResolvedValue([]);
    vi.spyOn(knowledge, 'list').mockReturnValue([
      {
        id: 'carbon',
        name: 'Carbon',
        status: 'ready',
        type: 'file',
        location: '/docs',
        collection: '',
        createdAt: 0,
        updatedAt: 0,
        documentCount: 1,
        chunkCount: 1,
      },
    ]);
    const classify = vi.spyOn(llm, 'chat').mockImplementation(async function* () {
      yield { message: { content: JSON.stringify(yes) } };
    });
    vi.spyOn(llm, 'complete')
      .mockResolvedValueOnce({ role: 'assistant', content: '{"tool":"skill:code-review"}' })
      .mockResolvedValueOnce({ role: 'assistant', content: '{"tool":"knowledge:carbon"}' })
      .mockResolvedValueOnce({ role: 'assistant', content: '{"tool":"filesystem.list"}' })
      .mockResolvedValue({ role: 'assistant', content: '{"final":"Done"}' });
    const service = new AgentService(library, llm, knowledge, mcp, settings, () => {}, tools);
    try {
      await library.save(
        'skills',
        librarySchema.parse({
          id: 'code-review',
          name: 'Code Review',
          content: 'SPECIALIZED WORKFLOW',
        }),
      );
      await library.save(
        'agents',
        librarySchema.parse({
          id: 'agent',
          name: 'Agent',
          capabilityConfig: {
            mode,
            trace: true,
            skills: ['code-review'],
            tools: ['filesystem.list'],
            knowledgeBases: ['carbon'],
          },
        }),
      );
      const id = await service.run({
        agentId: 'agent',
        task: 'Review our code using Carbon standards',
        project: root,
      });
      await expect.poll(() => service.runs().find((r) => r.id === id)?.status).toBe('Completed');
      const run = service.runs()[0];
      expect(search).toHaveBeenCalledTimes(mode === 'none' ? 0 : 1);
      expect(execute).toHaveBeenCalledTimes(mode === 'none' ? 0 : 1);
      expect(classify).toHaveBeenCalledTimes(mode === 'none' ? 0 : 3);
      expect(JSON.stringify(run)).toContain('Capability Decision');
      expect(JSON.stringify(run).includes('SPECIALIZED WORKFLOW')).toBe(mode === 'selected');
    } finally {
      await service.stopAll();
      await rm(root, { recursive: true, force: true });
    }
  },
);
