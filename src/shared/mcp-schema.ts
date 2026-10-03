import { z } from 'zod';

const text = z.string().refine((v) => !v.includes('\0'), 'Null bytes are not allowed');
const strings = z.record(z.string(), text);
export const mcpServerConfigSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000).optional(),
    enabled: z.boolean(),
    transport: z.enum(['stdio', 'streamable-http']),
    connection: z.discriminatedUnion('type', [
      z
        .object({
          type: z.literal('stdio'),
          command: text,
          args: z.array(text).optional(),
          cwd: text.optional(),
          env: strings.optional(),
        })
        .strict(),
      z
        .object({
          type: z.literal('streamable-http'),
          url: z
            .string()
            .url()
            .refine((v) => {
              const u = new URL(v);
              return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password;
            }, 'Use an HTTP(S) URL without credentials'),
          headers: strings.optional(),
        })
        .strict(),
    ]),
    capabilities: z
      .object({
        tools: z.boolean().optional(),
        resources: z.boolean().optional(),
        prompts: z.boolean().optional(),
        logging: z.boolean().optional(),
      })
      .strict()
      .optional(),
    permissions: z
      .object({
        allowRead: z.boolean().optional(),
        allowWrite: z.boolean().optional(),
        allowNetwork: z.boolean().optional(),
        allowExecute: z.boolean().optional(),
        requireApprovalForWrite: z.boolean().optional(),
        requireApprovalForExecute: z.boolean().optional(),
      })
      .strict()
      .optional(),
    metadata: z
      .object({
        version: z.string().optional(),
        author: z.string().optional(),
        homepage: z.string().url().optional(),
        tags: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    runtime: z
      .object({
        autoConnect: z.boolean().optional(),
        reconnect: z.boolean().optional(),
        reconnectAttempts: z.number().int().nonnegative().optional(),
        timeoutMs: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    discovered: z
      .object({
        tools: z
          .array(
            z
              .object({
                name: z.string(),
                description: z.string().optional(),
                inputSchema: z.record(z.string(), z.unknown()),
              })
              .passthrough(),
          )
          .optional(),
        resources: z
          .array(
            z
              .object({
                uri: z.string(),
                name: z.string(),
                description: z.string().optional(),
                mimeType: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
        prompts: z
          .array(
            z
              .object({
                name: z.string(),
                description: z.string().optional(),
                arguments: z
                  .array(
                    z
                      .object({
                        name: z.string(),
                        description: z.string().optional(),
                        required: z.boolean().optional(),
                      })
                      .strict(),
                  )
                  .optional(),
              })
              .passthrough(),
          )
          .optional(),
        lastSyncAt: z.iso.datetime({ offset: true }).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => v.transport === v.connection.type, {
    path: ['connection', 'type'],
    message: 'Connection type must match transport',
  });

export type MCPTool = NonNullable<NonNullable<MCPServerConfig['discovered']>['tools']>[number];
export type MCPResource = NonNullable<
  NonNullable<MCPServerConfig['discovered']>['resources']
>[number];
export type MCPPrompt = NonNullable<NonNullable<MCPServerConfig['discovered']>['prompts']>[number];
export interface MCPServerConfig extends z.infer<typeof mcpServerConfigSchema> {
  id: string;
}

export function mcpDefinitionFromItem(item: Record<string, unknown>) {
  const fields = [
    'id',
    'name',
    'description',
    'enabled',
    'transport',
    'connection',
    'capabilities',
    'permissions',
    'metadata',
    'runtime',
    'discovered',
  ];
  const value = Object.fromEntries(
    fields.filter((key) => item[key] !== undefined).map((key) => [key, item[key]]),
  );
  if (!value.connection) {
    value.transport = 'stdio';
    value.connection = {
      type: 'stdio',
      command: item.command,
      args: item.args ?? [],
      env: item.env ?? {},
    };
    value.runtime = { autoConnect: item.autoStart ?? false };
  }
  return value;
}

export function mcpConfigFromItem(item: Record<string, unknown>): MCPServerConfig {
  return mcpServerConfigSchema.parse(mcpDefinitionFromItem(item));
}
