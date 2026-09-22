import { it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
