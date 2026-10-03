import { createServer } from 'node:http';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let root: string, app: ElectronApplication, page: Page;
const env = () =>
  Object.fromEntries(
    Object.entries({ ...process.env, LOCALAI_DATA_DIR: root }).filter(
      (e): e is [string, string] => typeof e[1] === 'string' && e[0] !== 'ELECTRON_RUN_AS_NODE',
    ),
  );
test.beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'localai-workflows-'));
  if (!process.env.LOCALAI_LIVE_TEST)
    await writeFile(
      join(root, 'settings.json'),
      JSON.stringify({ chatModel: 'ui-test-model', ollamaUrl: 'http://127.0.0.1:1' }),
    );
  app = await electron.launch({ args: ['.'], env: env() });
  page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'Good ideas start here.' })).toBeVisible();
  if (process.env.LOCALAI_LIVE_TEST) {
    await page.evaluate(async () => {
      const models = await window.workspace.models.list();
      const settings = await window.workspace.settings.get();
      const profile = settings.providers[0];
      profile.chatModel =
        models.find((m) => m.capabilities?.includes('completion'))?.name ??
        models.find((m) => !m.name.includes('embed'))?.name ??
        '';
      profile.embeddingModel =
        models.find((m) => m.capabilities?.includes('embedding'))?.name ??
        models.find((m) => m.name.includes('embed'))?.name ??
        '';
      await window.workspace.settings.save(settings);
    });
    await page.reload();
  }
});
test.afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});
test('Landing settings customize the welcome screen and Credentials has its own tab', async () => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Reference name', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Credentials', exact: true }).click();
  await expect(page.getByLabel('Reference name', { exact: true })).toBeVisible();
  await expect(page.getByLabel('API key', { exact: true })).toHaveAttribute('type', 'password');
  await expect(page.getByRole('button', { name: 'Use .env file', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Landing', exact: true }).click();
  await expect(page.getByLabel('Reference name', { exact: true })).toHaveCount(0);
  await page.getByLabel('Welcome label', { exact: true }).fill('YOUR VIDEO STUDIO');
  await page.getByLabel('Welcome heading', { exact: true }).fill('Every story starts here.');
  await page
    .getByLabel('Welcome description', { exact: true })
    .fill('Choose a story.\nCreate something memorable.');
  await page.getByLabel('Card 1 title', { exact: true }).fill('Plan a video');
  await page
    .getByLabel('Card 1 prompt', { exact: true })
    .fill('Help me plan a short nature video.');
  await page.getByLabel('Landing logo', { exact: true }).setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8ioAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(page.getByRole('button', { name: 'Remove logo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Landing preview' });
  await expect(preview.getByRole('img', { name: 'Landing logo' })).toBeVisible();
  await expect(preview.getByRole('heading', { name: 'Every story starts here.' })).toBeVisible();
  await preview.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Save landing', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Landing page saved');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Every story starts here.' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Landing logo' })).toBeVisible();
  await page.getByRole('button', { name: /Plan a video/ }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    'Help me plan a short nature video.',
  );
  await page.screenshot({ path: 'test-results/custom-landing.png' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Landing', exact: true }).click();
  await page.getByRole('button', { name: 'Reset landing to defaults', exact: true }).click();
  await page.getByRole('button', { name: 'Save landing', exact: true }).click();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Good ideas start here.' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Landing logo' })).toHaveCount(0);
});
for (const [kind, section] of [
  ['agents', 'Agents'],
  ['mcp', 'MCP'],
  ['skills', 'Skills'],
  ['tools', 'Tools'],
  ['saved-text', 'Saved Text'],
] as const) {
  test(`${section} groups support bulk assignment, filtering, editing and persistence`, async () => {
    await page.evaluate(async (kind) => {
      const settings = await window.workspace.settings.get();
      const provider = settings.providers[0];
      for (const name of ['Writer', 'Narrator', 'Unrelated']) {
        await window.workspace.library.save(kind, {
          id: name.toLowerCase(),
          name,
          description: 'Grouping fixture',
          content: 'return input;',
          providerId: provider.id,
          model: provider.chatModel,
          skills: [],
          tools: [],
          knowledgeSources: [],
          enabled: true,
          autoStart: false,
          version: '1.0.0',
          createdAt: 0,
          updatedAt: 0,
          command: kind === 'mcp' ? 'node' : '',
          args:
            kind === 'mcp'
              ? ['/a/very/long/project/path/to/the/mcp/server.mjs', '--read-only']
              : [],
          env: {},
          ...(kind === 'tools'
            ? {
                toolConfig: {
                  type: 'javascript' as const,
                  parameters: [],
                  url: '',
                  method: 'GET' as const,
                  headers: {},
                },
              }
            : {}),
        });
      }
    }, kind);
    await page.reload();
    await page.getByRole('button', { name: section, exact: true }).click();
    const cards = page.locator(kind === 'skills' ? '.skill-card' : '.library-card');
    const neighbor = cards.nth(1);
    const closedHeight = await neighbor.evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    await cards.first().locator(':scope > summary').click();
    await expect(cards.first()).toHaveJSProperty('open', true);
    await expect(neighbor).toHaveJSProperty('open', false);
    await expect(neighbor.getByRole('button', { name: 'Edit', exact: true })).not.toBeVisible();
    expect(
      await neighbor.evaluate((element) => element.getBoundingClientRect().height),
    ).toBeCloseTo(closedHeight, 0);
    await expect(cards.first().locator(':scope > summary')).toHaveCSS(
      'display',
      kind === 'skills' ? 'flex' : 'grid',
    );
    await page.screenshot({ path: `test-results/accordion-${kind}.png` });
    await cards.first().locator(':scope > summary').click();
    if (kind === 'mcp') {
      const expanded = page.locator('.library-card').filter({ hasText: 'Writer' });
      await expanded.locator(':scope > summary').click();
      const command = expanded.locator('.command-line');
      const tooltip = page.getByRole('tooltip');
      await command.hover();
      await expect(tooltip).toHaveText(
        'node /a/very/long/project/path/to/the/mcp/server.mjs --read-only',
      );
      await tooltip.hover();
      await expect(tooltip).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(tooltip).toHaveCount(0);
      await command.focus();
      await expect(tooltip).toBeVisible();
      await page.screenshot({ path: 'test-results/mcp-command-tooltip.png' });
      await page.keyboard.press('Escape');
      await expect(tooltip).toHaveCount(0);
    }
    await page.getByRole('checkbox', { name: 'Select Writer', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Select Narrator', exact: true }).check();
    await page
      .locator('.library-selection-toolbar')
      .getByRole('button', { name: 'Move to group', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Move selected items to group' });
    await dialog.getByLabel('Group', { exact: true }).selectOption('__new_group__');
    await dialog.getByLabel('New group name', { exact: true }).fill('Video Studio');
    await dialog.getByRole('button', { name: 'Move', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    if (kind === 'mcp') {
      const bulkActions = page.locator('.library-selection-toolbar .mcp-group-actions');
      await expect(bulkActions.getByRole('button', { name: 'Move to group' })).toBeVisible();
      await expect(bulkActions.getByRole('button', { name: 'Remove from group' })).toBeVisible();
      expect(
        await bulkActions.evaluate((element) => {
          const [move, remove] = Array.from(element.querySelectorAll('button')).map((button) =>
            button.getBoundingClientRect(),
          );
          return remove.left - move.right;
        }),
      ).toBeLessThanOrEqual(8);
    }
    const groups = page.getByRole('navigation', { name: `${section} groups` });
    await expect(
      groups.getByRole('button', { name: 'Video Studio 2', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await groups.getByRole('button', { name: 'Edit Video Studio group', exact: true }).click();
    const renameGroupDialog = page.getByRole('dialog', { name: 'Rename group' });
    await expect(renameGroupDialog.getByLabel('Group', { exact: true })).toHaveValue(
      'Video Studio',
    );
    await renameGroupDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Select Writer', exact: true })).toBeVisible();
    await expect(
      page.getByRole('checkbox', { name: 'Select Narrator', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Select Unrelated', exact: true })).toHaveCount(
      0,
    );
    await page.screenshot({ path: `test-results/library-groups-${kind}.png` });
    await page.reload();
    await page.getByRole('button', { name: section, exact: true }).click();
    const groupsAfterReload = page.getByRole('navigation', { name: `${section} groups` });
    await groupsAfterReload.getByRole('button', { name: 'Video Studio 2', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Select Writer', exact: true }).check();
    await page
      .locator('.library-selection-toolbar')
      .getByRole('button', { name: 'Move to group', exact: true })
      .click();
    await dialog.getByLabel('Group', { exact: true }).selectOption('');
    await dialog.getByRole('button', { name: 'Move', exact: true }).click();
    await expect(
      groupsAfterReload.getByRole('button', { name: 'Ungrouped 2', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    const card = page
      .locator(kind === 'skills' ? '.skill-card' : '.library-card')
      .filter({ hasText: 'Writer' });
    await card.locator(':scope > summary').click();
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByLabel('Group', { exact: true })
      .selectOption('Video Studio');
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      groupsAfterReload.getByRole('button', { name: 'Video Studio 2', exact: true }),
    ).toBeVisible();
    await expect(groupsAfterReload.getByRole('button', { name: 'Delete All group' })).toHaveCount(
      0,
    );
    await expect(
      groupsAfterReload.getByRole('button', { name: 'Delete Ungrouped group' }),
    ).toHaveCount(0);
    await expect(
      page.locator('.library-selection-toolbar').getByRole('button', { name: 'Delete group' }),
    ).toHaveCount(0);
    await page
      .locator('.library-selection-toolbar')
      .getByRole('button', {
        name: 'Edit Video Studio group',
      })
      .click();
    const renameDialog = page.getByRole('dialog', { name: 'Rename group' });
    await renameDialog.getByLabel('Group', { exact: true }).fill('Project Review');
    await renameDialog.getByRole('button', { name: 'Rename group', exact: true }).click();
    await expect(
      groupsAfterReload.getByRole('button', { name: 'Project Review 2', exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('.library-selection-toolbar').getByRole('button', { name: 'Delete group' }),
    ).toBeVisible();
    await page
      .locator('.library-selection-toolbar')
      .getByRole('button', { name: 'Delete group' })
      .click();
    const deleteGroupDialog = page.getByRole('dialog', { name: 'Delete Project Review group?' });
    await deleteGroupDialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(
      groupsAfterReload.getByRole('button', { name: 'Project Review 2', exact: true }),
    ).toHaveCount(0);
    await expect(groupsAfterReload.getByRole('button', { name: /Ungrouped 3/ })).toBeVisible();
  });
}
test('saved text and skills create, edit, export-ready files, delete; settings persist', async () => {
  await page.getByRole('button', { name: 'Saved Text', exact: true }).click();
  await page.getByRole('button', { name: 'New text' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Architecture notes');
  await page.getByLabel('Text', { exact: true }).fill('# Design\nPrivate local notes.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Architecture notes' })).toBeVisible();
  await page.locator('.library-card').filter({ hasText: 'Architecture notes' }).click();
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Copied to clipboard');
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
    '# Design\nPrivate local notes.',
  );
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill('Updated notes');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Updated notes' })).toBeVisible();
  await page.getByRole('button', { name: 'Send to Chat' }).click();
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(
    '# Design\nPrivate local notes.',
  );
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  await page.getByRole('button', { name: 'New skill' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Citation guide');
  await page.getByLabel('Instructions', { exact: true }).fill('Cite reliable sources.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'New skill' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Review code');
  await page.getByLabel('Description', { exact: true }).fill('Check code quality');
  const skillCapabilities = page.getByRole('group', { name: 'Skill Capabilities' });
  await skillCapabilities.getByLabel('Citation guide', { exact: true }).check();
  await page.getByLabel('Instructions', { exact: true }).fill('Read before making changes.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Review code' }).click();
  await expect(page.getByText('Read before making changes.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(
    page.getByRole('group', { name: 'Skill Capabilities' }).getByLabel('Citation guide', {
      exact: true,
    }),
  ).toBeChecked();
  await page
    .getByRole('group', { name: 'Skill Capabilities' })
    .getByLabel('Citation guide', { exact: true })
    .uncheck();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Review code' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Careful reviewer');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Citation guide' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Your skills start here')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await page.screenshot({ path: 'test-results/settings.png' });
  await app.close();
  app = await electron.launch({ args: ['.'], env: env() });
  page = await app.firstWindow();
  await page.getByRole('button', { name: 'Saved Text', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Updated notes' })).toBeVisible();
  await page.locator('.library-card').filter({ hasText: 'Updated notes' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Your saved text start here')).toBeVisible();
});
test('agent, MCP, skill, and tool editors create definitions from JSON and YAML', async () => {
  const entries = [
    { section: 'Skills', create: 'New skill', mode: 'YAML', name: 'YAML skill', format: 'yaml' },
    {
      section: 'Agents',
      create: 'New agent',
      mode: 'Markdown',
      name: 'Markdown agent',
      format: 'md',
    },
    { section: 'MCP', create: 'New server', mode: 'YAML', name: 'YAML server', format: 'yaml' },
    { section: 'Tools', create: 'New tool', mode: 'JSON', name: 'JSON tool', format: 'json' },
  ] as const;
  for (const entry of entries) {
    await page.getByRole('button', { name: entry.section, exact: true }).click();
    await page.getByRole('button', { name: entry.create, exact: true }).click();
    const modal = page.getByRole('dialog');
    await expect(modal.getByRole('button', { name: 'Form', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(modal.getByRole('button', { name: 'Form', exact: true })).toHaveCSS(
      'font-weight',
      '600',
    );
    await modal.getByRole('button', { name: entry.mode, exact: true }).click();
    const definition =
      entry.format === 'json'
        ? JSON.stringify({
            name: entry.name,
            description: 'Created from a definition',
            ...(entry.section === 'Tools' ? { content: 'return input;' } : {}),
          })
        : entry.format === 'md'
          ? `---\nname: ${entry.name}\ndescription: Created from a definition\n---\nAgent instructions.\n`
          : `name: ${entry.name}\ndescription: Created from a definition\n`;
    await modal
      .getByRole('textbox', { name: `Definition · ${entry.mode}`, exact: true })
      .fill(definition);
    await modal.getByRole('button', { name: 'Form', exact: true }).click();
    await expect(
      modal.getByLabel(entry.section === 'MCP' ? 'Name (required)' : 'Name', { exact: true }),
    ).toHaveValue(entry.name);
    await modal.getByRole('button', { name: entry.mode, exact: true }).click();
    await modal.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(modal).not.toBeVisible();
    await expect(page.getByText(entry.name, { exact: true })).toBeVisible();
  }
});
test('Code workspace offers local and remote agents and prepares a test-fix run', async () => {
  await app.evaluate(({ dialog }, project) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
  }, root);
  await page.evaluate(async () => {
    const settings = await window.workspace.settings.get();
    const local = settings.providers.find((provider) => provider.provider === 'ollama')!;
    settings.providers.push({
      id: 'remote-provider',
      name: 'Remote provider',
      provider: 'ollama',
      enabled: true,
      apiKey: '',
      apiBaseUrl: '',
      ollamaUrl: 'http://192.168.1.50:11434',
      chatModel: 'remote-model',
      embeddingModel: '',
      modelIds: ['remote-model'],
      manualModelIds: ['remote-model'],
      authMethod: 'none',
      authHeader: 'x-api-key',
      timeout: 1000,
    });
    await window.workspace.settings.save(settings);
    const base = {
      description: 'Local test agent',
      content: 'Inspect and fix project code and tests.',
      version: '1.0.0',
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
      skills: [],
      tools: [
        'project.detect',
        'filesystem.read',
        'filesystem.write',
        'filesystem.edit',
        'filesystem.search',
        'filesystem.list',
        'shell.execute',
      ],
      knowledgeSources: [],
      autoStart: false,
      maxIterations: 5,
      command: '',
      args: [],
      env: {},
    };
    await window.workspace.library.save('agents', {
      ...base,
      id: 'local-coder',
      name: 'Local coder',
      providerId: local.id,
      model: local.chatModel,
    });
    await window.workspace.library.save('agents', {
      ...base,
      id: 'remote-coder',
      name: 'Remote coder',
      providerId: 'remote-provider',
      model: 'remote-model',
    });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Good ideas start here.' })).toBeVisible();
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  const agentSelect = page.getByLabel('Coding agent', { exact: true });
  await expect(agentSelect.locator('option')).toHaveCount(2);
  await expect(agentSelect).toContainText('Local coder');
  await expect(agentSelect).toContainText('Remote coder');

  await page.getByRole('button', { name: 'Fix failing tests', exact: true }).click();
  const task = page.getByLabel('Coding task', { exact: true });
  await expect(task).toHaveValue(/Do not weaken or delete the test/);
  const runButton = page.getByRole('button', { name: 'Run coding task', exact: true });
  await expect(runButton).toBeDisabled();
  await page.getByRole('button', { name: 'Select Folder', exact: true }).click();
  await expect(page.locator('.folder-selection .folder-path')).toContainText('localai-workflows-');
  await expect(runButton).toBeEnabled();
  await page.screenshot({ path: 'test-results/code-workspace.png' });
});
test('/code saves folders to Code and reconnects them from Chat', async () => {
  await page.getByRole('checkbox', { name: 'Code', exact: true }).check();
  const input = page.getByLabel('Message', { exact: true });
  const connect = page.getByRole('button', { name: 'Connect project', exact: true });
  await expect(connect).toHaveCount(0);
  await input.fill('/code');
  const folders = page.getByRole('listbox', { name: 'Saved folders' });
  await expect(folders).toBeVisible();
  await expect(page.getByText('No saved folders yet.', { exact: false })).toBeVisible();
  await app.evaluate(({ dialog }, project) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
  }, root);
  await folders.getByRole('option', { name: /Open another folder/ }).click();
  await expect(page.locator('.workspace-indicator')).toContainText('localai-workflows-');
  await expect(input).toHaveValue('');
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Project workspaces' })).toContainText(
    'localai-workflows-',
  );
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await expect(page.locator('.workspace-indicator')).toContainText('localai-workflows-');
  await input.fill('/code old-project');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.locator('.workspace-indicator')).toHaveCount(0);
  await expect(connect).toHaveCount(0);
  await expect(input).toHaveValue('');
  await input.fill('/');
  const codeFolder = page.getByRole('option').filter({ hasText: '/code-localai-workflows-' });
  await expect(codeFolder).toBeVisible();
  await expect(page.getByRole('option', { name: /Select a saved folder in Chat/ })).toHaveCount(0);
  await codeFolder.click();
  await expect(page.locator('.workspace-indicator')).toContainText('localai-workflows-');
  await input.fill('/code nonexistent-project');
  await expect(page.getByText('No matching saved folders.')).toBeVisible();
  await input.fill('/code localai-workflows-');
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(page.locator('.workspace-indicator')).toContainText('localai-workflows-');
  await expect(page.getByRole('region', { name: 'Project workspaces' })).toHaveCount(0);
  await expect(page.getByText('Restricted', { exact: true })).toBeVisible();
  await input.fill('/code');
  await expect(folders).toBeVisible();
  await input.press('Escape');
  await expect(folders).toHaveCount(0);
  await input.press('Enter');
  await expect(folders).toBeVisible();
  await expect(page.locator('.message.user')).toHaveCount(0);
});
test('Code workspaces persist and reconnect to conversations with guarded project access', async () => {
  await app.evaluate(({ dialog }, project) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
  }, root);

  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await page.getByRole('button', { name: 'Open folder', exact: true }).click();
  const workspace = page.getByRole('region', { name: 'Project workspaces' });
  await expect(workspace.getByText('Project operations require approval')).toBeVisible();
  await expect(workspace.getByText(/^localai-workflows-/)).toBeVisible();
  await workspace.getByRole('button', { name: 'Open in Chat' }).click();
  await expect(page.locator('.workspace-indicator')).toContainText('localai-workflows-');

  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.locator('.workspace-indicator')).toHaveCount(0);
  await page.getByRole('button', { name: 'Code', exact: true }).click();
  await workspace.getByRole('button', { name: 'Open in Chat' }).click();
  await expect(page.locator('.workspace-indicator')).toContainText('localai-workflows-');
  await expect(page.getByText('Restricted', { exact: true })).toBeVisible();
});
test('chat title double-click renames and exports the conversation as Markdown', async () => {
  const exportPath = join(root, 'chat-export.md');
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, exportPath);
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  const title = page.getByRole('heading', { name: 'New conversation', exact: true });
  await title.dblclick();
  const renameDialog = page.getByRole('dialog', { name: 'Rename conversation' });
  await renameDialog.getByLabel('Title', { exact: true }).fill('Planning session');
  await renameDialog.getByRole('button', { name: 'Save title', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Planning session', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Export .md', exact: true }).click();
  const markdown = await readFile(exportPath, 'utf8');
  expect(markdown).toContain('# Planning session');
  expect(markdown).toContain('- Model: ui-test-model');
});
test('Settings imports and exports complete workspace backups', async () => {
  const exportPath = join(root, 'workspace-backup.yaml');
  const importPath = join(root, 'restore.json');
  await writeFile(
    importPath,
    JSON.stringify({
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      settings: {
        ...(await page.evaluate(() => window.workspace.settings.get())),
        providers: (await page.evaluate(() => window.workspace.settings.get())).providers.map(
          (provider) => ({
            ...provider,
            apiKey: '',
            credentialRef: undefined,
            hasCredential: false,
          }),
        ),
        apiKey: '',
      },
      libraries: {
        skills: [
          {
            id: 'restored-skill',
            name: 'Restored skill',
            description: 'Imported from backup',
            content: 'Backup instructions',
          },
        ],
        'saved-text': [],
        agents: [],
        mcp: [],
        tools: [],
      },
      workflows: [],
      conversations: [
        {
          conversation: {
            id: 'restored-chat',
            title: 'Restored conversation',
            model: 'ui-test-model',
            providerId: 'ollama-local',
            createdAt: 100,
            updatedAt: 200,
          },
          messages: [
            {
              id: 'restored-message',
              conversationId: 'restored-chat',
              role: 'user',
              content: 'Backup question',
              createdAt: 101,
            },
          ],
        },
      ],
    }),
  );
  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.exportPath });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.importPath] });
    },
    { exportPath, importPath },
  );
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Import / Export', exact: true }).click();
  await page.getByLabel('Export format', { exact: true }).selectOption('yaml');
  await page.getByRole('button', { name: 'Export workspace', exact: true }).click();
  await expect
    .poll(async () => readFile(exportPath, 'utf8').catch(() => ''))
    .toContain('formatVersion: 1');
  await page.getByRole('button', { name: 'Import backup', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('1 chats');
  expect(await page.evaluate(() => window.workspace.chat.list())).toContainEqual(
    expect.objectContaining({ id: 'restored-chat', title: 'Restored conversation' }),
  );
  expect(await page.evaluate(() => window.workspace.library.list('skills'))).toContainEqual(
    expect.objectContaining({ id: 'restored-skill', name: 'Restored skill' }),
  );
});
test('global errors stay above an open editor dialog', async () => {
  await page.getByRole('button', { name: 'Skills', exact: true }).click();
  await page.getByRole('button', { name: 'New skill', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByRole('button', { name: 'YAML', exact: true }).click();
  await modal.getByRole('textbox', { name: 'Definition · YAML', exact: true }).fill('not: [valid');
  await modal.getByRole('button', { name: 'Form', exact: true }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(modal).toBeVisible();
  await expect(alert).toHaveJSProperty('popover', 'manual');
  expect(await alert.evaluate((element) => element.matches(':popover-open'))).toBe(true);
});
test('chat slash commands offer searchable selections, keyboard navigation and removable chips', async () => {
  for (const entry of [
    { section: 'Skills', create: 'New skill', name: 'Writing helper', command: 'skills' },
    { section: 'Agents', create: 'New agent', name: 'Project reviewer', command: 'agent' },
    { section: 'MCP', create: 'New server', name: 'Local tools', command: 'mcp' },
  ]) {
    await page.getByRole('button', { name: entry.section, exact: true }).click();
    await page.getByRole('button', { name: entry.create, exact: true }).click();
    const modal = page.getByRole('dialog');
    await modal
      .getByLabel(entry.command === 'mcp' ? 'Name (required)' : 'Name', { exact: true })
      .fill(entry.name);
    await modal
      .getByLabel(entry.command === 'mcp' ? 'Description (required)' : 'Description', {
        exact: true,
      })
      .fill('Slash command test');
    await modal.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(modal).not.toBeVisible();
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    const input = page.getByLabel('Message', { exact: true });
    await page
      .getByRole('checkbox', {
        name: entry.command === 'skills' ? 'Tools' : entry.command === 'mcp' ? 'MCP' : 'Agent',
        exact: true,
      })
      .check();
    await input.fill(`/${entry.command} `);
    await expect(
      page.getByRole('listbox').getByRole('option').filter({ hasText: entry.name }),
    ).toBeVisible();
    await input.fill(`/${entry.command} ${entry.name.slice(0, 4)}`);
    await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(1);
    await input.press('Enter');
    await expect(page.locator('.command-chip')).toContainText(entry.name);
    await expect(input).toHaveValue('');
    await input.fill('Keep this query');
    await page.getByRole('button', { name: 'Remove chat command' }).click();
    await expect(page.locator('.command-chip')).toHaveCount(0);
    await expect(input).toHaveValue('Keep this query');
  }
  const input = page.getByLabel('Message', { exact: true });
  await page.getByRole('checkbox', { name: 'Workflow', exact: true }).check();
  await input.fill('/');
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(5);
  await input.press('ArrowDown');
  await input.press('ArrowDown');
  await expect(page.getByRole('listbox').getByRole('option', { selected: true })).toContainText(
    '/agent',
  );
  await input.press('Enter');
  await expect(input).toHaveValue('/agent ');
  await input.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
});

test('real Ollama chat streams, persists across relaunch and continues', async () => {
  test.skip(
    !process.env.LOCALAI_LIVE_TEST,
    'Set LOCALAI_LIVE_TEST=1 to test the local Ollama server',
  );
  await expect(page.getByLabel('Model', { exact: true })).not.toHaveValue('', { timeout: 20000 });
  await page
    .getByLabel('Message', { exact: true })
    .fill('Remember the word cedar. Reply briefly to confirm.');
  await page.getByLabel('Message', { exact: true }).press('Shift+Enter');
  await expect(page.getByLabel('Message', { exact: true })).toHaveValue(/\n$/);
  await page.getByLabel('Message', { exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: 'Regenerate' })).toBeVisible({ timeout: 90000 });
  const answer = await page.locator('.message.assistant .markdown').innerText();
  expect(answer.length).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/chat.png' });
  await app.close();
  app = await electron.launch({ args: ['.'], env: env() });
  page = await app.firstWindow();
  await page
    .getByRole('button', {
      name: 'Remember the word cedar. Reply briefly to confirm.',
      exact: true,
    })
    .click();
  await expect(page.locator('.message.assistant .markdown')).toHaveText(answer);
  await page
    .getByLabel('Message', { exact: true })
    .fill('What word did I ask you to remember? Reply with just the word.');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('.message.assistant')).toHaveCount(2, { timeout: 90000 });
  await expect(page.locator('.message.assistant').last()).toContainText(/cedar/i, {
    timeout: 90000,
  });
});
test('Knowledge sources support adding, moving, renaming and deleting groups', async () => {
  await page.getByRole('button', { name: 'Knowledge Base', exact: true }).click();
  await page.getByRole('button', { name: 'Add source', exact: true }).click();
  await page.getByRole('combobox', { name: 'Source type' }).selectOption('url');
  await page.getByLabel('URL', { exact: true }).fill('https://first.example/docs');
  await page.getByLabel('Collection · optional').fill('Project docs');
  await page.getByLabel('Group · optional').selectOption('__new_group__');
  await page.getByLabel('New group name', { exact: true }).fill('Research');
  await page.getByRole('button', { name: 'Add URL', exact: true }).click();
  await page.getByRole('button', { name: 'Add source', exact: true }).click();
  await page.getByRole('combobox', { name: 'Source type' }).selectOption('url');
  await page.getByLabel('URL', { exact: true }).fill('https://second.example/docs');
  await page.getByLabel('Collection · optional').fill('Project docs');
  await page.getByRole('button', { name: 'Add URL', exact: true }).click();

  const groups = page.getByRole('navigation', { name: 'Knowledge Base groups' });
  await expect(groups.getByRole('button', { name: 'Research 1', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select second.example', exact: true }).check();
  await page
    .locator('.library-selection-toolbar')
    .getByRole('button', { name: 'Move to group', exact: true })
    .click();
  const moveDialog = page.getByRole('dialog', { name: 'Move sources to group' });
  await moveDialog.getByLabel('Group', { exact: true }).selectOption('Research');
  await moveDialog.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(groups.getByRole('button', { name: 'Research 2', exact: true })).toBeVisible();

  await page
    .locator('.library-selection-toolbar')
    .getByRole('button', {
      name: 'Edit Research group',
    })
    .click();
  const renameDialog = page.getByRole('dialog', { name: 'Rename group' });
  await renameDialog.getByLabel('Group', { exact: true }).fill('Reference docs');
  await renameDialog.getByRole('button', { name: 'Rename group', exact: true }).click();
  await expect(groups.getByRole('button', { name: 'Reference docs 2', exact: true })).toBeVisible();

  await expect(
    page.locator('.library-selection-toolbar').getByRole('button', { name: 'Delete group' }),
  ).toBeVisible();
  await page
    .locator('.library-selection-toolbar')
    .getByRole('button', { name: 'Delete group' })
    .click();
  const deleteDialog = page.getByRole('dialog', { name: 'Delete Reference docs group?' });
  await deleteDialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(groups.getByRole('button', { name: 'Reference docs 2', exact: true })).toHaveCount(
    0,
  );
  await expect(groups.getByRole('button', { name: 'Ungrouped 2', exact: true })).toBeVisible();
  await expect(page.locator('.source-card').filter({ hasText: 'second.example' })).toContainText(
    'Project docs',
  );
  await expect(groups.getByRole('button', { name: 'Delete All group' })).toHaveCount(0);
  await expect(groups.getByRole('button', { name: 'Delete Ungrouped group' })).toHaveCount(0);
  await expect(
    page.locator('.library-selection-toolbar').getByRole('button', { name: 'Delete group' }),
  ).toHaveCount(0);
});

test('knowledge URL sync, preview, semantic search and RAG chat use real local embeddings', async () => {
  test.skip(!process.env.LOCALAI_LIVE_TEST, 'Requires local embedding and chat models');
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      '<h1>Workspace manual</h1><p>The project codename is SILVERFERN. Releases happen on Thursdays.</p>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await expect(page.getByLabel('Model', { exact: true })).not.toHaveValue('');
    await page.getByRole('button', { name: 'Knowledge Base', exact: true }).click();
    await page.getByRole('button', { name: 'Add source', exact: true }).click();
    await page.getByRole('combobox', { name: 'Source type' }).selectOption('url');
    await page.getByLabel('URL', { exact: true }).fill(`http://127.0.0.1:${port}/docs`);
    await page.getByRole('button', { name: 'Add URL' }).click();
    await page.getByRole('button', { name: 'Sync / Re-index' }).click();
    await expect(page.locator('.source-card .badge')).toHaveText('ready', { timeout: 60000 });
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('SILVERFERN');
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByLabel('Search knowledge').fill('What is the project called?');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page.locator('.search-results')).toContainText('SILVERFERN', { timeout: 30000 });
    await page.screenshot({ path: 'test-results/knowledge.png' });
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await page.getByRole('checkbox', { name: 'KB', exact: true }).check();
    await page
      .getByLabel('Message', { exact: true })
      .fill('What is the project codename in my knowledge? Answer briefly.');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByRole('button', { name: 'Regenerate' })).toBeVisible({ timeout: 90000 });
    await expect(page.locator('.message.assistant')).toContainText(/SILVERFERN/i);
    await expect(page.getByText('Sources used: 1')).toBeVisible();
    await page.getByRole('button', { name: 'Knowledge Base', exact: true }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Turn your documents into context')).toBeVisible();
  } finally {
    server.close();
  }
});
test('agent UI creates a worker, reviews a real diff and applies approved changes', async () => {
  test.skip(!process.env.LOCALAI_LIVE_TEST, 'Requires a tool-capable local model');
  test.setTimeout(180000);
  const project = join(root, 'test-project');
  await mkdir(project);
  await writeFile(join(project, 'greeting.txt'), 'hello\n');
  await app.evaluate(({ dialog }, project) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
  }, project);
  await expect(page.getByLabel('Model', { exact: true })).not.toHaveValue('');
  await page.getByRole('button', { name: 'Agents', exact: true }).click();
  await page.getByRole('button', { name: 'New agent' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Careful file editor');
  await page
    .getByLabel('Instructions', { exact: true })
    .fill(
      'Read the target file, use its exact hash to write a change, read to verify, then provide a final report. Execute tools; do not just describe the work.',
    );
  await page.getByRole('checkbox', { name: 'filesystem.write', exact: true }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByRole('button', { name: 'Select Folder' }).click();
  await page
    .getByLabel('Task', { exact: true })
    .fill(
      'Change greeting.txt to exactly "hello local workspace" followed by a newline. Read first, write using the hash, verify by reading, then finish.',
    );
  await page.getByRole('button', { name: 'Start agent' }).click();
  await page.locator('.run > summary').click();
  await expect(page.getByRole('button', { name: 'Approve change' })).toBeVisible({
    timeout: 90000,
  });
  expect(await readFile(join(project, 'greeting.txt'), 'utf8')).toBe('hello\n');
  await expect(page.locator('.diff')).toContainText('+hello local workspace');
  await page.screenshot({ path: 'test-results/agent-approval.png' });
  await page.getByRole('button', { name: 'Approve change' }).click();
  await expect(page.locator('.run>summary .badge')).toHaveText('Completed', { timeout: 90000 });
  expect(await readFile(join(project, 'greeting.txt'), 'utf8')).toBe('hello local workspace\n');
});

test('selected agent-desktop KB scopes give me chat details to project documentation', async () => {
  test.skip(!process.env.LOCALAI_LIVE_TEST, 'Requires local embedding and chat models');
  await expect(page.getByLabel('Model', { exact: true })).not.toHaveValue('', { timeout: 20000 });
  await expect
    .poll(() => page.evaluate(async () => (await window.workspace.settings.get()).embeddingModel))
    .not.toBe('');
  const folder = join(root, 'agent-desktop');
  await mkdir(folder);
  await writeFile(
    join(folder, 'CHAT.md'),
    '# Chat in agent-desktop\nThe Chat section supports streaming responses, a Knowledge context selector, and saved conversations. The project-specific Chat recovery code is CHAT-CEDAR-472. Sources used expands the retrieved document excerpts.',
  );
  await app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
  }, folder);
  await page.evaluate(async () => {
    await window.workspace.knowledge.add({ type: 'folder' });
    const source = (await window.workspace.knowledge.list()).find(
      (s) => s.name === 'agent-desktop',
    )!;
    await window.workspace.knowledge.sync(source.id);
  });
  const sourceId = await page.evaluate(
    async () =>
      (await window.workspace.knowledge.list()).find((s) => s.name === 'agent-desktop')!.id,
  );
  await expect
    .poll(
      async () =>
        page.evaluate(
          async (id) => (await window.workspace.knowledge.list()).find((s) => s.id === id)?.status,
          sourceId,
        ),
      { timeout: 60000 },
    )
    .toBe('ready');
  // Refresh the renderer's sources through its normal navigation/load path.
  await page.getByRole('button', { name: 'Knowledge Base', exact: true }).click();
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByRole('checkbox', { name: 'KB', exact: true }).check();
  await page.getByLabel('Message', { exact: true }).fill('/agent-desktop');
  await page.getByRole('listbox').getByRole('option').click();
  await page.getByLabel('Message', { exact: true }).fill('give me chat details');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('button', { name: 'Regenerate' })).toBeVisible({ timeout: 90000 });
  await expect(page.getByText('Sources used: 1')).toBeVisible();
  await expect(page.locator('.message.assistant')).toContainText(
    /Knowledge context|streaming responses|saved conversations/i,
  );
  await expect(page.locator('.message.assistant')).not.toContainText(
    /don't have access to (?:any |your )?chat history/i,
  );
});
