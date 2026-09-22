import { DatabaseSync } from 'node:sqlite';
import type { WorkflowRun } from '../../shared/workflows';
export interface WorkflowRunStore {
  list(): WorkflowRun[];
  save(run: WorkflowRun): void;
}
export class WorkflowRunDatabase implements WorkflowRunStore {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS workflow_runs(id TEXT PRIMARY KEY, data TEXT NOT NULL)',
    );
  }
  list() {
    return this.db
      .prepare('SELECT data FROM workflow_runs ORDER BY rowid')
      .all()
      .map((row) => JSON.parse(String(row.data)) as WorkflowRun);
  }
  save(run: WorkflowRun) {
    this.db
      .prepare(
        'INSERT INTO workflow_runs(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
      )
      .run(run.id, JSON.stringify(run));
  }
  close() {
    this.db.close();
  }
}
