import { z } from 'zod';
import { idSchema } from './schemas';

export const workflowSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).default(''),
  executionMode: z.enum(['sequential', 'parallel', 'mixed']),
  agents: z
    .array(
      z.object({
        id: idSchema,
        agentId: idSchema,
        name: z.string().trim().min(1).max(200),
        prompt: z.string().max(20000).default(''),
        position: z.object({ x: z.number().finite(), y: z.number().finite() }).optional(),
      }),
    )
    .min(1)
    .max(100),
  connections: z
    .array(
      z.object({
        from: idSchema,
        to: idSchema,
        mode: z.enum(['sequential', 'parallel']),
        inputMapping: z
          .object({
            sourceOutput: z.string().max(200).default('result'),
            targetInput: z.enum(['previousAgentOutput', 'prompt']).default('previousAgentOutput'),
          })
          .optional(),
      }),
    )
    .max(1000),
  maxDepth: z.number().int().min(1).max(100).default(20),
  maxIterations: z.number().int().min(1).max(100).default(100),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AgentWorkflow = z.infer<typeof workflowSchema>;
export type WorkflowStatus =
  'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
export interface WorkflowNodeRun {
  nodeId: string;
  agentId: string;
  agentName: string;
  status: WorkflowStatus;
  runId?: string;
  result?: unknown;
  error?: string;
  iterationsUsed: number;
}
export interface WorkflowRun {
  id: string;
  workflow: AgentWorkflow;
  status: WorkflowStatus;
  nodes: WorkflowNodeRun[];
  task: string;
  folderPath?: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
}
export const workflowRunInputSchema = z.object({
  workflowId: idSchema,
  task: z.string().max(20000).default(''),
  project: z.string().max(4096).optional(),
});
export type WorkflowRunInput = z.infer<typeof workflowRunInputSchema>;

export function workflowEdges(workflow: AgentWorkflow) {
  if (workflow.executionMode === 'parallel') return [];
  if (workflow.executionMode === 'sequential')
    return workflow.agents.slice(1).map((node, i) => ({
      from: workflow.agents[i].id,
      to: node.id,
      mode: 'sequential' as const,
      inputMapping: workflow.connections.find(
        (c) => c.from === workflow.agents[i].id && c.to === node.id,
      )?.inputMapping,
    }));
  return workflow.connections;
}
export function validateWorkflow(input: unknown): AgentWorkflow {
  const workflow = workflowSchema.parse(input);
  const nodes = new Map(workflow.agents.map((n) => [n.id, n]));
  if (nodes.size !== workflow.agents.length) throw new Error('Workflow node IDs must be unique.');
  const pairs = new Set<string>();
  for (const edge of workflow.connections) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to))
      throw new Error('Connection references a missing agent node.');
    const key = `${edge.from}:${edge.to}`;
    if (pairs.has(key)) throw new Error('Duplicate workflow connection.');
    pairs.add(key);
    const path = edge.inputMapping?.sourceOutput ?? 'result';
    if (
      !/^result(?:\.[\w-]+)*$/.test(path) ||
      path.split('.').some((p) => ['__proto__', 'prototype', 'constructor'].includes(p))
    )
      throw new Error('Source output must be result or a safe dotted path such as result.issues.');
  }
  // Validate stored edges too, even when a preset execution mode is selected.
  const check = (edges: AgentWorkflow['connections']) => {
    const visiting: string[] = [],
      depths = new Map<string, number>();
    const visit = (id: string): number => {
      if (visiting.includes(id))
        throw new Error(
          `Circular Agent dependency detected: ${[...visiting.slice(visiting.indexOf(id)), id].map((key) => nodes.get(key)!.name).join(' → ')}`,
        );
      if (depths.has(id)) return depths.get(id)!;
      visiting.push(id);
      const depth = 1 + Math.max(0, ...edges.filter((e) => e.to === id).map((e) => visit(e.from)));
      visiting.pop();
      depths.set(id, depth);
      if (depth > workflow.maxDepth)
        throw new Error(`Workflow exceeds maximum depth (${workflow.maxDepth}).`);
      return depth;
    };
    for (const id of nodes.keys()) visit(id);
  };
  check(workflow.connections);
  check(workflowEdges(workflow));
  if (workflow.agents.length > workflow.maxIterations)
    throw new Error('Workflow exceeds maximum agent executions.');
  return workflow;
}

export function mappedOutput(result: unknown, path = 'result'): unknown {
  let value = result;
  for (const key of path.split('.').slice(1)) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key))
      throw new Error(`Output mapping ${path} was not found.`);
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}
