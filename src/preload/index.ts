import { contextBridge, ipcRenderer } from 'electron';
import type { WorkspaceAPI } from '../shared/api';
const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
const api: WorkspaceAPI = {
  workflows: {
    list: () => invoke('workflows:list'),
    save: (workflow) => invoke('workflows:save', workflow),
    duplicate: (id) => invoke('workflows:duplicate', id),
    remove: (id) => invoke('workflows:remove', id),
    run: (input) => invoke('workflows:run', input),
    stop: (id) => invoke('workflows:stop', id),
    runs: () => invoke('workflows:runs'),
  },
  settings: {
    get: () => invoke('settings:get'),
    save: (v) => invoke('settings:save', v),
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
    remove: (id) => invoke('chat:remove', id),
    clear: () => invoke('chat:clear'),
    messages: (id) => invoke('chat:messages', id),
    send: (i) => invoke('chat:send', i),
    stop: (id) => invoke('chat:stop', id),
  },
  library: {
    list: (k) => invoke('library:list', k),
    save: (k, i) => invoke('library:save', k, i),
    remove: (k, id) => invoke('library:remove', k, id),
    import: (k) => invoke('library:import', k),
    export: (k, id) => invoke('library:export', k, id),
  },
  knowledge: {
    list: () => invoke('knowledge:list'),
    add: (i) => invoke('knowledge:add', i),
    sync: (id) => invoke('knowledge:sync', id),
    stop: (id) => invoke('knowledge:stop', id),
    remove: (id) => invoke('knowledge:remove', id),
    preview: (id) => invoke('knowledge:preview', id),
    search: (q, m, s) => invoke('knowledge:search', q, m, s),
  },
  mcp: { states: () => invoke('mcp:states'), action: (id, a) => invoke('mcp:action', id, a) },
  tools: { run: (id, input) => invoke('tools:run', id, input) },
  agents: {
    project: () => invoke('agents:project'),
    run: (i) => invoke('agents:run', i),
    stop: (id) => invoke('agents:stop', id),
    approve: (id, a) => invoke('agents:approve', id, a),
    runs: () => invoke('agents:runs'),
    removeRun: (id) => invoke('agents:remove-run', id),
    clearRuns: () => invoke('agents:clear-runs'),
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
  },
  onEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof callback>[0]) =>
      callback(payload);
    ipcRenderer.on('workspace:event', listener);
    return () => ipcRenderer.removeListener('workspace:event', listener);
  },
};
contextBridge.exposeInMainWorld('workspace', api);
