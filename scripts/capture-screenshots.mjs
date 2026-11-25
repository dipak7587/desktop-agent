// Regenerates docs/assets/*.png from the compiled app using an isolated data directory.
// Usage: pnpm build && node scripts/capture-screenshots.mjs
import { _electron as electron } from '@playwright/test';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const out = join(import.meta.dirname, '..', 'docs', 'assets');
const root = await mkdtemp(join(tmpdir(), 'localai-shots-'));
await mkdir(out, { recursive: true });
await writeFile(
  join(root, 'settings.json'),
  JSON.stringify({ chatModel: 'demo-model', ollamaUrl: 'http://127.0.0.1:1' }),
);
const env = Object.fromEntries(
  Object.entries({ ...process.env, LOCALAI_DATA_DIR: root }).filter(
    (e) => typeof e[1] === 'string' && e[0] !== 'ELECTRON_RUN_AS_NODE',
  ),
);
const app = await electron.launch({ args: ['.'], env });
try {
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.getByRole('heading', { name: 'Good ideas start here.' }).waitFor();
  const shots = [
    ['Chat', 'chat'],
    ['Agents', 'agents'],
    ['Workflows', 'workflows'],
    ['Code', 'code'],
    ['Tools', 'tools'],
    ['MCP', 'mcp'],
    ['Skills', 'skills'],
    ['Settings', 'settings'],
  ];
  for (const [name, file] of shots) {
    const button = page.getByRole('button', { name, exact: true });
    if (!(await button.count())) {
      console.warn(`skipped ${name}: no sidebar button`);
      continue;
    }
    await button.first().click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, `${file}.png`) });
    console.log(`saved ${file}.png`);
  }
} finally {
  await app.close();
  await rm(root, { recursive: true, force: true });
}
