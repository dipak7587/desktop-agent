import { contextBridge, ipcRenderer } from 'electron';
import type { WorkspaceAPI } from '../shared/api';
import type { MemoryEntry } from '../shared/types';
const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
const api: WorkspaceAPI = {
  clipboard: { writeText: (text) => invoke('clipboard:write-text', text) },
  workflows: {
    list: () => invoke('workflows:list'),
    save: (workflow) => invoke('workflows:save', workflow),
    duplicate: (id) => invoke('workflows:duplicate', id),
    remove: (id) => invoke('workflows:remove', id),
    run: (input) => invoke('workflows:run', input),
    stop: (id) => invoke('workflows:stop', id),
    runs: () => invoke('workflows:runs'),
    clearRuns: () => invoke('workflows:clear-runs'),
  },
  settings: {
    get: () => invoke('settings:get'),
    save: (v) => invoke('settings:save', v),
    rememberChatSelection: (providerId, model) =>
      invoke('settings:remember-chat-selection', providerId, model),
    dataPath: () => invoke('settings:path'),
  },
  models: {
    list: (id) => invoke('models:list', id),
    info: (n, id) => invoke('models:info', n, id),
  },
  providers: {
    clearCredential: (id) => invoke('providers:clear-credential', id),
    usage: (id) => invoke('providers:usage', id),
  },
  chat: {
    list: (q) => invoke('chat:list', q),
    create: (m, p, a) => invoke('chat:create', m, p, a),
    selection: (id, p, m, a) => invoke('chat:selection', id, p, m, a),
    rename: (id, t) => invoke('chat:rename', id, t),
    exportMarkdown: (id) => invoke('chat:export-markdown', id),
    remove: (id) => invoke('chat:remove', id),
    clear: () => invoke('chat:clear'),
    messages: (id) => invoke('chat:messages', id),
    send: (i) => invoke('chat:send', i),
    stop: (id) => invoke('chat:stop', id),
  },
  code: {
    list: () => invoke('code:list'),
    chooseAndConnect: (conversationId) => invoke('code:choose-and-connect', conversationId),
    chooseAndRelink: (workspaceId, conversationId) =>
      invoke('code:choose-and-relink', workspaceId, conversationId),
    reconnect: (workspaceId, conversationId) =>
      invoke('code:reconnect', workspaceId, conversationId),
    setAccess: (workspaceId, policy) => invoke('code:set-access', workspaceId, policy),
    disconnect: (conversationId) => invoke('code:disconnect', conversationId),
    remove: (workspaceId) => invoke('code:remove', workspaceId),
  },
  library: {
    groups: (k) => invoke('library:groups', k),
    setGroup: (kind, ids, group) => invoke('library:set-group', kind, ids, group),
    renameGroup: (kind, from, to) => invoke('library:rename-group', kind, from, to),
    deleteGroup: (kind, group) => invoke('library:delete-group', kind, group),
    list: (k) => invoke('library:list', k),
    save: (k, i) => invoke('library:save', k, i),
    remove: (k, id) => invoke('library:remove', k, id),
    import: (k) => invoke('library:import', k),
    export: (k, id) => invoke('library:export', k, id),
  },
  knowledge: {
    list: () => invoke('knowledge:list'),
    add: (i) => invoke('knowledge:add', i),
    setGroup: (ids, group) => invoke('knowledge:set-group', ids, group),
    sync: (id) => invoke('knowledge:sync', id),
    stop: (id) => invoke('knowledge:stop', id),
    remove: (id) => invoke('knowledge:remove', id),
    preview: (id) => invoke('knowledge:preview', id),
    search: (q, m, s) => invoke('knowledge:search', q, m, s),
  },
  mcp: { states: () => invoke('mcp:states'), action: (id, a) => invoke('mcp:action', id, a) },
  tools: {
    run: (id, input) => invoke('tools:run', id, input),
    runSource: (source, input) => invoke('tools:run-source', source, input),
    analyze: (source) => invoke('tools:analyze', source),
    format: (source) => invoke('tools:format', source),
    convert: (source, format) => invoke('tools:convert', source, format),
    importSource: () => invoke('tools:import-source'),
  },
  agents: {
    project: () => invoke('agents:project'),
    run: (i) => invoke('agents:run', i),
    stop: (id) => invoke('agents:stop', id),
    approve: (id, a) => invoke('agents:approve', id, a),
    runs: () => invoke('agents:runs'),
    removeRun: (id) => invoke('agents:remove-run', id),
    clearRuns: () => invoke('agents:clear-runs'),
  },
  memory: {
    list: (scope?: MemoryEntry['scope'], scopeId?: string) => invoke('memory:list', scope, scopeId),
    save: (entry) => invoke('memory:save', entry),
    remove: (id) => invoke('memory:remove', id),
    clear: (scope, scopeId) => invoke('memory:clear', scope, scopeId),
  },
  secrets: {
    importEnv: () => invoke('secrets:import-env'),
    clearEnv: () => invoke('secrets:clear-env'),
    list: () => invoke('secrets:list'),
    set: (n, v) => invoke('secrets:set', n, v),
    remove: (n) => invoke('secrets:remove', n),
  },
  system: {
    openOllamaDocs: () => invoke('system:ollama-docs'),
    exportSettings: () => invoke('system:export-settings'),
    importSettings: () => invoke('system:import-settings'),
    exportWorkspace: (format) => invoke('system:export-workspace', format),
    importWorkspace: () => invoke('system:import-workspace'),
  },
  onEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) =>
      callback(payload);
    ipcRenderer.on('workspace:event', listener);
    return () => ipcRenderer.removeListener('workspace:event', listener);
  },
};
contextBridge.exposeInMainWorld('workspace', api);
