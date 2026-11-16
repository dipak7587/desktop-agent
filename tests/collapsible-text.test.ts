import { expect, it } from 'vitest';
import { needsCollapse } from '../src/renderer/components/common';

it('collapses text longer than two lines and keeps short text open', () => {
  expect(needsCollapse('one line')).toBe(false);
  expect(needsCollapse('a\nb')).toBe(false);
  expect(needsCollapse('a\nb\nc')).toBe(true);
  expect(needsCollapse('x'.repeat(500))).toBe(true);
});
