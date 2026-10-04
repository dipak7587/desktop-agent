const text = { type: 'string' };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
/** Native tool argument schemas; privileged executors still validate inputs at execution. */
export const workspaceToolSchemas: Record<string, Record<string, unknown>> = {
  'filesystem.read': object(
    {
      path: text,
      offset: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 1000 },
    },
    ['path'],
  ),
  'filesystem.list': object({ path: text }),
  'filesystem.exists': object({ path: text }, ['path']),
  'filesystem.search': object({ query: text }, ['query']),
  'filesystem.write': object({ path: text, content: text, expectedHash: text }, [
    'path',
    'content',
    'expectedHash',
  ]),
  'filesystem.delete': object({ path: text, expectedHash: text }, ['path', 'expectedHash']),
  'filesystem.edit': object({ path: text, find: text, replace: text, expectedHash: text }, [
    'path',
    'find',
    'replace',
    'expectedHash',
  ]),
  'project.detect': object({}),
  'git.status': object({}),
  'git.diff': object({}),
  'git.log': object({}),
  'git.add': object(
    {
      paths: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 4096 } },
    },
    ['paths'],
  ),
  'git.commit': object(
    {
      message: { type: 'string', minLength: 1, maxLength: 2000 },
      paths: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 4096 } },
    },
    ['message', 'paths'],
  ),
  'git.push': object({}),
  'shell.execute': object(
    {
      command: {
        type: 'string',
        enum: [
          'npm',
          'pnpm',
          'yarn',
          'node',
          'python',
          'python3',
          'pytest',
          'uv',
          'ruff',
          'cargo',
          'go',
          'dotnet',
          'java',
          'javac',
          'mvn',
          'gradle',
          'make',
          'cmake',
          'ctest',
          'ruby',
          'bundle',
          'php',
          'composer',
        ],
      },
      cwd: text,
      reason: text,
      args: { type: 'array', items: text },
    },
    ['command', 'args'],
  ),
};
