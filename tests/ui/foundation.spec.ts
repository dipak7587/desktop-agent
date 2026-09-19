import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('launches a sandboxed desktop window', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'localai-ui-'));
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
    ),
    LOCALAI_DATA_DIR: dir,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], env });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'Good ideas start here.' })).toBeVisible();
    expect(
      await page.evaluate(() => typeof (window as unknown as { require: unknown }).require),
    ).toBe('undefined');
    const metrics = await app.evaluate(({ app }) => app.getAppMetrics());
    expect(metrics.find((m) => m.type === 'Tab')?.sandboxed).toBe(true);
    await page.screenshot({ path: 'test-results/foundation.png' });
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
