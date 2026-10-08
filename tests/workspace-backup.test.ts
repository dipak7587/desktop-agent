import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { settingsSchema } from '../src/shared/schemas';
import {
  parseWorkspaceBackup,
  stringifyWorkspaceBackup,
  type WorkspaceBackup,
  type WorkspaceBackupFormat,
} from '../src/shared/workspace-backup';
import { ChatDatabase } from '../src/main/database/chat';

const backup = (): WorkspaceBackup => ({
  formatVersion: 1,
  exportedAt: new Date().toISOString(),
  settings: settingsSchema.parse({}),
  libraries: { skills: [], 'saved-text': [], agents: [], mcp: [], tools: [], hooks: [] },
  workflows: [],
  conversations: [
    {
      conversation: {
        id: 'chat-1',
        title: 'A test chat',
        model: 'model-a',
        providerId: 'provider-a',
        createdAt: 10,
        updatedAt: 20,
      },
      messages: [
        {
          id: 'message-1',
          conversationId: 'chat-1',
          role: 'user',
          content: 'Hello',
          createdAt: 11,
        },
      ],
    },
  ],
});

it.each(['json', 'yaml', 'md'] as const)(
  'round-trips workspace backups as %s',
  (format: WorkspaceBackupFormat) => {
    const serialized = stringifyWorkspaceBackup(backup(), format);
    expect(parseWorkspaceBackup(serialized, format)).toMatchObject({
      formatVersion: 1,
      libraries: { skills: [], 'saved-text': [], agents: [], mcp: [], tools: [] },
      conversations: [{ conversation: { id: 'chat-1' }, messages: [{ content: 'Hello' }] }],
    });
  },
);

it('rejects malformed or unsupported backup data', () => {
  expect(() => parseWorkspaceBackup('{', 'json')).toThrow('Could not parse');
  expect(() => parseWorkspaceBackup('# Not a backup', 'md')).toThrow('Could not parse');
  expect(() => parseWorkspaceBackup('{"formatVersion":2}', 'json')).toThrow();
});

it('imports conversation history transactionally and replaces matching IDs only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-backup-chat-'));
  const db = new ChatDatabase(join(root, 'app.sqlite'));
  try {
    const existing = db.create('old-model');
    db.rename(existing.id, 'Keep me');
    const replacement = backup().conversations[0];
    db.importConversations([
      {
        conversation: {
          ...replacement.conversation,
          id: 'other-chat',
          title: 'Other chat',
        },
        messages: [{ ...replacement.messages[0], conversationId: 'other-chat' }],
      },
    ]);
    db.importConversations([replacement]);
    db.importConversations([
      {
        ...replacement,
        conversation: { ...replacement.conversation, title: 'Replaced chat' },
        messages: [{ ...replacement.messages[0], content: 'Updated message' }],
      },
    ]);

    expect(db.get(existing.id).title).toBe('Keep me');
    expect(db.get('chat-1').title).toBe('Replaced chat');
    expect(db.messages('chat-1').map((message) => message.content)).toEqual(['Updated message']);
    expect(db.messages('other-chat').map((message) => message.content)).toEqual(['Hello']);
    expect(db.messages('chat-1')[0].id).not.toBe('message-1');
  } finally {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
