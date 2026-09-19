import { _electron as electron, expect } from '@playwright/test';
import { env as processEnv, argv } from 'node:process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root = await mkdtemp(join(tmpdir(), 'localai-dev-smoke-'));
const env = Object.fromEntries(
  Object.entries(processEnv).filter(
    ([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && typeof value === 'string',
  ),
);
const url = argv[2];
if (!url) throw new Error('Pass the renderer dev server URL');
const app = await electron.launch({
  args: ['.'],
  env: { ...env, LOCALAI_DATA_DIR: root, ELECTRON_RENDERER_URL: url },
});
try {
  const page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'Good ideas start here.' })).toBeVisible({
    timeout: 30000,
  });
  await expect(page).toHaveURL(new RegExp(url.replaceAll('.', '\\.')));
  await page.screenshot({ path: 'test-results/dev-app.png' });
} finally {
  await app.close();
  await rm(root, { recursive: true, force: true });
}
