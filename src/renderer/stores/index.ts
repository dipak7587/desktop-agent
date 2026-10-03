import { defaultChatSelection } from '../../shared/chat-selection';
import { errorMessage } from '../../shared/error-message';
import { create } from 'zustand';
import type {
  Settings,
  Model,
  Conversation,
  CodeWorkspace,
  Message,
  LibraryItem,
  LibraryKind,
  KnowledgeSource,
  MCPState,
  AppEvent,
  RunState,
  Section,
  ChatCommand,
} from '../../shared/types';
export const useUI = create<{
  section: Section;
  error: string;
  notice: string;
  draft: string;
  chatModes: import('../../shared/types').ChatMode[];
  chatKnowledge: string;
  chatCommand: (ChatCommand & { name: string }) | null;
  setSection: (section: Section) => void;
}>((set) => ({
  section: 'Chat',
  error: '',
  notice: '',
  draft: '',
  chatModes: [],
  chatKnowledge: 'all',
  chatCommand: null,
  setSection: (section) => set({ section }),
}));
export async function attempt<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action();
  } catch (e) {
    useUI.setState({
      error: errorMessage(e).replace(/^Error invoking remote method '[^']+': Error: /, ''),
    });
  }
}
export const useSettings = create<{
  settings: Settings | null;
  models: Model[];
  status: string;
  loading: boolean;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  save: (s: Settings) => Promise<void>;
}>((set, get) => ({
  settings: null,
  models: [],
  status: 'Checking connection',
  loading: false,
  load: async () => {
    const settings = await window.workspace.settings.get();
    set({ settings });
    document.documentElement.style.colorScheme =
      settings.theme === 'system' ? 'light dark' : settings.theme;
    document
      .querySelector('meta[name="color-scheme"]')
      ?.setAttribute('content', settings.theme === 'system' ? 'light dark' : settings.theme);
    document.title = settings.appName;
  },
  refresh: async () => {
    set({ loading: true });
    try {
      const models = await window.workspace.models.list();
      set({ models, status: `Connected · ${models.length} models` });
      await get().load();
    } catch (e) {
      set({ models: [], status: (e as Error).message });
    } finally {
      set({ loading: false });
    }
  },
  save: async (settings) => {
    await window.workspace.settings.save(settings);
    await get().load();
  },
}));
export const useChat = create<{
  conversations: Conversation[];
  workspace: CodeWorkspace | null;
  current: string | null;
  messages: Message[];
  stream: string;
  generating: string | null;
  activity: AppEvent[];
  generatingSelection?: AppEvent['selection'];
  search: string;
  load: (q?: string) => Promise<void>;
  open: (id: string) => Promise<void>;
  providerId: string;
  model: string;
  agentId: string;
  choose: (providerId: string, model: string, agentId?: string) => Promise<void>;
  connectWorkspace: () => Promise<void>;
  reconnectWorkspace: (workspaceId: string) => Promise<void>;
  relinkWorkspace: (workspaceId: string) => Promise<void>;
  disconnectWorkspace: () => Promise<void>;
  newChat: (selection?: { providerId: string; model: string; agentId?: string }) => Promise<void>;
  clear: () => Promise<void>;
  event: (event: AppEvent) => void;
}>((set, get) => ({
  conversations: [],
  workspace: null,
  current: null,
  providerId: '',
  model: '',
  agentId: '',
  messages: [],
  stream: '',
  generating: null,
  activity: [],
  search: '',
  load: async (q = '') => set({ conversations: await window.workspace.chat.list(q), search: q }),
  open: async (id) => {
    if (get().generating && get().generating !== id)
      throw new Error('Stop the current response before switching conversations');
    const messages = await window.workspace.chat.messages(id);
    if (get().current !== id) useUI.setState({ chatCommand: null });
    const c = get().conversations.find((c) => c.id === id);
    let workspace = c?.workspaceId
      ? ((await window.workspace.code.list()).find((item) => item.id === c.workspaceId) ?? null)
      : null;
    if (workspace?.available) workspace = await window.workspace.code.reconnect(workspace.id, id);
    set({
      current: id,
      workspace,
      messages,
      stream: get().generating === id ? get().stream : '',
      ...(c ? { providerId: c.providerId ?? '', model: c.model, agentId: c.agentId ?? '' } : {}),
    });
  },
  newChat: async (selection) => {
    if (get().generating)
      throw new Error('Stop the current response before starting another conversation');
    const settings = useSettings.getState().settings;
    const defaults = defaultChatSelection(settings);
    const c = await window.workspace.chat.create(
      selection?.model ?? defaults.model,
      selection?.providerId ?? (defaults.providerId || undefined),
      selection?.agentId,
    );
    useUI.setState({ chatCommand: null, draft: '' });
    set({
      current: c.id,
      workspace: null,
      messages: [],
      stream: '',
      providerId: c.providerId ?? '',
      model: c.model,
      agentId: c.agentId ?? '',
    });
    await get().load();
  },
  choose: async (providerId, model, agentId) => {
    set({ providerId, model, ...(agentId !== undefined ? { agentId } : {}) });
    if (!get().current) {
      const c = await window.workspace.chat.create(model, providerId, agentId);
      set({ current: c.id, messages: [], stream: '', providerId, model, agentId: agentId ?? '' });
      await get().load();
    } else {
      await window.workspace.chat.selection(get().current!, providerId, model, agentId);
      await get().load();
    }
    // Automatic agent selection passes an agentId; only manual choices become
    // the remembered selection for ordinary new chats.
    if (agentId === undefined && model) {
      const settings = await window.workspace.settings.rememberChatSelection(providerId, model);
      useSettings.setState({ settings });
    }
  },
  connectWorkspace: async () => {
    if (!get().current) await get().newChat();
    const conversationId = get().current;
    if (!conversationId) throw new Error('Create a conversation before connecting a workspace');
    const workspace = await window.workspace.code.chooseAndConnect(conversationId);
    if (!workspace) return;
    if (get().current === conversationId) set({ workspace });
    await get().load();
  },
  reconnectWorkspace: async (workspaceId) => {
    if (!get().current) await get().newChat();
    const conversationId = get().current;
    if (!conversationId) throw new Error('Create a conversation before connecting a workspace');
    const workspace = await window.workspace.code.reconnect(workspaceId, conversationId);
    if (get().current === conversationId) set({ workspace });
    await get().load();
  },
  relinkWorkspace: async (workspaceId) => {
    if (!get().current) await get().newChat();
    const conversationId = get().current;
    if (!conversationId) throw new Error('Create a conversation before relinking a workspace');
    const workspace = await window.workspace.code.chooseAndRelink(workspaceId, conversationId);
    if (!workspace) return;
    if (get().current === conversationId) set({ workspace });
    await get().load();
  },
  disconnectWorkspace: async () => {
    const conversationId = get().current;
    if (!conversationId) return;
    await window.workspace.code.disconnect(conversationId);
    if (get().current === conversationId) set({ workspace: null });
    await get().load();
  },
  clear: async () => {
    await window.workspace.chat.clear();
    useUI.setState({ chatCommand: null });
    set({
      current: null,
      workspace: null,
      messages: [],
      stream: '',
      generating: null,
      activity: [],
      conversations: [],
    });
    await get().load();
  },
  event: (e) => {
    if (e.status === 'generating')
      set({ generating: e.id, stream: '', activity: [], generatingSelection: e.selection });
    if (e.activity && get().current === e.id)
      set((s) => ({ activity: [...s.activity, e.activity!].slice(-100) }));
    if (e.status === 'streaming' && get().current === e.id)
      set((s) => ({ stream: s.stream + (e.content ?? '') }));
    if (e.message) {
      if (get().current === e.id)
        set((s) => ({
          messages: [...s.messages.filter((m) => m.id !== e.message!.id), e.message!],
          stream: '',
        }));
      set({ generating: null });
      void attempt(() => get().load());
    }
  },
}));
function libraryStore(kind: LibraryKind) {
  return create<{ items: LibraryItem[]; groups: string[]; load: () => Promise<void> }>((set) => ({
    items: [],
    groups: [],
    load: async () => {
      const [items, groups] = await Promise.all([
        window.workspace.library.list(kind),
        window.workspace.library.groups(kind),
      ]);
      set({ items, groups });
    },
  }));
}
export const useSkills = libraryStore('skills');
export const useAgents = libraryStore('agents');
export const useSavedText = libraryStore('saved-text');
export const useMCP = libraryStore('mcp');
export const useTools = libraryStore('tools');
export const libraryStores = {
  skills: useSkills,
  agents: useAgents,
  'saved-text': useSavedText,
  mcp: useMCP,
  tools: useTools,
};
export const useKnowledge = create<{
  sources: KnowledgeSource[];
  progress: Record<string, string>;
  load: () => Promise<void>;
}>((set) => ({
  sources: [],
  progress: {},
  load: async () => set({ sources: await window.workspace.knowledge.list() }),
}));
export const useMCPStatus = create<{ states: MCPState[]; load: () => Promise<void> }>((set) => ({
  states: [],
  load: async () => set({ states: await window.workspace.mcp.states() }),
}));
export const useRuns = create<{ runs: RunState[]; load: () => Promise<void> }>((set) => ({
  runs: [],
  load: async () => set({ runs: await window.workspace.agents.runs() }),
}));
