import { z } from 'zod';
export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const kindSchema = z.enum(['skills', 'saved-text', 'agents', 'mcp', 'tools']);
const text = z.string().max(2_000_000);
export const settingsSchema = z
  .object({
    appName: z.string().trim().min(1).max(80).default('LocalAI Workspace'),
    theme: z.enum(['system', 'dark', 'light']).default('system'),
    ollamaUrl: z
      .url()
      .refine((v) => {
        const u = new URL(v);
        return (
          ['http:', 'https:'].includes(u.protocol) &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash
        );
      }, 'Use an HTTP(S) URL without credentials')
      .default('http://127.0.0.1:11434'),
    chatModel: z.string().max(200).default(''),
    embeddingModel: z.string().max(200).default(''),
    temperature: z.number().min(0).max(2).default(0.7),
    contextSize: z.number().int().min(1024).max(131072).default(8192),
    topK: z.number().int().min(1).max(30).default(5),
    chunkSize: z.number().int().min(200).max(8000).default(1600),
    chunkOverlap: z.number().int().min(0).max(2000).default(200),
    ignorePatterns: z.array(z.string().max(300)).max(100).default([]),
    approvalMode: z.enum(['ask', 'safe', 'auto']).default('ask'),
    commandTimeout: z.number().int().min(1000).max(300000).default(60000),
    maxIterations: z.number().int().min(1).max(50).default(15),
    language: z.literal('en').default('en'),
    startAtLogin: z.boolean().default(false),
    defaultAgent: z.string().default(''),
  })
  .refine((v) => v.chunkOverlap < v.chunkSize, 'Chunk overlap must be smaller than chunk size');
export const capabilityConfigSchema = z.object({
  mode: z.enum(['auto', 'selected', 'none']).default('selected'),
  skills: z.array(idSchema).max(100).default([]),
  mcpServers: z.array(idSchema).max(100).default([]),
  tools: z.array(z.string().max(300)).max(200).default([]),
  knowledgeBases: z.array(z.string().max(200)).max(100).default([]),
  allowSkills: z.boolean().default(true),
  allowMCP: z.boolean().default(true),
  allowTools: z.boolean().default(true),
  allowKnowledgeBase: z.boolean().default(true),
  permissions: z.record(z.string().max(300), z.enum(['always_allow', 'ask', 'deny'])).default({}),
  trace: z.boolean().default(false),
});
export const librarySchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).default(''),
  content: text.default(''),
  version: z.string().max(80).default('1.0.0'),
  enabled: z.boolean().default(true),
  createdAt: z.number().default(0),
  updatedAt: z.number().default(0),
  model: z.string().max(200).default(''),
  skills: z.array(idSchema).max(100).default([]),
  tools: z.array(z.string().max(300)).max(200).default([]),
  knowledgeSources: z.array(z.string().max(200)).max(100).default([]),
  autoStart: z.boolean().default(false),
  maxIterations: z.number().int().min(1).max(50).optional(),
  capabilityConfig: capabilityConfigSchema.optional(),
  toolConfig: z
    .object({
      type: z.enum(['javascript', 'api']),
      parameters: z
        .array(
          z.object({
            name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
            type: z.enum(['string', 'number', 'boolean', 'object', 'array']),
            required: z.boolean().default(false),
          }),
        )
        .max(100)
        .refine(
          (p) => new Set(p.map((v) => v.name)).size === p.length,
          'Parameter names must be unique',
        ),
      url: z.string().max(4096).default(''),
      method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
      headers: z.record(z.string().max(200), z.string().max(2000)).default({}),
    })
    .optional(),
  command: z.string().max(500).default(''),
  args: z.array(z.string().max(2000)).max(100).default([]),
  env: z
    .record(
      z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
      z
        .string()
        .regex(
          /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/,
          'Environment values must be references such as ${GITHUB_TOKEN}',
        ),
    )
    .default({}),
});
export const sendSchema = z.object({
  id: idSchema,
  text: text,
  model: z.string().min(1).max(200),
  knowledge: z.string().max(200),
  regenerate: z.boolean().optional(),
  command: z
    .object({
      kind: z.enum(['skills', 'agent', 'mcp']),
      id: idSchema,
      project: z.string().max(4096).optional(),
    })
    .optional(),
});
export const sourceInputSchema = z.object({
  type: z.enum(['file', 'folder', 'url']),
  url: z.url().optional(),
  collection: z.string().max(100).optional(),
});
export const runInputSchema = z.object({
  agentId: idSchema,
  task: z.string().min(1).max(50000),
  project: z.string().max(4096).optional(),
});
