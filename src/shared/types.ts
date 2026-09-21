export type Section =
  'Chat' | 'Tools' | 'MCP' | 'Skills' | 'Saved Text' | 'Agents' | 'Knowledge Base' | 'Settings';
export type LibraryKind = 'skills' | 'saved-text' | 'agents' | 'mcp' | 'tools';
export interface Settings {
  appName: string;
  theme: 'system' | 'dark' | 'light';
  ollamaUrl: string;
  chatModel: string;
  embeddingModel: string;
  temperature: number;
  contextSize: number;
  topK: number;
  chunkSize: number;
  chunkOverlap: number;
  ignorePatterns: string[];
  approvalMode: 'ask' | 'safe' | 'auto';
  commandTimeout: number;
  maxIterations: number;
  language: 'en';
  startAtLogin: boolean;
  defaultAgent: string;
}
export interface Model {
  name: string;
  size: number;
  capabilities?: string[];
}
export interface Conversation {
  id: string;
  title: string;
  model: string;
  createdAt: number;
  updatedAt: number;
}
export interface Message {
  id: string;
  conversationId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  createdAt: number;
  metadata?: {
    sources?: SearchResult[];
    error?: string;
    stopped?: boolean;
    command?: ChatCommand & { name: string };
    activity?: AppEvent[];
  };
}
export interface ChatCommand {
  kind: 'skills' | 'agent' | 'mcp';
  id: string;
  project?: string;
}
export interface ChatInput {
  id: string;
  text: string;
  model: string;
  knowledge: string;
  regenerate?: boolean;
  command?: ChatCommand;
}
export interface LibraryItem {
  id: string;
  name: string;
  description: string;
  content: string;
  version: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  model: string;
  skills: string[];
  tools: string[];
  knowledgeSources: string[];
  autoStart: boolean;
  maxIterations?: number;
  toolConfig?: ToolConfig;
  command: string;
  args: string[];
  env: Record<string, string>;
}
export interface KnowledgeSource {
  id: string;
  type: 'file' | 'folder' | 'url';
  name: string;
  location: string;
  collection: string;
  createdAt: number;
  updatedAt: number;
  lastSyncedAt?: number;
  status: 'idle' | 'syncing' | 'indexing' | 'ready' | 'error';
  documentCount: number;
  chunkCount: number;
  error?: string;
  embeddingModel?: string;
}
export interface SearchResult {
  id: string;
  sourceId: string;
  name: string;
  content: string;
  score: number;
  location: string;
}
export interface AppEvent {
  type: 'chat' | 'knowledge' | 'agent' | 'mcp';
  id: string;
  status: string;
  content?: string;
  message?: Message;
  error?: string;
  approval?: { id: string; tool: string; description: string; diff?: string };
  activity?: AppEvent;
}
export interface MCPState {
  id: string;
  status: string;
  tools: { name: string; description?: string; inputSchema?: unknown }[];
  logs: string[];
}
export interface RunState {
  id: string;
  status: 'Running' | 'Completed' | 'Failed' | 'Cancelled' | 'Max iterations reached';
  phase?: string;
  events: AppEvent[];
  agentId: string;
  agentName: string;
  userPrompt: string;
  folderPath?: string;
  maxIterations: number;
  iterationsUsed: number;
  startedAt: string;
  completedAt?: string;
  tools: {
    toolId: string;
    toolName: string;
    status: 'running' | 'completed' | 'failed';
    input?: unknown;
    output?: unknown;
    error?: string;
  }[];
  mcps: { mcpId: string; mcpName: string }[];
  result?: string;
  error?: string;
}

export interface ToolConfig {
  type: 'javascript' | 'api';
  parameters: {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    required: boolean;
  }[];
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers: Record<string, string>;
}
