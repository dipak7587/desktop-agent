import { readdir, readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { idSchema } from '../../../shared/schemas';
import { validateWorkflow } from '../../../shared/workflows';
import { atomicWrite } from '../filesystem/storage';
import type { LibraryService } from '../filesystem/library';
export class WorkflowDefinitions {
  private directory: string;
  constructor(
    root: string,
    private library: LibraryService,
  ) {
    this.directory = join(root, 'workflows');
  }
  async list() {
    await mkdir(this.directory, { recursive: true });
    const names = (await readdir(this.directory)).filter((name) => name.endsWith('.json')).sort();
    return Promise.all(names.map((name) => this.get(name.slice(0, -5))));
  }
  async get(id: string) {
    return validateWorkflow(
      JSON.parse(await readFile(join(this.directory, `${idSchema.parse(id)}.json`), 'utf8')),
    );
  }
  async save(input: unknown) {
    const workflow = validateWorkflow(input);
    for (const node of workflow.agents) await this.library.get('agents', node.agentId);
    workflow.updatedAt = new Date().toISOString();
    await atomicWrite(
      join(this.directory, `${workflow.id}.json`),
      JSON.stringify(workflow, null, 2),
    );
    return workflow;
  }
  async duplicate(id: string) {
    const workflow = await this.get(id);
    const now = new Date().toISOString();
    return this.save({
      ...workflow,
      id: randomUUID(),
      name: `${workflow.name.slice(0, 190)} copy`,
      createdAt: now,
      updatedAt: now,
    });
  }
  async remove(id: string) {
    await rm(join(this.directory, `${idSchema.parse(id)}.json`));
  }
}
