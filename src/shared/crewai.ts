import { z } from 'zod';
import { idSchema } from './schemas';

export const crewTools = [
  {
    id: 'filesystem.read',
    name: 'Read file',
    description: 'Read a text file inside the selected folder.',
  },
  {
    id: 'filesystem.list',
    name: 'List files',
    description: 'List a directory inside the selected folder.',
  },
  {
    id: 'filesystem.search',
    name: 'Search text',
    description: 'Find text in files inside the selected folder.',
  },
] as const;
export const crewBuiltinToolSchema = z.enum([
  'filesystem.read',
  'filesystem.list',
  'filesystem.search',
]);
export const crewToolSchema = z.union([
  crewBuiltinToolSchema,
  z.string().regex(/^custom\.[A-Za-z0-9_-]{1,100}$/),
]);
export const crewCustomToolSchema = z.object({
  id: idSchema,
  name: z
    .string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/, 'Use a tool name with letters, numbers and underscores'),
  description: z.string().trim().min(1).max(2000),
  inputs: z
    .array(
      z.object({
        name: z
          .string()
          .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/)
          .refine((name) => !name.startsWith('model_'), 'Input names cannot start with model_'),
        type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
        description: z.string().max(1000).default(''),
        required: z.boolean().default(true),
      }),
    )
    .max(30)
    .refine(
      (inputs) => new Set(inputs.map((i) => i.name)).size === inputs.length,
      'Input names must be unique',
    ),
  code: z.string().trim().min(1).max(50000),
  timeoutSeconds: z.number().int().min(1).max(120).default(30),
});
export type CrewCustomTool = z.infer<typeof crewCustomToolSchema>;
export function validateCustomInput(tool: CrewCustomTool, input: unknown): Record<string, unknown> {
  const types = {
    string: z.string(),
    number: z.number().finite(),
    boolean: z.boolean(),
    object: z.record(z.string(), z.unknown()),
    array: z.array(z.unknown()),
  };
  const fields = Object.fromEntries(
    tool.inputs.map((field) => [
      field.name,
      field.required ? types[field.type] : types[field.type].optional(),
    ]),
  );
  const result = z.object(fields).strict().parse(input);
  if (JSON.stringify(result).length > 100000)
    throw new Error('Tool input exceeds 100,000 characters');
  return result;
}
export const crewToolTestSchema = z.object({
  projectId: idSchema,
  toolId: idSchema,
  args: z.record(z.string(), z.unknown()),
});
export type CrewToolTest = z.infer<typeof crewToolTestSchema>;
export function newCrewCustomTool(): CrewCustomTool {
  return {
    id: crypto.randomUUID(),
    name: 'count_words',
    description: 'Count the words in the supplied text.',
    inputs: [{ name: 'text', type: 'string', description: 'Text to count', required: true }],
    code: 'def run(input):\n    return {"words": len(input["text"].split())}',
    timeoutSeconds: 30,
  };
}

export type CrewTool = z.infer<typeof crewToolSchema>;
export const crewAgentSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(200),
  role: z.string().trim().min(1).max(2000),
  goal: z.string().trim().min(1).max(10000),
  backstory: z.string().max(20000).default(''),
  providerId: z.string().max(200).default(''),
  model: z.string().max(200).default(''),
  maxIterations: z.number().int().min(1).max(500).default(15),
  tools: z
    .array(crewToolSchema)
    .max(33)
    .refine((tools) => new Set(tools).size === tools.length, 'Tool assignments must be unique')
    .default([]),
});
export const crewProjectSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    id: idSchema,
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000).default(''),
    customTools: z.array(crewCustomToolSchema).max(30).default([]),
    process: z.literal('sequential').default('sequential'),
    agents: z.array(crewAgentSchema).min(1).max(20),
    tasks: z
      .array(
        z.object({
          id: idSchema,
          name: z.string().trim().min(1).max(200),
          agentId: idSchema,
          description: z.string().trim().min(1).max(20000),
          expectedOutput: z.string().trim().min(1).max(10000),
          context: z.array(idSchema).max(50).default([]),
        }),
      )
      .min(1)
      .max(50),
    maxModelCalls: z.number().int().min(1).max(500).default(100),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .superRefine((project, ctx) => {
    const customIds = new Set(project.customTools.map((tool) => `custom.${tool.id}`));
    const names = project.customTools.map((tool) => tool.name.toLowerCase());
    if (
      customIds.size !== project.customTools.length ||
      new Set(names).size !== names.length ||
      names.some((name) =>
        ['read_project_file', 'list_project_files', 'search_project_text'].includes(name),
      )
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Custom tool IDs and names must be unique and cannot use built-in names',
      });
    for (const agent of project.agents)
      for (const tool of agent.tools)
        if (tool.startsWith('custom.') && !customIds.has(tool))
          ctx.addIssue({
            code: 'custom',
            message: `${agent.name}: assigned custom tool is missing`,
          });
    const agents = new Set(project.agents.map((a) => a.id));
    if (agents.size !== project.agents.length)
      ctx.addIssue({ code: 'custom', message: 'Agent IDs must be unique' });
    const seen = new Set<string>();
    for (const task of project.tasks) {
      if (!agents.has(task.agentId))
        ctx.addIssue({ code: 'custom', message: `Assign an existing agent to ${task.name}` });
      if (seen.has(task.id)) ctx.addIssue({ code: 'custom', message: 'Task IDs must be unique' });
      if (
        new Set(task.context).size !== task.context.length ||
        task.context.some((id) => !seen.has(id))
      )
        ctx.addIssue({
          code: 'custom',
          message: `${task.name}: context must refer to earlier tasks only`,
        });
      seen.add(task.id);
    }
  });
export type CrewProject = z.infer<typeof crewProjectSchema>;
export type CrewAgent = z.infer<typeof crewAgentSchema>;
export const crewRunSchema = z.object({
  projectId: idSchema,
  input: z.string().max(20000).default(''),
  folder: z.string().max(4096).optional(),
});
export type CrewRunInput = z.infer<typeof crewRunSchema>;
export interface CrewRun {
  id: string;
  kind?: 'crew' | 'tool-test';
  project: CrewProject;
  input: string;
  folder?: string;
  status: 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt?: string;
  runtimeVersion?: string;
  modelCalls: number;
  error?: string;
  tasks: {
    id: string;
    name: string;
    agentId: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    modelCalls: number;
    result?: string;
  }[];
  tools: {
    id: string;
    taskId: string;
    tool: CrewTool;
    args: Record<string, unknown>;
    status: 'waiting' | 'approved' | 'denied' | 'completed' | 'failed' | 'cancelled';
    output?: string;
  }[];
}
export interface CrewRuntime {
  version: string;
  python: string;
}
export function newCrewProject(providerId = '', model = ''): CrewProject {
  const now = new Date().toISOString(),
    first = crypto.randomUUID(),
    second = crypto.randomUUID(),
    task = crypto.randomUUID();
  return {
    schemaVersion: 1,
    customTools: [],
    id: crypto.randomUUID(),
    name: 'My crew',
    description: '',
    process: 'sequential',
    agents: [
      {
        id: first,
        name: 'Analyst',
        role: 'Analyst',
        goal: 'Analyze the input and identify the key points.',
        backstory: 'Be precise and distinguish evidence from assumptions.',
        providerId,
        model,
        maxIterations: 15,
        tools: [],
      },
      {
        id: second,
        name: 'Writer',
        role: 'Writer',
        goal: 'Turn the analysis into a clear final report.',
        backstory: 'Write concise, well-supported reports.',
        providerId,
        model,
        maxIterations: 15,
        tools: [],
      },
    ],
    tasks: [
      {
        id: task,
        name: 'Analyze',
        agentId: first,
        description: 'Analyze the provided input.',
        expectedOutput: 'Key findings with supporting explanations.',
        context: [],
      },
      {
        id: crypto.randomUUID(),
        name: 'Write report',
        agentId: second,
        description: 'Write a report using the analysis.',
        expectedOutput: 'A concise Markdown report.',
        context: [task],
      },
    ],
    maxModelCalls: 100,
    createdAt: now,
    updatedAt: now,
  };
}
