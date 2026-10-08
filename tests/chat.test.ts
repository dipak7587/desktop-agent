import { it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ChatDatabase } from '../src/main/database/chat';
import { settingsSchema } from '../src/shared/schemas';
it('persists, searches, continues and cascade-deletes a conversation across restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chat-test-'));
  const file = join(root, 'app.sqlite');
  let db = new ChatDatabase(file);
  const c = db.create('local-model');
  db.add(c.id, 'user', 'Architecture question');
  db.add(c.id, 'assistant', 'Answer', { sources: [] });
  db.close();
  db = new ChatDatabase(file);
  expect(db.messages(c.id)).toHaveLength(2);
  expect(db.list('Architecture')[0].id).toBe(c.id);
  db.rename(c.id, 'Design');
  db.add(c.id, 'user', 'Continue');
  expect(db.messages(c.id)).toHaveLength(3);
  db.remove(c.id);
  expect(db.list()).toHaveLength(0);
  db.close();
  await rm(root, { recursive: true, force: true });
});

it('clears every stored conversation and message', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chat-test-'));
  const file = join(root, 'app.sqlite');
  const db = new ChatDatabase(file);
  const one = db.create('local-model');
  const two = db.create('local-model');
  db.add(one.id, 'user', 'First question');
  db.add(two.id, 'assistant', 'Second answer', { sources: [] });

  db.clear();

  expect(db.list()).toHaveLength(0);
  db.close();
  await rm(root, { recursive: true, force: true });
});

it('persists workspace identity and reconnects conversations without deleting project files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chat-workspace-test-'));
  const file = join(root, 'app.sqlite');
  let db = new ChatDatabase(file);
  const firstConversation = db.create('local-model');
  const workspace = db.connectCodeWorkspace(firstConversation.id, join(root, 'project'));
  expect(workspace.permissions).toEqual({ rules: {} });
  expect(workspace.allowedAgentIds).toBeUndefined();
  expect(db.get(firstConversation.id).workspaceId).toBe(workspace.id);
  expect(
    db.setCodeWorkspaceAccess(workspace.id, {
      allowedAgentIds: ['coder', 'reviewer', 'coder'],
      allowedSkills: ['coding'],
      allowedTools: ['filesystem.read'],
      allowedMCPServers: ['filesystem'],
      allowedKnowledgeBases: ['project-docs'],
    }),
  ).toMatchObject({
    allowedAgentIds: ['coder', 'reviewer'],
    allowedSkills: ['coding'],
    allowedTools: ['filesystem.read'],
    allowedMCPServers: ['filesystem'],
    allowedKnowledgeBases: ['project-docs'],
  });

  db.close();
  db = new ChatDatabase(file);
  const secondConversation = db.create('local-model');
  const reconnected = db.reconnectCodeWorkspace(workspace.id, secondConversation.id);
  expect(reconnected.id).toBe(workspace.id);
  expect(reconnected.allowedAgentIds).toEqual(['coder', 'reviewer']);
  expect(db.get(secondConversation.id).workspaceId).toBe(workspace.id);

  const relinked = db.relinkCodeWorkspace(
    workspace.id,
    firstConversation.id,
    join(root, 'replacement-project'),
  );
  expect(relinked.id).toBe(workspace.id);
  expect(relinked.canonicalPath).toBe(join(root, 'replacement-project'));
  expect(relinked.permissions).toEqual({ rules: {} });
  expect(relinked.allowedAgentIds).toBeUndefined();
  expect(relinked.allowedSkills).toBeUndefined();
  expect(relinked.allowedTools).toBeUndefined();
  expect(relinked.allowedMCPServers).toBeUndefined();
  expect(relinked.allowedKnowledgeBases).toBeUndefined();

  db.removeCodeWorkspace(workspace.id);
  expect(db.get(firstConversation.id).workspaceId).toBeNull();
  expect(db.get(secondConversation.id).workspaceId).toBeNull();
  expect(db.listCodeWorkspaces()).toHaveLength(0);
  db.close();
  await rm(root, { recursive: true, force: true });
});

it('migrates conversations created before Code workspace support', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chat-workspace-migration-'));
  const file = join(root, 'app.sqlite');
  const legacy = new DatabaseSync(file);
  legacy.exec(`
    CREATE TABLE conversations(id TEXT PRIMARY KEY,title TEXT NOT NULL,model TEXT NOT NULL,createdAt INTEGER NOT NULL,updatedAt INTEGER NOT NULL);
    CREATE TABLE messages(id TEXT PRIMARY KEY,conversationId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,role TEXT NOT NULL,content TEXT NOT NULL,createdAt INTEGER NOT NULL,metadata TEXT);
    INSERT INTO conversations VALUES('legacy','Old chat','model',1,2);
  `);
  legacy.close();

  const db = new ChatDatabase(file);
  expect(db.get('legacy').workspaceId).toBeNull();
  expect(db.listCodeWorkspaces()).toEqual([]);
  db.close();
  await rm(root, { recursive: true, force: true });
});

it('accepts cross-provider settings for Claude, OpenAI, and Google style models', () => {
  const settings = settingsSchema.parse({
    provider: 'anthropic',
    apiKey: 'test-key',
    apiBaseUrl: 'https://api.anthropic.com',
    chatModel: 'claude-3-5-sonnet-20241022',
    embeddingModel: 'text-embedding-004',
  });

  expect(settings.provider).toBe('anthropic');
  expect(settings.apiKey).toBe('test-key');
  expect(settings.apiBaseUrl).toBe('https://api.anthropic.com');
});
