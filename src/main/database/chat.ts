import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { Conversation, Message } from '../../shared/types';
export class ChatDatabase {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,title TEXT NOT NULL,model TEXT NOT NULL,createdAt INTEGER NOT NULL,updatedAt INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,conversationId TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,role TEXT NOT NULL,content TEXT NOT NULL,createdAt INTEGER NOT NULL,metadata TEXT);
 CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversationId,createdAt);`);
    const columns = this.db.prepare('PRAGMA table_info(conversations)').all();
    if (!columns.some((c) => c.name === 'providerId'))
      this.db.exec("ALTER TABLE conversations ADD COLUMN providerId TEXT NOT NULL DEFAULT ''");
    if (!columns.some((c) => c.name === 'agentId'))
      this.db.exec("ALTER TABLE conversations ADD COLUMN agentId TEXT NOT NULL DEFAULT ''");
    this.db.exec('PRAGMA user_version=2');
    for (const row of this.db
      .prepare("SELECT id,metadata FROM messages WHERE role='assistant' AND metadata IS NOT NULL")
      .all()) {
      const metadata = JSON.parse(String(row.metadata));
      if (metadata.status === 'streaming') {
        metadata.status = 'canceled';
        metadata.stopped = true;
        metadata.error = 'Application closed before this response finished.';
        this.db
          .prepare('UPDATE messages SET metadata=? WHERE id=?')
          .run(JSON.stringify(metadata), String(row.id));
      }
    }
  }
  migrateProviders(defaultId: string) {
    this.db.prepare("UPDATE conversations SET providerId=? WHERE providerId=''").run(defaultId);
  }
  list(query = ''): Conversation[] {
    return this.db
      .prepare(
        `SELECT * FROM conversations WHERE title LIKE ? OR id IN (SELECT conversationId FROM messages WHERE content LIKE ?) ORDER BY updatedAt DESC LIMIT 500`,
      )
      .all(`%${query}%`, `%${query}%`) as unknown as Conversation[];
  }
  get(id: string) {
    const c = this.db.prepare('SELECT * FROM conversations WHERE id=?').get(id) as unknown as
      Conversation | undefined;
    if (!c) throw new Error('Conversation no longer exists');
    return c;
  }
  create(model: string, providerId = '', agentId = ''): Conversation {
    const c = {
      id: randomUUID(),
      title: 'New conversation',
      providerId,
      agentId,
      model,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.db
      .prepare(
        'INSERT INTO conversations(id,title,model,createdAt,updatedAt,providerId,agentId) VALUES(?,?,?,?,?,?,?)',
      )
      .run(c.id, c.title, c.model, c.createdAt, c.updatedAt, providerId, agentId);
    return c;
  }
  setSelection(id: string, providerId: string, model: string, agentId?: string) {
    this.get(id);
    this.db
      .prepare(
        'UPDATE conversations SET providerId=?,model=?,agentId=COALESCE(?,agentId) WHERE id=?',
      )
      .run(providerId, model, agentId ?? null, id);
  }
  setModel(id: string, model: string) {
    this.get(id);
    this.db.prepare('UPDATE conversations SET model=? WHERE id=?').run(model, id);
  }
  rename(id: string, title: string) {
    this.get(id);
    this.db
      .prepare('UPDATE conversations SET title=?,updatedAt=? WHERE id=?')
      .run(title, Date.now(), id);
  }
  remove(id: string) {
    this.db.prepare('DELETE FROM conversations WHERE id=?').run(id);
  }
  clear() {
    this.db.exec('BEGIN IMMEDIATE; DELETE FROM messages; DELETE FROM conversations; COMMIT;');
  }
  messages(id: string): Message[] {
    this.get(id);
    return this.db
      .prepare('SELECT * FROM messages WHERE conversationId=? ORDER BY createdAt,rowid')
      .all(id)
      .map((row) => ({
        ...row,
        metadata: row.metadata ? JSON.parse(String(row.metadata)) : undefined,
      })) as unknown as Message[];
  }
  exportAll() {
    const conversations = this.db
      .prepare('SELECT * FROM conversations ORDER BY updatedAt DESC')
      .all() as unknown as Conversation[];
    return conversations.map((conversation) => ({
      conversation,
      messages: this.messages(conversation.id),
    }));
  }
  importConversations(entries: { conversation: Conversation; messages: Message[] }[]) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const saveConversation = this.db.prepare(
        'INSERT OR REPLACE INTO conversations(id,title,model,createdAt,updatedAt,providerId,agentId) VALUES(?,?,?,?,?,?,?)',
      );
      const removeMessages = this.db.prepare('DELETE FROM messages WHERE conversationId=?');
      const messageOwner = this.db.prepare('SELECT conversationId FROM messages WHERE id=?');
      const saveMessage = this.db.prepare(
        'INSERT OR REPLACE INTO messages(id,conversationId,role,content,createdAt,metadata) VALUES(?,?,?,?,?,?)',
      );
      for (const { conversation, messages } of entries) {
        saveConversation.run(
          conversation.id,
          conversation.title,
          conversation.model,
          conversation.createdAt,
          conversation.updatedAt,
          conversation.providerId ?? '',
          conversation.agentId ?? '',
        );
        removeMessages.run(conversation.id);
        for (const message of messages) {
          const owner = messageOwner.get(message.id) as { conversationId?: string } | undefined;
          const messageId =
            owner && owner.conversationId !== conversation.id ? randomUUID() : message.id;
          saveMessage.run(
            messageId,
            conversation.id,
            message.role,
            message.content,
            message.createdAt,
            message.metadata ? JSON.stringify(message.metadata) : null,
          );
        }
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  add(id: string, role: Message['role'], content: string, metadata?: Message['metadata']): Message {
    this.get(id);
    const m = {
      id: randomUUID(),
      conversationId: id,
      role,
      content,
      createdAt: Date.now(),
      metadata,
    };
    this.db
      .prepare('INSERT INTO messages VALUES(?,?,?,?,?,?)')
      .run(m.id, id, role, content, m.createdAt, metadata ? JSON.stringify(metadata) : null);
    this.db.prepare('UPDATE conversations SET updatedAt=? WHERE id=?').run(Date.now(), id);
    return m;
  }
  updateMessage(message: Message, content: string, metadata: Message['metadata']): Message {
    this.db
      .prepare('UPDATE messages SET content=?,metadata=? WHERE id=?')
      .run(content, JSON.stringify(metadata ?? {}), message.id);
    return { ...message, content, metadata };
  }
  removeLastAssistant(id: string) {
    const messages = this.messages(id);
    const last = messages.at(-1);
    if (last?.role === 'assistant') this.db.prepare('DELETE FROM messages WHERE id=?').run(last.id);
  }
  close() {
    this.db.close();
  }
}
