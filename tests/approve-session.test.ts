import { expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentService } from '../src/main/services/agents/agents';
import { LibraryService } from '../src/main/services/filesystem/library';
import { OllamaLLMProvider } from '../src/main/services/ollama/provider';
import { KnowledgeService } from '../src/main/services/rag/knowledge';
import { MCPService } from '../src/main/services/mcp/mcp';
import { librarySchema, settingsSchema } from '../src/shared/schemas';
import type { AppEvent } from '../src/shared/types';
import { useProviderBridge, toolReply } from './fixtures/scripted-provider';

async function setup(onEvent: (service: AgentService, event: AppEvent) => void) {
  const root = await mkdtemp(join(tmpdir(), 'approve-session-'));
  for (const dir of ['agents', 'skills', 'tools', 'mcp', 'project']) await mkdir(join(root, dir));
  const project = join(root, 'project');
  const settings = () => settingsSchema.parse({ chatModel: 'test-model', approvalMode: 'ask' });
  const library = new LibraryService(root);
  const agent = librarySchema.parse({
    id: 'writer',
    name: 'Writer',
    model: 'test-model',
    tools: ['filesystem.write'],
  });
  await library.save('agents', agent);
  const llm = new OllamaLLMProvider(settings);
  useProviderBridge(llm);
  const knowledge = new KnowledgeService(
    root,
    settings,
    { embed: async () => [], embedBatch: async () => [] },
    () => {},
  );
  const service = new AgentService(
    library,
    llm,
    knowledge,
    new MCPService(library, { resolve: () => '', redact: (s) => s }, () => {}),
    settings,
    () => {},
  );
  const write = (path: string) =>
    toolReply('filesystem.write', { path, content: path, expectedHash: 'missing' });
  const replies = [write('a.txt'), write('b.txt')];
  vi.spyOn(llm, 'complete').mockImplementation(async (request) => {
    // The capability router asks the model to judge relevance before each call.
    if (JSON.stringify(request.messages).includes('CAPABILITY_RELEVANCE_CHECK'))
      return {
        role: 'assistant',
        content: JSON.stringify({
          relevant: true,
          necessary: true,
          canAnswerDirectly: false,
          userForbids: false,
        }),
      };
    return replies.shift() ?? { role: 'assistant', content: 'Done.' };
  });
  const run = () =>
    service.runInChat(agent, 'write', project, new AbortController().signal, (event) => {
      onEvent(service, event);
    });
  return { root, project, service, run };
}

it('asks again for each operation when approved one at a time', async () => {
  const approvals: string[] = [];
  const { root, service, run } = await setup((svc, e) => {
    if (e.approval) {
      approvals.push(e.approval.id);
      setTimeout(() => svc.approve(e.approval!.id, true, false), 5);
    }
  });
  try {
    await run();
    expect(approvals).toHaveLength(2);
  } finally {
    await service.stopAll();
    await rm(root, { recursive: true, force: true });
  }
});

it('does not ask again after "approve all for this session"', async () => {
  const approvals: string[] = [];
  const { root, project, service, run } = await setup((svc, e) => {
    if (e.approval) {
      approvals.push(e.approval.id);
      setTimeout(() => svc.approve(e.approval!.id, true, true), 5);
    }
  });
  try {
    await run();
    expect(approvals).toHaveLength(1);
    expect(await readFile(join(project, 'a.txt'), 'utf8')).toBe('a.txt');
    expect(await readFile(join(project, 'b.txt'), 'utf8')).toBe('b.txt');
  } finally {
    await service.stopAll();
    await rm(root, { recursive: true, force: true });
  }
});

it('a rejection never enables automatic approval', async () => {
  const approvals: string[] = [];
  const { root, project, service, run } = await setup((svc, e) => {
    if (e.approval) {
      approvals.push(e.approval.id);
      setTimeout(() => svc.approve(e.approval!.id, false, true), 5);
    }
  });
  try {
    await run();
    expect(approvals).toHaveLength(2);
    await expect(readFile(join(project, 'a.txt'), 'utf8')).rejects.toThrow();
  } finally {
    await service.stopAll();
    await rm(root, { recursive: true, force: true });
  }
});
