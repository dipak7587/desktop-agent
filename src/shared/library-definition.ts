import { parse, stringify } from 'yaml';
import { parseMCPConfig } from './mcp-config';
import type { LibraryKind, LibraryItem } from './types';

export type LibraryDefinitionFormat = 'json' | 'yaml' | 'md';

export function parseLibraryDefinition(
  raw: string,
  format: LibraryDefinitionFormat,
  kind: LibraryKind,
): Partial<LibraryItem> {
  let value: unknown;
  let content: string | undefined;
  try {
    if (format === 'json') {
      value = JSON.parse(raw);
    } else if (format === 'yaml') {
      value = parse(raw);
    } else {
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(raw);
      if (!frontmatter) throw new Error('Markdown definitions require YAML frontmatter.');
      value = parse(frontmatter[1]);
      content = frontmatter[2].trim();
    }
  } catch {
    throw new Error(
      format === 'md'
        ? 'Enter Markdown with valid YAML frontmatter.'
        : `Enter valid ${format.toUpperCase()} for this definition.`,
    );
  }

  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('A definition must be an object.');

  const definition = {
    ...(value as Record<string, unknown>),
    ...(content === undefined ? {} : { content }),
  };
  if (kind === 'mcp' && 'mcpServers' in definition) {
    const servers = definition.mcpServers;
    if (!servers || typeof servers !== 'object' || Array.isArray(servers))
      throw new Error('mcpServers must contain exactly one server.');
    const entries = Object.entries(servers);
    if (entries.length !== 1) throw new Error('Paste exactly one server inside mcpServers.');
    const [name, config] = entries[0];
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new Error('The MCP server configuration must be an object.');
    const parsedConfig = parseMCPConfig(JSON.stringify(config));
    return {
      ...(config as Partial<LibraryItem>),
      ...parsedConfig,
      name: (config as { name?: string }).name ?? name,
    };
  }

  return definition as Partial<LibraryItem>;
}

export function stringifyLibraryDefinition(value: unknown, format: LibraryDefinitionFormat) {
  if (format === 'json') return JSON.stringify(value, null, 2);
  if (format === 'yaml') return stringify(value);

  const definition =
    value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};
  const content = typeof definition.content === 'string' ? definition.content : '';
  delete definition.content;
  return `---\n${stringify(definition).trimEnd()}\n---\n${content}`;
}
