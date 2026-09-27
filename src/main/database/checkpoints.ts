import { DatabaseSync } from 'node:sqlite';
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type ChannelVersions,
  type PendingWrite,
} from '@langchain/langgraph-checkpoint';
import type { RunnableConfig } from '@langchain/core/runnables';

/**
 * LangGraph checkpoint persistence backed by node:sqlite, mirroring the
 * application's existing database pattern (see database/chat.ts). This stores
 * serialized LangGraph thread state for conversations that use stateful
 * workflows, so state survives application restart. It reuses the same
 * SQLite engine the app already uses; no additional database technology is
 * introduced.
 */
export class CheckpointDatabase extends BaseCheckpointSaver {
  private db: DatabaseSync;

  constructor(path: string) {
    super();
    this.db = new DatabaseSync(path);
    this.db.exec(
      `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS checkpoints(
   thread_id TEXT NOT NULL,
   checkpoint_ns TEXT NOT NULL,
   checkpoint_id TEXT NOT NULL,
   parent_checkpoint_id TEXT,
   type TEXT,
   checkpoint BLOB NOT NULL,
   metadata BLOB,
   PRIMARY KEY(thread_id, checkpoint_ns, checkpoint_id)
 );
 CREATE TABLE IF NOT EXISTS checkpoint_writes(
   thread_id TEXT NOT NULL,
   checkpoint_ns TEXT NOT NULL,
   checkpoint_id TEXT NOT NULL,
   task_id TEXT NOT NULL,
   idx INTEGER NOT NULL,
   channel TEXT NOT NULL,
   type TEXT,
   value BLOB,
   PRIMARY KEY(thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
 );
 CREATE INDEX IF NOT EXISTS checkpoint_writes_thread
   ON checkpoint_writes(thread_id, checkpoint_ns, checkpoint_id);
 CREATE TABLE IF NOT EXISTS checkpoint_migrations(version INTEGER NOT NULL);
 INSERT OR IGNORE INTO checkpoint_migrations(version) VALUES (1);`,
    );
  }

  private loadBlob(value: unknown): Uint8Array | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Uint8Array) return value;
    if (typeof value === 'string') return new TextEncoder().encode(value);
    return null;
  }

  private async deserializeRow(type: unknown, value: unknown): Promise<unknown> {
    const data = this.loadBlob(value);
    if (data === null) return undefined;
    return this.serde.loadsTyped(String(type ?? 'json'), data);
  }

  private async serializeValue(value: unknown): Promise<{ type: string; blob: Uint8Array }> {
    const [type, data] = await this.serde.dumpsTyped(value);
    return { type, blob: data };
  }

  private configFor(threadId: string, checkpointNs: string, checkpointId: string): RunnableConfig {
    return {
      configurable: { thread_id: threadId, checkpoint_ns: checkpointNs, checkpoint_id: checkpointId },
    };
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const { thread_id: threadId, checkpoint_ns: namespace = '', checkpoint_id } = config.configurable ?? {};
    const row = checkpoint_id
      ? this.db
          .prepare(
            'SELECT * FROM checkpoints WHERE thread_id=? AND checkpoint_ns=? AND checkpoint_id=?',
          )
          .get(threadId, namespace, checkpoint_id)
      : this.db
          .prepare(
            'SELECT * FROM checkpoints WHERE thread_id=? AND checkpoint_ns=? ORDER BY checkpoint_id DESC LIMIT 1',
          )
          .get(threadId, namespace);
    if (!row) return undefined;
    const record = row as Record<string, unknown>;
    const checkpoint = (await this.deserializeRow(record.type, record.checkpoint)) as Checkpoint;
    const metadata = (await this.deserializeRow(record.type, record.metadata)) as
      | CheckpointMetadata
      | undefined;
    const pendingWrites = await this.loadPendingWrites(
      String(record.thread_id),
      String(record.checkpoint_ns),
      String(record.checkpoint_id),
    );
    const tuple: CheckpointTuple = {
      config: this.configFor(
        String(record.thread_id),
        String(record.checkpoint_ns),
        String(record.checkpoint_id),
      ),
      checkpoint,
      metadata,
      parentConfig: record.parent_checkpoint_id
        ? this.configFor(
            String(record.thread_id),
            String(record.checkpoint_ns),
            String(record.parent_checkpoint_id),
          )
        : undefined,
      pendingWrites,
    };
    return tuple;
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const { thread_id: threadId, checkpoint_ns: namespace = '' } = config.configurable ?? {};
    const before = options?.before?.configurable?.checkpoint_id;
    const rows = this.db
      .prepare(
        'SELECT * FROM checkpoints WHERE thread_id=? AND checkpoint_ns=? ORDER BY checkpoint_id DESC',
      )
      .all(threadId, namespace) as unknown as Record<string, unknown>[];
    for (const record of rows) {
      if (before && record.checkpoint_id === before) break;
      const tuple = await this.getTuple(
        this.configFor(String(record.thread_id), String(record.checkpoint_ns), String(record.checkpoint_id)),
      );
      if (tuple) yield tuple;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const { thread_id: threadId, checkpoint_ns: namespace = '' } = config.configurable ?? {};
    const serialized = await this.serializeValue(checkpoint);
    const serializedMetadata = await this.serializeValue({
      ...metadata,
      parents: metadata.parents ?? {},
    });
    this.db
      .prepare(
        `INSERT OR REPLACE INTO checkpoints(thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
         VALUES(?,?,?,?,?,?,?)`,
      )
      .run(
        threadId,
        namespace,
        checkpoint.id,
        config.configurable?.checkpoint_id ?? null,
        serialized.type,
        serialized.blob,
        serializedMetadata.blob,
      );
    return this.configFor(threadId, namespace, checkpoint.id);
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    const { thread_id: threadId, checkpoint_ns: namespace = '', checkpoint_id } = config.configurable ?? {};
    if (!checkpoint_id) throw new Error('Cannot store writes without a checkpoint ID');
    const statement = this.db.prepare(
      `INSERT OR REPLACE INTO checkpoint_writes(thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, value)
       VALUES(?,?,?,?,?,?,?,?)`,
    );
    for (const [index, [channel, value]] of writes.entries()) {
      const serialized = await this.serializeValue(value);
      statement.run(
        threadId,
        namespace,
        checkpoint_id,
        taskId,
        index,
        channel,
        serialized.type,
        serialized.blob,
      );
    }
  }

  private async loadPendingWrites(
    threadId: string,
    namespace: string,
    checkpointId: string,
  ): Promise<CheckpointTuple['pendingWrites']> {
    const rows = this.db
      .prepare(
        'SELECT task_id, idx, channel, type, value FROM checkpoint_writes WHERE thread_id=? AND checkpoint_ns=? AND checkpoint_id=? ORDER BY task_id, idx',
      )
      .all(threadId, namespace, checkpointId) as unknown as Record<string, unknown>[];
    const writes: CheckpointTuple['pendingWrites'] = [];
    for (const record of rows) {
      const value = await this.deserializeRow(record.type, record.value);
      writes.push([String(record.task_id), String(record.channel), value]);
    }
    return writes;
  }

  async deleteThread(threadId: string): Promise<void> {
    this.db.prepare('DELETE FROM checkpoints WHERE thread_id=?').run(threadId);
    this.db.prepare('DELETE FROM checkpoint_writes WHERE thread_id=?').run(threadId);
  }

  close() {
    this.db.close();
  }
}
