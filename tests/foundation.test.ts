import { it, expect } from 'vitest';
import {
  sendSchema,
  runInputSchema,
  sourceInputSchema,
  settingsSchema,
} from '../src/shared/schemas';
it('rejects malformed IPC requests before they reach a service', () => {
  expect(() =>
    sendSchema.parse({ id: '../../outside', text: 'hello', model: 'local', knowledge: 'none' }),
  ).toThrow();
  expect(() =>
    sendSchema.parse({ id: 'valid', text: 'hello', model: '', knowledge: 'none' }),
  ).toThrow();
  expect(runInputSchema.parse({ agentId: 'a', task: 'x' }).project).toBeUndefined();
  expect(() => runInputSchema.parse({ agentId: 'a', task: 'x', project: 42 })).toThrow();
  expect(() =>
    sourceInputSchema.parse({ type: 'executable', url: 'file:///etc/passwd' }),
  ).toThrow();
});
it('rejects credential-bearing provider URLs and unsafe numerical settings', () => {
  expect(() => settingsSchema.parse({ ollamaUrl: 'https://user:password@example.com' })).toThrow();
  expect(() => settingsSchema.parse({ ollamaUrl: 'file:///tmp/file' })).toThrow();
  expect(() => settingsSchema.parse({ maxIterations: 0 })).toThrow();
  expect(() => settingsSchema.parse({ commandTimeout: 99999999 })).toThrow();
});
