import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CrewAIService } from '../src/main/services/crewai/service';
import { runWorker } from '../src/main/services/crewai/worker';
import { newCrewProject, crewProjectSchema } from '../src/shared/crewai';
import { settingsSchema } from '../src/shared/schemas';
import { SettingsService } from '../src/main/services/settings/settings';
import type { Settings } from '../src/shared/types';
vi.mock('../src/main/services/crewai/worker', () => ({
  runWorker: vi.fn(),
  CREWAI_VERSION: '1.15.22',
}));
let root: string, service: CrewAIService, settings: Settings;
const emit = vi.fn();
const capture = vi.fn(() => ({
  providerId: 'local',
  providerNameSnapshot: 'Local',
  modelId: 'model',
  llm: {
    listModels: async () => [],
    async *chat() {
      yield { message: { content: 'Final Answer: Useful result' } };
    },
  },
}));
const slots = {
  withExternalSlot: async <T>(signal: AbortSignal, job: () => Promise<T>) => {
    signal.throwIfAborted();
    return job();
  },
};
beforeEach(async () => {
  vi.clearAllMocks();
  root = await mkdtemp(join(tmpdir(), 'crew-test-'));
  await mkdir(join(root, 'database'));
  settings = settingsSchema.parse({ crewAIEnabled: true });
  service = new CrewAIService(
    root,
    resolve('workers/crewai'),
    () => settings,
    { capture },
    slots,
    emit,
  );
});
afterEach(async () => {
  await service.close();
  await rm(root, { recursive: true, force: true });
});
const handshake = {
  v: 1 as const,
  type: 'ready' as const,
  version: '1.15.22' as const,
  python: '3.13.14',
};
async function finished(id: string) {
  await vi.waitFor(() =>
    expect(['completed', 'failed', 'cancelled']).toContain(
      service.runs().find((r) => r.id === id)!.status,
    ),
  );
  return service.runs().find((r) => r.id === id)!;
}
it('defaults off, persists opt-in and rejects non-boolean flags', async () => {
  expect(settingsSchema.parse({}).crewAIEnabled).toBe(false);
  expect(() => settingsSchema.parse({ crewAIEnabled: 'true' })).toThrow();
  const store = new SettingsService(root);
  await store.init();
  expect(store.get().crewAIEnabled).toBe(false);
  await store.save({ ...store.get(), crewAIEnabled: true, crewAIPython: '/custom/python' });
  const reopened = new SettingsService(root);
  await reopened.init();
  expect(reopened.get()).toMatchObject({ crewAIEnabled: true, crewAIPython: '/custom/python' });
});
it('rejects invalid task dependencies and unknown tools', () => {
  const p = newCrewProject();
  expect(crewProjectSchema.parse(p)).toEqual(p);
  p.tasks[0].context = [p.tasks[1].id];
  expect(() => crewProjectSchema.parse(p)).toThrow('earlier tasks');
  p.tasks[0].context = [];
  expect(() =>
    crewProjectSchema.parse({ ...p, agents: [{ ...p.agents[0], tools: ['shell.execute'] }] }),
  ).toThrow();
});
it('blocks disabled runtime actions before spawn or provider access and retains data', async () => {
  const p = await service.save(newCrewProject());
  settings.crewAIEnabled = false;
  await expect(service.check()).rejects.toThrow('disabled');
  await expect(service.run({ projectId: p.id, input: '' })).rejects.toThrow('disabled');
  await expect(service.save(p)).rejects.toThrow('disabled');
  await expect(service.export(p.id, root)).rejects.toThrow('disabled');
  expect(runWorker).not.toHaveBeenCalled();
  expect(capture).not.toHaveBeenCalled();
  expect(await service.list()).toHaveLength(1);
});
it('saves, duplicates, removes and exports a standalone project without app provider configuration', async () => {
  const p = await service.save(newCrewProject('private-provider-id', 'my-model'));
  const copy = await service.duplicate(p.id);
  expect(copy.id).not.toBe(p.id);
  const directory = await service.export(p.id, root);
  expect(await readdir(directory)).toEqual(
    expect.arrayContaining([
      'main.py',
      'crew_builder.py',
      'project.json',
      'tool_factory.py',
      'requirements.txt',
      'README.md',
      '.env.example',
    ]),
  );
  const exported = await readFile(join(directory, 'project.json'), 'utf8');
  expect(exported).not.toContain('private-provider-id');
  expect(exported).not.toContain('my-model');
  expect(JSON.parse(exported).agents[0].role).toBe('Analyst');
  await service.remove(copy.id);
  expect(await service.list()).toHaveLength(1);
});
it('executes sequential tasks with explicit model routing and persists completed history', async () => {
  const p = await service.save(newCrewProject('local', 'model'));
  vi.mocked(runWorker).mockImplementation(async (_p, _s, _d, signal, onEvent) => {
    const start = await onEvent(handshake, signal);
    for (const task of p.tasks) {
      const reply = await onEvent(
        {
          v: 1,
          type: 'model_request',
          runId: String(start!.runId),
          requestId: task.id,
          nodeId: task.id,
          messages: [{ role: 'user', content: task.description }],
        },
        signal,
      );
      expect(reply!.content).toContain('Useful result');
      await onEvent(
        {
          v: 1,
          type: 'node_completed',
          runId: String(start!.runId),
          nodeId: task.id,
          result: 'Useful result',
        },
        signal,
      );
    }
    await onEvent({ v: 1, type: 'completed', runId: String(start!.runId) }, signal);
  });
  const run = await finished(await service.run({ projectId: p.id, input: 'Test' }));
  expect(run.status).toBe('completed');
  expect(run.modelCalls).toBe(2);
  expect(run.tasks.every((t) => t.status === 'completed')).toBe(true);
  expect(capture).toHaveBeenCalledWith('local', 'model');
});
it('fails incomplete workers instead of reporting success', async () => {
  const p = await service.save(newCrewProject());
  vi.mocked(runWorker).mockImplementation(async (_p, _s, _d, signal, onEvent) => {
    await onEvent(handshake, signal);
  });
  const run = await finished(await service.run({ projectId: p.id, input: '' }));
  expect(run.status).toBe('failed');
  expect(run.error).toContain('without a completed result');
});
it('enforces model budgets independently of the worker', async () => {
  const p = await service.save({ ...newCrewProject(), maxModelCalls: 1 });
  vi.mocked(runWorker).mockImplementation(async (_p, _s, _d, signal, event) => {
    const start = await event(handshake, signal);
    for (const requestId of ['one', 'two'])
      await event(
        {
          v: 1,
          type: 'model_request',
          runId: String(start!.runId),
          nodeId: p.tasks[0].id,
          requestId,
          messages: [{ role: 'user', content: 'hello' }],
        },
        signal,
      );
  });
  const run = await finished(await service.run({ projectId: p.id, input: '' }));
  expect(run.modelCalls).toBe(1);
  expect(run.error).toContain('Maximum model calls');
});
it.each([true, false])('requires approval for a selected read tool (allow=%s)', async (allow) => {
  const p = newCrewProject();
  p.agents[0].tools = ['filesystem.read'];
  await service.save(p);
  await writeFile(join(root, 'example.txt'), 'approved-content');
  vi.mocked(runWorker).mockImplementation(async (_p, _s, _d, signal, event) => {
    const start = await event(handshake, signal);
    const response = await event(
      {
        v: 1,
        type: 'tool_request',
        runId: String(start!.runId),
        nodeId: p.tasks[0].id,
        requestId: 'approval',
        tool: 'filesystem.read',
        args: { path: 'example.txt' },
      },
      signal,
    );
    expect(String(response!.content)).toContain(allow ? 'approved-content' : 'denied');
  });
  const id = await service.run({ projectId: p.id, input: '', folder: root });
  await vi.waitFor(() => expect(service.runs()[0].status).toBe('waiting'));
  expect(service.runs()[0].tools[0].output).toBeUndefined();
  service.approve('approval', allow);
  const run = await finished(id);
  expect(run.tools[0].status).toBe(allow ? 'completed' : 'denied');
});
it('cancels pending approvals on disable and prevents late approval', async () => {
  const p = newCrewProject();
  p.agents[0].tools = ['filesystem.read'];
  await service.save(p);
  vi.mocked(runWorker).mockImplementation(async (_p, _s, _d, signal, event) => {
    const start = await event(handshake, signal);
    await event(
      {
        v: 1,
        type: 'tool_request',
        runId: String(start!.runId),
        nodeId: p.tasks[0].id,
        requestId: 'approval',
        tool: 'filesystem.read',
        args: { path: 'example.txt' },
      },
      signal,
    );
  });
  const id = await service.run({ projectId: p.id, input: '', folder: root });
  await vi.waitFor(() => expect(service.runs()[0].status).toBe('waiting'));
  settings.crewAIEnabled = false;
  await service.stopAll();
  expect((await finished(id)).status).toBe('cancelled');
  expect(service.runs()[0].tools[0].status).toBe('cancelled');
  expect(() => service.approve('approval', true)).toThrow('disabled');
});
it('rejects unassigned tools and protects paths even after approval', async () => {
  const p = newCrewProject();
  p.agents[0].tools = ['filesystem.read'];
  await service.save(p);
  vi.mocked(runWorker).mockImplementation(async (_p, _s, _d, signal, event) => {
    const start = await event(handshake, signal);
    const response = await event(
      {
        v: 1,
        type: 'tool_request',
        runId: String(start!.runId),
        nodeId: p.tasks[0].id,
        requestId: 'approval',
        tool: 'filesystem.read',
        args: { path: '../outside' },
      },
      signal,
    );
    expect(response!.content).toContain('outside');
    await event(
      {
        v: 1,
        type: 'tool_request',
        runId: String(start!.runId),
        nodeId: p.tasks[0].id,
        requestId: 'bad',
        tool: 'filesystem.search',
        args: { query: 'x' },
      },
      signal,
    );
  });
  const id = await service.run({ projectId: p.id, input: '', folder: root });
  await vi.waitFor(() => expect(service.runs()[0].status).toBe('waiting'));
  service.approve('approval', true);
  expect((await finished(id)).error).toContain('not assigned');
});

it('validates custom tool references and input contracts without coercion', async () => {
  const { newCrewCustomTool, validateCustomInput } = await import('../src/shared/crewai');
  const project = newCrewProject(),
    tool = newCrewCustomTool();
  project.customTools = [tool];
  project.agents[0].tools = [`custom.${tool.id}`];
  expect(crewProjectSchema.parse(project).customTools).toHaveLength(1);
  expect(() => crewProjectSchema.parse({ ...project, customTools: [] })).toThrow();
  expect(() => validateCustomInput(tool, { text: 3 })).toThrow();
  expect(() => validateCustomInput(tool, { text: 'ok', extra: true })).toThrow();
  expect(() => validateCustomInput(tool, {})).toThrow();
  expect(validateCustomInput(tool, { text: 'ok' })).toEqual({ text: 'ok' });
  expect(() =>
    crewProjectSchema.parse({ ...project, customTools: [tool, { ...tool, id: 'second' }] }),
  ).toThrow();
});

it('tests custom Python only after approval, using the saved run snapshot', async () => {
  const { newCrewCustomTool } = await import('../src/shared/crewai');
  const p = newCrewProject(),
    tool = newCrewCustomTool();
  p.customTools = [tool];
  await service.save(p);
  const id = await service.testTool({
    projectId: p.id,
    toolId: tool.id,
    args: { text: 'one two three' },
  });
  await vi.waitFor(() => expect(service.runs()[0].status).toBe('waiting'));
  expect(capture).not.toHaveBeenCalled();
  expect(runWorker).not.toHaveBeenCalled();
  tool.code = 'raise RuntimeError("new code must not execute")';
  await service.save(p);
  service.approve(service.runs()[0].tools[0].id, true);
  const run = await finished(id);
  expect(run.status).toBe('completed');
  expect(JSON.parse(run.tools[0].output!)).toMatchObject({ result: { words: 3 } });
  expect(run.project.customTools[0].code).not.toContain('new code');
});

it('denies and cancels custom tests without executing code; disabled tests are blocked', async () => {
  const { newCrewCustomTool } = await import('../src/shared/crewai');
  const p = newCrewProject(),
    tool = newCrewCustomTool();
  tool.code = 'raise RuntimeError("must not execute")';
  p.customTools = [tool];
  await service.save(p);
  const id = await service.testTool({ projectId: p.id, toolId: tool.id, args: { text: 'ok' } });
  await vi.waitFor(() => expect(service.runs()[0].status).toBe('waiting'));
  service.approve(service.runs()[0].tools[0].id, false);
  expect((await finished(id)).tools[0].status).toBe('denied');
  const next = await service.testTool({ projectId: p.id, toolId: tool.id, args: { text: 'ok' } });
  await vi.waitFor(() => expect(service.runs().find((r) => r.id === next)!.status).toBe('waiting'));
  await service.stopAll();
  expect((await finished(next)).tools[0].status).toBe('cancelled');
  settings.crewAIEnabled = false;
  await expect(
    service.testTool({ projectId: p.id, toolId: tool.id, args: { text: 'ok' } }),
  ).rejects.toThrow('disabled');
});
