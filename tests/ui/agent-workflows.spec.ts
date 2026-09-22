import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('workflow builder saves, connects, validates cycles, duplicates, runs, and offers chat commands', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'agent-workflow-ui-')));
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
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.setBackgroundThrottling(false);
    });
    await page.getByRole('button', { name: 'Agents', exact: true }).click();
    for (const name of ['Analysis', 'Review']) {
      await page.getByRole('button', { name: 'New agent', exact: true }).click();
      await page.getByLabel('Name', { exact: true }).fill(name);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Workflows', exact: true }).click();
    await page.getByRole('button', { name: 'New workflow' }).click();
    const modal = page.getByRole('dialog');
    await modal.getByLabel('Name (required)').fill('Quality workflow');
    await modal.getByLabel('Execution mode').selectOption('mixed');
    for (const name of ['Analysis', 'Review']) {
      await modal.getByLabel('Add agent', { exact: true }).selectOption({ label: name });
      await modal.getByRole('button', { name: 'Add Agent', exact: true }).click();
    }
    const analysis = modal.getByRole('group', { name: '1. Analysis', exact: true });
    const review = modal.getByRole('group', { name: '2. Review', exact: true });
    await review.getByRole('checkbox', { name: 'Analysis', exact: true }).check();
    await analysis.getByRole('checkbox', { name: 'Review', exact: true }).check();
    await modal.getByRole('button', { name: 'Save workflow' }).click();
    await expect(modal.getByRole('alert')).toContainText('Circular Agent dependency');
    await analysis.getByRole('checkbox', { name: 'Review', exact: true }).uncheck();
    await review.getByLabel('Output from Analysis').fill('result');
    await modal.getByRole('button', { name: 'Save workflow' }).click();
    await expect(modal).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Quality workflow', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Quality workflow copy', exact: true }),
    ).toBeVisible();
    const card = page
      .locator('.workflow-card')
      .filter({ has: page.getByRole('heading', { name: 'Quality workflow', exact: true }) });
    await card.getByRole('button', { name: 'Run workflow', exact: true }).click();
    await expect(modal.getByText('No folder selected', { exact: true })).toBeVisible();
    await modal.getByRole('button', { name: 'Start workflow', exact: true }).click();
    const history = page.locator('.runs > .run').first();
    await history.locator(':scope > summary').click();
    await expect(history.locator(':scope > summary .badge')).toHaveText('failed');
    await expect(history).toContainText('Analysis');
    await expect(history).toContainText('Required upstream agent');
    // IPC validates both graph data and picker-authorized folders.
    const errors = await page.evaluate(async () => {
      const workflow = (await window.workspace.workflows.list())[0];
      const messages: string[] = [];
      for (const input of [
        { workflowId: '../escape', task: '' },
        { workflowId: workflow.id, task: '', project: '/unselected' },
      ]) {
        try {
          await window.workspace.workflows.run(input);
        } catch (e) {
          messages.push(String(e));
        }
      }
      return messages;
    });
    expect(errors).toHaveLength(2);
    expect(errors[1]).toContain('folder picker');
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await page.getByLabel('Message', { exact: true }).fill('/workflow Quality workflow');
    await page.getByRole('option').filter({ hasText: 'Quality workflow' }).first().click();
    await expect(page.locator('.command-chip')).toContainText('/workflow');
    await expect(page.getByRole('button', { name: 'Select Folder' })).toBeVisible();
    await page.getByRole('button', { name: 'Workflows', exact: true }).click();
    await page.screenshot({ path: 'test-results/agent-workflows.png' });
    await page.reload();
    await page.getByRole('button', { name: 'Workflows', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Quality workflow', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.workflows-page > .runs > .run > summary .badge')).toHaveText(
      'failed',
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
