import { it, expect } from 'vitest';
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
