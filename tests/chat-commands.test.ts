import { useProviderBridge, toolReply } from './fixtures/scripted-provider';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { librarySchema, settingsSchema, sendSchema } from '../src/shared/schemas';
import { commandKinds, resolveSlash, slashPrefix } from '../src/shared/slash-commands';
import { ChatDatabase } from '../src/main/database/chat';
import { ChatService } from '../src/main/services/ollama/chat';
import { ChatCommands } from '../src/main/services/ollama/commands';
import { LibraryService } from '../src/main/services/filesystem/library';
import { AgentService } from '../src/main/services/agents/agents';
import { MCPService } from '../src/main/services/mcp/mcp';
import { KnowledgeService } from '../src/main/services/rag/knowledge';
import { OllamaLLMProvider, type ChatRequest } from '../src/main/services/ollama/provider';
import type { AppEvent } from '../src/shared/types';
import type { MemoryService } from '../src/main/services/ai/memory';

let root: string,
  db: ChatDatabase,
  library: LibraryService,
  mcp: MCPService,
  agents: AgentService,
  commands: ChatCommands,
  chat: ChatService,
  llm: OllamaLLMProvider,
  events: AppEvent[];
const settings = () => settingsSchema.parse({ chatModel: 'test', maxIterations: 5 });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'chat-command-'));
  for (const dir of ['agents', 'skills', 'mcp', 'project']) await mkdir(join(root, dir));
  db = new ChatDatabase(join(root, 'chat.sqlite'));
  library = new LibraryService(root);
  llm = new OllamaLLMProvider(settings);
  useProviderBridge(llm);
  vi.spyOn(llm, 'chat').mockImplementation(async function* () {
    yield {
      message: {
        content: JSON.stringify({
          relevant: true,
          necessary: true,
          canAnswerDirectly: false,
          userForbids: false,
        }),
      },
    };
  });
  mcp = new MCPService(library, { resolve: () => '', redact: (s) => s }, () => {});
  const knowledge = new KnowledgeService(
    root,
    settings,
    { embed: async () => [], embedBatch: async () => [] },
    () => {},
  );
  agents = new AgentService(library, llm, knowledge, mcp, settings, () => {});
  commands = new ChatCommands(library, mcp, agents);
  events = [];
  chat = new ChatService(
    db,
    llm,
    (e) => events.push(e),
    async () => [],
    () => 8192,
    commands,
  );
});
afterEach(async () => {
  await chat.stopAll();
  await agents.stopAll();
  await mcp.stopAll();
  db.close();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});
const input = () => ({
  id: db.create('test').id,
  text: 'Help with this task',
  model: 'test',
  knowledge: 'none',
});
const settle = async (id: string) => {
  await expect.poll(() => chat.isActive(id)).toBe(false);
};
async function setupMCP() {
  await library.save(
    'mcp',
    librarySchema.parse({
      id: 'server',
      name: 'My server',
      description: 'Testing',
      command: 'node',
    }),
  );
  vi.spyOn(mcp, 'states').mockReturnValue([
    {
      id: 'server',
      status: 'connected',
      tools: [{ name: 'echo', inputSchema: { type: 'object' } }],
      logs: [],
    },
  ]);
  return vi.spyOn(mcp, 'call').mockResolvedValue('actual tool result');
}

it('parses quoted names, longest unquoted names, queries and rejects ambiguity', () => {
  expect(commandKinds).toContain('code');
  const items = ['My server', 'My server two'].map((name, i) =>
    librarySchema.parse({ id: `s${i}`, name }),
  );
  expect(slashPrefix('/mcp ')).toEqual({ kind: 'mcp', rest: '' });
  expect(slashPrefix('/mcp-My')).toEqual({ kind: 'mcp', rest: 'My' });
  expect(resolveSlash('/mcp-My server hello', items)).toMatchObject({
    command: { id: 's0' },
    query: 'hello',
  });
  expect(resolveSlash('/mcp "My server" "hello world"', items)).toMatchObject({
    command: { id: 's0' },
    query: 'hello world',
  });
  expect(resolveSlash('/mcp My server two hello', items)).toMatchObject({
    command: { id: 's1' },
    query: 'hello',
  });
  expect(() => resolveSlash('/mcp My server', items)).toThrow('query');
  expect(() => resolveSlash('/mcp "missing" query', items)).toThrow();
  expect(() => resolveSlash('/mcp "My server" query', [...items, items[0]])).toThrow('ambiguous');
  expect(() =>
    sendSchema.parse({ ...input(), command: { kind: 'shell', id: 'server' } }),
  ).toThrow();
  expect(() =>
    sendSchema.parse({ ...input(), command: { kind: 'mcp', id: '../server' } }),
  ).toThrow();
});

it('applies a skill to only its requested turn and persists command metadata', async () => {
  await library.save(
    'skills',
    librarySchema.parse({
      id: 'skill',
      name: 'Brief answers',
      content: 'Use exactly three bullets.',
    }),
  );
  const requests: ChatRequest[] = [];
  vi.spyOn(llm, 'chat').mockImplementation(async function* (request) {
    if (request.messages[0].content.includes('CAPABILITY_RELEVANCE_CHECK')) {
      yield {
        message: {
          content: JSON.stringify({
            relevant: true,
            necessary: true,
            canAnswerDirectly: false,
            userForbids: false,
          }),
        },
      };
      return;
    }
    requests.push(request);
    yield { message: { content: 'A helpful answer' } };
  });
  const request = input();
  await chat.send({ ...request, command: { kind: 'skills', id: 'skill' } });
  await settle(request.id);
  expect(requests[0].messages[0].content).toContain('Use exactly three bullets.');
  expect(requests[0].tools).toBeUndefined();
  expect(db.messages(request.id).at(-1)?.metadata?.command?.name).toBe('Brief answers');
  await expect(chat.send({ ...request, regenerate: true })).rejects.toThrow(
    'cannot be regenerated',
  );
  await chat.send({ ...request, text: 'A normal follow-up' });
  await settle(request.id);
  expect(requests[1].messages[0].content).not.toContain('Use exactly three bullets.');
});

it('runs a selected skill with its tools, MCP and KB configuration', async () => {
  await setupMCP();
  const connected = mcp.states();
  vi.mocked(mcp.states).mockReturnValue([{ ...connected[0], status: 'stopped', tools: [] }]);
  const start = vi.spyOn(mcp, 'start').mockImplementation(async () => {
    vi.mocked(mcp.states).mockReturnValue(connected);
  });
  await library.save(
    'skills',
    librarySchema.parse({
      id: 'research',
      name: 'Research',
      content: 'Compare real source results.',
      capabilityConfig: {
        mode: 'selected',
        tools: ['custom:lookup'],
        mcpServers: ['server'],
        knowledgeBases: ['all'],
        permissions: { 'custom:lookup': 'ask' },
      },
    }),
  );
  const run = vi.spyOn(agents, 'runInChat').mockResolvedValue('Skill result from KB and tools.');
  const request = input();
  await chat.send({ ...request, modes: ['skills'], command: { kind: 'skills', id: 'research' } });
  await settle(request.id);
  expect(start).toHaveBeenCalledExactlyOnceWith('server');
  expect(run).toHaveBeenCalledOnce();
  const effective = run.mock.calls[0][0];
  expect(effective.content).toContain('Compare real source results.');
  expect(effective.capabilityConfig).toMatchObject({
    tools: ['custom:lookup'],
    mcpServers: ['server'],
    knowledgeBases: ['all'],
    permissions: { 'custom:lookup': 'ask' },
  });
  expect(effective.model).toBe(request.model);
  expect(db.messages(request.id).at(-1)?.content).toBe('Skill result from KB and tools.');
  expect(db.messages(request.id).at(-1)?.metadata?.command?.kind).toBe('skills');
  await chat.send({ ...request, text: 'Normal follow-up', modes: [] });
  await settle(request.id);
  expect(run).toHaveBeenCalledOnce();
});

it('rejects disabled definitions and MCP startup failures before saving a message', async () => {
  await library.save(
    'skills',
    librarySchema.parse({ id: 'off', name: 'Disabled', enabled: false }),
  );
  await library.save(
    'mcp',
    librarySchema.parse({ id: 'server', name: 'Server', description: 'Not running' }),
  );
  const request = input();
  await expect(chat.send({ ...request, command: { kind: 'skills', id: 'off' } })).rejects.toThrow(
    'Enable',
  );
  await expect(chat.send({ ...request, command: { kind: 'mcp', id: 'server' } })).rejects.toThrow(
    'executable command',
  );
  expect(db.messages(request.id)).toEqual([]);
  expect(chat.isActive(request.id)).toBe(false);
});

it('starts a selected stopped MCP server before running its tools', async () => {
  await setupMCP();
  const connected = mcp.states();
  vi.mocked(mcp.states).mockReturnValue([{ ...connected[0], status: 'stopped', tools: [] }]);
  const start = vi.spyOn(mcp, 'start').mockImplementation(async (id) => {
    expect(id).toBe('server');
    vi.mocked(mcp.states).mockReturnValue(connected);
  });
  const run = vi.spyOn(agents, 'runInChat').mockResolvedValue('MCP answer');
  const request = input();
  await chat.send({ ...request, modes: ['mcp'], command: { kind: 'mcp', id: 'server' } });
  await settle(request.id);
  expect(start).toHaveBeenCalledExactlyOnceWith('server');
  expect(run.mock.calls[0][0].tools).toEqual(['mcp:server:echo']);
  expect(db.messages(request.id).at(-1)?.content).toBe('MCP answer');
});

it('routes an unselected MCP checkbox across connected enabled servers and preserves approvals', async () => {
  const call = await setupMCP();
  for (const id of ['second', 'disabled', 'stopped', 'empty'])
    await library.save(
      'mcp',
      librarySchema.parse({
        id,
        name: id,
        description: 'Search test information',
        enabled: id !== 'disabled',
      }),
    );
  const original = mcp.states();
  vi.mocked(mcp.states).mockReturnValue([
    ...original,
    ...(['second', 'disabled', 'stopped', 'empty'] as const).map((id) => ({
      id,
      status: id === 'stopped' ? ('stopped' as const) : ('connected' as const),
      tools: id === 'empty' ? [] : [{ name: 'search', inputSchema: { type: 'object' } }],
      logs: [],
    })),
  ]);
  const prepare = vi.spyOn(commands, 'prepareAllMCP');
  const run = vi.spyOn(agents, 'runInChat');
  const complete = vi
    .spyOn(llm, 'complete')
    .mockResolvedValueOnce(toolReply('mcp:second:search', { query: 'hello' }))
    .mockResolvedValueOnce({ role: 'assistant', content: 'Answer from MCP results.' });
  const request = input();
  await chat.send({ ...request, modes: ['mcp'] });
  await expect.poll(() => events.some((event) => event.activity?.approval)).toBe(true);
  expect(call).not.toHaveBeenCalled();
  expect(prepare).toHaveBeenCalledOnce();
  expect(run.mock.calls[0][0].tools).toEqual(
    expect.arrayContaining(['mcp:server:echo', 'mcp:second:search']),
  );
  expect(run.mock.calls[0][0].tools).toHaveLength(2);
  expect(run.mock.calls[0][0].skills).toEqual([]);
  expect(run.mock.calls[0][2]).toBe('');
  agents.approve(events.find((event) => event.activity?.approval)!.activity!.approval!.id, true);
  await settle(request.id);
  expect(call).toHaveBeenCalledExactlyOnceWith(
    'second',
    'search',
    { query: 'hello' },
    expect.any(AbortSignal),
  );
  expect(
    complete.mock.calls
      .at(-1)![0]
      .messages.some((message) => message.content.includes('actual tool result')),
  ).toBe(true);
  expect(db.messages(request.id).at(-1)?.content).toBe('Answer from MCP results.');
});

it('rejects unselected MCP mode without a connected server before saving messages', async () => {
  const request = input();
  await expect(chat.send({ ...request, modes: ['mcp'] })).rejects.toThrow('No enabled MCP servers');
  expect(db.messages(request.id)).toEqual([]);
  expect(chat.isActive(request.id)).toBe(false);
});

it('restricts MCP calls to the chosen server and waits for approval before executing', async () => {
  const call = await setupMCP();
  const complete = vi
    .spyOn(llm, 'complete')
    .mockResolvedValueOnce(toolReply('mcp:other:echo', {}))
    .mockResolvedValueOnce(toolReply('mcp:server:echo', { message: 'hello' }))
    .mockResolvedValueOnce({
      role: 'assistant',
      content: 'Used the tool result.',
    });
  const request = input();
  const all = vi.spyOn(commands, 'prepareAllMCP');
  await chat.send({ ...request, modes: ['mcp'], command: { kind: 'mcp', id: 'server' } });
  expect(all).not.toHaveBeenCalled();
  await expect.poll(() => events.some((e) => e.activity?.approval)).toBe(true);
  expect(call).not.toHaveBeenCalled();
  const approval = events.find((e) => e.activity?.approval)!.activity!.approval!;
  agents.approve(approval.id, true);
  await settle(request.id);
  expect(call).toHaveBeenCalledExactlyOnceWith(
    'server',
    'echo',
    { message: 'hello' },
    expect.any(AbortSignal),
  );
  expect(
    complete.mock.calls.at(-1)![0].messages.some((m) => m.content.includes('actual tool result')),
  ).toBe(true);
  const saved = db.messages(request.id).at(-1)!;
  expect(saved.content).toBe('Used the tool result.');
  expect(saved.metadata?.activity?.some((e) => e.approval)).toBe(true);
  db.close();
  db = new ChatDatabase(join(root, 'chat.sqlite'));
  expect(db.messages(request.id).at(-1)?.metadata?.command?.kind).toBe('mcp');
});

it.each(['reject', 'stop'] as const)(
  'does not execute an MCP operation after %s',
  async (action) => {
    const call = await setupMCP();
    vi.spyOn(llm, 'complete')
      .mockResolvedValueOnce(toolReply('mcp:server:echo', {}))
      .mockResolvedValue({
        role: 'assistant',
        content: 'No operation performed.',
      });
    const request = input();
    await chat.send({ ...request, command: { kind: 'mcp', id: 'server' } });
    await expect.poll(() => events.some((e) => e.activity?.approval)).toBe(true);
    const approval = events.find((e) => e.activity?.approval)!.activity!.approval!;
    if (action === 'stop') chat.stop(request.id);
    else agents.approve(approval.id, false);
    await settle(request.id);
    expect(call).not.toHaveBeenCalled();
    expect(() => agents.approve(approval.id, true)).toThrow('no longer active');
    expect(db.messages(request.id).at(-1)?.metadata?.stopped).toBe(action === 'stop');
  },
);

it('runs an agent from chat with its configured model and applies a reviewed file change', async () => {
  await library.save(
    'agents',
    librarySchema.parse({
      id: 'writer',
      name: 'Writer',
      model: 'agent-model',
      tools: ['filesystem.write'],
    }),
  );
  const complete = vi
    .spyOn(llm, 'complete')
    .mockResolvedValueOnce(
      toolReply('filesystem.write', {
        path: 'hello.txt',
        content: 'hello',
        expectedHash: 'missing',
      }),
    )
    .mockResolvedValueOnce({
      role: 'assistant',
      content: 'Created hello.txt',
    });
  const request = input();
  await chat.send({
    ...request,
    command: { kind: 'agent', id: 'writer', project: join(root, 'project') },
  });
  await expect.poll(() => events.some((e) => e.activity?.approval?.diff)).toBe(true);
  const approval = events.find((e) => e.activity?.approval)!.activity!.approval!;
  expect(approval.diff).toContain('+hello');
  agents.approve(approval.id, true);
  await settle(request.id);
  expect(complete.mock.calls[0][0].model).toBe('agent-model');
  expect(await readFile(join(root, 'project', 'hello.txt'), 'utf8')).toBe('hello');
  expect(db.messages(request.id).at(-1)?.content).toBe('Created hello.txt');
});

it.each(['general', 'restricted', 'project'] as const)(
  'routes regular Chat knowledge and skills for a %s request',
  async (kind) => {
    await library.save(
      'skills',
      librarySchema.parse({
        id: 'review',
        name: 'Code Review',
        description: 'Review project code',
        content: 'REVIEW WORKFLOW',
      }),
    );
    const search = vi.fn().mockResolvedValue([
      {
        id: 'chunk',
        sourceId: 'carbon',
        name: 'Architecture',
        content: 'STORED ARCHITECTURE',
        score: 1,
        location: '',
      },
    ]);
    chat = new ChatService(
      db,
      llm,
      (e) => events.push(e),
      search,
      () => 8192,
      commands,
    );
    const prompts: string[] = [];
    vi.spyOn(llm, 'chat').mockImplementation(async function* (request) {
      if (request.messages[0].content.includes('CAPABILITY_RELEVANCE_CHECK')) {
        yield {
          message: {
            content: JSON.stringify({
              relevant: kind === 'project',
              necessary: kind === 'project',
              canAnswerDirectly: kind !== 'project',
              userForbids: false,
            }),
          },
        };
      } else {
        prompts.push(request.messages[0].content);
        yield { message: { content: 'Answer' } };
      }
    });
    const request = {
      ...input(),
      knowledge: 'carbon',
      text:
        kind === 'restricted'
          ? 'No skills, no MCP, no tools. Explain React.'
          : kind === 'general'
            ? 'What is React?'
            : 'Review our code against the stored architecture.',
    };
    await chat.send({ ...request, command: { kind: 'skills', id: 'review' } });
    await settle(request.id);
    expect(search).toHaveBeenCalledTimes(kind === 'project' ? 1 : 0);
    expect(prompts[0].includes('REVIEW WORKFLOW')).toBe(kind === 'project');
    expect(prompts[0].includes('STORED ARCHITECTURE')).toBe(kind === 'project');
  },
);

it.each(['carbon', 'collection:Engineering', 'all'])(
  'passes source metadata and follow-up context into the decision for %s',
  async (scope) => {
    const search = vi.fn().mockResolvedValue([
      {
        id: 'c1',
        sourceId: 'carbon',
        name: 'Carbon architecture',
        content: 'Carbon uses a dedicated identity service.',
        score: 1,
        location: '',
      },
    ]);
    const source = {
      id: 'carbon',
      type: 'file' as const,
      name: 'Carbon architecture',
      collection: 'Engineering',
      status: 'ready' as const,
      location: '',
      createdAt: 0,
      updatedAt: 0,
      documentCount: 1,
      chunkCount: 1,
    };
    chat = new ChatService(
      db,
      llm,
      (e) => events.push(e),
      search,
      () => 8192,
      commands,
      (s) => s,
      () => [source],
    );
    let answerPrompt = '';
    vi.spyOn(llm, 'chat').mockImplementation(async function* (request) {
      if (request.messages[0].content.includes('CAPABILITY_RELEVANCE_CHECK')) {
        const context = JSON.parse(request.messages[1].content);
        expect(context.capability.description).toContain('Carbon architecture');
        expect(context.selectedKnowledge).toBe(scope);
        expect(context.conversation).toContain('Explain our Carbon platform');
        yield {
          message: {
            content: JSON.stringify({
              relevant: true,
              necessary: true,
              canAnswerDirectly: false,
              userForbids: false,
            }),
          },
        };
      } else {
        answerPrompt = request.messages[0].content;
        yield {
          message: { content: 'Carbon uses a dedicated identity service. [Carbon architecture]' },
        };
      }
    });
    const request = input();
    db.add(request.id, 'user', 'Explain our Carbon platform');
    db.add(request.id, 'assistant', 'Which part?');
    await chat.send({ ...request, text: 'How does authentication work?', knowledge: scope });
    await settle(request.id);
    expect(search).toHaveBeenCalledExactlyOnceWith('How does authentication work?', scope);
    expect(answerPrompt).toContain('Carbon uses a dedicated identity service.');
    expect(answerPrompt).toContain('Base source-specific answers on these passages');
    expect(db.messages(request.id).at(-1)?.metadata?.sources).toHaveLength(1);
    expect(events.some((e) => e.activity?.content?.includes('Retrieved 1 passages'))).toBe(true);
  },
);
it.each(['empty', 'not-ready', 'skipped'] as const)(
  'reports %s knowledge instead of silently implying a KB answer',
  async (state) => {
    const search = vi.fn().mockResolvedValue([]);
    chat = new ChatService(
      db,
      llm,
      (e) => events.push(e),
      search,
      () => 8192,
      commands,
      (s) => s,
      () => [
        {
          id: 'carbon',
          type: 'file',
          name: 'Carbon',
          collection: '',
          status: state === 'not-ready' ? 'idle' : 'ready',
          location: '',
          createdAt: 0,
          updatedAt: 0,
          documentCount: 0,
          chunkCount: 0,
        },
      ],
    );
    let system = '';
    vi.spyOn(llm, 'chat').mockImplementation(async function* (request) {
      if (request.messages[0].content.includes('CAPABILITY_RELEVANCE_CHECK')) {
        yield {
          message: {
            content: JSON.stringify({
              relevant: state !== 'skipped',
              necessary: state !== 'skipped',
              canAnswerDirectly: state === 'skipped',
              userForbids: false,
            }),
          },
        };
      } else {
        system = request.messages[0].content;
        yield { message: { content: 'No KB answer available.' } };
      }
    });
    const request = input();
    await chat.send({ ...request, text: 'What does Carbon use?', knowledge: 'carbon' });
    await settle(request.id);
    expect(search).toHaveBeenCalledTimes(state === 'empty' ? 1 : 0);
    expect(system).toContain(
      state === 'empty'
        ? 'no passages were returned'
        : state === 'not-ready'
          ? 'No selected source is ready'
          : 'No KB search was performed',
    );
  },
);

it('codes in a persisted workspace without a configured agent and reviews writes', async () => {
  const { realpath } = await import('node:fs/promises');
  const project = await realpath(join(root, 'project'));
  const request = input();
  db.connectCodeWorkspace(request.id, project);
  db.add(request.id, 'user', 'Keep the existing public API.');
  const complete = vi
    .spyOn(llm, 'complete')
    .mockResolvedValueOnce(
      toolReply('filesystem.write', {
        path: 'direct.txt',
        content: 'direct coding works',
        expectedHash: 'missing',
      }),
    )
    .mockResolvedValueOnce({ role: 'assistant', content: 'Created direct.txt; tests not run.' });
  await chat.send({ ...request, modes: ['code'] });
  await expect.poll(() => events.some((event) => event.activity?.approval)).toBe(true);
  await expect(readFile(join(project, 'direct.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  agents.approve(events.find((event) => event.activity?.approval)!.activity!.approval!.id, true);
  await settle(request.id);
  expect(await readFile(join(project, 'direct.txt'), 'utf8')).toBe('direct coding works');
  expect(await library.list('agents')).toEqual([]);
  expect(agents.runs()[0]).toMatchObject({ folderPath: project, status: 'Completed' });
  expect(complete.mock.calls[0][0].messages[0].content).toContain('Keep the existing public API.');
  expect(db.messages(request.id).at(-1)?.metadata?.command?.kind).toBe('code');
  await expect(chat.send({ ...request, regenerate: true })).rejects.toThrow(
    'cannot be regenerated',
  );
  db.disconnectCodeWorkspace(request.id);
  const prepare = vi.spyOn(commands, 'prepareCoding');
  await chat.send({ ...request, text: 'Explain this concept.' });
  await settle(request.id);
  expect(prepare).not.toHaveBeenCalled();
});

it('restores linked folders for selected agents and rejects missing direct workspaces', async () => {
  const { realpath } = await import('node:fs/promises');
  const project = await realpath(join(root, 'project'));
  const request = input();
  const workspace = db.connectCodeWorkspace(request.id, project);
  await library.save(
    'agents',
    librarySchema.parse({ id: 'reviewer', name: 'Reviewer', model: 'test' }),
  );
  vi.spyOn(llm, 'complete').mockResolvedValue({ role: 'assistant', content: 'Reviewed.' });
  await chat.send({ ...request, command: { kind: 'agent', id: 'reviewer' } });
  await settle(request.id);
  expect(agents.runs()[0].folderPath).toBe(project);
  db.relinkCodeWorkspace(workspace.id, request.id, join(project, 'missing'));
  await expect(chat.send(request)).rejects.toThrow();
  expect(chat.isActive(request.id)).toBe(false);
});

it('uses only the model when every chat mode is unchecked, even with a workspace and KB scope', async () => {
  const search = vi.fn().mockResolvedValue([]);
  const coding = vi.spyOn(commands, 'prepareCoding');
  const prepare = vi.spyOn(commands, 'prepare');
  const runAgent = vi.spyOn(agents, 'runInChat');
  const memory = {
    retrieve: vi.fn().mockReturnValue([]),
    formatForPrompt: vi.fn().mockReturnValue('MEMORY CONTEXT'),
    maybeCapture: vi.fn().mockResolvedValue(undefined),
  };
  const requests: ChatRequest[] = [];
  vi.spyOn(llm, 'chat').mockImplementation(async function* (request) {
    requests.push(request);
    yield { message: { content: 'Direct model answer' } };
  });
  chat = new ChatService(
    db,
    llm,
    (e) => events.push(e),
    search,
    () => 8192,
    commands,
    undefined,
    undefined,
    undefined,
    memory as unknown as MemoryService,
  );
  const request = input();
  db.connectCodeWorkspace(request.id, join(root, 'project'));
  await chat.send({ ...request, knowledge: 'all', modes: [] });
  await settle(request.id);
  expect(search).not.toHaveBeenCalled();
  expect(coding).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
  expect(runAgent).not.toHaveBeenCalled();
  expect(memory.retrieve).not.toHaveBeenCalled();
  expect(memory.formatForPrompt).not.toHaveBeenCalled();
  expect(memory.maybeCapture).not.toHaveBeenCalled();
  expect(requests).toHaveLength(1);
  expect(requests[0].messages).toEqual([{ role: 'user', content: request.text }]);
  expect(requests[0].tools ?? []).toEqual([]);
  expect(db.messages(request.id).at(-1)?.content).toBe('Direct model answer');
  expect(db.messages(request.id).at(-1)?.metadata?.command).toBeUndefined();
  // The direct path retains ordinary conversation history for subsequent turns.
  await chat.send({ ...request, text: 'Follow up', modes: [] });
  await settle(request.id);
  expect(requests[1].messages).toEqual([
    { role: 'user', content: request.text },
    { role: 'assistant', content: 'Direct model answer', tool_calls: [] },
    { role: 'user', content: 'Follow up' },
  ]);
});

it('rejects commands from unchecked categories', async () => {
  await expect(
    chat.send({ ...input(), modes: ['kb'], command: { kind: 'mcp', id: 'server' } }),
  ).rejects.toThrow('matching chat checkbox');
  await expect(
    chat.send({ ...input(), modes: ['tools'], command: { kind: 'skills', id: 'review' } }),
  ).rejects.toThrow('matching chat checkbox');
});

it('always retrieves the selected KB and stops adding its context once KB is unchecked', async () => {
  const search = vi.fn().mockResolvedValue([
    {
      id: 'chunk',
      sourceId: 'saved-text',
      name: 'Handbook',
      content: 'PRIVATE KB FACT',
      score: 1,
      location: '',
    },
  ]);
  chat = new ChatService(
    db,
    llm,
    (e) => events.push(e),
    search,
    () => 8192,
    commands,
  );
  const prompts: string[] = [];
  vi.spyOn(llm, 'chat').mockImplementation(async function* (request) {
    prompts.push(request.messages.map((message) => message.content).join('\n'));
    yield { message: { content: 'Answer' } };
  });
  const request = input();
  await chat.send({ ...request, knowledge: 'saved-text', modes: ['kb'] });
  await settle(request.id);
  expect(search).toHaveBeenCalledWith(request.text, 'saved-text');
  expect(prompts[0]).toContain('PRIVATE KB FACT');
  await chat.send({ ...request, knowledge: 'saved-text', modes: [] });
  await settle(request.id);
  expect(search).toHaveBeenCalledTimes(1);
  expect(prompts.at(-1)).not.toContain('PRIVATE KB FACT');
});

it('combines selected KB passages with a tool command and limits the tool agent to that tool', async () => {
  await library.save(
    'tools',
    librarySchema.parse({
      id: 'double',
      name: 'Double',
      content: 'return 2;',
      toolConfig: { type: 'javascript', parameters: [] },
    }),
  );
  const run = vi.spyOn(agents, 'runInChat').mockResolvedValue('Tool answer');
  const search = vi.fn().mockResolvedValue([
    {
      id: 'chunk',
      sourceId: 'docs',
      name: 'Docs',
      content: 'KB TOOL INPUT',
      score: 1,
      location: '',
    },
  ]);
  chat = new ChatService(
    db,
    llm,
    (e) => events.push(e),
    search,
    () => 8192,
    commands,
  );
  const request = input();
  await chat.send({
    ...request,
    knowledge: 'docs',
    modes: ['kb', 'tools'],
    command: { kind: 'tools', id: 'double' },
  });
  await settle(request.id);
  expect(run.mock.calls[0][0].tools).toEqual(['custom:double']);
  expect(run.mock.calls[0][1]).toContain('KB TOOL INPUT');
  expect(db.messages(request.id).at(-1)?.content).toBe('Tool answer');
  expect(db.messages(request.id).at(-1)?.metadata?.sources).toHaveLength(1);
});
