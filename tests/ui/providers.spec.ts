import { test, expect, _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('provider selection, historical badges, agent overrides, and restart persistence', async () => {
  const server = createServer(async (req, res) => {
    if (req.url === '/api/tags') {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          models: [
            { name: 'first-model', size: 0 },
            { name: 'second-model', size: 0 },
          ],
        }),
      );
      return;
    }
    if (req.url === '/api/chat') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const answer = body.messages.some((m: { content: string }) => m.content.includes('JSON'))
        ? '{"final":"Agent answer"}'
        : `Answer from ${body.model}`;
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.end(
        JSON.stringify({ message: { role: 'assistant', content: answer }, done: true }) + '\n',
      );
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const root = await mkdtemp(join(tmpdir(), 'provider-ui-'));
  await writeFile(
    join(root, 'settings.json'),
    JSON.stringify({ ollamaUrl: endpoint, chatModel: 'first-model' }),
  );
  const env = Object.fromEntries(
    Object.entries({ ...process.env, LOCALAI_DATA_DIR: root }).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && entry[0] !== 'ELECTRON_RUN_AS_NODE',
    ),
  );
  let app = await electron.launch({ args: ['.'], env });
  try {
    let page = await app.firstWindow();
    await expect(page.getByLabel('Model', { exact: true })).toHaveValue('first-model');
    await expect(page.getByLabel('Provider', { exact: true })).toHaveCount(0);
    await page.getByLabel('Message', { exact: true }).fill('First question');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('.message.assistant').filter({ hasText: 'completed' })).toContainText(
      'Local Ollama / first-model',
    );
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'AI Providers', exact: true }).click();
    await page.getByRole('button', { name: 'Add provider', exact: true }).click();
    await page.getByLabel('Display name', { exact: true }).fill('Second Ollama');
    await page.getByLabel('API base URL', { exact: true }).fill(endpoint);
    await page
      .getByRole('button', { name: 'Test connection / Refresh models', exact: true })
      .click();
    await expect(page.getByLabel('Default chat model').locator('option')).toHaveCount(3);
    await page.getByLabel('Default chat model').selectOption('second-model');
    await page.getByRole('button', { name: 'Save provider', exact: true }).click();
    await expect(page.locator('article').filter({ hasText: 'Second Ollama' })).toContainText(
      'second-model',
    );
    await expect(page.locator('article').filter({ hasText: 'Local Ollama' })).toContainText(
      'Application default',
    );
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await page.getByLabel('Provider', { exact: true }).selectOption({ label: 'Second Ollama' });
    await expect(page.getByLabel('Model', { exact: true })).toHaveValue('second-model');
    await page.getByLabel('Message', { exact: true }).fill('Second question');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.locator('.message.assistant').last()).toContainText(
      'Second Ollama / second-model',
    );
    await expect(page.locator('.message.assistant').first()).toContainText(
      'Local Ollama / first-model',
    );
    await page.getByRole('button', { name: 'Agents', exact: true }).click();
    await page.getByRole('button', { name: 'New agent', exact: true }).click();
    const modal = page.getByRole('dialog');
    await modal.getByLabel('Name', { exact: true }).fill('Provider agent');
    await modal.getByLabel('Provider', { exact: true }).selectOption({ label: 'Second Ollama' });
    await modal.getByRole('button', { name: 'Save', exact: true }).click();
    const card = page.locator('.library-card').filter({ hasText: 'Provider agent' });
    await expect(card).toContainText('Second Ollama / second-model');
    await card.getByRole('button', { name: 'Open in Chat', exact: true }).click();
    await page.getByLabel('Model', { exact: true }).selectOption('first-model');
    await expect(page.getByText('Conversation override', { exact: true })).toBeVisible();
    let agent = await page.evaluate(async () => (await window.workspace.library.list('agents'))[0]);
    expect(agent.model).toBe('second-model');
    await page.getByRole('button', { name: 'Save to Agent', exact: true }).click();
    await expect(page.getByText('Conversation override', { exact: true })).toHaveCount(0);
    agent = await page.evaluate(async () => (await window.workspace.library.list('agents'))[0]);
    expect(agent.model).toBe('first-model');
    await page.screenshot({ path: 'test-results/providers-chat.png' });
    await app.close();
    app = await electron.launch({ args: ['.'], env });
    page = await app.firstWindow();
    await page.getByRole('button', { name: 'First question', exact: true }).click();
    await expect(page.getByLabel('Provider', { exact: true })).toHaveValue(agent.providerId!);
    await expect(page.getByLabel('Model', { exact: true })).toHaveValue('second-model');
    await expect(page.locator('.message.assistant').first()).toContainText(
      'Local Ollama / first-model',
    );
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'AI Providers', exact: true }).click();
    const second = page.locator('article').filter({ hasText: 'Second Ollama' });
    await second.getByRole('button', { name: 'Delete', exact: true }).click();
    const blocked = page.getByRole('dialog', { name: 'Cannot delete provider' });
    await expect(blocked).toContainText('used by this agent');
    await expect(blocked.getByRole('listitem')).toHaveText(['Provider agent']);
    await blocked.getByRole('button', { name: 'Close', exact: true }).click();
    await page.evaluate(async () => {
      const agent = (await window.workspace.library.list('agents'))[0];
      await window.workspace.library.save('agents', {
        ...agent,
        id: 'second-agent',
        name: 'Disabled agent',
        enabled: false,
      });
    });
    await second.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(blocked).toContainText('used by these 2 agents');
    await expect(blocked.getByRole('listitem')).toHaveCount(2);
    await expect(blocked).toContainText('Disabled agent');
    await blocked.getByRole('button', { name: 'Close', exact: true }).click();
    const rejection = await page.evaluate(async (id) => {
      const settings = await window.workspace.settings.get();
      try {
        await window.workspace.settings.save({
          ...settings,
          providers: settings.providers.filter((p) => p.id !== id),
        });
        return 'Deletion unexpectedly succeeded';
      } catch (e) {
        return (e as Error).message;
      }
    }, agent.providerId!);
    expect(rejection).toContain('used by 2 agents');
    await second.getByRole('button', { name: 'Disable', exact: true }).click();
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Use Local Ollama', exact: true })).toBeVisible();
    await expect(page.getByLabel('Provider', { exact: true })).toHaveCount(0);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
