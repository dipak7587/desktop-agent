import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CrewAIService } from '../src/main/services/crewai/service';
import { newCrewCustomTool, newCrewProject } from '../src/shared/crewai';
import { settingsSchema } from '../src/shared/schemas';
import { runWorker } from '../src/main/services/crewai/worker';
import { OllamaLLMProvider } from '../src/main/services/ollama/provider';

const python = process.env.CREWAI_TEST_PYTHON;
it.skipIf(!python).each(['filesystem', 'custom'])(
  'runs real pinned CrewAI with deterministic model and approved %s tool fixtures',
  async (kind) => {
    const root = await mkdtemp(join(tmpdir(), 'crew-real-'));
    await mkdir(join(root, 'database'));
    const settings = settingsSchema.parse({ crewAIEnabled: true, crewAIPython: python });
    let calls = 0;
    const service = new CrewAIService(
      root,
      resolve('workers/crewai'),
      () => settings,
      {
        capture: () => ({
          providerId: 'fixture',
          providerNameSnapshot: 'Fixture',
          modelId: 'fixture',
          llm: {
            listModels: async () => [],
            async *chat() {
              calls++;
              yield {
                message: {
                  content:
                    calls === 1
                      ? kind === 'custom'
                        ? 'Thought: Count the words.\nAction: count_words\nAction Input: {"text":"one two three"}'
                        : 'Thought: I need to read the provided file.\nAction: read_project_file\nAction Input: {"path":"example.txt"}'
                      : 'Thought: I have the result.\nFinal Answer: Integration fixture complete.',
                },
              };
            },
          },
        }),
      },
      { withExternalSlot: async (_s, work) => work() },
      (event) => {
        if (event.status === 'waiting') {
          const request = service
            .runs()
            .find((r) => r.id === event.id)
            ?.tools.find((t) => t.status === 'waiting');
          if (request) service.approve(request.id, true);
        }
      },
    );
    try {
      expect(await service.check()).toMatchObject({ version: '1.15.22' });
      const p = newCrewProject('fixture', 'fixture');
      const custom = newCrewCustomTool();
      p.customTools = kind === 'custom' ? [custom] : [];
      p.agents[0].tools = kind === 'custom' ? [`custom.${custom.id}`] : ['filesystem.read'];
      await writeFile(join(root, 'example.txt'), 'Integration fixture text');
      await service.save(p);
      const id = await service.run({
        projectId: p.id,
        input: 'Read example.txt and summarize.',
        folder: kind === 'custom' ? undefined : root,
      });
      const deadline = Date.now() + 45000;
      while (
        Date.now() < deadline &&
        !['completed', 'failed', 'cancelled'].includes(
          service.runs().find((r) => r.id === id)!.status,
        )
      )
        await new Promise((r) => setTimeout(r, 100));
      const run = service.runs().find((r) => r.id === id)!;
      expect(run.error).toBeUndefined();
      expect(run.status).toBe('completed');
      expect(run.tasks).toHaveLength(2);
      expect(run.tools[0].status).toBe('completed');
      expect(run.tools[0].output).toContain(
        kind === 'custom' ? '"words":3' : 'Integration fixture text',
      );
      expect(run.modelCalls).toBeGreaterThanOrEqual(3);
    } finally {
      await service.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);

it.skipIf(!python || !process.env.CREWAI_LIVE_MODEL)(
  'runs a real CrewAI project through the local Ollama provider',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'crew-live-'));
    await mkdir(join(root, 'database'));
    const settings = settingsSchema.parse({
      crewAIEnabled: true,
      crewAIPython: python,
      chatModel: process.env.CREWAI_LIVE_MODEL,
    });
    const service = new CrewAIService(
      root,
      resolve('workers/crewai'),
      () => settings,
      {
        capture: () => ({
          providerId: 'local',
          providerNameSnapshot: 'Ollama',
          modelId: settings.chatModel,
          llm: new OllamaLLMProvider(() => settings),
        }),
      },
      { withExternalSlot: async (_s, work) => work() },
      () => {},
    );
    try {
      const p = newCrewProject('local', settings.chatModel);
      p.agents = p.agents.slice(0, 1);
      p.tasks = p.tasks.slice(0, 1);
      p.tasks[0].description = 'Reply with exactly the word READY.';
      p.tasks[0].expectedOutput = 'The word READY';
      await service.save(p);
      const id = await service.run({ projectId: p.id, input: '' });
      const deadline = Date.now() + 110000;
      while (
        Date.now() < deadline &&
        !['completed', 'failed', 'cancelled'].includes(service.runs()[0].status)
      )
        await new Promise((r) => setTimeout(r, 100));
      const result = service.runs().find((r) => r.id === id)!;
      expect(result.error).toBeUndefined();
      expect(result.status).toBe('completed');
      expect(result.tasks[0].result).toContain('READY');
      const exported = await service.export(p.id, root);
      const standalone = await promisify(execFile)(python!, [join(exported, 'main.py')], {
        cwd: exported,
        timeout: 60000,
        env: {
          PATH: process.env.PATH,
          HOME: root,
          CREWAI_MODEL: `openai/${settings.chatModel}`,
          OPENAI_API_KEY: 'local-test-only',
          CREWAI_BASE_URL: 'http://localhost:11434/v1',
        },
      });
      expect(standalone.stdout).toContain('READY');
    } finally {
      await service.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  120000,
);

it.skipIf(!python)(
  'cancels and reaps a Python worker waiting for host input',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'crew-cancel-'));
    const controller = new AbortController();
    try {
      await expect(
        runWorker(
          python!,
          resolve('workers/crewai/worker.py'),
          root,
          controller.signal,
          async () => {
            controller.abort(new Error('User stopped'));
          },
        ),
      ).rejects.toThrow('User stopped');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
  30000,
);
