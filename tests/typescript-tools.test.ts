import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useProviderBridge, toolReply } from './fixtures/scripted-provider';
import { AgentService } from '../src/main/services/agents/agents';
import { OllamaLLMProvider } from '../src/main/services/ollama/provider';
import { KnowledgeService } from '../src/main/services/rag/knowledge';
import { MCPService } from '../src/main/services/mcp/mcp';
import { librarySchema, settingsSchema } from '../src/shared/schemas';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generateToolSource,
  toolExamples,
  type ToolDefinition,
} from '../src/shared/tool-definition';
import {
  analyzeToolSource,
  convertToolSource,
  formatToolSource,
} from '../src/main/services/tools/typescript';
import { LibraryService } from '../src/main/services/filesystem/library';
import { toolItemFromSource } from '../src/main/services/tools/files';
import { CustomToolService } from '../src/main/services/tools/custom';
let root: string, library: LibraryService, tools: CustomToolService;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ts-tools-'));
  library = new LibraryService(root);
  tools = new CustomToolService(library, { resolve: () => '', redact: (s) => s }, () => 3000);
});
afterEach(async () => {
  tools.stopAll();
  await rm(root, { recursive: true, force: true });
});

it('generates a real LangChain calculator, round trips Builder, and invokes it', async () => {
  const source = generateToolSource(toolExamples.calculator);
  const result = analyzeToolSource(source);
  expect(result.advanced).toBe(false);
  expect(result.definition).toMatchObject({
    name: 'calculator',
    inputs: toolExamples.calculator.inputs,
  });
  await library.save('tools', toolItemFromSource(source, { id: 'calculator' }));
  expect(await tools.run('calculator', { a: 10, b: 5, operation: 'multiply' })).toBe('50');
  await expect(tools.run('calculator', { a: 10, b: 0, operation: 'divide' })).rejects.toThrow(
    'Cannot divide by zero',
  );
  await expect(tools.run('calculator', { a: 1, b: 2, operation: 'wrong' })).rejects.toThrow();
});
it('converts JSON, YAML, and simple Markdown to one executable TS format', async () => {
  const examples = [
    [
      'json',
      JSON.stringify({
        name: 'add_numbers',
        description: 'Add numbers',
        input: { a: { type: 'number', required: true }, b: { type: 'number', required: true } },
        function: 'return a + b;',
      }),
    ],
    [
      'yaml',
      'name: add_numbers\ndescription: Add numbers\ninput:\n  a:\n    type: number\n    required: true\n  b:\n    type: number\n    required: true\nfunction: return a + b;',
    ],
    [
      'markdown',
      '# Tool\n\nName: add_numbers\n\nDescription:\nAdd numbers\n\n## Input\na:\n- type: number\n- required: true\nb:\n- type: number\n- required: true\n\n## Function\nreturn a + b;',
    ],
  ] as const;
  for (const [format, raw] of examples) {
    const value = convertToolSource(raw, format);
    expect(value.source).toContain('from "langchain/tools"');
    expect(await tools.runSource(value.source, { a: 4, b: 7 })).toBe('11');
  }
});
it('validates and runs JavaScript and TypeScript lifecycle hooks', async () => {
  const typescript = `export default async function hook(context: { value: string }) {
  if (context.value !== 'typescript') throw new Error('Unexpected hook context');
}`;
  const javascript = `module.exports.default = async function(context) {
  if (context.value !== 'javascript') throw new Error('Unexpected hook context');
}`;
  await library.save('hooks', {
    ...librarySchema.parse({ id: 'typed-hook', name: 'Typed hook', hookType: 'pre' }),
    content: typescript,
  });
  await tools.runHook(typescript, { value: 'typescript' }, undefined, root);
  await tools.runHook(javascript, { value: 'javascript' }, undefined, root);
  await expect(tools.runHook(typescript, { value: 'wrong' }, undefined, root)).rejects.toThrow(
    'Unexpected hook context',
  );
  await expect(tools.runHook('export default function {', {}, undefined, root)).rejects.toThrow();
});
it('persists hook assignments on built-in agents without allowing other edits', async () => {
  const builtInRoot = join(root, 'built-ins');
  const builtIns = new LibraryService(builtInRoot);
  await builtIns.save(
    'agents',
    librarySchema.parse({ id: 'built-in-agent', name: 'Built-in agent', model: 'model' }),
  );
  await library.loadBuiltIns(builtInRoot);
  const hook = await library.save('hooks', {
    ...librarySchema.parse({ id: 'attached-hook', name: 'Attached hook', hookType: 'pre' }),
    content: 'export default async function hook() {}',
  });
  const agent = await library.get('agents', 'built-in-agent');
  await library.save('agents', { ...agent, hooks: [hook.id] });
  expect((await library.get('agents', 'built-in-agent')).hooks).toEqual([hook.id]);
  await expect(
    library.save('agents', {
      ...agent,
      hooks: [hook.id],
      content: 'Built-in instructions changed',
    }),
  ).rejects.toThrow('provider, model, and hook assignments');
});
it('supports required/optional inputs, arrays, objects, dates, enums, any, and defaults', async () => {
  const definition: ToolDefinition = {
    name: 'inputs',
    description: 'Test input schema',
    inputs: [
      { name: 'input', type: 'string', required: true },
      { name: 'optional', type: 'string', required: false },
      { name: 'list', type: 'array', required: false, defaultValue: [] },
      { name: 'options', type: 'object', required: false, defaultValue: {} },
      {
        name: 'choice',
        type: 'enum',
        required: false,
        enumValues: ['one', 'two'],
        defaultValue: 'one',
      },
      { name: 'count', type: 'number', required: false, defaultValue: 20 },
      { name: 'yes', type: 'boolean', required: false, defaultValue: false },
      { name: 'day', type: 'date', required: false },
      { name: 'anything', type: 'any', required: false },
    ],
    functionBody: 'return { input, optional, list, options, choice, count, yes, day, anything };',
  };
  const source = generateToolSource(definition);
  const analysis = analyzeToolSource(source);
  expect(analysis.definition?.inputs).toEqual(definition.inputs);
  expect(
    JSON.parse(await tools.runSource(source, { input: 'hello', day: '2026-10-03T00:00:00Z' })),
  ).toMatchObject({
    input: 'hello',
    list: [],
    options: {},
    choice: 'one',
    count: 20,
    yes: false,
    day: '2026-10-03T00:00:00.000Z',
  });
  await expect(tools.runSource(source, {})).rejects.toThrow();
  await expect(tools.runSource(source, { input: 'hello', list: 'bad' })).rejects.toThrow();
});
it('rejects invalid names, duplicate inputs, invalid schemas/defaults, imports and TS syntax', () => {
  expect(() => generateToolSource({ ...toolExamples.starter, name: 'has spaces' })).toThrow();
  expect(() =>
    generateToolSource({
      ...toolExamples.starter,
      inputs: [toolExamples.starter.inputs[0], toolExamples.starter.inputs[0]],
    }),
  ).toThrow('unique');
  expect(() =>
    generateToolSource({
      ...toolExamples.starter,
      inputs: [{ name: 'mode', type: 'enum', required: true }],
    }),
  ).toThrow();
  expect(() =>
    generateToolSource({
      ...toolExamples.starter,
      inputs: [{ name: 'count', type: 'number', required: false, defaultValue: 'wrong' }],
    }),
  ).toThrow();
  const source = generateToolSource(toolExamples.starter);
  for (const invalid of [
    source.replace('z.string()', 'z.invalid()'),
    source.replace('z.string()', 'z.number().default("bad")'),
    source.replace('langchain/tools', 'missing-tool-package'),
    source.replace('zod', './local-code'),
    source + '\nconst broken = ;',
    source.replace('"input":', '"has spaces":'),
    source.replace('"input": z.string()', '"input": z.string(), "input": z.number()'),
  ])
    expect(() => analyzeToolSource(invalid)).toThrow();
});
it('never executes code when analyzing, formatting, saving, listing or loading; preserves advanced source', async () => {
  const marker = join(root, 'executed');
  const source = `import { tool } from "langchain/tools";\nimport { z } from "zod";\nimport { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "executed");\nconst helper = (value: number) => value * 3;\nexport const advancedTool = tool(async ({ value }) => helper(value), { name: "advanced", description: "Advanced helper", schema: z.object({ value: z.number().int().positive() }) });`;
  expect(analyzeToolSource(source).advanced).toBe(true);
  formatToolSource(source);
  await library.save('tools', toolItemFromSource(source, { id: 'advanced', group: 'Examples' }));
  expect(await readdir(join(root, 'tools'))).toContain('advanced.ts');
  const file = await readFile(library.path('tools', 'advanced'), 'utf8');
  expect(file).toContain('const helper');
  expect((await library.list('tools'))[0]).toMatchObject({
    name: 'advanced',
    group: 'Examples',
    toolConfig: { type: 'langchain' },
  });
  await expect(access(marker)).rejects.toThrow();
  expect(await tools.run('advanced', { value: 4 })).toBe('12');
  expect(await readFile(marker, 'utf8')).toBe('executed');
});
it('loads existing Markdown tools and migrates them to TS while preserving stable IDs', async () => {
  await mkdir(join(root, 'tools'));
  await writeFile(
    join(root, 'tools', 'legacy.md'),
    '---\nname: Legacy tool\ndescription: Double a value\ntoolConfig:\n  type: javascript\n  parameters:\n    - name: value\n      type: number\n      required: true\n---\nreturn input.value * 2;',
  );
  const item = await library.get('tools', 'legacy');
  expect(item.id).toBe('legacy');
  expect(await tools.run('legacy', { value: 2 })).toBe('4');
  await library.save('tools', item);
  expect(await readdir(join(root, 'tools'))).toEqual(['legacy.ts']);
  expect((await library.get('tools', 'legacy')).id).toBe('legacy');
  const path = library.path('tools', 'legacy');
  const saved = await readFile(path, 'utf8');
  const start = saved.indexOf('\n') + 1;
  await writeFile(
    path,
    saved.slice(0, start) +
      saved.slice(start).replace('return input.value * 2;', 'return input.value * 3;'),
  );
  expect(await tools.run('legacy', { value: 2 })).toBe('6');
});
it('enforces disabled state, cancellation, timeout and output limits for TypeScript tools', async () => {
  const save = (body: string) =>
    library.save(
      'tools',
      toolItemFromSource(generateToolSource({ ...toolExamples.starter, functionBody: body }), {
        id: 'limits',
      }),
    );
  await save('return "a".repeat(200000);');
  await expect(tools.run('limits', { input: 'x' })).rejects.toThrow('100 KB');
  const item = await save('return input;');
  await library.save('tools', { ...item, enabled: false });
  await expect(tools.run('limits', { input: 'x' })).rejects.toThrow('Enable');
  await save('while (true) {}');
  const controller = new AbortController();
  const running = tools.run('limits', { input: 'x' }, controller.signal);
  controller.abort();
  await expect(running).rejects.toThrow();
  const fast = new CustomToolService(library, { resolve: () => '', redact: (s) => s }, () => 100);
  await expect(fast.run('limits', { input: 'x' })).rejects.toThrow();
});

it('selects a saved TypeScript tool through the existing agent approval and invocation path', async () => {
  const settings = () =>
    settingsSchema.parse({ chatModel: 'test', approvalMode: 'auto', maxIterations: 3 });
  const item = await library.save(
    'tools',
    toolItemFromSource(generateToolSource(toolExamples.calculator), { id: 'calculator' }),
  );
  expect(item.toolConfig?.inputSchema).toMatchObject({
    properties: { operation: { enum: ['add', 'subtract', 'multiply', 'divide'] } },
    required: ['a', 'b', 'operation'],
  });
  await library.save(
    'agents',
    librarySchema.parse({ id: 'math', name: 'Math', tools: ['custom:calculator'] }),
  );
  const llm = new OllamaLLMProvider(settings);
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
  vi.spyOn(llm, 'complete')
    .mockResolvedValueOnce(toolReply('custom:calculator', { a: 10, b: 5, operation: 'multiply' }))
    .mockResolvedValue({ role: 'assistant', content: '50' });
  const kb = new KnowledgeService(
    root,
    settings,
    { embed: async () => [], embedBatch: async () => [] },
    () => {},
  );
  const mcp = new MCPService(library, { resolve: () => '', redact: (s) => s }, () => {});
  let approvals = 0;
  const service = new AgentService(
    library,
    llm,
    kb,
    mcp,
    settings,
    (event) => {
      if (event.approval) {
        approvals++;
        queueMicrotask(() => service.approve(event.approval!.id, true));
      }
    },
    undefined,
    tools,
  );
  try {
    const id = await service.run({
      agentId: 'math',
      task: 'Multiply ten by five using the calculator',
    });
    await expect.poll(() => service.runs().find((run) => run.id === id)?.status).toBe('Completed');
    expect(approvals).toBe(1);
    expect(service.runs()[0].tools).toContainEqual(
      expect.objectContaining({
        toolId: 'custom:calculator',
        status: 'completed',
        output: expect.stringContaining('50'),
      }),
    );
  } finally {
    await service.stopAll();
    vi.restoreAllMocks();
  }
});
