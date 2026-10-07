import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { librarySchema, settingsSchema } from './schemas';
import { validateWorkflow, workflowSchema } from './workflows';

export const workspaceBackupFormatSchema = z.enum(['json', 'yaml', 'md']);
export type WorkspaceBackupFormat = z.infer<typeof workspaceBackupFormatSchema>;

const conversationSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().max(200),
  model: z.string().max(200),
  providerId: z.string().max(100).optional(),
  agentId: z.string().max(100).optional(),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
});

const messageSchema = z.object({
  id: z.string().min(1).max(100),
  conversationId: z.string().min(1).max(100),
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string().max(2_000_000),
  createdAt: z.number().finite(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const workspaceBackupSchema = z
  .object({
    formatVersion: z.literal(1),
    exportedAt: z.string().datetime(),
    settings: settingsSchema,
    libraries: z
      .object({
        skills: z.array(librarySchema).max(10000),
        'saved-text': z.array(librarySchema).max(10000),
        agents: z.array(librarySchema).max(10000),
        mcp: z.array(librarySchema).max(10000),
        tools: z.array(librarySchema).max(10000),
        hooks: z.array(librarySchema).max(10000).default([]),
      })
      .strict(),
    workflows: z.array(workflowSchema).max(10000),
    conversations: z
      .array(z.object({ conversation: conversationSchema, messages: z.array(messageSchema) }))
      .max(10000),
  })
  .strict()
  .superRefine((backup, context) => {
    for (const [kind, items] of Object.entries(backup.libraries)) {
      const ids = items.map((item) => item.id);
      if (new Set(ids).size !== ids.length)
        context.addIssue({
          code: 'custom',
          path: ['libraries', kind],
          message: `Duplicate ${kind} IDs in workspace backup.`,
        });
    }
    for (const [index, server] of backup.libraries.mcp.entries())
      if (!server.description.trim())
        context.addIssue({
          code: 'custom',
          path: ['libraries', 'mcp', index, 'description'],
          message: 'MCP server descriptions cannot be empty.',
        });
    for (const [index, item] of backup.libraries.tools.entries()) {
      if (!item.toolConfig) {
        context.addIssue({
          code: 'custom',
          path: ['libraries', 'tools', index, 'toolConfig'],
          message: 'Tool execution configuration is required.',
        });
      } else if (item.toolConfig.type === 'javascript' && !item.content.trim()) {
        context.addIssue({
          code: 'custom',
          path: ['libraries', 'tools', index, 'content'],
          message: 'JavaScript tools require executable code.',
        });
      } else if (item.toolConfig.type === 'api') {
        try {
          const url = new URL(item.toolConfig.url);
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
            throw new Error('invalid URL');
        } catch {
          context.addIssue({
            code: 'custom',
            path: ['libraries', 'tools', index, 'toolConfig', 'url'],
            message: 'API tools require a valid HTTP(S) URL without credentials.',
          });
        }
      }
    }
    for (const [index, workflow] of backup.workflows.entries()) {
      try {
        validateWorkflow(workflow);
      } catch (error) {
        context.addIssue({
          code: 'custom',
          path: ['workflows', index],
          message: error instanceof Error ? error.message : 'Invalid workflow definition.',
        });
      }
    }
    const conversationIds = new Set(
      backup.conversations.map(({ conversation }) => conversation.id),
    );
    if (conversationIds.size !== backup.conversations.length)
      context.addIssue({
        code: 'custom',
        path: ['conversations'],
        message: 'Duplicate conversation IDs in workspace backup.',
      });
    const messageIds = backup.conversations.flatMap(({ messages }) => messages.map((m) => m.id));
    if (new Set(messageIds).size !== messageIds.length)
      context.addIssue({
        code: 'custom',
        path: ['conversations'],
        message: 'Duplicate message IDs in workspace backup.',
      });
    backup.conversations.forEach(({ conversation, messages }, index) => {
      for (const message of messages) {
        if (
          message.conversationId !== conversation.id ||
          !conversationIds.has(message.conversationId)
        )
          context.addIssue({
            code: 'custom',
            path: ['conversations', index, 'messages'],
            message: 'Each message must belong to its archived conversation.',
          });
      }
    });
  });

export type WorkspaceBackup = z.infer<typeof workspaceBackupSchema>;

export function parseWorkspaceBackup(raw: string, format: WorkspaceBackupFormat): WorkspaceBackup {
  let value: unknown;
  try {
    if (format === 'json') value = JSON.parse(raw);
    else if (format === 'yaml') value = parseYaml(raw);
    else {
      const payload = /```workspace-backup\s*\n([\s\S]*?)\n```/.exec(raw);
      if (!payload) throw new Error('Missing workspace-backup code block.');
      value = JSON.parse(payload[1]);
    }
  } catch {
    throw new Error(`Could not parse the ${format.toUpperCase()} workspace backup.`);
  }
  return workspaceBackupSchema.parse(value);
}

export function stringifyWorkspaceBackup(backup: WorkspaceBackup, format: WorkspaceBackupFormat) {
  const validated = workspaceBackupSchema.parse(backup);
  if (format === 'json') return JSON.stringify(validated, null, 2);
  if (format === 'yaml') return stringifyYaml(validated);
  return `# LocalAI Workspace Backup\n\nExported ${validated.exportedAt}.\n\nImport this file in Settings > Import / Export.\n\n\`\`\`workspace-backup\n${JSON.stringify(validated, null, 2)}\n\`\`\`\n`;
}
