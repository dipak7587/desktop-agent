import { _electron as electron, expect } from '@playwright/test';
import { env as processEnv, platform, arch } from 'node:process';
import { resolve } from 'node:path';
const executablePath =
  processEnv.LOCALAI_PACKAGED_APP ??
  (platform === 'darwin'
    ? resolve(`dist/mac-${arch}/LocalAI Workspace.app/Contents/MacOS/LocalAI Workspace`)
    : undefined);
if (!executablePath) throw new Error('Set LOCALAI_PACKAGED_APP to the packaged executable');
const env = Object.fromEntries(
  Object.entries(processEnv).filter(
    ([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && typeof value === 'string',
  ),
);
const app = await electron.launch({ executablePath, args: [], env, timeout: 30000 });
try {
  const page = await app.firstWindow({ timeout: 30000 });
  await expect(page.getByRole('heading', { name: 'Good ideas start here.' })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole('button', { name: 'Knowledge Base', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Knowledge Base', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/packaged-app.png' });
  const packaged = await app.evaluate(({ app }) => app.isPackaged);
  if (!packaged) throw new Error('Expected the actual packaged application');
} finally {
  await app.close();
}
