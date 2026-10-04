import { librarySchema } from './schemas';

export const BUILTIN_CODING_AGENT_ID = 'builtin-coding-agent';

const readTools = [
  'project.detect',
  'filesystem.read',
  'filesystem.list',
  'filesystem.search',
  'filesystem.exists',
  'git.status',
  'git.diff',
  'git.log',
];

export const codeAgentTemplates = [
  {
    id: 'coding',
    name: 'Coding',
    description: 'Implement features and fix bugs.',
    instructions: 'Implement the requested code changes, then verify them with relevant tests.',
    edits: true,
    commands: true,
  },
  {
    id: 'tests',
    name: 'Test Cases',
    description: 'Create unit, integration, and end-to-end tests.',
    instructions:
      'Inspect the existing test framework and add meaningful regression, boundary, and failure-case tests. Run the relevant tests. Do not weaken assertions to hide bugs.',
    edits: true,
    commands: true,
  },
  {
    id: 'runner',
    name: 'Test Runner',
    description: 'Run checks and investigate failures.',
    instructions:
      'Discover and run the relevant project tests, lint, or type checks with permission. Report exact commands, results, and likely root causes. Do not edit project files.',
    edits: false,
    commands: true,
  },
  {
    id: 'review',
    name: 'Code Review',
    description: 'Review changes for bugs and regressions.',
    instructions:
      'Review the requested changes using project files and Git diffs. Prioritize actionable bugs and regressions, citing file paths and lines. Do not modify files.',
    edits: false,
    commands: false,
  },
  {
    id: 'mr',
    name: 'MR Preparation',
    description: 'Draft a merge-request title and description.',
    instructions:
      'Inspect Git status, diffs, and relevant history. Prepare a merge-request title, description, testing summary, and risks based on actual changes. Clearly distinguish verified checks from suggested checks. Return the draft for review; do not commit, push, or publish.',
    edits: false,
    commands: false,
  },
  {
    id: 'commit-push',
    name: 'Commit and Push',
    description: 'Review requested changes, commit selected files, and push the current branch.',
    instructions:
      'Review the Git status and diffs before acting. Only commit changes explicitly requested by the user; do not include unrelated or pre-staged changes. Propose the explicit file list and use the approval-gated Git add tool to stage only those files. Then use the approval-gated Git commit tool with that same file list and a concise message. Never amend, reset, clean, force-push, or stage all files. Push only the current branch to its configured upstream, using the separate approval-gated push tool. If the scope or destination is unclear, ask before acting; if there is no upstream, stop and explain.',
    edits: false,
    commands: false,
    gitActions: true,
  },
  {
    id: 'refactor',
    name: 'Refactoring',
    description: 'Improve code structure while preserving behavior.',
    instructions:
      'Refactor the requested code in small steps, preserving behavior and public interfaces. Verify with relevant tests.',
    edits: true,
    commands: true,
  },
  {
    id: 'docs',
    name: 'Documentation',
    description: 'Write and update project documentation.',
    instructions:
      'Verify details against the source and update the requested documentation. Keep examples accurate and state any unverified assumptions.',
    edits: true,
    commands: false,
  },
  {
    id: 'custom',
    name: 'Custom',
    description: 'Define your own specialist agent.',
    instructions:
      'Complete the user’s requested project task using the configured tools and permissions.',
    edits: true,
    commands: true,
  },
] as const;

export function createCodeAgent(
  templateId: string,
  id: string,
  providerId?: string,
  model = '',
  maxIterations = 15,
) {
  const template = codeAgentTemplates.find((entry) => entry.id === templateId);
  if (!template) throw new Error('Choose a code agent template.');
  const tools = [
    ...readTools,
    ...(template.edits ? ['filesystem.write', 'filesystem.edit'] : []),
    ...(template.commands ? ['shell.execute'] : []),
    ...('gitActions' in template && template.gitActions
      ? ['git.add', 'git.commit', 'git.push']
      : []),
  ];
  return librarySchema.parse({
    id,
    name: template.name,
    description: template.description,
    content: template.instructions,
    agentRuntime: 'deepagents-acp',
    group: 'Code',
    providerId,
    model,
    maxIterations,
    tools,
    capabilityConfig: {
      mode: 'selected',
      tools,
      permissions: {
        'filesystem.write': template.edits ? 'ask' : 'deny',
        'filesystem.edit': template.edits ? 'ask' : 'deny',
        'filesystem.delete': 'deny',
        'shell.execute': template.commands ? 'ask' : 'deny',
        'git.commit': 'ask',
        'git.push': 'ask',
        'git.add': 'ask',
      },
    },
  });
}
