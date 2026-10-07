import {
  analyzeToolSource,
  formatToolSource,
  convertToolSource,
} from '../services/tools/typescript';
import { toolItemFromSource } from '../services/tools/files';
import { parseLibraryDefinition } from '../../shared/library-definition';
import { mcpConfigFromItem } from '../../shared/mcp-schema';
import { randomUUID } from 'node:crypto';
import type { WorkflowService } from '../services/workflows/workflows';
import type { WorkflowRunDatabase } from '../database/workflow-runs';
import { workflowSchema, workflowRunInputSchema } from '../../shared/workflows';
import type { ProviderRouter } from '../services/providers/router';
import type { CustomToolService } from '../services/tools/custom';
import type { AgentRunDatabase } from '../database/agent-runs';
import { readText } from '../services/filesystem/walk';
import { app, ipcMain, dialog, shell, BrowserWindow, clipboard } from 'electron';
import { z } from 'zod';
import { realpath, stat } from 'node:fs/promises';
import {
  settingsSchema,
  idSchema,
  kindSchema,
  librarySchema,
  sendSchema,
  sourceInputSchema,
  runInputSchema,
  memoryInputSchema,
} from '../../shared/schemas';
import type { SettingsService } from '../services/settings/settings';
import type { MemoryService, MemoryEntry } from '../services/ai/memory';
import type { CheckpointDatabase } from '../database/checkpoints';
import type { OllamaLLMProvider } from '../services/ollama/provider';
import type { ChatDatabase } from '../database/chat';
import type { ChatService } from '../services/ollama/chat';
import { createLLMProvider, type LLMProvider } from '../services/ollama/provider';
import type { LibraryService } from '../services/filesystem/library';
import type { KnowledgeService } from '../services/rag/knowledge';
import type { MCPService } from '../services/mcp/mcp';
import type { AgentService } from '../services/agents/agents';
import type { SecretStore } from '../security/secrets';
import { atomicWrite } from '../services/filesystem/storage';
import { errorMessage } from '../../shared/error-message';
import { BUILTIN_CODING_AGENT_ID } from '../../shared/code-agent-templates';
import {
  parseWorkspaceBackup,
  stringifyWorkspaceBackup,
  workspaceBackupFormatSchema,
  workspaceBackupSchema,
} from '../../shared/workspace-backup';
export interface Services {
  workflows: WorkflowService;
  workflowDb: WorkflowRunDatabase;
  providers: ProviderRouter;
  settings: SettingsService;
  ollama: OllamaLLMProvider;
  llm: LLMProvider;
  db: ChatDatabase;
  chat: ChatService;
  library: LibraryService;
  knowledge: KnowledgeService;
  mcp: MCPService;
  agents: AgentService;
  secrets: SecretStore;
  customTools: CustomToolService;
  runDb: AgentRunDatabase;
  memory: MemoryService;
  checkpoints?: CheckpointDatabase;
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
        throw new Error(s.secrets.redact(errorMessage(e)));
      }
    });
  }
  const none = z.tuple([]),
    id = z.tuple([idSchema]);
  handle('clipboard:write-text', z.tuple([z.string().max(2_000_000)]), (text) =>
    clipboard.writeText(text),
  );
  handle('settings:get', none, () => s.settings.get());
  handle('settings:path', none, () => s.settings.root);
  handle(
    'settings:remember-chat-selection',
    z.tuple([idSchema, z.string().min(1).max(200)]),
    (providerId, model) => s.settings.rememberChatSelection(providerId, model),
  );
  handle('settings:save', z.tuple([settingsSchema]), async (value) => {
    const result = await s.settings.save(value);
    app.setName(value.appName);
    app.setLoginItemSettings({ openAtLogin: value.startAtLogin });
    return result;
  });
  handle('models:list', z.tuple([idSchema.optional()]), (id) => s.providers.discover(id));
  handle('models:info', z.tuple([z.string().max(200), idSchema.optional()]), async (name, id) => {
    const snapshot = s.settings.forProvider(id);
    const provider = createLLMProvider(() => snapshot);
    return provider.info ? provider.info(name) : { model: name, capabilities: ['text'] };
  });
  handle('providers:clear-credential', id, (id) => s.settings.clearCredential(id));
  handle('providers:usage', id, async (id) => ({
    agents: (await s.library.list('agents')).filter((a) => a.providerId === id).map((a) => a.name),
    conversations: s.db
      .list()
      .filter((c) => c.providerId === id)
      .map((c) => c.title),
  }));
  handle('chat:list', z.tuple([z.string().max(500).optional()]), (q) => s.db.list(q));
  handle('code:list', none, async () =>
    Promise.all(
      s.db.listCodeWorkspaces().map(async (workspace) => {
        let available = false;
        try {
          available = (await stat(workspace.canonicalPath)).isDirectory();
        } catch {
          available = false;
        }
        return { ...workspace, available };
      }),
    ),
  );
  handle('code:choose-and-connect', id, async (conversationId) => {
    s.db.get(conversationId);
    const result = await dialog.showOpenDialog({
      title: 'Connect project workspace',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const canonicalPath = await realpath(result.filePaths[0]);
    if (!(await stat(canonicalPath)).isDirectory()) throw new Error('Choose a project folder');
    projects.add(canonicalPath);
    await s.chat.releaseWorkspace(conversationId);
    return s.db.connectCodeWorkspace(conversationId, canonicalPath);
  });
  handle('code:reconnect', z.tuple([idSchema, idSchema]), async (workspaceId, conversationId) => {
    const workspace = s.db.getCodeWorkspace(workspaceId);
    if (!(await stat(workspace.canonicalPath)).isDirectory())
      throw new Error('Workspace folder is missing or inaccessible. Relink it using Open Folder.');
    projects.add(workspace.canonicalPath);
    if (s.db.get(conversationId).workspaceId !== workspaceId)
      await s.chat.releaseWorkspace(conversationId);
    return s.db.reconnectCodeWorkspace(workspaceId, conversationId);
  });
  handle(
    'code:set-access',
    z.tuple([
      idSchema,
      z.object({
        agentIds: z.array(idSchema).max(100),
        skills: z.array(idSchema).max(100),
        tools: z.array(z.string().max(300)).max(200),
        mcpServers: z.array(idSchema).max(100),
        knowledgeBases: z.array(z.string().max(200)).max(100),
      }),
    ]),
    async (
      workspaceId: string,
      policy: {
        agentIds: string[];
        skills: string[];
        tools: string[];
        mcpServers: string[];
        knowledgeBases: string[];
      },
    ) => {
      const knownAgents = new Set((await s.library.list('agents')).map((agent) => agent.id));
      const unknownAgent = policy.agentIds.find(
        (agentId) => agentId !== BUILTIN_CODING_AGENT_ID && !knownAgents.has(agentId),
      );
      if (unknownAgent) throw new Error('Choose only existing agents for this folder.');
      const [skills, tools, mcpServers, knowledge] = await Promise.all([
        s.library.list('skills'),
        s.library.list('tools'),
        s.library.list('mcp'),
        s.knowledge.list(),
      ]);
      if (
        policy.skills.some((resourceId) => !skills.some((resource) => resource.id === resourceId))
      )
        throw new Error('Choose only existing skills for this folder.');
      const builtinTools = new Set([
        'filesystem.read',
        'filesystem.write',
        'filesystem.edit',
        'filesystem.delete',
        'filesystem.list',
        'filesystem.search',
        'filesystem.exists',
        'project.detect',
        'git.status',
        'git.diff',
        'git.log',
        'git.add',
        'git.commit',
        'git.push',
        'shell.execute',
      ]);
      if (
        policy.tools.some(
          (resourceId) =>
            !builtinTools.has(resourceId) &&
            !(
              resourceId.startsWith('custom:') &&
              tools.some((resource) => `custom:${resource.id}` === resourceId)
            ),
        )
      )
        throw new Error('Choose only existing tools for this folder.');
      if (
        policy.mcpServers.some(
          (resourceId) => !mcpServers.some((resource) => resource.id === resourceId),
        )
      )
        throw new Error('Choose only existing MCP servers for this folder.');
      if (
        policy.knowledgeBases.some(
          (resourceId) =>
            resourceId !== 'all' &&
            !resourceId.startsWith('collection:') &&
            !knowledge.some((resource) => resource.id === resourceId),
        )
      )
        throw new Error('Choose only existing knowledge bases for this folder.');
      return s.db.setCodeWorkspaceAccess(workspaceId, {
        allowedAgentIds: policy.agentIds,
        allowedSkills: policy.skills,
        allowedTools: policy.tools,
        allowedMCPServers: policy.mcpServers,
        allowedKnowledgeBases: policy.knowledgeBases,
      });
    },
  );
  handle(
    'code:choose-and-relink',
    z.tuple([idSchema, idSchema]),
    async (workspaceId, conversationId) => {
      s.db.get(conversationId);
      s.db.getCodeWorkspace(workspaceId);
      const result = await dialog.showOpenDialog({
        title: 'Relink project workspace',
        properties: ['openDirectory'],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      const canonicalPath = await realpath(result.filePaths[0]);
      if (!(await stat(canonicalPath)).isDirectory()) throw new Error('Choose a project folder');
      projects.add(canonicalPath);
      for (const conversation of s.db.list().filter((c) => c.workspaceId === workspaceId))
        await s.chat.releaseWorkspace(conversation.id);
      await s.chat.releaseWorkspace(conversationId);
      return s.db.relinkCodeWorkspace(workspaceId, conversationId, canonicalPath);
    },
  );
  handle('code:disconnect', id, async (conversationId) => {
    await s.chat.releaseWorkspace(conversationId);
    s.db.disconnectCodeWorkspace(conversationId);
  });
  handle('code:remove', id, async (workspaceId) => {
    for (const conversation of s.db.list().filter((c) => c.workspaceId === workspaceId))
      await s.chat.releaseWorkspace(conversation.id);
    s.db.removeCodeWorkspace(workspaceId);
  });
  handle(
    'chat:create',
    z.tuple([z.string().max(200), idSchema.optional(), idSchema.optional()]),
    (model, providerId, agentId) =>
      s.db.create(model, providerId ?? s.settings.get().activeProviderId, agentId),
  );
  handle(
    'chat:selection',
    z.tuple([
      idSchema,
      idSchema,
      z.string().max(200),
      z.union([idSchema, z.literal('')]).optional(),
    ]),
    (id, providerId, model, agentId) => {
      s.settings.profile(providerId);
      if (model) s.settings.validateSelection(providerId, model);
      s.db.setSelection(id, providerId, model, agentId);
    },
  );
  handle('chat:rename', z.tuple([idSchema, z.string().trim().min(1).max(200)]), (id, title) =>
    s.db.rename(id, title),
  );
  handle('chat:export-markdown', id, async (id) => {
    const conversation = s.db.get(id);
    const messages = s.db.messages(id);
    const safeTitle = Array.from(conversation.title, (character) =>
      /[<>:"/\\|?*]/.test(character) || character.charCodeAt(0) < 32 ? '-' : character,
    )
      .join('')
      .trim();
    const result = await dialog.showSaveDialog({
      defaultPath: `${safeTitle || 'conversation'}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) return;

    const markdown = [
      `# ${conversation.title}`,
      '',
      `- Created: ${new Date(conversation.createdAt).toLocaleString()}`,
      `- Updated: ${new Date(conversation.updatedAt).toLocaleString()}`,
      `- Model: ${conversation.model || 'Not selected'}`,
      '',
      ...messages.flatMap((message) => [
        `## ${message.role === 'assistant' ? 'Assistant' : message.role === 'user' ? 'User' : message.role}`,
        '',
        message.content ||
          (message.metadata?.error ? `_${message.metadata.error}_` : '_No content_'),
        ...(message.metadata?.error && message.content
          ? ['', `> Error: ${message.metadata.error}`]
          : []),
        '',
      ]),
    ].join('\n');
    await atomicWrite(result.filePath, markdown);
  });
  handle('chat:remove', id, async (id) => {
    if (s.chat.isActive(id)) throw new Error('Stop generation before deleting this conversation');
    await s.chat.releaseWorkspace(id);
    s.db.remove(id);
  });
  handle('chat:clear', none, async () => {
    await s.chat.stopAll();
    for (const conversation of s.db.list()) await s.chat.releaseWorkspace(conversation.id);
    s.db.clear();
  });
  handle('chat:messages', id, (id) => s.db.messages(id));
  handle('chat:send', z.tuple([sendSchema]), (input) => {
    if (
      ['agent', 'workflow'].includes(input.command?.kind ?? '') &&
      input.command?.project &&
      !projects.has(input.command.project)
    )
      throw new Error('Select a project using the folder picker first');
    return s.chat.send(input);
  });
  handle('chat:stop', id, (id) => s.chat.stop(id));
  handle('library:list', z.tuple([kindSchema]), (kind) => s.library.list(kind));
  handle('library:groups', z.tuple([kindSchema]), (kind) => s.library.groups(kind));
  handle(
    'library:rename-group',
    z.tuple([kindSchema, z.string().trim().min(1).max(100), z.string().trim().min(1).max(100)]),
    (kind, from, to) => s.library.renameGroup(kind, from, to),
  );
  handle(
    'library:delete-group',
    z.tuple([kindSchema, z.string().trim().min(1).max(100)]),
    (kind, group) => s.library.deleteGroup(kind, group),
  );
  handle(
    'library:set-group',
    z.tuple([
      z.enum(['agents', 'mcp', 'skills', 'tools', 'saved-text']),
      z.array(idSchema).min(1).max(1000),
      librarySchema.shape.group,
    ]),
    (kind, ids, group) => s.library.setGroup(kind, ids, group),
  );
  handle('library:save', z.tuple([kindSchema, librarySchema]), async (kind, item) => {
    await s.library.assertSaveAllowed(kind, item);
    if (kind === 'agents') {
      item = { ...item, providerId: item.providerId ?? s.settings.get().activeProviderId };
      s.settings.validateSelection(item.providerId, item.model);
    }
    if (kind === 'mcp') {
      mcpConfigFromItem({ ...item });
      await s.mcp.stop(item.id);
    }
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
      filters: [
        {
          name: 'Portable definition',
          extensions:
            kind === 'tools'
              ? ['ts', 'json', 'yaml', 'yml', 'md']
              : kind === 'mcp'
                ? ['json', 'yaml', 'yml', 'md']
                : ['md'],
        },
      ],
    });
    if (result.canceled) return;
    const raw = await readText(result.filePaths[0], 2000000);
    if (raw.length > 2_000_000) throw new Error('Import file exceeds 2 MB');
    const extension = result.filePaths[0].split('.').pop()?.toLowerCase();
    const item =
      kind === 'tools' && extension !== 'md' && extension !== 'ts'
        ? toolItemFromSource(
            convertToolSource(raw, extension === 'json' ? 'json' : 'yaml').source,
            { id: randomUUID() },
          )
        : kind === 'mcp' && extension !== 'json'
          ? librarySchema.parse({
              ...parseLibraryDefinition(raw, extension === 'md' ? 'md' : 'yaml', kind),
              id: randomUUID(),
            })
          : s.library.parse(kind, raw);
    if (kind === 'agents') {
      item.providerId ??= s.settings.get().activeProviderId;
      item.model ||=
        s.settings.get().providers.find((p) => p.id === item.providerId)?.chatModel ?? '';
      s.settings.validateSelection(item.providerId, item.model);
    }
    await s.library.save(kind, item);
  });
  handle('library:export', z.tuple([kindSchema, idSchema]), async (kind, id) => {
    const item = await s.library.get(kind, id);
    const result = await dialog.showSaveDialog({
      defaultPath: `${item.id}.${kind === 'mcp' ? 'json' : kind === 'tools' ? 'ts' : 'md'}`,
    });
    if (!result.canceled && result.filePath)
      await atomicWrite(result.filePath, s.library.serialize(kind, item));
  });
  handle('knowledge:list', none, () => s.knowledge.list());
  handle(
    'knowledge:set-group',
    z.tuple([z.array(idSchema).min(1).max(1000), librarySchema.shape.group]),
    (ids, group) => s.knowledge.setGroup(ids, group),
  );
  handle('knowledge:add', z.tuple([sourceInputSchema]), async (input) => {
    if (input.type === 'url') {
      if (!input.url) throw new Error('Enter a URL');
      await s.knowledge.add('url', input.url, input.collection, input.group);
      return;
    }
    const result = await dialog.showOpenDialog({
      title: 'Add knowledge source',
      properties: [input.type === 'folder' ? 'openDirectory' : 'openFile'],
      filters:
        input.type === 'file' ? [{ name: 'Text documents', extensions: ['md', 'txt'] }] : undefined,
    });
    if (!result.canceled)
      await s.knowledge.add(
        input.type,
        await realpath(result.filePaths[0]),
        input.collection,
        input.group,
      );
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
  handle('agents:remove-run', id, (id) => s.agents.removeRun(id));
  handle('agents:clear-runs', none, () => s.agents.clearRuns());
  const toolSourceInput = z.string().max(2_000_000);
  const toolFormatInput = z.enum(['typescript', 'json', 'yaml', 'markdown']);
  handle(
    'tools:run-source',
    z.tuple([toolSourceInput, z.record(z.string(), z.unknown())]),
    (source, input) => s.customTools.runSource(source, input),
  );
  handle('tools:analyze', z.tuple([toolSourceInput]), (source) => analyzeToolSource(source));
  handle('tools:format', z.tuple([toolSourceInput]), (source) => formatToolSource(source));
  handle('tools:convert', z.tuple([toolSourceInput, toolFormatInput]), (source, format) =>
    convertToolSource(source, format),
  );
  handle('tools:import-source', none, async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Tool',
      properties: ['openFile'],
      filters: [{ name: 'LangChain tool', extensions: ['ts', 'md', 'json', 'yaml', 'yml'] }],
    });
    if (result.canceled) return null;
    const path = result.filePaths[0];
    const raw = await readText(path, 2_000_000);
    const extension = path.split('.').pop()?.toLowerCase();
    return convertToolSource(
      raw,
      extension === 'ts'
        ? 'typescript'
        : extension === 'md'
          ? 'markdown'
          : extension === 'json'
            ? 'json'
            : 'yaml',
    );
  });
  handle(
    'tools:run',
    z.tuple([idSchema, z.record(z.string().max(200), z.unknown())]),
    (id, input) => s.customTools.run(id, input),
  );
  handle(
    'workflows:export-document',
    z.tuple([
      z
        .object({
          name: z.string().max(200),
          format: z.enum(['md', 'json', 'yaml']),
          content: z.string().max(1000000),
        })
        .strict(),
    ]),
    async (input) => {
      const name =
        input.name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'workflow';
      const options = {
        defaultPath: `${name}.${input.format}`,
        filters: [{ name: `Workflow ${input.format.toUpperCase()}`, extensions: [input.format] }],
      };
      const window = getWindow();
      const result = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return false;
      await atomicWrite(result.filePath, input.content);
      return true;
    },
  );
  handle('workflows:list', none, () => s.workflows.definitions.list());
  handle('workflows:save', z.tuple([workflowSchema]), (input) =>
    s.workflows.definitions.save(input),
  );
  handle('workflows:duplicate', id, (id) => s.workflows.definitions.duplicate(id));
  handle('workflows:remove', id, (id) => s.workflows.definitions.remove(id));
  handle('workflows:runs', none, () => s.workflows.runs());
  handle('workflows:clear-runs', none, () => s.workflows.clearRuns());
  handle('workflows:stop', id, (id) => s.workflows.stop(id));
  handle('workflows:run', z.tuple([workflowRunInputSchema]), (input) => {
    if (input.project && !projects.has(input.project))
      throw new Error('Select a project using the folder picker first');
    return s.workflows.run(input);
  });
  handle('agents:runs', none, () => s.agents.runs());
  handle(
    'memory:list',
    z.tuple([
      z.enum(['global', 'conversation', 'agent']).optional(),
      z.string().max(200).optional(),
    ]),
    (scope, scopeId) => s.memory.list(scope, scopeId) as MemoryEntry[],
  );
  handle('memory:save', z.tuple([memoryInputSchema]), (input) =>
    s.memory.save({
      scope: input.scope,
      scopeId: input.scopeId ?? (input.scope === 'global' ? '' : ''),
      content: input.content,
      source: 'explicit',
    }),
  );
  handle('memory:remove', id, (id) => s.memory.remove(id));
  handle(
    'memory:clear',
    z.tuple([
      z.enum(['global', 'conversation', 'agent']).optional(),
      z.string().max(200).optional(),
    ]),
    (scope, scopeId) => s.memory.clear(scope, scopeId),
  );
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
  handle('system:export-workspace', z.tuple([workspaceBackupFormatSchema]), async (format) => {
    const result = await dialog.showSaveDialog({
      defaultPath: `localai-workspace-backup.${format === 'yaml' ? 'yaml' : format}`,
      filters: [
        { name: format === 'md' ? 'Markdown' : format.toUpperCase(), extensions: [format] },
      ],
    });
    if (result.canceled || !result.filePath) return;

    const settings = s.settings.get();
    const backup = workspaceBackupSchema.parse({
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      settings: {
        ...settings,
        apiKey: '',
        providers: settings.providers.map((provider) => ({
          ...provider,
          apiKey: '',
          credentialRef: undefined,
          hasCredential: false,
        })),
      },
      libraries: {
        skills: (await s.library.list('skills')).filter((item) => !item.builtIn),
        'saved-text': (await s.library.list('saved-text')).filter((item) => !item.builtIn),
        agents: (await s.library.list('agents')).filter((item) => !item.builtIn),
        mcp: (await s.library.list('mcp')).filter((item) => !item.builtIn),
        tools: (await s.library.list('tools')).filter((item) => !item.builtIn),
      },
      workflows: await s.workflows.definitions.list(),
      conversations: s.db.exportAll(),
    });
    await atomicWrite(result.filePath, stringifyWorkspaceBackup(backup, format));
  });
  handle('system:import-workspace', none, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'showHiddenFiles'],
      filters: [{ name: 'Workspace backup', extensions: ['json', 'yaml', 'yml', 'md'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const path = result.filePaths[0];
    const raw = await readText(path, 50_000_000);
    const extension = path.split('.').pop()?.toLowerCase();
    const format =
      extension === 'md' ? 'md' : extension === 'yaml' || extension === 'yml' ? 'yaml' : 'json';
    const backup = parseWorkspaceBackup(raw, format);

    const currentSettings = s.settings.get();
    const importedProviderIds = new Set(backup.settings.providers.map((provider) => provider.id));
    const mergedSettings = {
      ...backup.settings,
      providers: [
        ...currentSettings.providers.filter((provider) => !importedProviderIds.has(provider.id)),
        ...backup.settings.providers,
      ],
      activeProviderId: backup.settings.providers.some(
        (provider) => provider.id === backup.settings.activeProviderId,
      )
        ? backup.settings.activeProviderId
        : currentSettings.activeProviderId,
    };
    if (
      !mergedSettings.providers.some((provider) => provider.id === mergedSettings.activeProviderId)
    )
      throw new Error('The backup does not contain a provider configuration.');

    const currentAgents = await s.library.list('agents');
    const agentIds = new Set([
      ...currentAgents.map((agent) => agent.id),
      ...backup.libraries.agents.map((agent) => agent.id),
    ]);
    for (const workflow of backup.workflows)
      for (const node of workflow.agents)
        if (!agentIds.has(node.agentId))
          throw new Error(`Workflow “${workflow.name}” references missing agent “${node.name}”.`);

    for (const kind of ['skills', 'saved-text', 'agents', 'mcp', 'tools'] as const)
      for (const item of backup.libraries[kind]) s.library.assertWritable(kind, item.id);
    await s.settings.save(mergedSettings);
    for (const kind of ['skills', 'saved-text', 'agents', 'mcp', 'tools'] as const) {
      for (const item of backup.libraries[kind]) {
        if (kind === 'mcp') await s.mcp.stop(item.id);
        await s.library.save(kind, item);
      }
    }
    for (const workflow of backup.workflows) await s.workflows.definitions.save(workflow);
    s.db.importConversations(backup.conversations);
    return {
      conversations: backup.conversations.length,
      workflows: backup.workflows.length,
      libraries: {
        skills: backup.libraries.skills.length,
        'saved-text': backup.libraries['saved-text'].length,
        agents: backup.libraries.agents.length,
        mcp: backup.libraries.mcp.length,
        tools: backup.libraries.tools.length,
      },
    };
  });
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
