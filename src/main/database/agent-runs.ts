import { DatabaseSync } from 'node:sqlite';
import type { RunState } from '../../shared/types';
export interface RunStore {
  list(): RunState[];
  save(run: RunState): void;
}
export class AgentRunDatabase implements RunStore {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS agent_runs(id TEXT PRIMARY KEY, data TEXT NOT NULL)',
    );
  }
  list(): RunState[] {
    return this.db
      .prepare('SELECT data FROM agent_runs ORDER BY rowid')
      .all()
      .map((row) => JSON.parse(String(row.data)) as RunState);
  }
  save(run: RunState) {
    this.db
      .prepare(
        'INSERT INTO agent_runs(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(run.id, JSON.stringify(run));
  }
  close() {
    this.db.close();
  }
}
