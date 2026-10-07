import { parse, stringify } from 'yaml';
import { validateWorkflow, type AgentWorkflow } from './workflows';
import { validateDeclarative } from './declarative-workflows';
export type WorkflowFormat = 'form' | 'json' | 'yaml' | 'md';
function readWorkflowSource(source: string, format: Exclude<WorkflowFormat, 'form'>): unknown {
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
  return format === 'json'
    ? JSON.parse(text)
    : parse(text, { maxAliasCount: 50, uniqueKeys: true });
}

/** Export draft documents without requiring an executable workflow. */
export function convertWorkflowSource(
  source: string,
  from: Exclude<WorkflowFormat, 'form'>,
  to: Exclude<WorkflowFormat, 'form'>,
): string {
  if (from === to) return source;
  const value = readWorkflowSource(source, from);
  if (to === 'json') return JSON.stringify(value, null, 2);
  const yaml = stringify(value);
  return to === 'md' ? `# Workflow draft\n\n\`\`\`yaml\n${yaml}\`\`\`\n` : yaml;
}

export function parseWorkflow(
  source: string,
  format: Exclude<WorkflowFormat, 'form'>,
  base: AgentWorkflow,
  options: { draft?: boolean } = {},
): AgentWorkflow {
  const value = readWorkflowSource(source, format);
  if (value && typeof value === 'object' && 'steps' in value) {
    const definition = validateDeclarative(
      value,
      'maxDepth' in value && typeof value.maxDepth === 'number'
        ? Math.min(100, value.maxDepth)
        : base.maxDepth,
      options.draft,
    );
    const workflow: AgentWorkflow = {
      ...base,
      name: definition.name,
      maxDepth: definition.maxDepth ?? base.maxDepth,
      maxIterations: definition.maxIterations ?? base.maxIterations,
      description: definition.description ?? '',
      agents: [],
      connections: [],
      definition,
    };
    return options.draft ? workflow : validateWorkflow(workflow);
  }
  return validateWorkflow({
    ...(value && typeof value === 'object' ? value : {}),
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
