import { expect, it } from 'vitest';
import { withWorkspacePolicy, isLocalCodeProvider } from '../src/main/services/agents/coding';
import { librarySchema } from '../src/shared/schemas';
import type { CodeWorkspace } from '../src/shared/types';

const workspace: CodeWorkspace = {
  id: 'project',
  name: 'Project',
  canonicalPath: '/project',
  createdAt: '',
  lastOpenedAt: '',
  selectedAgentId: null,
  permissions: { rules: {} },
};
it('defaults linked project operations to Ask without expanding agent selection', () => {
  const agent = librarySchema.parse({ id: 'reader', name: 'Reader', tools: ['filesystem.read'] });
  const scoped = withWorkspacePolicy(agent, workspace);
  expect(scoped.capabilityConfig?.tools).toEqual(['filesystem.read']);
  expect(scoped.capabilityConfig?.permissions['filesystem.read']).toBe('ask');
  expect(agent.capabilityConfig).toBeUndefined();
});
it('intersects workspace and agent denials with more specific allows', () => {
  const agent = librarySchema.parse({
    id: 'reader',
    name: 'Reader',
    capabilityConfig: {
      tools: ['filesystem.read'],
      permissions: { tool: 'deny', 'filesystem.read': 'always_allow' },
    },
  });
  const allowed = {
    ...workspace,
    permissions: {
      rules: {
        'filesystem.read': { decision: 'always_allow' as const, scope: 'workspace' as const },
      },
    },
  };
  expect(withWorkspacePolicy(agent, allowed).capabilityConfig?.permissions['filesystem.read']).toBe(
    'deny',
  );
  const denied = {
    ...allowed,
    permissions: {
      rules: {
        ...allowed.permissions.rules,
        tool: { decision: 'deny' as const, scope: 'workspace' as const },
      },
    },
  };
  expect(
    withWorkspacePolicy(librarySchema.parse({ id: 'reader', name: 'Reader' }), denied)
      .capabilityConfig?.permissions['filesystem.read'],
  ).toBe('deny');
});

it('accepts local inference endpoints and rejects cloud profiles', () => {
  expect(
    isLocalCodeProvider({
      provider: 'ollama',
      ollamaUrl: 'https://127.evil.example',
      apiBaseUrl: '',
    }),
  ).toBe(false);
  expect(
    isLocalCodeProvider({
      provider: 'ollama',
      ollamaUrl: 'http://localhost:11434',
      apiBaseUrl: '',
    }),
  ).toBe(true);
  expect(
    isLocalCodeProvider({
      provider: 'custom',
      ollamaUrl: '',
      apiBaseUrl: 'http://192.168.1.10:1234/v1',
    }),
  ).toBe(true);
  expect(
    isLocalCodeProvider({
      provider: 'openai',
      ollamaUrl: '',
      apiBaseUrl: 'https://api.openai.com/v1',
    }),
  ).toBe(false);
  expect(
    isLocalCodeProvider({ provider: 'ollama', ollamaUrl: 'https://ollama.com', apiBaseUrl: '' }),
  ).toBe(false);
});
