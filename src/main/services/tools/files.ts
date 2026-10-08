import type { LibraryItem } from '../../../shared/types';
import { legacyToolSource } from './legacy';
export { legacyToolSource } from './legacy';
import { librarySchema } from '../../../shared/schemas';
import { analyzeToolSource } from './typescript';

export function toolItemFromSource(
  source: string,
  metadata: Partial<LibraryItem> = {},
): LibraryItem {
  const analyzed = analyzeToolSource(source);
  return librarySchema.parse({
    ...metadata,
    name: analyzed.name,
    description: analyzed.description,
    content: analyzed.source,
    toolSource: analyzed.source,
    toolConfig: {
      type: 'langchain',
      parameters: [],
      inputSchema: analyzed.inputSchema,
      exportName: analyzed.exportName,
    },
  });
}
export function serializeToolFile(item: LibraryItem): string {
  const source =
    item.toolSource ??
    (item.toolConfig?.type === 'langchain' ? item.content : legacyToolSource(item));
  const checked = analyzeToolSource(source);
  const { toolSource: _source, ...metadata } = item;
  // Executable TypeScript remains the source of truth; app-only attributes are inert comments.
  const fields =
    item.toolConfig?.type === 'langchain'
      ? {
          id: item.id,
          group: item.group,
          enabled: item.enabled,
          env: item.env,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        }
      : metadata;
  return `// @workspace-tool ${JSON.stringify(fields)}\n${checked.source}`;
}
export function parseToolFile(raw: string, id: string): LibraryItem {
  const match = /^\/\/ @workspace-tool ([^\n]*)\n/.exec(raw);
  const metadata = match ? JSON.parse(match[1]) : {};
  const source = match ? raw.slice(match[0].length) : raw;
  const checked = analyzeToolSource(source);
  if (metadata.toolConfig?.type && metadata.toolConfig.type !== 'langchain') {
    const legacy = librarySchema.parse({ ...metadata, id });
    // A user edit to the executable source must take precedence over legacy comment metadata.
    if (analyzeToolSource(legacyToolSource(legacy)).source === checked.source)
      return { ...legacy, toolSource: checked.source };
    return toolItemFromSource(checked.source, { ...legacy, id });
  }
  return toolItemFromSource(checked.source, { ...metadata, id });
}
