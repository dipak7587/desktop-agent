import { expect, it } from 'vitest';
import { withWorkspacePolicy } from '../src/main/services/agents/coding';
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
