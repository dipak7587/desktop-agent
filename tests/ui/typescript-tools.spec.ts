import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let app: ElectronApplication, page: Page, root: string;
test.beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'typescript-tools-ui-'));
  await writeFile(
    join(root, 'settings.json'),
    JSON.stringify({ chatModel: 'ui-test-model', ollamaUrl: 'http://127.0.0.1:1' }),
  );
  app = await electron.launch({
    args: ['.'],
    env: Object.fromEntries(
      Object.entries({ ...process.env, LOCALAI_DATA_DIR: root }).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === 'string' && entry[0] !== 'ELECTRON_RUN_AS_NODE',
      ),
    ),
  });
  page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'Good ideas start here.' })).toBeVisible();
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
});
test.afterEach(async () => {
  await app?.close();
  await rm(root, { recursive: true, force: true });
});

test('Builder syncs with TypeScript, validates, tests, saves TS, and reloads', async () => {
  await page.getByRole('button', { name: 'New tool', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByLabel('Tool example').selectOption('calculator');
  await modal.getByRole('button', { name: 'Validate', exact: true }).click();
  await expect(modal.getByText('✓ Input schema valid', { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'TypeScript', exact: true }).click();
  await expect(modal.locator('.tool-code-highlight .hljs-keyword').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/typescript-tool-editor.png' });
  expect(await modal.getByLabel('TypeScript source', { exact: true }).inputValue()).toContain(
    'langchain/tools',
  );
  await modal.getByRole('button', { name: 'Builder', exact: true }).click();
  await expect(modal.getByLabel('Name', { exact: true })).toHaveValue('calculator');
  await modal.getByRole('button', { name: 'Test Tool', exact: true }).click();
  await modal.getByLabel('Test input · JSON').fill('{"a":10,"b":5,"operation":"multiply"}');
  await modal.getByRole('button', { name: 'Run test', exact: true }).click();
  await expect(modal.getByText('50', { exact: true })).toBeVisible();
  await expect(modal.getByText(/Execution status: Completed/)).toBeVisible();
  await modal.getByRole('button', { name: 'Save Tool', exact: true }).click();
  await expect(modal).not.toBeVisible();
  const files = await readdir(join(root, 'tools'));
  const tools = files.filter((file) => file.endsWith('.ts'));
  expect(tools).toHaveLength(1);
  expect(files.some((file) => file.endsWith('.md'))).toBe(false);
  expect(await readFile(join(root, 'tools', tools[0]), 'utf8')).toContain(
    'export const customTool = tool(',
  );
  await page.locator('.library-card > summary').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(modal.getByLabel('TypeScript source', { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'Builder', exact: true }).click();
  await expect(modal.getByLabel('Name', { exact: true })).toHaveValue('calculator');
});

test('pasted YAML converts to TS, static errors appear at the top, and advanced code is preserved', async () => {
  await page.getByRole('button', { name: 'New tool', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByRole('button', { name: 'Paste definition' }).click();
  await modal.getByLabel('Input format').selectOption('yaml');
  await modal
    .getByLabel('Definition to import')
    .fill(
      'name: add_numbers\ndescription: Add numbers\ninput:\n  a:\n    type: number\n    required: true\n  b:\n    type: number\n    required: true\nfunction: return a + b;',
    );
  await modal.getByRole('button', { name: 'Convert and preview' }).click();
  await expect(modal.getByLabel('TypeScript source', { exact: true })).toBeVisible();
  const valid = await modal.getByLabel('TypeScript source', { exact: true }).inputValue();
  await modal
    .getByLabel('TypeScript source', { exact: true })
    .fill(valid.replace('name: "add_numbers"', 'name: "bad name"'));
  await modal.getByRole('button', { name: 'Save Tool', exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText('Tool names');
  await modal
    .getByLabel('TypeScript source', { exact: true })
    .fill(valid + '\nconst helper = (value: number) => value * 2;');
  await modal.getByRole('button', { name: 'Builder', exact: true }).click();
  await expect(modal.getByText(/Advanced TypeScript mode/)).toBeVisible();
  expect(await modal.getByLabel('TypeScript source', { exact: true }).inputValue()).toContain(
    'const helper',
  );
  await modal.getByRole('button', { name: 'Save Tool', exact: true }).click();
  await expect(modal).not.toBeVisible();
});
