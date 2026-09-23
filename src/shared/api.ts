import type { AgentWorkflow, WorkflowRun, WorkflowRunInput } from './workflows';
import type {
  Settings,
  Model,
  Conversation,
  Message,
  LibraryKind,
  LibraryItem,
  KnowledgeSource,
  SearchResult,
  AppEvent,
  MCPState,
  RunState,
  ChatInput,
} from './types';
export interface WorkspaceAPI {
  workflows: {
    list(): Promise<AgentWorkflow[]>;
    save(workflow: AgentWorkflow): Promise<AgentWorkflow>;
    duplicate(id: string): Promise<AgentWorkflow>;
    remove(id: string): Promise<void>;
    run(input: WorkflowRunInput): Promise<string>;
    stop(id: string): Promise<void>;
    runs(): Promise<WorkflowRun[]>;
  };
  settings: {
    get(): Promise<Settings>;
    save(value: Settings): Promise<Settings>;
    dataPath(): Promise<string>;
  };
  models: {
    list(providerId?: string): Promise<Model[]>;
    info(name: string, providerId?: string): Promise<unknown>;
  };
  providers: {
    clearCredential(id: string): Promise<void>;
    usage(id: string): Promise<{ agents: string[]; conversations: string[] }>;
  };
  chat: {
    list(query?: string): Promise<Conversation[]>;
    create(model: string, providerId?: string, agentId?: string): Promise<Conversation>;
    selection(id: string, providerId: string, model: string, agentId?: string): Promise<void>;
    rename(id: string, title: string): Promise<void>;
    remove(id: string): Promise<void>;
    clear(): Promise<void>;
    messages(id: string): Promise<Message[]>;
    send(input: ChatInput): Promise<void>;
    stop(id: string): Promise<void>;
  };
  library: {
    list(kind: LibraryKind): Promise<LibraryItem[]>;
    save(kind: LibraryKind, item: LibraryItem): Promise<LibraryItem>;
    remove(kind: LibraryKind, id: string): Promise<void>;
    import(kind: LibraryKind): Promise<void>;
    export(kind: LibraryKind, id: string): Promise<void>;
  };
  knowledge: {
    list(): Promise<KnowledgeSource[]>;
    add(input: {
      type: 'file' | 'folder' | 'url';
      url?: string;
      collection?: string;
    }): Promise<void>;
    sync(id: string): Promise<void>;
    stop(id: string): Promise<void>;
    remove(id: string): Promise<void>;
    preview(id: string): Promise<string>;
    search(query: string, mode: 'semantic' | 'keyword', scope?: string): Promise<SearchResult[]>;
  };
  mcp: {
    states(): Promise<MCPState[]>;
    action(id: string, action: 'start' | 'stop' | 'restart' | 'test'): Promise<void>;
  };
  tools: { run(id: string, input: Record<string, unknown>): Promise<string> };
  agents: {
    project(): Promise<string | null>;
    run(input: { agentId: string; task: string; project?: string }): Promise<string>;
    stop(id: string): Promise<void>;
    approve(id: string, approved: boolean): Promise<void>;
    runs(): Promise<RunState[]>;
    removeRun(id: string): Promise<void>;
    clearRuns(): Promise<void>;
  };
  secrets: {
    importEnv(): Promise<string[]>;
    clearEnv(): Promise<void>;
    list(): Promise<string[]>;
    set(name: string, value: string): Promise<void>;
    remove(name: string): Promise<void>;
  };
  system: {
    openOllamaDocs(): Promise<void>;
    exportSettings(): Promise<void>;
    importSettings(): Promise<void>;
  };
  onEvent(callback: (event: AppEvent) => void): () => void;
}
declare global {
  interface Window {
    workspace: WorkspaceAPI;
  }
}
