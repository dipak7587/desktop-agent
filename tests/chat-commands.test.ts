import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { librarySchema, settingsSchema, sendSchema } from '../src/shared/schemas';
import { resolveSlash, slashPrefix } from '../src/shared/slash-commands';
import { ChatDatabase } from '../src/main/database/chat';
import { ChatService } from '../src/main/services/ollama/chat';
import { ChatCommands } from '../src/main/services/ollama/commands';
import { LibraryService } from '../src/main/services/filesystem/library';
import { AgentService } from '../src/main/services/agents/agents';
import { MCPService } from '../src/main/services/mcp/mcp';
import { KnowledgeService } from '../src/main/services/rag/knowledge';
import { OllamaLLMProvider, type ChatRequest } from '../src/main/services/ollama/provider';
import type { AppEvent } from '../src/shared/types';

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
  const items = ['My server', 'My server two'].map((name, i) =>
    librarySchema.parse({ id: `s${i}`, name }),
  );
  expect(slashPrefix('/mcp ')).toEqual({ kind: 'mcp', rest: '' });
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

it('rejects disabled definitions and stopped MCP servers before saving a message', async () => {
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
    'Start',
  );
  expect(db.messages(request.id)).toEqual([]);
  expect(chat.isActive(request.id)).toBe(false);
});

it('restricts MCP calls to the chosen server and waits for approval before executing', async () => {
  const call = await setupMCP();
  const complete = vi
    .spyOn(llm, 'complete')
    .mockResolvedValueOnce({
      role: 'assistant',
      content: JSON.stringify({ tool: 'mcp:other:echo', args: {} }),
    })
    .mockResolvedValueOnce({
      role: 'assistant',
      content: JSON.stringify({ tool: 'mcp:server:echo', args: { message: 'hello' } }),
    })
    .mockResolvedValueOnce({
      role: 'assistant',
      content: JSON.stringify({ final: 'Used the tool result.' }),
    });
  const request = input();
  await chat.send({ ...request, command: { kind: 'mcp', id: 'server' } });
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
      .mockResolvedValueOnce({
        role: 'assistant',
        content: JSON.stringify({ tool: 'mcp:server:echo' }),
      })
      .mockResolvedValue({
        role: 'assistant',
        content: JSON.stringify({ final: 'No operation performed.' }),
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
    .mockResolvedValueOnce({
      role: 'assistant',
      content: JSON.stringify({
        tool: 'filesystem.write',
        args: { path: 'hello.txt', content: 'hello', expectedHash: 'missing' },
      }),
    })
    .mockResolvedValueOnce({
      role: 'assistant',
      content: JSON.stringify({ final: 'Created hello.txt' }),
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
    const search = vi
      .fn()
      .mockResolvedValue([
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
