import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, readFile, readdir, rm, mkdtemp, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  crewProjectSchema,
  crewBuiltinToolSchema,
  crewToolTestSchema,
  validateCustomInput,
  type CrewToolTest,
  crewRunSchema,
  type CrewProject,
  type CrewRun,
  type CrewRunInput,
  type CrewRuntime,
} from '../../../shared/crewai';
import { idSchema } from '../../../shared/schemas';
import type { AppEvent, Settings } from '../../../shared/types';
import type { ProviderRouter } from '../providers/router';
import { AgentTools } from '../agents/tools';
import { atomicWrite } from '../filesystem/storage';
import { executeCustomTool } from './custom';
import { runWorker, CREWAI_VERSION } from './worker';

export interface CrewSlots {
  withExternalSlot<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T>;
}
export class CrewAIService {
  private database: DatabaseSync;
  private history = new Map<string, CrewRun>();
  private active = new Map<string, { controller: AbortController; job: Promise<void> }>();
  private checks = new Set<AbortController>();
  private checkCleanup = new Set<Promise<void>>();
  private approvals = new Map<string, { runId: string; resolve: (allow: boolean) => void }>();
  constructor(
    private root: string,
    private workerDirectory: string,
    private settings: () => Settings,
    private providers: Pick<ProviderRouter, 'capture'>,
    private slots: CrewSlots,
    private emit: (event: AppEvent) => void,
    private redact: (text: string) => string = (text) => text,
  ) {
    this.database = new DatabaseSync(join(root, 'database', 'crewai-runs.sqlite'));
    this.database.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, data TEXT NOT NULL)',
    );
    for (const row of this.database.prepare('SELECT data FROM runs ORDER BY rowid').all()) {
      const run = JSON.parse(String(row.data)) as CrewRun;
      this.history.set(run.id, run);
      if (!['completed', 'failed', 'cancelled'].includes(run.status)) {
        run.status = 'cancelled';
        run.completedAt = new Date().toISOString();
        run.error = 'Application closed before this crew finished.';
        for (const task of run.tasks) if (task.status !== 'completed') task.status = 'cancelled';
        for (const tool of run.tools)
          if (['waiting', 'approved'].includes(tool.status)) tool.status = 'cancelled';
        this.publish(run);
      }
    }
  }
  private enabled() {
    if (!this.settings().crewAIEnabled)
      throw new Error('CrewAI is disabled. Enable it in Settings first.');
  }
  private scrub<T>(value: T): T {
    return JSON.parse(this.redact(JSON.stringify(value))) as T;
  }
  private path(id: string) {
    return join(this.root, 'crewai', 'projects', `${idSchema.parse(id)}.json`);
  }
  async list() {
    const directory = join(this.root, 'crewai', 'projects');
    await mkdir(directory, { recursive: true });
    return Promise.all(
      (await readdir(directory))
        .filter((n) => n.endsWith('.json'))
        .map((n) => this.get(n.slice(0, -5))),
    );
  }
  async get(id: string) {
    return crewProjectSchema.parse(JSON.parse(await readFile(this.path(id), 'utf8')));
  }
  async save(input: CrewProject) {
    this.enabled();
    const project = crewProjectSchema.parse(input);
    project.updatedAt = new Date().toISOString();
    await atomicWrite(this.path(project.id), JSON.stringify(project, null, 2));
    return project;
  }
  async duplicate(id: string) {
    this.enabled();
    const project = await this.get(id),
      now = new Date().toISOString();
    return this.save({
      ...project,
      id: randomUUID(),
      name: `${project.name.slice(0, 190)} copy`,
      createdAt: now,
      updatedAt: now,
    });
  }
  async remove(id: string) {
    await rm(this.path(id), { force: true });
  }
  runs() {
    return this.scrub([...this.history.values()]);
  }
  private publish(run: CrewRun) {
    this.database
      .prepare(
        'INSERT INTO runs(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(run.id, JSON.stringify(this.scrub(run)));
    this.emit({ type: 'crewai', id: run.id, status: run.status });
  }
  async check(): Promise<CrewRuntime> {
    this.enabled();
    if (this.checks.size) throw new Error('A CrewAI runtime check is already running.');
    const controller = new AbortController();
    this.checks.add(controller);
    let cleaned!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      cleaned = resolve;
    });
    this.checkCleanup.add(cleanup);
    const timer = setTimeout(
      () => controller.abort(new Error('CrewAI runtime check timed out.')),
      30000,
    );
    let ready: CrewRuntime | undefined;
    let directory: string | undefined;
    try {
      await mkdir(join(this.root, 'cache'), { recursive: true });
      directory = await mkdtemp(join(this.root, 'cache', 'crewai-check-'));
      this.enabled();
      controller.signal.throwIfAborted();
      await runWorker(
        this.settings().crewAIPython,
        join(this.workerDirectory, 'worker.py'),
        directory,
        controller.signal,
        async (event) => {
          this.enabled();
          if (event.type === 'failed') throw new Error(event.error);
          if (event.type !== 'ready' || ready) throw new Error('Invalid CrewAI readiness response');
          ready = { version: event.version, python: event.python };
          return { type: 'check' };
        },
      );
      if (!ready) throw new Error('CrewAI did not report runtime readiness');
      return ready;
    } finally {
      clearTimeout(timer);
      try {
        if (directory) await rm(directory, { recursive: true, force: true });
      } finally {
        this.checks.delete(controller);
        this.checkCleanup.delete(cleanup);
        cleaned();
      }
    }
  }
  async run(raw: CrewRunInput) {
    this.enabled();
    const input = crewRunSchema.parse(raw),
      project = await this.get(input.projectId);
    this.enabled();
    if (this.active.size >= 3) throw new Error('At most three CrewAI projects may run at once.');
    const selected = new Map(
      project.agents.map((agent) => [
        agent.id,
        this.providers.capture(agent.providerId, agent.model),
      ]),
    );
    if (
      project.tasks.some((t) =>
        project.agents
          .find((a) => a.id === t.agentId)!
          .tools.some((id) => id.startsWith('filesystem.')),
      ) &&
      !input.folder
    )
      throw new Error('Select a folder for the project tools, or remove the tools.');
    const run: CrewRun = {
      id: randomUUID(),
      project: structuredClone(project),
      input: input.input,
      folder: input.folder,
      status: 'queued',
      startedAt: new Date().toISOString(),
      modelCalls: 0,
      tasks: project.tasks.map((t) => ({
        id: t.id,
        name: t.name,
        agentId: t.agentId,
        status: 'pending',
        modelCalls: 0,
      })),
      tools: [],
    };
    this.history.set(run.id, run);
    this.publish(run);
    const controller = new AbortController();
    const job = Promise.resolve().then(async () => {
      const timeout = setTimeout(
        () => controller.abort(new Error('CrewAI exceeded the 15-minute run deadline.')),
        15 * 60 * 1000,
      );
      let directory: string | undefined;
      try {
        await this.slots.withExternalSlot(controller.signal, async () => {
          this.enabled();
          controller.signal.throwIfAborted();
          await mkdir(join(this.root, 'cache'), { recursive: true });
          directory = await mkdtemp(join(this.root, 'cache', 'crewai-run-'));
          this.enabled();
          controller.signal.throwIfAborted();
          let ready = false,
            completed = false,
            cursor = 0;
          const requests = new Set<string>(),
            agentCalls = new Map<string, number>();
          const startup = setTimeout(
            () => controller.abort(new Error('CrewAI worker startup timed out.')),
            30000,
          );
          try {
            await runWorker(
              this.settings().crewAIPython,
              join(this.workerDirectory, 'worker.py'),
              directory,
              controller.signal,
              async (event, signal) => {
                this.enabled();
                signal.throwIfAborted();
                if (event.type === 'failed') throw new Error(event.error);
                if (event.type === 'ready') {
                  if (ready) throw new Error('Duplicate worker handshake');
                  ready = true;
                  clearTimeout(startup);
                  run.runtimeVersion = event.version;
                  run.status = 'running';
                  this.publish(run);
                  return {
                    type: 'start',
                    runId: run.id,
                    project: {
                      ...project,
                      customTools: project.customTools.map(
                        ({ code: _code, ...definition }) => definition,
                      ),
                    },
                    input: input.input,
                    contextSize: this.settings().contextSize,
                  };
                }
                if (!ready || completed || event.runId !== run.id)
                  throw new Error('Unexpected CrewAI event');
                if (event.type === 'completed') {
                  if (cursor !== project.tasks.length)
                    throw new Error('CrewAI completed without all task results');
                  completed = true;
                  return;
                }
                const task = run.tasks[cursor];
                if (!task || task.id !== event.nodeId)
                  throw new Error('CrewAI attempted an out-of-order task');
                const agent = project.agents.find((a) => a.id === task.agentId)!;
                task.status = 'running';
                if (event.type === 'node_completed') {
                  if (!task.modelCalls)
                    throw new Error('CrewAI returned a task without calling its model');
                  task.result = this.redact(event.result);
                  task.status = 'completed';
                  cursor++;
                  this.publish(run);
                  return;
                }
                if (requests.has(event.requestId)) throw new Error('Duplicate worker request');
                requests.add(event.requestId);
                if (requests.size > 1500) throw new Error('CrewAI request limit reached');
                if (event.type === 'model_request') {
                  const count = agentCalls.get(agent.id) ?? 0;
                  if (run.modelCalls >= project.maxModelCalls || count >= agent.maxIterations)
                    throw new Error(`Maximum model calls reached for ${agent.name} or this crew.`);
                  agentCalls.set(agent.id, count + 1);
                  task.modelCalls++;
                  run.modelCalls++;
                  run.status = 'running';
                  this.publish(run);
                  const provider = selected.get(agent.id)!;
                  let content = '';
                  for await (const chunk of provider.llm.chat({
                    model: provider.modelId,
                    messages: event.messages,
                    signal,
                  })) {
                    signal.throwIfAborted();
                    if (chunk.error) throw new Error(chunk.error);
                    if (chunk.message?.tool_calls?.length)
                      throw new Error('Unexpected native tool call from provider');
                    content += chunk.message?.content ?? '';
                    if (content.length > 200000)
                      throw new Error('Model response exceeds size limit');
                  }
                  if (!content.trim()) throw new Error('Provider returned an empty response');
                  return {
                    type: 'model_result',
                    runId: run.id,
                    requestId: event.requestId,
                    content,
                  };
                }
                if (!agent.tools.includes(event.tool))
                  throw new Error('CrewAI requested a tool not assigned to its agent');
                return {
                  type: 'tool_result',
                  runId: run.id,
                  requestId: event.requestId,
                  content: await this.executeToolCall(
                    run,
                    event.requestId,
                    task.id,
                    event.tool,
                    event.args,
                    signal,
                  ),
                };
              },
            );
          } finally {
            clearTimeout(startup);
          }
          controller.signal.throwIfAborted();
          if (!completed) throw new Error('CrewAI exited without a completed result');
          run.status = 'completed';
        });
      } catch (error) {
        run.status = controller.signal.aborted ? 'cancelled' : 'failed';
        run.error = this.redact(
          String(controller.signal.aborted ? controller.signal.reason : error),
        );
        for (const task of run.tasks) if (task.status !== 'completed') task.status = run.status;
        for (const tool of run.tools)
          if (['waiting', 'approved'].includes(tool.status))
            tool.status = run.status === 'cancelled' ? 'cancelled' : 'failed';
      } finally {
        clearTimeout(timeout);
        for (const [key, entry] of this.approvals)
          if (entry.runId === run.id) this.approvals.delete(key);
        run.completedAt = new Date().toISOString();
        this.publish(run);
        try {
          if (directory) await rm(directory, { recursive: true, force: true });
        } finally {
          this.active.delete(run.id);
        }
      }
    });
    this.active.set(run.id, { controller, job });
    return run.id;
  }
  private async executeToolCall(
    run: CrewRun,
    requestId: string,
    taskId: string,
    toolId: string,
    raw: unknown,
    signal: AbortSignal,
  ) {
    this.enabled();
    signal.throwIfAborted();
    const custom = run.project.customTools.find((t) => `custom.${t.id}` === toolId);
    let args: Record<string, unknown>;
    if (custom) args = validateCustomInput(custom, raw);
    else {
      crewBuiltinToolSchema.parse(toolId);
      if (!run.folder) throw new Error('Tool requires a selected folder');
      args =
        toolId === 'filesystem.search'
          ? z
              .object({ query: z.string().min(1).max(300) })
              .strict()
              .parse(raw)
          : z
              .object({ path: z.string().max(4096).default('.') })
              .strict()
              .parse(raw);
    }
    const call: CrewRun['tools'][number] = {
      id: requestId,
      taskId,
      tool: toolId,
      args: this.scrub(args),
      status: 'waiting',
    };
    run.tools.push(call);
    run.status = 'waiting';
    const allowed = await new Promise<boolean>((resolve, reject) => {
      const abort = () => {
        this.approvals.delete(call.id);
        reject(signal.reason);
      };
      signal.addEventListener('abort', abort, { once: true });
      this.approvals.set(call.id, {
        runId: run.id,
        resolve: (allow) => {
          signal.removeEventListener('abort', abort);
          resolve(allow);
        },
      });
      this.publish(run);
      if (signal.aborted) abort();
    });
    signal.throwIfAborted();
    this.enabled();
    run.status = 'running';
    if (!allowed) {
      call.status = 'denied';
      this.publish(run);
      return 'User denied this tool request.';
    }
    call.status = 'approved';
    this.publish(run);
    try {
      await mkdir(join(this.root, 'cache'), { recursive: true });
      call.output = this.redact(
        custom
          ? await executeCustomTool(
              this.settings().crewAIPython,
              join(this.workerDirectory, 'custom_runner.py'),
              join(this.root, 'cache'),
              custom,
              args,
              signal,
            )
          : JSON.stringify(
              await new AgentTools(this.settings).execute(
                crewBuiltinToolSchema.parse(toolId),
                args,
                run.folder!,
                signal,
                async () => false,
              ),
            ),
      ).slice(0, 200000);
      signal.throwIfAborted();
      call.status = 'completed';
    } catch (error) {
      signal.throwIfAborted();
      call.status = 'failed';
      call.output = this.redact(String(error));
    }
    this.publish(run);
    return call.output;
  }
  async testTool(raw: CrewToolTest) {
    this.enabled();
    const input = crewToolTestSchema.parse(raw),
      project = await this.get(input.projectId);
    this.enabled();
    const tool = project.customTools.find((t) => t.id === input.toolId);
    if (!tool) throw new Error('Custom tool does not exist');
    validateCustomInput(tool, input.args);
    if (this.active.size >= 3) throw new Error('At most three CrewAI projects may run at once.');
    const run: CrewRun = {
      id: randomUUID(),
      kind: 'tool-test',
      project: structuredClone(project),
      input: tool.name,
      status: 'queued',
      startedAt: new Date().toISOString(),
      modelCalls: 0,
      tasks: [],
      tools: [],
    };
    this.history.set(run.id, run);
    this.publish(run);
    const controller = new AbortController();
    const job = Promise.resolve().then(async () => {
      const timeout = setTimeout(
        () => controller.abort(new Error('Tool test exceeded the 15-minute deadline')),
        900000,
      );
      try {
        await this.slots.withExternalSlot(controller.signal, async () => {
          await this.executeToolCall(
            run,
            randomUUID(),
            tool.id,
            `custom.${tool.id}`,
            input.args,
            controller.signal,
          );
          run.status =
            run.tools[0].status === 'completed'
              ? 'completed'
              : run.tools[0].status === 'denied'
                ? 'cancelled'
                : 'failed';
        });
      } catch (error) {
        run.status = controller.signal.aborted ? 'cancelled' : 'failed';
        run.error = this.redact(String(error));
        for (const call of run.tools)
          if (['waiting', 'approved'].includes(call.status)) call.status = run.status;
      } finally {
        clearTimeout(timeout);
        for (const [key, value] of this.approvals)
          if (value.runId === run.id) this.approvals.delete(key);
        run.completedAt = new Date().toISOString();
        this.publish(run);
        this.active.delete(run.id);
      }
    });
    this.active.set(run.id, { controller, job });
    return run.id;
  }
  approve(requestId: string, allow: boolean) {
    this.enabled();
    const request = this.approvals.get(requestId);
    if (!request) throw new Error('Approval is no longer pending');
    this.approvals.delete(requestId);
    request.resolve(allow);
  }
  stop(id: string) {
    this.active.get(id)?.controller.abort(new Error('CrewAI run stopped.'));
  }
  async stopAll() {
    for (const check of this.checks)
      check.abort(new Error('CrewAI disabled or application closing.'));
    for (const id of this.active.keys()) this.stop(id);
    await Promise.allSettled(
      [...this.active.values()].map((entry) => entry.job).concat([...this.checkCleanup]),
    );
  }
  async close() {
    await this.stopAll();
    this.database.close();
  }
  async export(id: string, parent: string) {
    this.enabled();
    const project = this.scrub(await this.get(id));
    this.enabled();
    const destination = await mkdtemp(join(parent, 'crewai-project-'));
    try {
      // Copy only known, application-owned templates. Never execute an exported project in-app.
      for (const file of [
        'crew_builder.py',
        'tool_factory.py',
        'main.py',
        'custom_runner.py',
        'custom_runtime.py',
        'requirements.txt',
        'README.md',
      ])
        await copyFile(join(this.workerDirectory, file), join(destination, file));
      // Provider IDs are app-local; exported agents use explicitly supplied model configuration.
      for (const agent of project.agents) {
        agent.providerId = '';
        agent.model = '';
      }
      await atomicWrite(join(destination, 'project.json'), JSON.stringify(project, null, 2));
      await atomicWrite(
        join(destination, '.env.example'),
        'CREWAI_MODEL=openai/your-model\nOPENAI_API_KEY=\n',
      );
      await atomicWrite(join(destination, '.gitignore'), '.venv/\n.env\n__pycache__/\n');
      return destination;
    } catch (error) {
      await rm(destination, { recursive: true, force: true });
      throw error;
    }
  }
}
export { CREWAI_VERSION };
