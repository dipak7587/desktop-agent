import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../src/main/services/filesystem/library';
import { librarySchema } from '../src/shared/schemas';
import {
  resolveKnowledgeBases,
  resolveMCPServers,
  resolveSkills,
  resolveTools,
} from '../src/main/services/agents/resource-resolvers';
import type { KnowledgeSource } from '../src/shared/types';

let root: string;
let library: LibraryService;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'agent-resolvers-')));
  library = new LibraryService(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it('resolves only configured, enabled resources from existing libraries', async () => {
  for (const id of ['skill-selected', 'skill-other', 'skill-disabled'])
    await library.save(
      'skills',
      librarySchema.parse({
        id,
        name: id,
        content: 'Instructions',
        enabled: id !== 'skill-disabled',
      }),
    );
  for (const id of ['tool-selected', 'tool-other'])
    await library.save(
      'tools',
      librarySchema.parse({
        id,
        name: id,
        content: 'return input;',
        toolConfig: { type: 'javascript', parameters: [], url: '', method: 'GET', headers: {} },
      }),
    );
  for (const id of ['mcp-selected', 'mcp-other'])
    await library.save(
      'mcp',
      librarySchema.parse({
        id,
        name: id,
        enabled: true,
        transport: 'stdio',
        connection: { type: 'stdio', command: 'node', args: [] },
      }),
    );

  expect(
    (await resolveSkills(['skill-selected', 'skill-disabled'], library)).map((x) => x.id),
  ).toEqual(['skill-selected']);
  const tools = await resolveTools(['filesystem.read', 'custom:tool-selected'], library);
  expect(tools.local).toEqual(['filesystem.read']);
  expect(tools.custom.map((x) => x.id)).toEqual(['tool-selected']);
  expect(await resolveMCPServers(['mcp-selected'], library)).toMatchObject([
    { id: 'mcp-selected' },
  ]);

  const sources = [
    { id: 'kb-selected', status: 'ready' },
    { id: 'kb-other', status: 'ready' },
    { id: 'kb-not-ready', status: 'error' },
  ] as KnowledgeSource[];
  expect(resolveKnowledgeBases(['kb-selected', 'kb-not-ready'], sources).map((x) => x.id)).toEqual([
    'kb-selected',
  ]);
});
