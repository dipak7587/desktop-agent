import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('custom tools, dependency errors, temporary folders and bulk agent deletion', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'workspace-features-ui-')));
  await writeFile(
    join(root, 'settings.json'),
    JSON.stringify({ chatModel: 'ui-test-model', ollamaUrl: 'http://127.0.0.1:1' }),
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
    await expect(page.getByRole('heading', { name: 'Good ideas start here.' })).toBeVisible();
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('button', { name: 'New tool', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill('Double');
    await page
      .getByLabel('Input parameters')
      .fill('[{"name":"value","type":"number","required":true}]');
    await page.getByLabel('JavaScript logic').fill('return input.value * 2;');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Test / Run' }).click();
    await page.getByLabel('Input · JSON').fill('{"value":3}');
    await page.getByRole('button', { name: 'Run tool', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('status')).toHaveText('6');
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: 'Agents', exact: true }).click();
    for (const name of ['Reviewer', 'Writer']) {
      await page.getByRole('button', { name: 'New agent' }).click();
      await page.getByLabel('Name', { exact: true }).fill(name);
      await page.getByLabel('Maximum execution iterations').fill('500');
      await page.getByRole('radio', { name: 'None', exact: true }).check();
      await expect(page.getByLabel('Double', { exact: true })).toBeDisabled();
      await expect(page.getByLabel('Allow Skills', { exact: true })).toBeDisabled();
      await page.getByRole('radio', { name: 'Auto', exact: true }).check();
      await expect(page.getByLabel('Double', { exact: true })).toBeDisabled();
      await page.getByRole('radio', { name: 'Selected', exact: true }).check();
      await page.getByLabel('Allow Tools', { exact: true }).uncheck();
      await expect(page.getByLabel('Double', { exact: true })).toBeDisabled();
      await page.getByLabel('Allow Tools', { exact: true }).check();
      await page.getByLabel('Show capability decisions in history and Chat').check();
      await page.getByText('Capability permissions', { exact: true }).click();
      await expect(page.getByLabel('Permission: shell.execute', { exact: true })).toHaveCount(0);
      await page.getByLabel('shell.execute', { exact: true }).check();
      await page.getByLabel('Permission: shell.execute', { exact: true }).selectOption('deny');
      await page.getByLabel('shell.execute', { exact: true }).uncheck();
      await expect(page.getByLabel('Permission: shell.execute', { exact: true })).toHaveCount(0);
      await page.getByLabel('shell.execute', { exact: true }).check();
      await expect(page.getByLabel('Permission: shell.execute', { exact: true })).toHaveValue(
        'deny',
      );
      await page.getByLabel('filesystem.read', { exact: true }).uncheck();
      await page.getByRole('radio', { name: 'None', exact: true }).check();
      await expect(page.getByLabel('Permission: shell.execute', { exact: true })).toHaveCount(0);
      await page.getByRole('radio', { name: 'Auto', exact: true }).check();
      await expect(page.getByLabel('Permission: filesystem.read', { exact: true })).toBeVisible();
      await page.getByRole('radio', { name: 'Selected', exact: true }).check();
      await expect(page.getByLabel('Permission: filesystem.read', { exact: true })).toHaveCount(0);
      await page.getByText('Capability permissions', { exact: true }).click();
      await page.getByLabel('Double', { exact: true }).check();
      if (name === 'Reviewer') {
        await page.getByRole('radio', { name: 'Auto', exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: 'test-results/capability-settings.png' });
      }
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByRole('dialog')).not.toBeVisible();
    }
    await page.getByRole('button', { name: 'Run', exact: true }).first().click();
    await expect(page.getByText('No folder selected', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start agent' })).toBeEnabled();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, root);
    await page.getByRole('button', { name: 'Select Folder', exact: true }).click();
    await expect(page.getByText(root, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Remove Folder' }).click();
    await expect(page.getByText('No folder selected', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Select Folder', exact: true }).click();
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, tmpdir());
    await page.getByRole('button', { name: 'Change Folder' }).click();
    await expect(page.locator('.folder-path')).not.toHaveText(root);
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: 'Tools', exact: true }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Reviewer');
    await expect(page.getByRole('alert')).toContainText('Writer');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Dismiss error' }).click();
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await page.getByLabel('Message', { exact: true }).fill('/agent Reviewer');
    await expect(page.getByText('No folder selected', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Select Folder', exact: true }).click();
    await page.getByRole('button', { name: 'Remove Folder' }).click();
    await expect(page.getByText('No folder selected', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Agents', exact: true }).click();
    await page.getByLabel('Select all Agents').check();
    await page.getByRole('button', { name: 'Delete Selected' }).click();
    await expect(page.getByRole('dialog')).toContainText('Delete 2 agents?');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('.library-card')).toHaveCount(2);
    await page.getByRole('button', { name: 'Delete Selected' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByText('Your agents start here')).toBeVisible();
    await page.getByRole('button', { name: 'MCP', exact: true }).click();
    await page.getByRole('button', { name: 'New server' }).click();
    await page.getByLabel('Name (required)').fill('Manual server');
    await page.getByLabel('Description (required)').fill('Startup configuration test');
    await page
      .getByLabel('Environment variables · JSON')
      .fill(JSON.stringify({ MODE: 'production', TOKEN: '${TOKEN}', EMPTY: '' }));
    await page.getByLabel('Start automatically when application starts').check();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Auto start: On')).toBeVisible();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    expect(JSON.parse(await page.getByLabel('Environment variables · JSON').inputValue())).toEqual({
      MODE: 'production',
      TOKEN: '${TOKEN}',
      EMPTY: '',
    });
    await page.getByLabel('Import from JSON').check();
    await page
      .getByLabel('MCP configuration JSON')
      .fill(JSON.stringify({ env: { MODE: 'development', TOKEN: 'literal-token' } }));
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    expect(JSON.parse(await page.getByLabel('Environment variables · JSON').inputValue())).toEqual({
      MODE: 'development',
      TOKEN: 'literal-token',
    });
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.screenshot({ path: 'test-results/new-features-mcp.png' });
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
