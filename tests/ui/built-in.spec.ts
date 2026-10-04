import { test, expect, _electron as electron } from '@playwright/test';
import { cp, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('a fresh app loads its bundled content into every sidebar section', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bundled-app-ui-'));
  const application = join(root, 'application');
  const bundle = join(application, 'built-in');
  await mkdir(application);
  // Isolated application root: no import step and no developer user data.
  await cp(resolve('out'), join(application, 'out'), { recursive: true });
  await symlink(resolve('node_modules'), join(application, 'node_modules'), 'dir');
  await writeFile(
    join(application, 'package.json'),
    JSON.stringify({
      name: 'bundle-fixture',
      version: '1.0.0',
      type: 'module',
      main: 'out/main/bootstrap.js',
    }),
  );
  for (const folder of ['agents', 'skills/builtin-writing', 'tools', 'mcp', 'kb/product-guide'])
    await mkdir(join(bundle, folder), { recursive: true });
  await writeFile(join(bundle, 'general.json'), JSON.stringify({ appName: 'Bundled Team App' }));
  await writeFile(join(bundle, 'landing.json'), JSON.stringify({ title: 'Bundled welcome' }));
  await writeFile(
    join(bundle, 'agents/builtin-helper.md'),
    '---\nname: Bundled helper\n---\nHelp the user.',
  );
  await writeFile(
    join(bundle, 'skills/builtin-writing/SKILL.md'),
    '---\nname: Bundled writing\n---\nWrite clearly.',
  );
  await writeFile(
    join(bundle, 'tools/builtin-add.ts'),
    `
    import { tool } from '@langchain/core/tools';
    import { z } from 'zod';
    export const add = tool(async ({ a, b }) => String(a + b), {
      name: 'bundled_add', description: 'Add numbers', schema: z.object({ a: z.number(), b: z.number() }),
    });
  `,
  );
  await writeFile(
    join(bundle, 'mcp/builtin-server.json'),
    JSON.stringify({
      name: 'Bundled MCP',
      enabled: false,
      transport: 'streamable-http',
      connection: { type: 'streamable-http', url: 'http://127.0.0.1:1/mcp' },
      runtime: { autoConnect: false },
    }),
  );
  await writeFile(
    join(bundle, 'kb/product-guide/intro.md'),
    '# Bundled guide\nWelcome to the product.',
  );
  const app = await electron.launch({
    args: [application],
    env: Object.fromEntries(
      Object.entries({ ...process.env, LOCALAI_DATA_DIR: join(root, 'user') }).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && entry[0] !== 'ELECTRON_RUN_AS_NODE',
      ),
    ),
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'Bundled welcome' })).toBeVisible();
    for (const [section, name] of [
      ['Agents', 'Bundled helper'],
      ['Skills', 'Bundled writing'],
      ['Tools', 'bundled_add'],
      ['MCP', 'Bundled MCP'],
    ]) {
      await page.getByRole('button', { name: section, exact: true }).click();
      const card = page
        .locator('details')
        .filter({ has: page.locator('summary').filter({ hasText: name }) })
        .first();
      await expect(card).toBeVisible();
      await card.locator(':scope > summary').click();
      await expect(card.getByText('Built-in · Read-only', { exact: true })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
      await expect(card.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Knowledge Base', exact: true }).click();
    await expect(page.getByRole('heading', { name: /product guide/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Bundled guide', exact: true })).toBeVisible();
    const blocked = await page.evaluate(async () => {
      const [agent] = await window.workspace.library.list('agents');
      try {
        await window.workspace.library.save('agents', { ...agent, name: 'Overwrite' });
      } catch (error) {
        return String(error);
      }
      return '';
    });
    expect(blocked).toContain('Built-in');
    await page.screenshot({ path: 'test-results/built-in.png' });
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
