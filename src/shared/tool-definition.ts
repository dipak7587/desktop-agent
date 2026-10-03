import { z } from 'zod';

export const toolInputTypes = ['string', 'number', 'boolean', 'array', 'object', 'enum', 'date', 'any'] as const;
export const toolInputSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Use letters, numbers, and underscores; start with a letter or underscore.'),
  type: z.enum(toolInputTypes),
  description: z.string().optional(),
  required: z.boolean().default(true),
  defaultValue: z.unknown().optional(),
  enumValues: z.array(z.string()).optional(),
}).strict().superRefine((input, ctx) => {
  if (input.type === 'enum' && !input.enumValues?.length) ctx.addIssue({ code: 'custom', message: 'Enum inputs need at least one value', path: ['enumValues'] });
  if (input.defaultValue === undefined) return;
  const value = input.defaultValue;
  const valid = input.type === 'any' || (input.type === 'enum' ? input.enumValues?.includes(String(value)) && typeof value === 'string' : input.type === 'array' ? Array.isArray(value) : input.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : input.type === 'date' ? typeof value === 'string' && !Number.isNaN(Date.parse(value)) : typeof value === input.type);
  if (!valid) ctx.addIssue({ code: 'custom', message: `Default value must match ${input.type}`, path: ['defaultValue'] });
});
export const toolDefinitionSchema = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Tool names use letters, numbers, and underscores, without spaces.'),
  description: z.string().trim().min(1, 'Describe what this tool does.'),
  inputs: z.array(toolInputSchema).max(100).refine((inputs) => new Set(inputs.map((p) => p.name)).size === inputs.length, 'Parameter names must be unique'),
  functionBody: z.string().trim().min(1, 'Add function logic.'),
}).strict();
export type ToolInputDefinition = z.infer<typeof toolInputSchema>;
export type ToolDefinition = z.infer<typeof toolDefinitionSchema>;
export type ToolImportFormat = 'typescript' | 'json' | 'yaml' | 'markdown';
export interface ToolAnalysis {
  source: string;
  name: string;
  description: string;
  exportName: string;
  inputSchema: Record<string, unknown>;
  definition?: ToolDefinition;
  advanced: boolean;
  checks: string[];
}

/** One generator for Builder, JSON, YAML, Markdown, and legacy imports. Never executes code. */
export function generateToolSource(definition: ToolDefinition, validate = true): string {
  const value = validate ? toolDefinitionSchema.parse(definition) : definition;
  const schema = value.inputs.map((input) => {
    toolInputSchema.parse(input);
    let expression = input.type === 'array' ? 'z.array(z.any())' : input.type === 'object' ? 'z.record(z.string(), z.any())' : input.type === 'enum' ? `z.enum(${JSON.stringify(input.enumValues)})` : `z.${input.type}()`;
    if (input.defaultValue !== undefined) expression += `.default(${input.type === 'date' ? `new Date(${JSON.stringify(input.defaultValue)})` : JSON.stringify(input.defaultValue)})`;
    else if (!input.required) expression += '.optional()';
    if (input.description) expression += `.describe(${JSON.stringify(input.description)})`;
    return `    ${JSON.stringify(input.name)}: ${expression},`;
  }).join('\n');
  const names = value.inputs.map((p) => p.name).join(', ');
  // Quoted name and fixed export identifier prevent code injection through metadata.
  return `import { tool } from "langchain/tools";\nimport { z } from "zod";\n\nexport const customTool = tool(\n  async (input) => {\n    const { ${names} } = input;\n    // Start coding from here.\n${value.functionBody.split('\n').map((line) => `    ${line}`).join('\n')}\n  },\n  {\n    name: ${JSON.stringify(value.name)},\n    description: ${JSON.stringify(value.description)},\n    schema: z.object({\n${schema}\n    }),\n  },\n);\n`;
}

export const toolExamples: Record<'starter' | 'calculator' | 'search', ToolDefinition> = {
  starter: { name: 'my_tool', description: 'Describe what this tool does.', inputs: [{ name: 'input', type: 'string', required: true, description: 'Input value' }], functionBody: 'return input;' },
  calculator: { name: 'calculator', description: 'Perform a basic arithmetic operation.', inputs: [{ name: 'a', type: 'number', required: true, description: 'First number' }, { name: 'b', type: 'number', required: true, description: 'Second number' }, { name: 'operation', type: 'enum', required: true, enumValues: ['add', 'subtract', 'multiply', 'divide'], description: 'Arithmetic operation' }], functionBody: `switch (operation) {\n  case "add": return a + b;\n  case "subtract": return a - b;\n  case "multiply": return a * b;\n  case "divide":\n    if (b === 0) throw new Error("Cannot divide by zero");\n    return a / b;\n  default: throw new Error("Unsupported operation");\n}` },
  search: { name: 'search_files', description: 'Search files in a workspace using a query and optional filters.', inputs: [{ name: 'query', type: 'string', required: true, description: 'Search query' }, { name: 'directory', type: 'string', required: false, defaultValue: '.', description: 'Directory to search' }, { name: 'extensions', type: 'array', required: false, description: 'Optional file extensions' }, { name: 'maxResults', type: 'number', required: false, defaultValue: 20, description: 'Maximum results' }], functionBody: 'return { query, directory, extensions, maxResults, results: [] };' },
};
