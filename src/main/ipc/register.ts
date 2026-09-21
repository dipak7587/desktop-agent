import type { CustomToolService } from '../services/tools/custom';
import type { AgentRunDatabase } from '../database/agent-runs';
import { readText } from '../services/filesystem/walk';
import { app, ipcMain, dialog, shell, BrowserWindow } from 'electron';
import { z } from 'zod';
import { realpath } from 'node:fs/promises';
import {
  settingsSchema,
  idSchema,
  kindSchema,
  librarySchema,
  sendSchema,
  sourceInputSchema,
  runInputSchema,
} from '../../shared/schemas';
import type { SettingsService } from '../services/settings/settings';
import type { OllamaLLMProvider } from '../services/ollama/provider';
import type { ChatDatabase } from '../database/chat';
import type { ChatService } from '../services/ollama/chat';
import type { LibraryService } from '../services/filesystem/library';
import type { KnowledgeService } from '../services/rag/knowledge';
import type { MCPService } from '../services/mcp/mcp';
import type { AgentService } from '../services/agents/agents';
import type { SecretStore } from '../security/secrets';
import { atomicWrite } from '../services/filesystem/storage';
export interface Services {
  settings: SettingsService;
  ollama: OllamaLLMProvider;
  db: ChatDatabase;
  chat: ChatService;
  library: LibraryService;
  knowledge: KnowledgeService;
  mcp: MCPService;
  agents: AgentService;
  secrets: SecretStore;
  customTools: CustomToolService;
  runDb: AgentRunDatabase;
}
export function registerIPC(s: Services, getWindow: () => BrowserWindow | null) {
  const projects = new Set<string>();
  function handle(channel: string, schema: z.ZodType, fn: (...args: any[]) => unknown) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      const window = getWindow();
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error('Untrusted IPC sender');
      const parsed = schema.parse(args) as unknown[];
      try {
        return await fn(...parsed);
      } catch (e) {
        throw new Error(s.secrets.redact((e as Error).message));
      }
    });
  }
  const none = z.tuple([]),
    id = z.tuple([idSchema]);
  handle('settings:get', none, () => s.settings.get());
  handle('settings:path', none, () => s.settings.root);
  handle('settings:save', z.tuple([settingsSchema]), async (value) => {
    const result = await s.settings.save(value);
    app.setName(value.appName);
    app.setLoginItemSettings({ openAtLogin: value.startAtLogin });
    return result;
  });
  handle('models:list', none, () => s.ollama.listModels());
  handle('models:info', z.tuple([z.string().max(200)]), (name) => s.ollama.info(name));
  handle('chat:list', z.tuple([z.string().max(500).optional()]), (q) => s.db.list(q));
  handle('chat:create', z.tuple([z.string().max(200)]), (model) => s.db.create(model));
  handle('chat:rename', z.tuple([idSchema, z.string().trim().min(1).max(200)]), (id, title) =>
    s.db.rename(id, title),
  );
  handle('chat:remove', id, (id) => {
    if (s.chat.isActive(id)) throw new Error('Stop generation before deleting this conversation');
    s.db.remove(id);
  });
  handle('chat:clear', none, async () => {
    await s.chat.stopAll();
    s.db.clear();
  });
  handle('chat:messages', id, (id) => s.db.messages(id));
  handle('chat:send', z.tuple([sendSchema]), (input) => {
    if (
      input.command?.kind === 'agent' &&
      input.command.project &&
      !projects.has(input.command.project)
    )
      throw new Error('Select a project using the folder picker first');
    return s.chat.send(input);
  });
  handle('chat:stop', id, (id) => s.chat.stop(id));
  handle('library:list', z.tuple([kindSchema]), (kind) => s.library.list(kind));
  handle('library:save', z.tuple([kindSchema, librarySchema]), async (kind, item) => {
    if (kind === 'mcp') await s.mcp.stop(item.id);
    return s.library.save(kind, item);
  });
  handle('library:remove', z.tuple([kindSchema, idSchema]), async (kind, id) => {
    await s.library.assertRemovable(kind, id);
    if (kind === 'mcp') await s.mcp.stop(id);
    return s.library.remove(kind, id);
  });
  handle('library:import', z.tuple([kindSchema]), async (kind) => {
    const result = await dialog.showOpenDialog({
      title: `Import ${kind}`,
      properties: ['openFile'],
      filters: [{ name: 'Portable definition', extensions: [kind === 'mcp' ? 'json' : 'md'] }],
    });
    if (result.canceled) return;
    const raw = await readText(result.filePaths[0], 2000000);
    if (raw.length > 2_000_000) throw new Error('Import file exceeds 2 MB');
    await s.library.save(kind, s.library.parse(kind, raw));
  });
  handle('library:export', z.tuple([kindSchema, idSchema]), async (kind, id) => {
    const item = await s.library.get(kind, id);
    const result = await dialog.showSaveDialog({
      defaultPath: `${item.id}.${kind === 'mcp' ? 'json' : 'md'}`,
    });
    if (!result.canceled && result.filePath)
      await atomicWrite(result.filePath, s.library.serialize(kind, item));
  });
  handle('knowledge:list', none, () => s.knowledge.list());
  handle('knowledge:add', z.tuple([sourceInputSchema]), async (input) => {
    if (input.type === 'url') {
      if (!input.url) throw new Error('Enter a URL');
      await s.knowledge.add('url', input.url, input.collection);
      return;
    }
    const result = await dialog.showOpenDialog({
      title: 'Add knowledge source',
      properties: [input.type === 'folder' ? 'openDirectory' : 'openFile'],
      filters:
        input.type === 'file' ? [{ name: 'Text documents', extensions: ['md', 'txt'] }] : undefined,
    });
    if (!result.canceled)
      await s.knowledge.add(input.type, await realpath(result.filePaths[0]), input.collection);
  });
  handle('knowledge:sync', id, (id) => s.knowledge.sync(id));
  handle('knowledge:stop', id, (id) => s.knowledge.stop(id));
  handle('knowledge:remove', id, (id) => s.knowledge.remove(id));
  handle('knowledge:preview', id, (id) => s.knowledge.preview(id));
  handle(
    'knowledge:search',
    z.tuple([
      z.string().min(1).max(2000),
      z.enum(['semantic', 'keyword']),
      z.string().max(200).optional(),
    ]),
    (q, m, scope) => s.knowledge.search(q, m, scope),
  );
  handle('mcp:states', none, () => s.mcp.states());
  handle(
    'mcp:action',
    z.tuple([idSchema, z.enum(['start', 'stop', 'restart', 'test'])]),
    (id, action) => s.mcp.action(id, action),
  );
  handle('agents:project', none, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select agent workspace',
      properties: ['openDirectory'],
    });
    if (result.canceled) return null;
    const path = await realpath(result.filePaths[0]);
    projects.add(path);
    return path;
  });
  handle('agents:run', z.tuple([runInputSchema]), (input) => {
    if (input.project && !projects.has(input.project))
      throw new Error('Select a project using the folder picker first');
    return s.agents.run(input);
  });
  handle('agents:stop', id, (id) => s.agents.stop(id));
  handle('agents:approve', z.tuple([idSchema, z.boolean()]), (id, approved) =>
    s.agents.approve(id, approved),
  );
  handle(
    'tools:run',
    z.tuple([idSchema, z.record(z.string().max(200), z.unknown())]),
    (id, input) => s.customTools.run(id, input),
  );
  handle('agents:runs', none, () => s.agents.runs());
  const secretName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,99}$/);
  handle('secrets:list', none, () => s.secrets.list());
  handle('secrets:import-env', none, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Use an environment file',
      properties: ['openFile', 'showHiddenFiles'],
    });
    return result.canceled ? [] : s.secrets.loadEnvironment(result.filePaths[0]);
  });
  handle('secrets:clear-env', none, () => s.secrets.clearEnvironment());
  handle('secrets:set', z.tuple([secretName, z.string().min(1).max(10000)]), (name, value) =>
    s.secrets.set(name, value),
  );
  handle('secrets:remove', z.tuple([secretName]), (name) => s.secrets.remove(name));
  handle('system:ollama-docs', none, () => shell.openExternal('https://ollama.com/download'));
  handle('system:export-settings', none, async () => {
    const result = await dialog.showSaveDialog({ defaultPath: 'localai-settings.json' });
    if (!result.canceled && result.filePath)
      await atomicWrite(result.filePath, JSON.stringify(s.settings.get(), null, 2));
  });
  handle('system:import-settings', none, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Settings JSON', extensions: ['json'] }],
    });
    if (!result.canceled)
      await s.settings.save(
        settingsSchema.parse(JSON.parse(await readText(result.filePaths[0], 2000000))),
      );
  });
}
