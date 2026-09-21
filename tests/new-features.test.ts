import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { LibraryService } from '../src/main/services/filesystem/library';
import { CustomToolService } from '../src/main/services/tools/custom';
import { AgentService } from '../src/main/services/agents/agents';
import { AgentRunDatabase } from '../src/main/database/agent-runs';
import { MCPService } from '../src/main/services/mcp/mcp';
import { OllamaLLMProvider } from '../src/main/services/ollama/provider';
import { KnowledgeService } from '../src/main/services/rag/knowledge';
import { librarySchema, settingsSchema } from '../src/shared/schemas';
import { resolveSlash } from '../src/shared/slash-commands';
let root: string, library: LibraryService, tools: CustomToolService;
const secrets = {
  resolve: () => 'private-key',
  redact: (s: string) => s.replaceAll('private-key', '[REDACTED]'),
};
const settings = () => settingsSchema.parse({ chatModel: 'test', maxIterations: 4 });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'new-features-'));
  library = new LibraryService(root);
  tools = new CustomToolService(library, secrets, () => 1000);
});
afterEach(async () => {
  tools.stopAll();
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});
async function saveTool(code = 'return input.value * 2;') {
  return library.save(
    'tools',
    librarySchema.parse({
      id: 'double',
      name: 'Double',
      content: code,
      toolConfig: {
        type: 'javascript',
        parameters: [{ name: 'value', type: 'number', required: true }],
      },
    }),
  );
}
it('runs Node.js logic, validates parameters, reports failures and enforces output/time limits', async () => {
  await saveTool();
  expect(await tools.run('double', { value: 3 })).toBe('6');
  await expect(tools.run('double', { value: 'bad' })).rejects.toThrow('must be number');
  await expect(tools.run('double', {})).rejects.toThrow('must be number');
  await saveTool('throw new Error("private-key");');
  await expect(tools.run('double', { value: 1 })).rejects.toThrow('[REDACTED]');
  await saveTool('return "a".repeat(200000);');
  await expect(tools.run('double', { value: 1 })).rejects.toThrow('100 KB');
  await saveTool('while(true) {}');
  await expect(tools.run('double', { value: 1 })).rejects.toThrow();
});
it('makes real HTTP calls with input, secret references, redaction and HTTP errors', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/fail') {
      res.writeHead(503);
      res.end('unavailable');
      return;
    }
    res.end(JSON.stringify({ url: req.url, token: req.headers.authorization }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as { port: number };
    const item = librarySchema.parse({
      id: 'api',
      name: 'API',
      toolConfig: {
        type: 'api',
        parameters: [],
        url: `http://127.0.0.1:${address.port}/`,
        headers: { Authorization: '${TOKEN}' },
      },
    });
    await library.save('tools', item);
    expect(await tools.run('api', { q: 'hello' })).toBe('{"url":"/?q=hello","token":"[REDACTED]"}');
    await library.save('tools', {
      ...item,
      toolConfig: { ...item.toolConfig!, url: item.toolConfig!.url + 'fail' },
    });
    await expect(tools.run('api', {})).rejects.toThrow('HTTP 503');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});
it('blocks MCP and Tool deletion for every referencing agent, including disabled agents', async () => {
  await saveTool();
  await library.save(
    'mcp',
    librarySchema.parse({ id: 'server', name: 'Server', description: 'Test' }),
  );
  const agent = librarySchema.parse({
    id: 'agent',
    name: 'Reviewer',
    enabled: false,
    tools: ['custom:double', 'mcp:server:echo'],
  });
  await library.save('agents', agent);
  await expect(library.remove('tools', 'double')).rejects.toThrow('Reviewer');
  await expect(library.remove('mcp', 'server')).rejects.toThrow('Reviewer');
  await library.save('agents', { ...agent, tools: [] });
  await library.remove('tools', 'double');
  await library.remove('mcp', 'server');
  expect(await library.list('tools')).toEqual([]);
});
it('auto-starts only enabled opted-in MCPs and records startup failures', async () => {
  for (const [id, autoStart, enabled] of [
    ['yes', true, true],
    ['no', false, true],
    ['disabled', true, false],
  ] as const)
    await library.save(
      'mcp',
      librarySchema.parse({ id, name: id, description: 'Test', autoStart, enabled }),
    );
  const mcp = new MCPService(library, secrets, () => {});
  const start = vi.spyOn(mcp, 'start').mockRejectedValue(new Error('Cannot start private-key'));
  await mcp.autoStart();
  expect(start).toHaveBeenCalledExactlyOnceWith('yes');
  expect(mcp.states()[0]).toMatchObject({
    id: 'yes',
    status: 'error',
    logs: ['Cannot start [REDACTED]'],
  });
});
it('persists folderless agent runs, uses configured iterations and never publishes model planning', async () => {
  await saveTool();
  const agent = await library.save(
    'agents',
    librarySchema.parse({
      id: 'agent',
      name: 'Agent',
      maxIterations: 2,
      tools: ['custom:double', 'filesystem.read'],
    }),
  );
  expect(resolveSlash('/agent Agent', [agent]).query).toBe('Run your configured instructions.');
  const llm = new OllamaLLMProvider(settings);
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
  const complete = vi
    .spyOn(llm, 'complete')
    .mockResolvedValueOnce({
      role: 'assistant',
      content: JSON.stringify({
        plan: 'PRIVATE REASONING',
        tool: 'custom:double',
        args: { value: 4 },
      }),
    })
    .mockResolvedValue({ role: 'assistant', content: '{"final":"Done"}' });
  const knowledge = new KnowledgeService(
    root,
    settings,
    { embed: async () => [], embedBatch: async () => [] },
    () => {},
  );
  const mcp = new MCPService(library, secrets, () => {});
  let db = new AgentRunDatabase(join(root, 'runs.sqlite'));
  const service = new AgentService(
    library,
    llm,
    knowledge,
    mcp,
    settings,
    (e) => {
      if (e.approval) queueMicrotask(() => service.approve(e.approval!.id, true));
    },
    undefined,
    tools,
    db,
    secrets.redact,
  );
  try {
    const id = await service.run({ agentId: 'agent', task: 'Double four' });
    await expect.poll(() => service.runs().find((r) => r.id === id)?.status).toBe('Completed');
    const run = service.runs()[0];
    expect(run).toMatchObject({
      iterationsUsed: 2,
      maxIterations: 2,
      result: 'Done',
      tools: [{ toolId: 'custom:double', status: 'completed' }],
    });
    expect(run.completedAt).toBeTruthy();
    expect(JSON.stringify(run)).not.toContain('PRIVATE REASONING');
    expect(complete.mock.calls[0][0].messages[0].content).toContain('Allowed tools: custom:double');
    db.close();
    db = new AgentRunDatabase(join(root, 'runs.sqlite'));
    expect(db.list()[0]).toEqual(run);
    const limited = new AgentService(
      library,
      llm,
      knowledge,
      mcp,
      settings,
      () => {},
      undefined,
      tools,
      db,
    );
    complete.mockResolvedValue({ role: 'assistant', content: '{}' });
    const limitedId = await limited.run({ agentId: 'agent', task: 'Task' });
    await expect
      .poll(() => limited.runs().find((r) => r.id === limitedId)?.status)
      .toBe('Max iterations reached');
    expect(limited.runs().find((r) => r.id === limitedId)?.iterationsUsed).toBe(2);
    await limited.stopAll();
  } finally {
    await service.stopAll();
    db.close();
  }
});

it('serializes optional definition fields passed as undefined over IPC', async () => {
  const item = librarySchema.parse({
    id: 'note',
    name: 'Note',
    toolConfig: undefined,
    maxIterations: undefined,
  });
  await library.save('saved-text', item);
  expect((await library.get('saved-text', 'note')).name).toBe('Note');
});
