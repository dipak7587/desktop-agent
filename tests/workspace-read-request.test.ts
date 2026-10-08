import { expect, it } from 'vitest';
import { workspaceReadRequest } from '../src/main/services/agents/workspace-read-request';
it.each(['list my folders', 'show the project files', 'read my folders'])(
  'recognizes folder inspection: %s',
  (task) => {
    expect(workspaceReadRequest(task)).toEqual({ id: 'filesystem.list', args: { path: '.' } });
  },
);
it.each([
  'hi',
  'do not read package.json',
  'explain package.json without reading files',
  'write package.json',
  'what is a package.json file?',
  'read package.json and delete it',
])('leaves ambiguous, prohibited or modifying requests to the model: %s', (task) => {
  expect(workspaceReadRequest(task)).toBeUndefined();
});
