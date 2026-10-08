import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../src/main/services/filesystem/library';
import { WorkflowDefinitions } from '../src/main/services/workflows/definitions';
import { KnowledgeService } from '../src/main/services/rag/knowledge';
import { librarySchema, settingsSchema } from '../src/shared/schemas';

it.each(['agents', 'mcp', 'skills', 'tools', 'saved-text'] as const)(
  '%s rejects duplicate creation, renaming and simultaneous saves but permits edits',
  async (kind) => {
    const root = await mkdtemp(join(tmpdir(), 'duplicate-names-'));
    try {
      const library = new LibraryService(root);
      const item = librarySchema.parse({
        id: 'one',
        name: 'Example',
        content: 'return input;',
        toolConfig: kind === 'tools' ? { type: 'javascript', parameters: [] } : undefined,
      });
      await library.save(kind, item);
      await expect(library.save(kind, { ...item, id: 'two', name: ' example ' })).rejects.toThrow(
        'already exists',
      );
      await expect(library.save(kind, { ...item, description: 'Edited' })).resolves.toMatchObject({
        description: 'Edited',
      });
      await library.save(kind, { ...item, id: 'two', name: 'Different' });
      await expect(library.save(kind, { ...item, id: 'two' })).rejects.toThrow('already exists');
      expect((await library.get(kind, 'two')).name).toBe('Different');
      const results = await Promise.allSettled(
        ['three', 'four'].map((id) => library.save(kind, { ...item, id, name: 'Concurrent' })),
      );
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(await library.list(kind)).toHaveLength(3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

it('rejects duplicate workflow names and permits updating the same workflow', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-names-'));
  try {
    const library = new LibraryService(root);
    await library.save('agents', librarySchema.parse({ id: 'agent', name: 'Agent' }));
    const definitions = new WorkflowDefinitions(root, library);
    const input = {
      id: 'one',
      name: 'Example',
      agents: [{ id: 'node', agentId: 'agent', name: 'Agent' }],
      connections: [],
      executionMode: 'sequential',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const saved = await definitions.save(input);
    await expect(definitions.save(saved)).resolves.toMatchObject({ id: 'one' });
    await expect(definitions.save({ ...saved, id: 'two', name: ' EXAMPLE ' })).rejects.toThrow(
      'already exists',
    );
    expect(await definitions.list()).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('rejects duplicate knowledge source names before persisting', async () => {
  const root = await mkdtemp(join(tmpdir(), 'knowledge-names-'));
  try {
    const knowledge = new KnowledgeService(
      root,
      () => settingsSchema.parse({}),
      { embed: async () => [1], embedBatch: async () => [[1]] },
      () => {},
    );
    await expect(knowledge.add('folder', '/first/Example', '   ')).rejects.toThrow(
      'description is required',
    );
    await knowledge.add('folder', '/first/Example', 'First knowledge source');
    await expect(
      knowledge.add('folder', '/second/example', 'Duplicate knowledge source'),
    ).rejects.toThrow('already exists');
    expect(knowledge.list()).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
