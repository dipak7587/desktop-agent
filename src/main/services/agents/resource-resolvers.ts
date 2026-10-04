import type { KnowledgeSource, LibraryItem } from '../../../shared/types';
import type { LibraryService } from '../filesystem/library';
import { localTools } from './tools';

export async function resolveSkills(ids: string[], library: LibraryService) {
  const selected = new Set(ids);
  return (await library.list('skills')).filter((skill) => selected.has(skill.id) && skill.enabled);
}

export async function resolveTools(ids: string[], library: LibraryService) {
  const selected = new Set(ids);
  const customIds = new Set(
    ids.filter((id) => id.startsWith('custom:')).map((id) => id.slice('custom:'.length)),
  );
  const custom: LibraryItem[] = (await library.list('tools')).filter(
    (item) => customIds.has(item.id) && item.enabled,
  );
  return {
    local: localTools.filter((id) => selected.has(id)),
    custom,
    mcp: ids.filter((id) => id.startsWith('mcp:')),
  };
}

export async function resolveMCPServers(ids: string[], library: LibraryService) {
  const selected = new Set(ids);
  return (await library.list('mcp')).filter((server) => selected.has(server.id) && server.enabled);
}

export function resolveKnowledgeBases(ids: string[], sources: KnowledgeSource[]) {
  const selected = new Set(ids);
  return sources.filter((source) => selected.has(source.id) && source.status === 'ready');
}
