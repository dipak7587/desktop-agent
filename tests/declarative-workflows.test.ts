import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import {
  executeDeclarative,
  resolveValue,
  workflowInputs,
  type WorkflowAdapter,
} from '../src/main/services/workflows/declarative';
import { validateDeclarative, type DeclarativeWorkflow } from '../src/shared/declarative-workflows';
import { parseWorkflow, serializeWorkflow } from '../src/shared/workflow-formats';
import { validateWorkflow, type AgentWorkflow } from '../src/shared/workflows';
const signal = () => new AbortController().signal;
const base = (): AgentWorkflow => ({
  id: 'dynamic',
  name: 'Dynamic',
  description: '',
  executionMode: 'sequential',
  agents: [],
  connections: [],
  maxDepth: 20,
  maxIterations: 100,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
const adapter = (): WorkflowAdapter => ({
  agent: vi.fn(async (_id, input) => input),
  tool: vi.fn(async (_id, input) => input),
});
const run = (definition: DeclarativeWorkflow, input = {}, runners = adapter()) =>
  executeDeclarative(definition, input, runners, { signal: signal() });
describe('declarative workflow formats and validation', () => {
  it.each(['json', 'yaml', 'md'] as const)(
    'round trips %s without losing nested hooks or typed values',
    (format) => {
      const workflow = validateWorkflow({
        ...base(),
        definition: {
          name: 'Dynamic',
          config: { defaultAgent: 'reviewer' },
          steps: [
            {
              id: 'files',
              type: 'loop',
              over: ['a', 'b'],
              as: 'file',
              hooks: {
                beforeIteration: [
                  { id: 'load', type: 'tool', tool: 'read', input: { path: '{{file}}' } },
                ],
              },
              steps: [
                {
                  type: 'agent',
                  agent: '{{workflow.config.defaultAgent}}',
                  input: '{{hooks.load.output}}',
                },
              ],
            },
          ],
        },
      });
      expect(parseWorkflow(serializeWorkflow(workflow, format), format, base()).definition).toEqual(
        {
          ...workflow.definition,
          description: '',
          maxDepth: workflow.maxDepth,
          maxIterations: workflow.maxIterations,
        },
      );
    },
  );
  it('accepts front matter and rejects ambiguous Markdown, unsafe fields, missing requirements and duplicate IDs', () => {
    expect(
      parseWorkflow(
        '---\nname: Test\nsteps:\n  - type: agent\n    agent: a\n---\nDocumentation',
        'md',
        base(),
      ).definition?.name,
    ).toBe('Test');
    expect(() => parseWorkflow('# No definition', 'md', base())).toThrow(/Markdown/);
    expect(() => validateDeclarative({ name: 'Bad', steps: [{ type: 'loop' }] })).toThrow(
      /requires/,
    );
    expect(() =>
      validateDeclarative({
        name: 'Bad',
        steps: [{ type: 'agent', agent: 'a', script: 'evil()' }],
      }),
    ).toThrow();
    expect(() =>
      validateDeclarative({
        name: 'Bad',
        steps: [
          { id: 'a', type: 'agent', agent: 'a' },
          { id: 'a', type: 'agent', agent: 'b' },
        ],
      }),
    ).toThrow(/Duplicate/);
    expect(() =>
      parseWorkflow('name: Cycle\nsteps: &s\n - type: sequence\n   steps: *s', 'yaml', base()),
    ).toThrow(/depth/);
  });
  it('applies typed defaults and rejects invalid required inputs', () => {
    const definition: DeclarativeWorkflow = {
      name: 'Typed',
      inputs: { count: { type: 'number', default: 3 }, target: { type: 'string' } },
      steps: [{ type: 'agent', agent: 'a' }],
    };
    expect(workflowInputs(definition, { target: 'project' })).toEqual({
      count: 3,
      target: 'project',
    });
    expect(() => workflowInputs(definition, {})).toThrow(/Missing/);
    expect(() => workflowInputs(definition, { target: false })).toThrow(/string/);
  });
});
it('resolves typed references, interpolation and safe expressions without executing code', () => {
  const context = {
    steps: {},
    hooks: {},
    input: { number: 3, text: 'hello world', object: { ok: true } },
  };
  expect(resolveValue('{{input.object}}', context)).toEqual({ ok: true });
  expect(resolveValue('Count {{input.number}}', context)).toBe('Count 3');
  expect(
    resolveValue('{{input.number >= 3 && (input.text == "hello world" || false)}}', context),
  ).toBe(true);
  expect(() => resolveValue('{{input.constructor}}', context)).toThrow();
  expect(() => resolveValue('{{process.exit()}}', context)).toThrow();
  expect(() => resolveValue('{{input.missing}}', context)).toThrow(/Unresolved/);
  expect(() => resolveValue('{{input.number + 2}}', context)).toThrow(/Invalid/);
});
it('runs the nested governance example with isolated variables and inherited hooks', async () => {
  const calls: unknown[] = [];
  const runners: WorkflowAdapter = {
    agent: async (id, input) => {
      calls.push([id, input]);
      return input;
    },
    tool: async (id, input) => ({ id, input }),
  };
  const definition: DeclarativeWorkflow = {
    name: 'Governance',
    agents: { reviewer: 'review-agent' },
    tools: { read: 'read-file' },
    hooks: { preWorkflow: [{ id: 'setup', type: 'tool', tool: '{{tools.read}}', input: 'setup' }] },
    steps: [
      {
        id: 'files',
        type: 'loop',
        over: '{{input.files}}',
        as: 'file',
        mode: 'parallel',
        maxConcurrency: 2,
        hooks: {
          beforeIteration: [
            { id: 'load', type: 'tool', tool: '{{tools.read}}', input: '{{file}}' },
          ],
        },
        steps: [
          {
            type: 'loop',
            over: ['security', 'style'],
            as: 'rule',
            steps: [
              {
                type: 'agent',
                agent: '{{agents.reviewer}}',
                input: {
                  file: '{{hooks.load.output.input}}',
                  rule: '{{rule}}',
                  setup: '{{hooks.setup.output.input}}',
                },
              },
            ],
          },
        ],
      },
      { type: 'agent', agent: 'reporter', input: '{{steps.files.output}}' },
    ],
  };
  const output = await run(definition, { files: ['a.ts', 'b.ts'] }, runners);
  expect(calls.slice(0, 4)).toEqual(
    expect.arrayContaining(
      ['a.ts', 'b.ts'].flatMap((file) =>
        ['security', 'style'].map((rule) => ['review-agent', { file, rule, setup: 'setup' }]),
      ),
    ),
  );
  expect(output).toHaveLength(2);
});
it('joins parallel branches in source order and bounds concurrent loop work', async () => {
  let active = 0,
    maximum = 0;
  const runners: WorkflowAdapter = {
    ...adapter(),
    agent: async (_id, input) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return input;
    },
  };
  const output = await run(
    {
      name: 'Parallel',
      steps: [
        {
          id: 'loop',
          type: 'loop',
          over: [1, 2, 3, 4],
          as: 'item',
          mode: 'parallel',
          maxConcurrency: 2,
          steps: [{ type: 'agent', agent: 'a', input: '{{item}}' }],
        },
        {
          type: 'parallel',
          steps: [
            { id: 'one', type: 'agent', agent: 'a', input: '{{steps.loop.output}}' },
            { id: 'two', type: 'agent', agent: 'b', input: 2 },
          ],
        },
      ],
    },
    {},
    runners,
  );
  expect(maximum).toBe(2);
  expect(output).toEqual([[[1], [2], [3], [4]], 2]);
});
it('routes conditions and switches, retries failures, and executes lifecycle hooks', async () => {
  const calls: string[] = [];
  let attempt = 0;
  const runners: WorkflowAdapter = {
    ...adapter(),
    tool: async (id) => {
      calls.push(id);
      if (id === 'flaky' && ++attempt < 2) throw new Error('temporary');
      return id;
    },
  };
  const hook = (tool: string) => [{ type: 'tool' as const, tool }];
  await run(
    {
      name: 'Routing',
      hooks: { preWorkflow: hook('start'), postWorkflow: hook('end') },
      steps: [
        {
          type: 'condition',
          if: '{{input.enabled == true}}',
          then: [
            {
              type: 'switch',
              value: '{{input.kind}}',
              cases: {
                ts: [
                  {
                    type: 'tool',
                    tool: 'flaky',
                    retry: { maxAttempts: 3, on: ['tool_error'] },
                    hooks: {
                      before: hook('pre'),
                      after: hook('post'),
                      success: hook('success'),
                      error: hook('error'),
                    },
                  },
                ],
                default: hook('default'),
              },
            },
          ],
          else: hook('no'),
        },
      ],
    },
    { enabled: true, kind: 'ts' },
    runners,
  );
  expect(calls).toEqual(['start', 'pre', 'flaky', 'flaky', 'post', 'success', 'end']);
});
it('bounds repeat loops and stops after the until expression passes', async () => {
  let iteration = 0;
  const runners = { ...adapter(), tool: async () => ({ passed: ++iteration >= 2 }) };
  const definition: DeclarativeWorkflow = {
    name: 'Repeat',
    steps: [
      {
        type: 'repeat',
        maxIterations: 3,
        until: '{{steps.check.output.passed == true}}',
        steps: [{ id: 'check', type: 'tool', tool: 'test' }],
      },
    ],
  };
  await run(definition, {}, runners);
  expect(iteration).toBe(2);
  await expect(
    run(definition, {}, { ...adapter(), tool: async () => ({ passed: false }) }),
  ).rejects.toThrow(/maxIterations/);
});
it('runs error hooks and skips downstream steps on failure', async () => {
  const calls: string[] = [];
  const runners = {
    ...adapter(),
    tool: async (id: string, input: unknown) => {
      calls.push(id);
      if (id === 'fail') throw new Error('broken');
      return input;
    },
  };
  await expect(
    run(
      {
        name: 'Errors',
        hooks: { onError: [{ type: 'tool', tool: 'root-error', input: '{{error.message}}' }] },
        steps: [
          { type: 'tool', tool: 'fail', hooks: { error: [{ type: 'tool', tool: 'step-error' }] } },
          { type: 'tool', tool: 'never' },
        ],
      },
      {},
      runners,
    ),
  ).rejects.toThrow('broken');
  expect(calls).toEqual(['fail', 'step-error', 'root-error']);
});
it('cancels retry delays and enforces a shared execution budget', async () => {
  const controller = new AbortController();
  const runners = {
    ...adapter(),
    tool: async () => {
      queueMicrotask(() => controller.abort());
      throw new Error('failure');
    },
  };
  await expect(
    executeDeclarative(
      {
        name: 'Cancel',
        steps: [{ type: 'tool', tool: 'fail', retry: { maxAttempts: 3, delayMs: 60000 } }],
      },
      {},
      runners,
      { signal: controller.signal },
    ),
  ).rejects.toThrow();
  await expect(
    executeDeclarative(
      {
        name: 'Budget',
        steps: [
          { type: 'loop', over: [1, 2, 3], as: 'item', steps: [{ type: 'agent', agent: 'a' }] },
        ],
      },
      {},
      adapter(),
      { signal: signal(), maxExecutions: 3 },
    ),
  ).rejects.toThrow(/executions/);
});

it('imports the complete governance example in every file format and executes its hooks', async () => {
  let expected: unknown;
  for (const format of ['yaml', 'json', 'md'] as const) {
    const text = await readFile(
      new URL(`../examples/governance-review/workflow.${format}`, import.meta.url),
      'utf8',
    );
    const workflow = parseWorkflow(text, format, base());
    if (expected) expect(workflow.definition).toEqual(expected);
    expected = workflow.definition;
    const saved: unknown[] = [];
    const output = await executeDeclarative(
      workflow.definition!,
      { target: 'repository' },
      {
        agent: async (id) =>
          id === 'change-detector'
            ? { files: [{ path: 'a.ts' }] }
            : id === 'rule-selector'
              ? { relevantRules: [{ path: 'rule.md' }] }
              : id === 'reporter'
                ? 'Final report'
                : 'Reviewed',
        tool: async (id, input) => {
          if (id === 'filesystem.write') saved.push(input);
          return id === 'custom:list-governance-files' ? [{ path: 'rule.md' }] : 'contents';
        },
      },
      { signal: signal() },
    );
    expect(output).toBe('Final report');
    expect(saved).toEqual([{ path: 'governance-review.md', content: 'Final report' }]);
  }
});
