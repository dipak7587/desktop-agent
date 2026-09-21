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
  app = await electron.launch({ args: ['.'], env: env() });
  page = await app.firstWindow();
  await expect(page.getByRole('heading', { name: 'Good ideas start here.' })).toBeVisible();
});
test.afterEach(async () => {
  await app.close();
  await rm(root, { recursive: true, force: true });
});
test('saved text and skills create, edit, export-ready files, delete; settings persist', async () => {
  await page.getByRole('button', { name: 'Saved Text', exact: true }).click();
  await page.getByRole('button', { name: 'New text' }).click();
  await page.getByLabel('Title', { exact: true }).fill('Architecture notes');
  await page.getByLabel('Text', { exact: true }).fill('# Design\nPrivate local notes.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Architecture notes' })).toBeVisible();
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
  await page.getByLabel('Name', { exact: true }).fill('Review code');
  await page.getByLabel('Description', { exact: true }).fill('Check code quality');
  await page.getByLabel('Instructions', { exact: true }).fill('Read before making changes.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('summary').filter({ hasText: 'Review code' }).click();
  await expect(page.getByText('Read before making changes.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Careful reviewer');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
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
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Your saved text start here')).toBeVisible();
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
  await input.fill('/');
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(3);
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
  await expect(page.getByLabel('Chat model')).not.toHaveValue('', { timeout: 20000 });
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
    await expect(page.getByLabel('Chat model')).not.toHaveValue('');
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
    await page.getByLabel('Knowledge context').selectOption('all');
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
  await expect(page.getByLabel('Chat model')).not.toHaveValue('');
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
  await expect(page.getByLabel('Chat model')).not.toHaveValue('', { timeout: 20000 });
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
  await page.getByLabel('Knowledge context').selectOption(sourceId);
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
