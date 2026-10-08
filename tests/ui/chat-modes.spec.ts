import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('checkboxes filter slash commands and keep KB scope alongside tool selection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chat-modes-ui-'));
  await writeFile(
    join(root, 'settings.json'),
    JSON.stringify({ chatModel: 'test', ollamaUrl: 'http://127.0.0.1:1' }),
  );
  await writeFile(
    join(root, 'knowledge.json'),
    JSON.stringify([
      {
        id: 'project-docs',
        name: 'Project Docs',
        type: 'folder',
        location: root,
        status: 'idle',
        collection: '',
        documentCount: 0,
        chunkCount: 0,
        createdAt: 0,
        updatedAt: 0,
      },
    ]),
  );
  const app = await electron.launch({
    args: ['.'],
    env: Object.fromEntries(
      Object.entries({ ...process.env, LOCALAI_DATA_DIR: root }).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && entry[0] !== 'ELECTRON_RUN_AS_NODE',
      ),
    ),
  });
  try {
    const page = await app.firstWindow();
    const input = page.getByLabel('Message', { exact: true });
    await expect(page.getByLabel('Knowledge context')).toHaveCount(0);
    for (const name of ['KB', 'MCP', 'Tools', 'Skills', 'Code', 'Agent', 'Workflow'])
      await expect(page.getByRole('checkbox', { name, exact: true })).not.toBeChecked();
    await input.fill('/');
    const allOptions = page.getByRole('listbox');
    for (const suggestion of [
      '/store-context',
      '/all-kb',
      '/Project Docs',
      '/mcp',
      '/tools',
      '/skills',
      '/agent',
      '/workflow',
      '/code',
    ])
      await expect(allOptions).toContainText(suggestion);
    await page.getByRole('listbox').getByRole('option').filter({ hasText: '/skills' }).click();
    await expect(page.getByRole('checkbox', { name: 'Skills', exact: true })).toBeChecked();
    await page.getByRole('checkbox', { name: 'Skills', exact: true }).uncheck();
    await input.fill('/');
    await page.getByRole('checkbox', { name: 'KB', exact: true }).check();
    await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(3);
    await expect(page.getByRole('listbox').getByRole('option')).toContainText([
      '/store-context',
      '/all-kb',
      '/Project Docs',
    ]);
    await page
      .getByRole('listbox')
      .getByRole('option', { name: '/Project Docs KB folder · idle', exact: true })
      .click();
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Tools', exact: true }).check();
    await input.fill('/');
    await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(4);
    await expect(page.getByRole('listbox').getByRole('option', { name: /\/tools/ })).toBeVisible();
    await expect(page.getByRole('listbox').getByRole('option', { name: /\/mcp/ })).toHaveCount(0);
    await expect(page.getByRole('listbox').getByRole('option', { name: /\/code/ })).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'KB', exact: true }).uncheck();
    await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1);
    await expect(page.getByRole('listbox').getByRole('option')).toContainText('/tools');
    await page.getByRole('checkbox', { name: 'Tools', exact: true }).uncheck();
    for (const [name, command] of [
      ['MCP', '/mcp'],
      ['Agent', '/agent'],
      ['Workflow', '/workflow'],
      ['Skills', '/skills'],
      ['Code', '/code'],
    ]) {
      await page.getByRole('checkbox', { name, exact: true }).check();
      await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1);
      await expect(page.getByRole('listbox').getByRole('option')).toContainText(command);
      if (name === 'Code') {
        await input.fill('/code');
        await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1);
        await expect(page.getByRole('listbox').getByRole('option')).toContainText(
          'Open another folder',
        );
        await input.fill('/');
      }
      await page.getByRole('checkbox', { name, exact: true }).uncheck();
    }
    await page.getByRole('checkbox', { name: 'KB', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Tools', exact: true }).check();
    await page.screenshot({ path: 'test-results/chat-modes.png' });
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
