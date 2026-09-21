import type { ChatCommand, LibraryItem } from './types';
export const commandKinds = ['mcp', 'agent', 'skills'] as const;
export function slashPrefix(text: string) {
  const match = /^\/(mcp|agent|skills)\s+([\s\S]*)$/.exec(text);
  return match ? { kind: match[1] as ChatCommand['kind'], rest: match[2] } : null;
}
export function resolveSlash(text: string, items: LibraryItem[]) {
  const prefix = slashPrefix(text);
  if (!prefix)
    throw new Error('Choose /mcp, /agent, or /skills, then select a name and enter your query.');
  const rest = prefix.rest.trimStart();
  const quoted = /^"((?:\\.|[^"\\])*)"(?:\s+|$)/.exec(rest);
  let name: string;
  let query: string;
  if (quoted) {
    name = JSON.parse(`"${quoted[1]}"`) as string;
    query = rest.slice(quoted[0].length).trim();
  } else {
    const matches = items
      .filter(
        (i) =>
          rest.toLowerCase().startsWith(i.name.toLowerCase() + ' ') ||
          rest.toLowerCase() === i.name.toLowerCase(),
      )
      .sort((a, b) => b.name.length - a.name.length);
    if (!matches.length) throw new Error('Select an available name from the command list.');
    name = matches[0].name;
    query = rest.slice(name.length).trim();
  }
  const matching = items.filter((i) => i.name.toLowerCase() === name.toLowerCase());
  if (matching.length !== 1)
    throw new Error('Name is missing or ambiguous. Select an item from the list.');
  if (!matching[0].enabled) throw new Error('Enable this item before using it in Chat.');
  if (query.startsWith('"') && query.endsWith('"')) {
    try {
      query = JSON.parse(query) as string;
    } catch {
      /* Keep ordinary quoted prose. */
    }
  }
  if (!query.trim() && prefix.kind === 'agent') query = 'Run your configured instructions.';
  if (!query.trim()) throw new Error('Enter a query after the selected name.');
  return { command: { kind: prefix.kind, id: matching[0].id }, name: matching[0].name, query };
}
