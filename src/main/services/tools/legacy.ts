import type { LibraryItem } from '../../../shared/types';
import { generateToolSource } from '../../../shared/tool-definition';

export function legacyToolSource(item: LibraryItem): string {
  const config = item.toolConfig!;
  const name = item.name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^[0-9]/, '_$&') || 'custom_tool';
  let body = item.content;
  if (config.type === 'api') {
    body = `const url = new URL(${JSON.stringify(config.url)});\nconst headers = ${JSON.stringify(config.headers)};\nif (${JSON.stringify(config.method)} === "GET") {\n  for (const [key, value] of Object.entries(input)) url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));\n}\nconst response = await fetch(url, { method: ${JSON.stringify(config.method)}, headers: { "Content-Type": "application/json", ...headers }, body: ${JSON.stringify(config.method)} === "GET" ? undefined : JSON.stringify(input), redirect: "error" });\nconst result = await response.text();\nif (!response.ok) throw new Error("HTTP " + response.status + ": " + result.slice(0, 2000));\nreturn result;`;
  }
  // Legacy functions receive the original input object and require; keep that contract.
  const generated = generateToolSource(
    {
      name,
      description: item.description || `Run ${item.name}`,
      inputs: config.parameters,
      functionBody: body,
    },
    true,
    true,
  );
  return generated.replace(
    /async \(__toolInput\) => \{\n {4}const \{[^\n]*\} = __toolInput;/,
    'async (input) => {',
  );
}
