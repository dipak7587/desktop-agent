import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('dynamic workflows import, switch all formats, edit nested forms, validate and run typed inputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dynamic-workflow-ui-'));
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
    await page.getByRole('button', { name: 'Workflows', exact: true }).click();
    await page.getByRole('button', { name: 'New workflow', exact: true }).click();
    const modal = page.getByRole('dialog');
    await expect(
      page.getByRole('button', { name: 'New dynamic workflow', exact: true }),
    ).toHaveCount(0);
    await expect(modal.getByRole('tab', { name: 'Default', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await modal.getByRole('tab', { name: 'Form', exact: true }).click();
    await expect(modal.getByRole('group', { name: 'Dynamic', exact: true })).toBeVisible();
    await modal.getByLabel('Import workflow file').setInputFiles({
      name: 'test.yaml',
      mimeType: 'text/yaml',
      buffer: Buffer.from(
        'name: Dynamic example\ninputs:\n  target:\n    type: string\nsteps:\n  - id: each\n    type: loop\n    over: []\n    as: item\n    steps:\n      - id: review\n        type: agent\n        agent: reviewer\n        input: "{{item}}"\n',
      ),
    });
    await modal
      .getByRole('tabpanel')
      .getByLabel('Description', { exact: true })
      .fill('A dynamic workflow test');
    await expect(modal.getByRole('tabpanel').getByLabel('Name (required)')).toHaveValue(
      'Dynamic example',
    );
    await expect(modal.getByLabel('Item variable')).toHaveValue('item');
    for (const format of ['JSON', 'YAML', 'Markdown']) {
      await modal.getByRole('tab', { name: format, exact: true }).click();
      await expect(modal.locator('[name="workflow-source"]')).toContainText('Dynamic example');
    }
    await modal.getByRole('tab', { name: 'Form', exact: true }).click();
    await modal.getByLabel('Item variable').fill('file');
    await modal.getByRole('tab', { name: 'JSON', exact: true }).click();
    await expect(modal.locator('[name="workflow-source"]')).toContainText('"as": "file"');
    const source = await modal.locator('[name="workflow-source"]').inputValue();
    await modal.locator('[name="workflow-source"]').fill('{ bad json');
    await modal.getByRole('button', { name: 'Save workflow', exact: true }).click();
    await expect(modal.getByRole('alert')).toBeVisible();
    await modal.locator('[name="workflow-source"]').fill(source);
    await modal.getByRole('button', { name: 'Save workflow', exact: true }).click();
    await expect(modal).toHaveCount(0);
    const card = page.locator('.workflow-card').filter({ hasText: 'Dynamic example' });
    await card.locator('summary').click();
    await card.getByRole('button', { name: 'Run workflow', exact: true }).click();
    await page.getByLabel('target (string)').fill('repository');
    await page.getByRole('button', { name: 'Start workflow', exact: true }).click();
    await expect(page.locator('.runs')).toContainText('completed');
    const definitions = await page.evaluate(() => window.workspace.workflows.list());
    expect(definitions[0].definition?.steps[0].as).toBe('file');
    await page.reload();
    await page.getByRole('button', { name: 'Workflows', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Dynamic example', exact: true })).toBeVisible();
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
