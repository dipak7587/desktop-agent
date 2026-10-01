import type { LandingSettings } from './landing';
export type Section =
  | 'Chat'
  | 'Tools'
  | 'MCP'
  | 'Skills'
  | 'Saved Text'
  | 'Agents'
  | 'Code'
  | 'Workflows'
  | 'Knowledge Base'
  | 'Settings';
export type LibraryKind = 'skills' | 'saved-text' | 'agents' | 'mcp' | 'tools';
export type LLMProviderName =
  'ollama' | 'openai' | 'anthropic' | 'google' | 'openrouter' | 'groq' | 'custom';
export interface ProviderProfile {
  enabled?: boolean;
  modelIds?: string[];
  manualModelIds?: string[];
  credentialRef?: string;
  hasCredential?: boolean;
  timeout?: number;
  authMethod?: 'none' | 'bearer' | 'header';
  authHeader?: string;
  id: string;
  name: string;
  provider: LLMProviderName;
  apiKey: string;
  apiBaseUrl: string;
  ollamaUrl: string;
  chatModel: string;
  embeddingModel: string;
}
export interface Settings {
  landing?: LandingSettings;
  lastChatSelection?: { providerId: string; model: string };
  timeout?: number;
  authMethod?: 'none' | 'bearer' | 'header';
  authHeader?: string;
  appName: string;
  appLogo: string;
  theme: 'system' | 'dark' | 'light';
  provider: LLMProviderName;
  apiKey: string;
  apiBaseUrl: string;
  ollamaUrl: string;
  chatModel: string;
  embeddingModel: string;
  providers: ProviderProfile[];
  activeProviderId: string;
  temperature: number;
  contextSize: number;
  topK: number;
  chunkSize: number;
  chunkOverlap: number;
  ignorePatterns: string[];
  approvalMode: 'ask' | 'safe' | 'auto';
  commandTimeout: number;
  maxIterations: number;
  memoryEnabled: boolean;
  memoryAutomatic: boolean;
  deepAgentMode: 'classic' | 'deep';
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
  providerId?: string;
  agentId?: string;
  workspaceId?: string | null;
  id: string;
  title: string;
  model: string;
  createdAt: number;
  updatedAt: number;
}
export type WorkspacePermissionDecision = 'always_allow' | 'ask' | 'deny';
export interface WorkspacePermissionPolicy {
  rules: Record<string, { decision: WorkspacePermissionDecision; scope: 'workspace' }>;
}
export interface CodeWorkspace {
  id: string;
  name: string;
  canonicalPath: string;
  createdAt: string;
  lastOpenedAt: string;
  permissions: WorkspacePermissionPolicy;
  selectedAgentId: string | null;
  preferredProviderId?: string | null;
  preferredModelId?: string | null;
  available?: boolean;
}
export function resolveProviderSettings(settings: Settings): Settings {
  const profile = settings.providers.find((p) => p.id === settings.activeProviderId);
  if (!profile) return settings;
  return {
    ...settings,
    provider: profile.provider,
    apiKey: profile.apiKey,
    apiBaseUrl: profile.apiBaseUrl,
    ollamaUrl: profile.ollamaUrl,
    chatModel: profile.chatModel,
    embeddingModel: profile.embeddingModel,
    activeProviderId: profile.id,
  };
}
export interface Message {
  id: string;
  conversationId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  createdAt: number;
  metadata?: {
    providerId?: string;
    providerNameSnapshot?: string;
    modelId?: string;
    agentId?: string;
    status?: 'streaming' | 'completed' | 'canceled' | 'failed';
    sources?: SearchResult[];
    error?: string;
    stopped?: boolean;
    command?: ChatCommand & { name: string };
    activity?: AppEvent[];
  };
}
export type ChatMode = 'kb' | 'mcp' | 'tools' | 'skills' | 'code' | 'agent' | 'workflow';
export interface ChatCommand {
  kind: 'skills' | 'agent' | 'mcp' | 'workflow' | 'code' | 'tools';
  id: string;
  project?: string;
}
export interface ChatInput {
  modes?: ChatMode[];
  providerId?: string;
  id: string;
  text: string;
  model: string;
  knowledge: string;
  regenerate?: boolean;
  command?: ChatCommand;
}
export interface LibraryItem {
  group?: string;
  providerId?: string;
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
  capabilityConfig?: AgentCapabilityConfig;
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
export interface MemoryEntry {
  id: string;
  scope: 'global' | 'conversation' | 'agent';
  scopeId: string;
  content: string;
  source: 'explicit' | 'automatic';
  createdAt: string;
  updatedAt: string;
}
export interface AppEvent {
  iterationsUsed?: number;
  selection?: { providerId: string; providerNameSnapshot: string; modelId: string };
  type: 'chat' | 'knowledge' | 'agent' | 'mcp' | 'workflow';
  id: string;
  status: string;
  content?: string;
  message?: Message;
  error?: string;
  approval?: { id: string; tool: string; description: string; diff?: string };
  activity?: AppEvent;
  capabilityDecision?: CapabilityDecision & { called: boolean };
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

export type CapabilityType = 'skill' | 'mcp' | 'tool' | 'knowledge';
export type CapabilityMode = 'auto' | 'selected' | 'none';
export type PermissionMode = 'always_allow' | 'ask' | 'deny';
export interface Capability {
  id: string;
  name: string;
  type: CapabilityType;
  description?: string;
  enabled: boolean;
  selectionId?: string;
  requiresProject?: boolean;
  defaultPermission?: PermissionMode;
}
export interface AgentCapabilityConfig {
  mode: CapabilityMode;
  skills: string[];
  mcpServers: string[];
  tools: string[];
  knowledgeBases: string[];
  allowSkills: boolean;
  allowMCP: boolean;
  allowTools: boolean;
  allowKnowledgeBase: boolean;
  permissions: Record<string, PermissionMode>;
  trace: boolean;
}
export interface CapabilityDecision {
  shouldCall: boolean;
  capability: Capability;
  reason: string;
  confidence?: number;
  requiresConfirmation?: boolean;
}
