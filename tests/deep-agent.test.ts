import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentTools } from '../src/main/services/agents/tools';
import { DeepAgentEngine } from '../src/main/services/ai/deep-agents';
import { settingsSchema } from '../src/shared/schemas';
import { librarySchema } from '../src/shared/schemas';
import type { LLMProvider, ChatChunk } from '../src/main/services/ollama/provider';
import { ToolMessage } from '@langchain/core/messages';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

const agent = () =>
  librarySchema.parse({
    id: 'reviewer',
    name: 'Reviewer',
    model: 'test-model',
    content: 'Inspect the workspace and finish with a summary.',
    tools: ['filesystem.read'],
  });

function scriptedLLM(script: { name: string; args: Record<string, unknown> }[]) {
  let turn = 0;
  return {
    chat: async function* (request: { messages: { content: unknown }[] }) {
      const last = request.messages.at(-1);
      if (last instanceof ToolMessage || turn >= script.length) {
        yield {
          message: { content: `{"final":"Done. Verified workspace contents."}` },
        } as ChatChunk;
        return;
      }
      const action = script[turn];
      turn += 1;
      yield {
        message: {
          content: '',
          tool_calls: [{ function: { name: action.name, arguments: action.args } }],
        },
      } as ChatChunk;
    },
  } as unknown as LLMProvider;
}

it('deep agent reads a workspace file through the existing AgentTools layer and finishes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepagent-'));
  roots.push(root);
  const workspace = join(root, 'project');
  await mkdir(workspace);
  await writeFile(join(workspace, 'notes.md'), '# Notes\nDeep agents run locally.');
  const emit = vi.fn();
  const engine = new DeepAgentEngine(
    scriptedLLM([{ name: 'filesystem_read', args: { path: 'notes.md' } }]),
    new AgentTools(() => settingsSchema.parse({})),
    () => settingsSchema.parse({}),
  );
  const result = await engine.run({
    agent: agent(),
    task: 'Summarize notes.md',
    project: workspace,
    threadId: `t-${Date.now()}`,
    signal: new AbortController().signal,
    approve: async () => true,
    emit,
  });
  expect(result.output).toContain('Done');
  const planning = emit.mock.calls
    .map((call) => call[0] as { content?: string })
    .some((event) => event.content?.includes('Deep agent'));
  expect(planning).toBe(true);
});

it('sensitive deep agent tools pause on the existing approval flow and rejection blocks the write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deepagent-'));
  roots.push(root);
  const workspace = join(root, 'project');
  await mkdir(workspace);
  const approvals: string[] = [];
  const engine = new DeepAgentEngine(
    scriptedLLM([
      { name: 'filesystem_write', args: { path: 'new.md', content: 'hello', expectedHash: 'missing' } },
    ]),
    new AgentTools(() => settingsSchema.parse({})),
    () => settingsSchema.parse({}),
  );
  const result = await engine.run({
    agent: agent(),
    task: 'Create new.md',
    project: workspace,
    threadId: `t-${Date.now()}`,
    signal: new AbortController().signal,
    approve: async (tool, description) => {
      approvals.push(`${tool}: ${description.slice(0, 40)}`);
      return false;
    },
    emit: () => {},
  });
  expect(approvals.join('\n')).toContain('filesystem.write');
  await expect(readFile(join(workspace, 'new.md'), 'utf8')).rejects.toThrow();
  expect(result.output).toContain('Done');
});
