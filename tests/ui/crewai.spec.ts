import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm, realpath, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('CrewAI opt-in builder creates agents/tasks/tools, exports, persists and blocks disabled execution', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-ui-')));
  const exports = await realpath(await mkdtemp(join(tmpdir(), 'crew-export-ui-')));
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
    await expect(page.getByRole('button', { name: 'CrewAI Projects', exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(async () => {
        try {
          await window.workspace.crewai.check();
          return '';
        } catch (e) {
          return String(e);
        }
      }),
    ).toContain('disabled');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByLabel('Enable CrewAI')).not.toBeChecked();
    await page.getByLabel('Enable CrewAI').check();
    await page.getByLabel('Python executable').fill('/missing/crewai/python');
    await expect(page.getByRole('button', { name: 'Check CrewAI runtime' })).toBeDisabled();
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByRole('button', { name: 'CrewAI Projects', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Check CrewAI runtime' }).click();
    await expect(page.getByText(/Not ready:/)).toBeVisible();
    await page.getByRole('button', { name: 'CrewAI Projects', exact: true }).click();
    await page.getByRole('button', { name: 'New crew project' }).click();
    await page.getByLabel('Project name').fill('Report crew');
    await page.getByLabel('Project description').fill('Analyze and write a report');
    await page.getByRole('button', { name: 'Agents (2)', exact: true }).click();
    const analyst = page.getByRole('group', { name: 'Analyst', exact: true });
    await analyst
      .getByRole('textbox', { name: 'Goal', exact: true })
      .fill('Analyze project documentation.');
    await analyst.getByLabel('Maximum model calls').fill('500');
    await page.getByRole('button', { name: 'Tools', exact: true }).last().click();
    const reader = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: 'Read file', exact: true }) });
    await reader.getByLabel('Analyst', { exact: true }).check();
    await page.getByRole('button', { name: 'Tasks (2)', exact: true }).click();
    const writer = page.getByRole('group', { name: '2. Write report', exact: true });
    await expect(writer.getByLabel('Analyze', { exact: true })).toBeChecked();
    await writer.getByLabel('Expected output').fill('A Markdown report with a conclusion.');
    await page.getByRole('button', { name: 'Save project', exact: true }).click();
    await expect(page.getByText('CrewAI project saved', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.screenshot({ path: 'test-results/crewai-builder.png' });
    await app.evaluate(({ dialog }, parent) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [parent] });
    }, exports);
    await page.getByRole('button', { name: 'Export Python project' }).click();
    await expect(page.getByText(/Project exported to/)).toBeVisible();
    const directory = (await readdir(exports))[0];
    expect(await readFile(join(exports, directory, 'main.py'), 'utf8')).toContain('crew.kickoff');
    await page.getByRole('button', { name: 'Run crew', exact: true }).click();
    await page.getByRole('button', { name: 'Select Folder', exact: true }).click();
    await page.getByRole('button', { name: 'Start crew', exact: true }).click();
    await expect(page.locator('.crew-page .run > summary .badge')).toHaveText('failed');
    await page.locator('.crew-page .run > summary').click();
    await expect(page.locator('.crew-page .run')).toContainText('ENOENT');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Enable CrewAI').uncheck();
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByRole('button', { name: 'CrewAI Projects', exact: true })).toHaveCount(0);
    const result = await page.evaluate(async () => {
      const projects = await window.workspace.crewai.list();
      try {
        await window.workspace.crewai.run({ projectId: projects[0].id, input: '' });
        return '';
      } catch (e) {
        return String(e);
      }
    });
    expect(result).toContain('disabled');
    // Import cannot enable CrewAI or replace the locally chosen Python executable.
    const imported = join(exports, 'settings.json');
    await writeFile(
      imported,
      JSON.stringify({ crewAIEnabled: true, crewAIPython: '/unsafe/imported' }),
    );
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, imported);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.getByLabel('Enable CrewAI')).not.toBeChecked();
    const settings = await page.evaluate(() => window.workspace.settings.get());
    expect(settings.crewAIPython).toBe('/missing/crewai/python');
    await page.getByLabel('Enable CrewAI').check();
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: 'CrewAI Projects', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Report crew', exact: true })).toBeVisible();
    const stored = await page.evaluate(() => window.workspace.crewai.list());
    expect(stored[0].agents[0].tools).toEqual(['filesystem.read']);
    expect(stored[0].agents[0].maxIterations).toBe(500);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
    await rm(exports, { recursive: true, force: true });
  }
});

test('custom CrewAI tool editor validates, assigns, tests after approval, and exports code', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'crew-custom-ui-')));
  await writeFile(
    join(root, 'settings.json'),
    JSON.stringify({
      crewAIEnabled: true,
      crewAIPython: 'python3',
      ollamaUrl: 'http://127.0.0.1:1',
    }),
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
    await page.getByRole('button', { name: 'CrewAI Projects', exact: true }).click();
    await page.getByRole('button', { name: 'New crew project' }).click();
    await page.getByRole('button', { name: 'Tools', exact: true }).last().click();
    await page.getByRole('button', { name: 'Create custom tool' }).click();
    const editor = page.getByRole('group', { name: 'count_words', exact: true });
    await editor.getByLabel('Analyst', { exact: true }).check();
    await expect(editor.getByRole('button', { name: 'Remove custom tool' })).toBeDisabled();
    await editor.getByRole('textbox', {name:'Test input (JSON)',exact:true}).fill('{"text":3}');
    await editor.getByRole('button', { name: 'Save and test tool' }).click();
    await expect(page.getByRole('alert')).toContainText('Invalid');
    await editor.getByRole('textbox', {name:'Test input (JSON)',exact:true}).fill('{"text":"one two three"}');
    await page.screenshot({ path: 'test-results/crewai-custom-tools.png', fullPage: true });
    await editor.getByRole('button', { name: 'Save and test tool' }).click();
    await expect(page.getByRole('button', { name: 'Allow tool' })).toBeVisible();
    await expect(page.locator('.crew-tool-request pre').first()).toContainText('def run(input)');
    expect((await page.evaluate(() => window.workspace.crewai.runs()))[0].tools[0].status).toBe(
      'waiting',
    );
    await page.getByRole('button', { name: 'Allow tool' }).click();
    await expect
      .poll(async () => (await page.evaluate(() => window.workspace.crewai.runs()))[0].status)
      .toBe('completed');
    await page.locator('details.run > summary').click();
    await page.getByText('Tool output', { exact: true }).click();
    await expect(page.locator('.crew-tool-request')).toContainText('"words":3');
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, root);
    await page.getByRole('button', { name: 'Export Python project', exact: true }).click();
    await expect
      .poll(async () => (await readdir(root)).some((name) => name.startsWith('crewai-project-')))
      .toBe(true);
    const exported = (await readdir(root)).find((name) => name.startsWith('crewai-project-'))!;
    const definition = JSON.parse(await readFile(join(root, exported, 'project.json'), 'utf8'));
    expect(definition.customTools[0].code).toContain('def run(input)');
    expect(definition.agents[0].tools).toContain(`custom.${definition.customTools[0].id}`);
    await page.reload();
    expect((await page.evaluate(() => window.workspace.crewai.list()))[0].customTools).toHaveLength(
      1,
    );
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
