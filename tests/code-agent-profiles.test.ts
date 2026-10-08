import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodeAgent } from '../src/shared/code-agent-templates';
import { librarySchema, settingsSchema } from '../src/shared/schemas';
import { LibraryService } from '../src/main/services/filesystem/library';
import { AgentService } from '../src/main/services/agents/agents';
import { CodeAgentManager } from '../src/main/services/agents/code-agent-manager';
import { KnowledgeService } from '../src/main/services/rag/knowledge';
import { MCPService } from '../src/main/services/mcp/mcp';
import { useProviderBridge } from './fixtures/scripted-provider';

let root: string;
let library: LibraryService;
let service: AgentService;
const settings = () => settingsSchema.parse({ chatModel: 'local' });
const provider = useProviderBridge({
  listModels: async () => [],
  complete: async () => ({ role: 'assistant' as const, content: 'Task completed.' }),
  async *chat() {},
});
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'code-profiles-')));
  library = new LibraryService(root);
  const knowledge = new KnowledgeService(
    root,
    settings,
    { embed: async () => [], embedBatch: async () => [] },
    () => {},
  );
  vi.spyOn(knowledge, 'list').mockReturnValue([]);
  const mcp = new MCPService(library, { resolve: () => '', redact: (text) => text }, () => {});
  service = new AgentService(library, provider, knowledge, mcp, settings, () => {});
});
afterEach(async () => {
  await service.stopAll();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

it('persists multiple specialist agents and runs them through isolated ACP sessions', async () => {
  const run = vi.spyOn(CodeAgentManager.prototype, 'run');
  const close = vi.spyOn(CodeAgentManager.prototype, 'closeConversation');
  for (const [template, id] of [
    ['tests', 'tests-one'],
    ['mr', 'mr-one'],
  ]) {
    await library.save('agents', createCodeAgent(template, id, 'local', 'local'));
    expect((await library.get('agents', id)).agentRuntime).toBe('deepagents-acp');
  }
  const ids = await Promise.all(
    ['tests-one', 'mr-one'].map((agentId) =>
      service.run({ agentId, project: root, task: 'Explain your role without tools.' }),
    ),
  );
  await expect
    .poll(() => service.runs().filter((entry) => entry.status === 'Completed').length)
    .toBe(2);
  expect(run).toHaveBeenCalledTimes(2);
  expect(new Set(run.mock.calls.map((call) => call[2].conversationId)).size).toBe(2);
  expect(run.mock.calls.map((call) => call[0].agent.id).sort()).toEqual(['mr-one', 'tests-one']);
  expect(
    run.mock.calls.every((call) => call[0].systemPrompt.includes('software engineering agent')),
  ).toBe(true);
  await expect.poll(() => close.mock.calls.length).toBe(2);
  for (const id of ids)
    expect(service.runs().find((entry) => entry.id === id)?.result).toBe('Task completed.');
}, 20000);

it('includes only enabled Code agents selected for the folder in chat ACP', async () => {
  const run = vi
    .spyOn(CodeAgentManager.prototype, 'run')
    .mockResolvedValue({ reason: 'completed', result: 'Done.' });
  const first = {
    ...createCodeAgent('coding', 'first', 'local', 'local'),
    tools: ['filesystem.read', 'filesystem.write'],
  };
  const second = librarySchema.parse({
    id: 'second',
    name: 'User-created agent',
    model: 'local',
    enabled: true,
    tools: ['filesystem.read'],
  });
  expect(second.agentRuntime).toBeUndefined();
  const unselected = createCodeAgent('tests', 'unselected', 'local', 'local');
  const disabled = { ...createCodeAgent('tests', 'disabled', 'local', 'local'), enabled: false };
  await Promise.all(
    [first, second, unselected, disabled].map((agent) => library.save('agents', agent)),
  );
  const builtin = librarySchema.parse({
    id: 'builtin-coding-agent',
    name: 'Coding assistant',
    model: 'local',
    tools: ['filesystem.read', 'filesystem.write'],
  });

  await service.runInChat(
    builtin,
    'Explain your role.',
    root,
    new AbortController().signal,
    () => {},
    undefined,
    {
      conversationId: 'chat',
      workspaceId: 'project',
      providerId: 'local',
      history: '',
      access: {
        allowedAgentIds: [builtin.id, first.id, second.id],
        allowedTools: ['filesystem.read'],
      },
    },
  );

  expect(run).toHaveBeenCalledOnce();
  expect(run.mock.calls[0][0].acpAgents?.map((agent) => agent.id).sort()).toEqual([
    'builtin-coding-agent',
    'first',
    'second',
  ]);
  const builtinTools = run.mock.calls[0][0].acpAgents?.find(
    (agent) => agent.id === 'builtin-coding-agent',
  )?.tools;
  expect(builtinTools?.some((tool) => tool.description.includes('filesystem.read'))).toBe(true);
  expect(builtinTools?.some((tool) => tool.description.includes('filesystem.write'))).toBe(false);
});

it('keeps review and MR templates read-only while test writers request approval', () => {
  for (const template of ['review', 'mr']) {
    const agent = createCodeAgent(template, template);
    expect(agent.tools).not.toContain('shell.execute');
    expect(agent.tools).not.toContain('filesystem.write');
    expect(agent.capabilityConfig?.permissions['filesystem.edit']).toBe('deny');
  }
  const tests = createCodeAgent('tests', 'tests');
  expect(tests.tools).toContain('shell.execute');
  expect(tests.capabilityConfig?.permissions['filesystem.write']).toBe('ask');
});

it('gives the commit and push template only approval-gated Git mutation tools', () => {
  const agent = createCodeAgent('commit-push', 'commit-push');
  expect(agent.name).toBe('Commit and Push');
  expect(agent.tools).toContain('git.add');
  expect(agent.tools).toContain('git.commit');
  expect(agent.tools).toContain('git.push');
  expect(agent.tools).not.toContain('shell.execute');
  expect(agent.tools).not.toContain('filesystem.write');
  expect(agent.capabilityConfig?.permissions['git.add']).toBe('ask');
  expect(agent.capabilityConfig?.permissions['git.commit']).toBe('ask');
  expect(agent.capabilityConfig?.permissions['git.push']).toBe('ask');
  expect(agent.content).toContain('Never amend, reset, clean, force-push');
});

it('requires a project and rejects a captured cloud provider before creating a run', async () => {
  const agent = createCodeAgent('coding', 'coder', 'cloud', 'local');
  await library.save('agents', agent);
  await expect(service.run({ agentId: agent.id, task: 'Work' })).rejects.toThrow('project folder');
  const selected = {
    llm: provider,
    providerId: 'cloud',
    providerNameSnapshot: 'Cloud',
    modelId: 'local',
    local: false,
  };
  // runInChat uses the same service entry point and validates the captured profile,
  // even when the application's default configuration points at localhost.
  await expect(
    service.runInChat(agent, 'Work', root, new AbortController().signal, () => {}, selected),
  ).rejects.toThrow('local model');
  expect(service.runs()).toHaveLength(0);
});

it('blocks coding agents not granted access to a configured workspace folder', async () => {
  const mcp = new MCPService(library, { resolve: () => '', redact: (text) => text }, () => {});
  const restricted = new AgentService(
    library,
    provider,
    new KnowledgeService(
      root,
      settings,
      { embed: async () => [], embedBatch: async () => [] },
      () => {},
    ),
    mcp,
    settings,
    () => {},
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    () => ({ allowedAgentIds: ['reviewer'] }),
  );
  const agent = createCodeAgent('coding', 'coder', 'local', 'local');
  await library.save('agents', agent);
  await expect(restricted.run({ agentId: agent.id, project: root, task: 'Work' })).rejects.toThrow(
    'not allowed to access this project folder',
  );
  expect(restricted.runs()).toHaveLength(0);
  await restricted.stopAll();
});
