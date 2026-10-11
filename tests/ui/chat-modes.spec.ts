import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { LibraryService } from '../../src/main/services/filesystem/library';
import { librarySchema } from '../../src/shared/schemas';
import { ChatDatabase } from '../../src/main/database/chat';
import { toolItemFromSource } from '../../src/main/services/tools/files';
import { generateToolSource, toolExamples } from '../../src/shared/tool-definition';

test('global commands ignore checkbox filters, nest MCP tools, and clear only the current chat', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chat-modes-ui-'));
  const library = new LibraryService(root);
  await library.save(
    'mcp',
    librarySchema.parse({
      id: 'test-server',
      name: 'Test server',
      description: 'Test MCP',
      command: process.execPath,
      args: [resolve('tests/fixtures/mcp-server.mjs')],
    }),
  );
  await library.save(
    'tools',
    toolItemFromSource(
      generateToolSource({
        ...toolExamples.calculator,
        name: 'command_test_calculator',
        inputs: toolExamples.calculator.inputs,
      }),
      { id: 'command-test-calculator' },
    ),
  );
  await mkdir(join(root, 'database'), { recursive: true });
  const db = new ChatDatabase(join(root, 'database', 'app.sqlite'));
  const conversation = db.create('test-model');
  db.rename(conversation.id, 'Clear this chat');
  db.add(conversation.id, 'user', 'Temporary message');
  const other = db.create('other-model');
  db.rename(other.id, 'Keep this chat');
  db.add(other.id, 'user', 'Keep this message');
  db.close();
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
    const commands = [
      '/mcp',
      '/tools',
      '/agent',
      '/skills',
      '/workflow',
      '/code',
      '/kb',
      '/clear',
      '/help',
    ];
    await input.fill('/');
    for (const command of commands)
      await expect(
        page
          .getByRole('option')
          .filter({ has: page.locator('strong', { hasText: new RegExp(`^${command}$`) }) }),
      ).toBeVisible();
    for (const name of ['KB', 'MCP', 'Tools', 'Skills', 'Code', 'Agent', 'Workflow']) {
      await page.getByRole('checkbox', { name, exact: true }).check();
      for (const command of commands)
        await expect(page.getByRole('listbox')).toContainText(command);
      await page.getByRole('checkbox', { name, exact: true }).uncheck();
    }
    await input.fill('/mcp');
    await page.getByRole('option', { name: /Test server/ }).click();
    await expect(page.getByRole('listbox', { name: 'Tools from Test server' })).toBeVisible();
    await page.getByRole('option', { name: /Connect and load tools/ }).click();
    await expect(page.getByRole('option', { name: /^echo / })).toBeVisible();
    await page.getByRole('option', { name: /^echo / }).click();
    await expect(page.locator('.command-chip')).toContainText('Test server · echo');
    await expect(page.getByRole('checkbox', { name: 'MCP', exact: true })).not.toBeChecked();
    await page.getByRole('checkbox', { name: 'MCP', exact: true }).check();
    await page.getByRole('checkbox', { name: 'MCP', exact: true }).uncheck();
    await expect(page.locator('.command-chip')).toContainText('echo');
    await input.fill('/mcp "Test server" ');
    await input.press('Escape');
    await expect(input).toHaveValue('/mcp ');
    await input.press('Escape');
    await expect(input).toHaveValue('/');
    await input.fill('/tools');
    await page.getByRole('option', { name: /^command_test_calculator / }).click();
    await expect(page.locator('.command-chip')).toContainText('calculator');
    await expect(page.getByRole('checkbox', { name: 'Tools', exact: true })).not.toBeChecked();
    await input.fill('/help');
    await expect(page.getByRole('listbox', { name: 'Command help' })).toContainText(
      '/mcp "Server" "Tool" request',
    );
    await input.fill('/code');
    await expect(page.getByRole('option', { name: /Open another folder/ })).toBeVisible();
    await input.fill('/kb');
    await expect(page.getByRole('option', { name: /Saved Text context/ })).toBeVisible();
    await page.getByRole('button', { name: 'Clear this chat', exact: true }).click();
    await expect(page.getByText('Temporary message', { exact: true })).toBeVisible();
    await input.fill('/clear');
    await input.press('Enter');
    await expect(page.getByText('Temporary message', { exact: true })).toHaveCount(0);
    const saved = await page.evaluate(
      async (id) => ({
        messages: await window.workspace.chat.messages(id),
        chats: await window.workspace.chat.list(),
      }),
      conversation.id,
    );
    expect(saved.messages).toEqual([]);
    expect(saved.chats.find((chat) => chat.id === conversation.id)?.model).toBe('test-model');
    expect(saved.chats.some((chat) => chat.id === other.id)).toBe(true);
    await input.fill('/');
    await page.screenshot({ path: 'test-results/global-chat-commands.png' });
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
