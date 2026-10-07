import { parse, stringify } from 'yaml';
import { validateWorkflow, type AgentWorkflow } from './workflows';
import { validateDeclarative } from './declarative-workflows';
export type WorkflowFormat = 'form' | 'json' | 'yaml' | 'md';
export function parseWorkflow(
  source: string,
  format: Exclude<WorkflowFormat, 'form'>,
  base: AgentWorkflow,
): AgentWorkflow {
  if (source.length > 1000000) throw new Error('Workflow document exceeds 1 MB');
  source = source.replaceAll('\r\n', '\n');
  let text = source;
  if (format === 'md') {
    const fences = [...source.matchAll(/^```(yaml|yml|json)\s*\n([\s\S]*?)^```\s*$/gm)];
    if (fences.length === 1) {
      text = fences[0][2];
      format = fences[0][1] === 'json' ? 'json' : 'yaml';
    } else if (source.startsWith('---\n') && source.indexOf('\n---', 4) >= 0) {
      text = source.slice(4, source.indexOf('\n---', 4));
      format = 'yaml';
    } else throw new Error('Markdown requires one YAML/JSON code block or YAML front matter.');
  }
  const value =
    format === 'json' ? JSON.parse(text) : parse(text, { maxAliasCount: 50, uniqueKeys: true });
  if (value && typeof value === 'object' && 'steps' in value) {
    const definition = validateDeclarative(
      value,
      typeof value.maxDepth === 'number' ? Math.min(100, value.maxDepth) : base.maxDepth,
    );
    return validateWorkflow({
      ...base,
      name: definition.name,
      maxDepth: definition.maxDepth ?? base.maxDepth,
      maxIterations: definition.maxIterations ?? base.maxIterations,
      description: definition.description ?? '',
      agents: [],
      connections: [],
      definition,
    });
  }
  return validateWorkflow({
    ...value,
    id: base.id,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
  });
}
export function serializeWorkflow(
  workflow: AgentWorkflow,
  format: Exclude<WorkflowFormat, 'form'>,
): string {
  const value = workflow.definition
    ? {
        ...workflow.definition,
        name: workflow.name,
        description: workflow.description,
        maxDepth: workflow.maxDepth,
        maxIterations: workflow.maxIterations,
      }
    : workflow;
  if (format === 'json') return JSON.stringify(value, null, 2);
  const yaml = stringify(value);
  return format === 'md' ? `# ${workflow.name}\n\n\`\`\`yaml\n${yaml}\`\`\`\n` : yaml;
}
