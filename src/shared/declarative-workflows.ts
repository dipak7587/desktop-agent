import { z } from 'zod';

const safeKey = z
  .string()
  .regex(/^[a-zA-Z_][\w-]*$/)
  .refine((v) => !['__proto__', 'prototype', 'constructor'].includes(v), 'Unsafe identifier');
export const hookNames = [
  'before',
  'after',
  'pre',
  'post',
  'success',
  'error',
  'preStep',
  'postStep',
  'onSuccess',
  'onError',
  'preWorkflow',
  'postWorkflow',
  'beforeLoop',
  'afterLoop',
  'beforeIteration',
  'afterIteration',
] as const;
export type HookName = (typeof hookNames)[number];
export interface WorkflowStep {
  id?: string;
  type: 'agent' | 'tool' | 'sequence' | 'parallel' | 'loop' | 'condition' | 'switch' | 'repeat';
  agent?: string;
  tool?: string;
  input?: unknown;
  steps?: WorkflowStep[];
  over?: unknown;
  as?: string;
  mode?: 'sequential' | 'parallel';
  maxConcurrency?: number;
  if?: unknown;
  then?: WorkflowStep[];
  else?: WorkflowStep[];
  value?: unknown;
  cases?: Record<string, WorkflowStep[]>;
  until?: unknown;
  maxIterations?: number;
  retry?: { maxAttempts: number; delayMs?: number; on?: string[] };
  hooks?: Partial<Record<HookName, WorkflowStep[]>>;
}
export const stepSchema: z.ZodType<WorkflowStep> = z.lazy(() =>
  z
    .object({
      id: safeKey.optional(),
      type: z.enum([
        'agent',
        'tool',
        'sequence',
        'parallel',
        'loop',
        'condition',
        'switch',
        'repeat',
      ]),
      agent: z.string().min(1).optional(),
      tool: z.string().min(1).optional(),
      input: z.unknown().optional(),
      steps: z.array(stepSchema).max(100).optional(),
      over: z.unknown().optional(),
      as: safeKey.optional(),
      mode: z.enum(['sequential', 'parallel']).optional(),
      maxConcurrency: z.number().int().min(1).max(32).optional(),
      if: z.unknown().optional(),
      then: z.array(stepSchema).max(100).optional(),
      else: z.array(stepSchema).max(100).optional(),
      value: z.unknown().optional(),
      cases: z.record(safeKey, z.array(stepSchema).max(100)).optional(),
      until: z.unknown().optional(),
      maxIterations: z.number().int().min(1).max(100).optional(),
      retry: z
        .object({
          maxAttempts: z.number().int().min(1).max(10),
          delayMs: z.number().int().min(0).max(60000).optional(),
          on: z.array(z.enum(['timeout', 'tool_error', 'invalid_output'])).optional(),
        })
        .strict()
        .optional(),
      hooks: z.partialRecord(z.enum(hookNames), z.array(stepSchema).max(100)).optional(),
    })
    .strict()
    .superRefine((step, ctx) => {
      const required: Record<string, string[]> = {
        agent: ['agent'],
        tool: ['tool'],
        sequence: ['steps'],
        parallel: ['steps'],
        loop: ['over', 'as', 'steps'],
        condition: ['if', 'then'],
        switch: ['value', 'cases'],
        repeat: ['until', 'steps', 'maxIterations'],
      };
      for (const field of required[step.type])
        if ((step as Record<string, unknown>)[field] === undefined)
          ctx.addIssue({
            code: 'custom',
            path: [field],
            message: `${step.type} requires ${field}`,
          });
    }),
);
export const declarativeSchema = z
  .object({
    name: z.string().min(1).max(200),
    maxDepth: z.number().int().min(1).max(100).optional(),
    maxIterations: z.number().int().min(1).max(100).optional(),
    description: z.string().max(2000).optional(),
    inputs: z
      .record(
        safeKey,
        z
          .object({
            type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
            default: z.unknown().optional(),
            required: z.boolean().optional(),
            description: z.string().optional(),
          })
          .strict(),
      )
      .optional(),
    agents: z.record(safeKey, z.string()).optional(),
    tools: z.record(safeKey, z.string()).optional(),
    config: z.record(safeKey, z.unknown()).optional(),
    hooks: z.partialRecord(z.enum(hookNames), z.array(stepSchema).max(100)).optional(),
    steps: z.array(stepSchema).min(1).max(100),
  })
  .strict();
export type DeclarativeWorkflow = z.infer<typeof declarativeSchema>;

export function validateDeclarative(
  value: unknown,
  maxDepth = 20,
  draft = false,
): DeclarativeWorkflow {
  // Bound raw nesting before recursive schema parsing.
  const bound = (v: unknown, depth: number) => {
    if (depth > maxDepth * 4 + 10) throw new Error('Workflow exceeds maximum depth');
    if (v && typeof v === 'object')
      for (const [key, child] of Object.entries(v)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key))
          throw new Error('Unsafe workflow property');
        bound(child, depth + 1);
      }
  };
  bound(value, 0);
  const definition = (
    draft
      ? declarativeSchema.extend({ name: z.string().max(200), steps: z.array(stepSchema).max(100) })
      : declarativeSchema
  ).parse(value);
  const visit = (steps: WorkflowStep[], depth: number) => {
    if (depth > maxDepth) throw new Error('Workflow exceeds maximum depth');
    const ids = new Set<string>();
    for (const step of steps) {
      if (step.id && ids.has(step.id)) throw new Error(`Duplicate step ID: ${step.id}`);
      if (step.id) ids.add(step.id);
      for (const children of [
        step.steps,
        step.then,
        step.else,
        ...Object.values(step.cases ?? {}),
        ...Object.values(step.hooks ?? {}),
      ])
        if (children) visit(children, depth + 1);
    }
  };
  visit(definition.steps, 1);
  for (const steps of Object.values(definition.hooks ?? {})) visit(steps, 1);
  return definition;
}
