import type { ChatCommand, LibraryItem } from './types';
export const globalCommands = [
  {
    name: 'mcp',
    description: 'Choose an MCP server, then a tool or Ask this server',
    usage: '/mcp "Server" "Tool" request',
  },
  { name: 'tools', description: 'Choose a configured tool', usage: '/tools "Tool" request' },
  { name: 'agent', description: 'Run a configured agent', usage: '/agent "Agent" task' },
  { name: 'skills', description: 'Apply a saved skill', usage: '/skills "Skill" request' },
  { name: 'workflow', description: 'Run a saved workflow', usage: '/workflow "Workflow" task' },
  { name: 'code', description: 'Choose a project folder', usage: '/code' },
  { name: 'kb', description: 'Choose knowledge sources or Saved Text', usage: '/kb' },
  { name: 'clear', description: 'Stop and clear the current conversation', usage: '/clear' },
  { name: 'help', description: 'Show commands and usage', usage: '/help' },
] as const;
export function globalCommand(text: string) {
  return globalCommands.find((command) => text.trim() === `/${command.name}`);
}

/** Match a quoted or unquoted resource name without requiring a query yet. */
export function namedResource<T extends { name: string }>(text: string, items: T[]) {
  const rest = text.trimStart();
  const quoted = /^"((?:\\.|[^"\\])*)"(?:\s+|$)/.exec(rest);
  const name = quoted ? (JSON.parse(`"${quoted[1]}"`) as string) : undefined;
  const matches = items
    .filter((item) =>
      name !== undefined
        ? item.name.toLowerCase() === name.toLowerCase()
        : rest.toLowerCase() === item.name.toLowerCase() ||
          rest.toLowerCase().startsWith(item.name.toLowerCase() + ' '),
    )
    .sort((a, b) => b.name.length - a.name.length);
  if (!matches.length) return undefined;
  const item = matches[0];
  if (matches.filter((entry) => entry.name.toLowerCase() === item.name.toLowerCase()).length !== 1)
    throw new Error('Name is ambiguous. Select an item from the list.');
  return { item, rest: rest.slice(quoted ? quoted[0].length : item.name.length).trimStart() };
}

export const commandKinds = globalCommands
  .map((command) => command.name)
  .filter((name): name is ChatCommand['kind'] => !['clear', 'help', 'kb'].includes(name));
const resourcePrefix = new RegExp(
  `^/(${commandKinds.filter((kind) => kind !== 'code').join('|')})(?:[-\\s]+([\\s\\S]*))?$`,
);
export function slashPrefix(text: string) {
  const match = resourcePrefix.exec(text);
  return match
    ? { kind: match[1] as Exclude<ChatCommand['kind'], 'code'>, rest: match[2] ?? '' }
    : null;
}
export function resolveSlash(
  text: string,
  items: Pick<LibraryItem, 'id' | 'name' | 'enabled'>[],
  mcpTools: { name: string }[] = [],
) {
  const prefix = slashPrefix(text);
  if (!prefix)
    throw new Error(
      'Choose /mcp, /tools, /agent, /skills, or /workflow, then select a name and enter your query.',
    );
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
  let tool: string | undefined;
  if (prefix.kind === 'mcp') {
    const nested = namedResource(query, mcpTools);
    if (nested) {
      tool = nested.item.name;
      query = nested.rest.trim();
    } else {
      // Explicit quoted tool + request works before discovery as well. The main
      // process validates the tool after connecting; never broaden an unknown
      // tool selection into permission to use the entire server.
      const explicitTool = /^"((?:\\.|[^"\\])*)"\s+([\s\S]+)$/.exec(query);
      if (explicitTool) {
        tool = JSON.parse(`"${explicitTool[1]}"`) as string;
        query = explicitTool[2].trim();
      }
    }
  }
  if (query.startsWith('"') && query.endsWith('"')) {
    try {
      query = JSON.parse(query) as string;
    } catch {
      /* Keep ordinary quoted prose. */
    }
  }
  if (!query.trim() && ['agent', 'workflow'].includes(prefix.kind))
    query = 'Run your configured instructions.';
  if (!query.trim()) throw new Error('Enter a query after the selected name.');
  return {
    command: { kind: prefix.kind, id: matching[0].id, ...(tool ? { tool } : {}) },
    name: matching[0].name,
    query,
  };
}
