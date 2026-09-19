import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/ui',
  workers: 1,
  timeout: 120000,
  use: { trace: 'retain-on-failure' },
  reporter: 'list',
});
