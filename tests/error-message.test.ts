import { expect, it } from 'vitest';
import { errorMessage } from '../src/shared/error-message';

it('extracts useful messages from nested provider errors', () => {
  expect(errorMessage({ error: { message: 'Model does not support tools' } })).toBe(
    'Model does not support tools',
  );
  expect(errorMessage({ response: { data: { error: { message: 'Unsupported request' } } } })).toBe(
    'Unsupported request',
  );
  expect(errorMessage(new Error('Connection refused'))).toBe('Connection refused');
  expect(
    errorMessage(new Error('[object Object]', { cause: { message: 'Model cannot use tools' } })),
  ).toBe('Model cannot use tools');
});

it('serializes structured errors instead of displaying [object Object]', () => {
  expect(errorMessage({ status: 400, parameter: 'tool_choice' })).toBe(
    '{"status":400,"parameter":"tool_choice"}',
  );
  expect(errorMessage('[object Object]')).toBe('[object Object]');
});