import { WorkflowRunDatabase } from './database/workflow-runs';
import { WorkflowDefinitions } from './services/workflows/definitions';
import { WorkflowService } from './services/workflows/workflows';
import { ProviderRouter } from './services/providers/router';
import { CustomToolService } from './services/tools/custom';
import { AgentRunDatabase } from './database/agent-runs';
import { app, BrowserWindow, session, dialog } from 'electron';
import { join } from 'node:path';
import { mkdir, appendFile, readdir } from 'node:fs/promises';
import { SettingsService } from './services/settings/settings';
import {
  createEmbeddingProvider,
  createLLMProvider,
  OllamaLLMProvider,
} from './services/ollama/provider';
import { ChatDatabase } from './database/chat';
import { ChatService } from './services/ollama/chat';
import { ChatCommands } from './services/ollama/commands';
import { LibraryService } from './services/filesystem/library';
import { KnowledgeService } from './services/rag/knowledge';
import { SecretStore } from './security/secrets';
import { MCPService } from './services/mcp/mcp';
import { AgentService } from './services/agents/agents';
import { registerIPC, type Services } from './ipc/register';
import type { AppEvent } from '../shared/types';
let window: BrowserWindow | null = null;
let services: Services | undefined;
let quitting = false;
if (process.env.LOCALAI_DATA_DIR && !app.isPackaged)
  app.setPath('userData', process.env.LOCALAI_DATA_DIR);
const root = app.getPath('userData');
async function log(error: unknown) {
  await mkdir(join(root, 'logs'), { recursive: true });
  await appendFile(
    join(root, 'logs', 'app.log'),
    `${new Date().toISOString()} ${services?.secrets.redact(String(error)) ?? String(error)}\n`,
  );
}
function createWindow() {
  window = new BrowserWindow({
    title: services?.settings.get().appName,
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#141615',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (e) => e.preventDefault());
  window.on('closed', () => {
    window = null;
  });
  if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged)
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadFile(join(import.meta.dirname, '../renderer/index.html'));
}
app
  .whenReady()
  .then(async () => {
    for (const dir of [
      'database',
      'skills',
      'agents',
      'tools',
      'mcp',
      'saved-text',
      'cache',
      'logs',
    ])
      await mkdir(join(root, dir), { recursive: true });
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
      callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    const secrets = new SecretStore(root);
    await secrets.init();
    const settings = new SettingsService(root, secrets, () =>
      new LibraryService(root).list('agents'),
    );
    await settings.init();
    app.setName(settings.get().appName);
    const getSettings = () => settings.get();
    const ollama = new OllamaLLMProvider(getSettings);
    const providers = new ProviderRouter(settings);
    const llm = createLLMProvider(getSettings);
    const embeddings = {
      embed: (text: string, signal?: AbortSignal) =>
        createEmbeddingProvider(() => settings.forProvider()).embed(text, signal),
      embedBatch: (texts: string[], signal?: AbortSignal) =>
        createEmbeddingProvider(() => settings.forProvider()).embedBatch(texts, signal),
    };
    const db = new ChatDatabase(join(root, 'database', 'app.sqlite'));
    db.migrateProviders(settings.get().activeProviderId);
    const library = new LibraryService(root, () => knowledge.syncSavedText());
    for (const agent of await library.list('agents')) {
      if (!agent.providerId && settings.get().activeProviderId)
        await library.save('agents', {
          ...agent,
          providerId: settings.get().activeProviderId,
          model: agent.model || settings.get().chatModel,
        });
    }
    const emit = (event: AppEvent) => {
      if (window && !window.isDestroyed())
        window.webContents.send('workspace:event', {
          ...event,
          content: event.content ? secrets.redact(event.content) : undefined,
          error: event.error ? secrets.redact(event.error) : undefined,
        });
    };
    const knowledge = new KnowledgeService(root, getSettings, embeddings, emit);
    await knowledge.init();
    if (
      (await readdir(join(root, 'saved-text'))).some((name) => name.endsWith('.md')) ||
      knowledge.list().some((source) => source.id === 'saved-text')
    )
      await knowledge.syncSavedText();
    const mcp = new MCPService(library, secrets, emit);
    const customTools = new CustomToolService(library, secrets, () => getSettings().commandTimeout);
    const runDb = new AgentRunDatabase(join(root, 'database', 'agent-runs.sqlite'));
    const agents = new AgentService(
      library,
      llm,
      knowledge,
      mcp,
      getSettings,
      emit,
      undefined,
      customTools,
      runDb,
      (text) => secrets.redact(text),
      providers,
    );
    const workflowDb = new WorkflowRunDatabase(join(root, 'database', 'workflow-runs.sqlite'));
    const workflows = new WorkflowService(
      new WorkflowDefinitions(root, library),
      agents,
      workflowDb,
      emit,
      (text) => secrets.redact(text),
    );
    const chat = new ChatService(
      db,
      llm,
      emit,
      (q, scope) => knowledge.search(q, 'semantic', scope),
      () => getSettings().contextSize,
      new ChatCommands(library, mcp, agents, workflows),
      (text) => secrets.redact(text),
      () => knowledge.list(),
      providers,
    );
    services = {
      workflows,
      workflowDb,
      providers,
      settings,
      ollama,
      llm,
      db,
      chat,
      library,
      knowledge,
      mcp,
      agents,
      secrets,
      customTools,
      runDb,
    };
    registerIPC(services, () => window);
    createWindow();
    void mcp.autoStart().catch(log);
    app.on('activate', () => {
      if (!window) createWindow();
    });
  })
  .catch(async (e) => {
    await log(e);
    dialog.showErrorBox('LocalAI Workspace could not start', String(e));
    app.quit();
  });
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  void (async () => {
    if (services) {
      await Promise.allSettled([
        services.chat.stopAll(),
        services.workflows.stopAll(),
        services.knowledge.stopAll(),
        services.agents.stopAll(),
        services.mcp.stopAll(),
      ]);
      services.customTools.stopAll();
      services.workflowDb.close();
      services.runDb.close();
      services.db.close();
    }
    app.exit();
  })();
});
process.on('unhandledRejection', (e) => {
  void log(e);
  if (window && !window.isDestroyed())
    window.webContents.send('workspace:event', {
      type: 'agent',
      id: 'system',
      status: 'Failed',
      error: 'An operation failed. See the local application log.',
    });
});
