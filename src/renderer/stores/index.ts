import { create } from 'zustand';
import type {
  Settings,
  Model,
  Conversation,
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
  chatCommand: (ChatCommand & { name: string }) | null;
  setSection: (section: Section) => void;
}>((set) => ({
  section: 'Chat',
  error: '',
  notice: '',
  draft: '',
  chatCommand: null,
  setSection: (section) => set({ section }),
}));
export async function attempt<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action();
  } catch (e) {
    useUI.setState({
      error: (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''),
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
      const settings = get().settings;
      if (settings && models.length && (!settings.chatModel || !settings.embeddingModel))
        await get().save({
          ...settings,
          chatModel:
            settings.chatModel ||
            models.find((m) => m.capabilities?.includes('completion'))?.name ||
            models.find((m) => !m.name.includes('embed'))?.name ||
            '',
          embeddingModel:
            settings.embeddingModel ||
            models.find((m) => m.name.startsWith('nomic-embed-text'))?.name ||
            '',
        });
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
  current: string | null;
  messages: Message[];
  stream: string;
  generating: string | null;
  activity: AppEvent[];
  search: string;
  load: (q?: string) => Promise<void>;
  open: (id: string) => Promise<void>;
  newChat: () => Promise<void>;
  event: (event: AppEvent) => void;
}>((set, get) => ({
  conversations: [],
  current: null,
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
    set({ current: id, messages, stream: '' });
  },
  newChat: async () => {
    if (get().generating)
      throw new Error('Stop the current response before starting another conversation');
    const c = await window.workspace.chat.create(useSettings.getState().settings?.chatModel ?? '');
    useUI.setState({ chatCommand: null });
    set({ current: c.id, messages: [], stream: '' });
    await get().load();
  },
  event: (e) => {
    if (e.status === 'generating') set({ generating: e.id, stream: '', activity: [] });
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
  return create<{ items: LibraryItem[]; load: () => Promise<void> }>((set) => ({
    items: [],
    load: async () => set({ items: await window.workspace.library.list(kind) }),
  }));
}
export const useSkills = libraryStore('skills');
export const useAgents = libraryStore('agents');
export const useSavedText = libraryStore('saved-text');
export const useMCP = libraryStore('mcp');
export const libraryStores = {
  skills: useSkills,
  agents: useAgents,
  'saved-text': useSavedText,
  mcp: useMCP,
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
