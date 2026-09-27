import { nativeChatModel } from '../ai/native-models';
import {
  AIMessage,
  type AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { providerURLSchema } from '../../../shared/schemas';
import type { Model, Settings, LLMProviderName } from '../../../shared/types';
export interface ChatMessage {
  role: string;
  content: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
  tool_call_id?: string;
}
export interface ToolCall {
  id?: string;
  function: { name: string; arguments: Record<string, unknown> };
}
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  tools?: unknown[];
  format?: unknown;
}
export interface ChatChunk {
  message?: { content?: string; tool_calls?: ToolCall[] };
  done?: boolean;
  error?: string;
}
export interface LLMProvider {
  createChatModel(
    model: string,
    options?: { disableStreaming?: boolean; format?: unknown },
  ): BaseChatModel;
  listModels(): Promise<Model[]>;
  info?(name: string): Promise<unknown>;
  complete?(request: ChatRequest): Promise<ChatMessage>;
  chat(request: ChatRequest): AsyncIterable<ChatChunk>;
}
export interface EmbeddingProvider {
  embed(text: string, signal?: AbortSignal): Promise<number[]>;
  embedBatch(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}
function nativeMessages(messages: ChatMessage[]) {
  return messages.map((m) =>
    m.role === 'system'
      ? new SystemMessage(m.content)
      : m.role === 'assistant'
        ? new AIMessage({
            content: m.content,
            tool_calls: m.tool_calls?.map((t) => ({
              name: t.function.name,
              args: t.function.arguments,
              id: t.id,
            })),
          })
        : m.role === 'tool'
          ? new ToolMessage({
              content: m.content,
              tool_call_id: m.tool_call_id ?? '',
              name: m.tool_name,
            })
          : new HumanMessage(m.content),
  );
}
async function* nativeChat(settings: Settings, request: ChatRequest): AsyncIterable<ChatChunk> {
  const model = nativeChatModel(settings, request.model, { format: request.format });
  const runnable = request.tools?.length
    ? model.bindTools!(request.tools as Parameters<NonNullable<BaseChatModel['bindTools']>>[0])
    : model;
  let combined: AIMessageChunk | undefined;
  for await (const message of await runnable.stream(nativeMessages(request.messages), {
    signal: request.signal,
  })) {
    combined = combined ? combined.concat(message) : message;
    yield { message: { content: message.text } };
  }
  if (combined?.tool_calls?.length)
    yield {
      message: {
        tool_calls: combined.tool_calls.map((t) => ({
          id: t.id,
          function: { name: t.name, arguments: t.args },
        })),
      },
    };
}
async function nativeComplete(settings: Settings, request: ChatRequest): Promise<ChatMessage> {
  const model = nativeChatModel(settings, request.model, {
    disableStreaming: true,
    format: request.format,
  });
  const runnable = request.tools?.length
    ? model.bindTools!(request.tools as Parameters<NonNullable<BaseChatModel['bindTools']>>[0])
    : model;
  const message = await runnable.invoke(nativeMessages(request.messages), {
    signal: request.signal,
  });
  return {
    role: 'assistant',
    content: message.text,
    tool_calls: message.tool_calls?.map((t) => ({
      id: t.id,
      function: { name: t.name, arguments: t.args },
    })),
  };
}
export class OllamaLLMProvider implements LLMProvider {
  constructor(private settings: () => Settings) {}
  async request(path: string, body?: unknown, signal?: AbortSignal) {
    const settings = this.settings();
    const base = providerURLSchema.parse(settings.ollamaUrl);
    return providerFetch(settings, `${base.replace(/\/$/, '')}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  }
  async listModels(): Promise<Model[]> {
    return (await (await this.request('/api/tags')).json()).models;
  }
  async info(name: string) {
    return (await this.request('/api/show', { model: name })).json();
  }
  createChatModel(model: string, options = {}) {
    return nativeChatModel(this.settings(), model, options);
  }
  chat(request: ChatRequest) {
    return nativeChat(this.settings(), request);
  }
  complete(request: ChatRequest) {
    return nativeComplete(this.settings(), request);
  }
}
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private llm: OllamaLLMProvider,
    private settings: () => Settings,
  ) {}
  async embed(text: string, signal?: AbortSignal) {
    return (await this.embedBatch([text], signal))[0];
  }
  async embedBatch(texts: string[], signal?: AbortSignal) {
    const model = this.settings().embeddingModel;
    if (!model)
      throw new Error(
        'Select an installed embedding model in Settings. nomic-embed-text is recommended.',
      );
    const data = await (
      await this.llm.request('/api/embed', { model, input: texts }, signal)
    ).json();
    if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length)
      throw new Error('Invalid embedding response');
    return data.embeddings as number[][];
  }
}

const defaultProviderBaseUrl: Record<LLMProviderName, string> = {
  ollama: 'http://localhost:11434',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  custom: '',
};

export function providerBaseUrl(settings: Settings) {
  const provider = settings.provider;
  const explicit = settings.apiBaseUrl.trim();
  if (explicit) return providerURLSchema.parse(explicit).replace(/\/$/, '');
  if (provider === 'custom')
    throw new Error('Set a custom API base URL for the selected provider.');
  return defaultProviderBaseUrl[provider].replace(/\/$/, '');
}

/** Shared transport: bounded requests, no redirect credential forwarding or upstream error echoes. */
export async function providerFetch(
  settings: Settings,
  url: string | URL,
  init: RequestInit = {},
  errorMode: 'throw' | 'response' = 'throw',
) {
  const timeout = AbortSignal.timeout(settings.timeout ?? 300000);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
  } catch {
    if (init.signal?.aborted) throw new Error('Request canceled');
    throw new Error(
      timeout.aborted
        ? 'Provider request timed out. Retry or increase the timeout.'
        : 'Cannot reach provider. Check its endpoint and network connection, then retry.',
    );
  }
  if (!response.ok) {
    const action =
      response.status === 401 || response.status === 403
        ? 'Check the API credential and account permissions.'
        : response.status === 429
          ? 'Rate limit reached. Wait and retry.'
          : response.status === 404
            ? 'Check the API base URL and model ID.'
            : 'Retry or check the provider service.';
    const message = `${settings.provider} HTTP ${response.status}. ${action}`;
    if (errorMode === 'response')
      return Response.json(
        { error: { message, type: 'provider_error' } },
        { status: response.status },
      );
    throw new Error(message);
  }
  return response;
}

abstract class RemoteProvider implements LLMProvider {
  constructor(protected settings: () => Settings) {}
  abstract listModels(): Promise<Model[]>;
  createChatModel(model: string, options = {}) {
    return nativeChatModel(this.settings(), model, options);
  }
  chat(request: ChatRequest) {
    return nativeChat(this.settings(), request);
  }
  complete(request: ChatRequest) {
    return nativeComplete(this.settings(), request);
  }
  protected async request(path: string, body?: unknown, signal?: AbortSignal) {
    const s = this.settings();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (s.provider === 'anthropic') {
      headers['x-api-key'] = s.apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else if (s.provider === 'google') headers['x-goog-api-key'] = s.apiKey;
    else if (s.apiKey && s.authMethod !== 'none') {
      if (s.authMethod === 'header') headers[s.authHeader ?? 'x-api-key'] = s.apiKey;
      else headers.Authorization = `Bearer ${s.apiKey}`;
    }
    return providerFetch(s, `${providerBaseUrl(s)}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  }
}
export class OpenAICompatibleLLMProvider extends RemoteProvider {
  async listModels(): Promise<Model[]> {
    const data = await (await this.request('/models')).json();
    if (!Array.isArray(data.data))
      throw new Error('Model discovery unavailable. Register model IDs manually.');
    return data.data.map((m: { id: string }) => ({
      name: m.id,
      size: 0,
      capabilities: ['completion'],
    }));
  }
  async info(name: string) {
    return (await this.request(`/models/${encodeURIComponent(name)}`)).json();
  }
}
export class GoogleLLMProvider extends RemoteProvider {
  async listModels(): Promise<Model[]> {
    const models: Model[] = [];
    let page = '';
    do {
      const data = await (
        await this.request(`/models${page ? `?pageToken=${encodeURIComponent(page)}` : ''}`)
      ).json();
      if (!Array.isArray(data.models))
        throw new Error('Model discovery unavailable. Register model IDs manually.');
      models.push(
        ...data.models.map((m: { name: string; supportedGenerationMethods?: string[] }) => ({
          name: m.name.replace(/^models\//, ''),
          size: 0,
          capabilities: [
            ...(m.supportedGenerationMethods?.includes('generateContent') ? ['completion'] : []),
            ...(m.supportedGenerationMethods?.includes('embedContent') ? ['embedding'] : []),
          ],
        })),
      );
      page = data.nextPageToken ?? '';
    } while (page && models.length < 10000);
    return models;
  }
  async info(name: string) {
    return (await this.request(`/models/${encodeURIComponent(name)}`)).json();
  }
}
export class AnthropicLLMProvider extends RemoteProvider {
  async listModels(): Promise<Model[]> {
    const models: Model[] = [];
    let after = '';
    do {
      const data = await (
        await this.request(`/v1/models${after ? `?after_id=${encodeURIComponent(after)}` : ''}`)
      ).json();
      if (!Array.isArray(data.data))
        throw new Error('Model discovery unavailable. Register model IDs manually.');
      models.push(
        ...data.data.map((m: { id: string }) => ({
          name: m.id,
          size: 0,
          capabilities: ['completion'],
        })),
      );
      after = data.has_more ? data.last_id : '';
    } while (after && models.length < 10000);
    return models;
  }
  async info(name: string) {
    return (await this.request(`/v1/models/${encodeURIComponent(name)}`)).json();
  }
}

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  constructor(private settings: () => Settings) {}
  async embed(text: string, signal?: AbortSignal) {
    return (await this.embedBatch([text], signal))[0];
  }
  async embedBatch(texts: string[], signal?: AbortSignal) {
    const model = this.settings().embeddingModel;
    if (!model) throw new Error('Select an embedding model in Settings for the selected provider.');
    const response = await providerFetch(
      this.settings(),
      `${providerBaseUrl(this.settings())}/embeddings`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.settings().apiKey ? { Authorization: `Bearer ${this.settings().apiKey}` } : {}),
        },
        body: JSON.stringify({ model, input: texts }),
        signal,
      },
    );
    const data = await response.json();
    return (data.data ?? []).map((item: { embedding: number[] }) => item.embedding);
  }
}

export class GoogleEmbeddingProvider implements EmbeddingProvider {
  constructor(private settings: () => Settings) {}
  async embed(text: string, signal?: AbortSignal) {
    return (await this.embedBatch([text], signal))[0];
  }
  async embedBatch(texts: string[], signal?: AbortSignal) {
    const model = this.settings().embeddingModel;
    if (!model) throw new Error('Select an embedding model in Settings for the selected provider.');
    const url = new URL(
      `${providerBaseUrl(this.settings())}/models/${encodeURIComponent(model)}:batchEmbedContents`,
    );
    const response = await providerFetch(this.settings(), url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.settings().apiKey },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${model}`,
          content: { parts: [{ text }] },
        })),
      }),
      signal,
    });
    const data = await response.json();
    return (data.embeddings ?? []).map((item: { values?: number[] }) => item.values ?? []);
  }
}

export function createLLMProvider(settings: () => Settings): LLMProvider {
  const next = settings();
  const selected = next.providers?.find((p) => p.id === next.activeProviderId);
  const resolved = selected
    ? {
        ...next,
        ...selected,
        provider: selected.provider,
        apiKey: selected.apiKey,
        apiBaseUrl: selected.apiBaseUrl,
        ollamaUrl: selected.ollamaUrl,
        chatModel: selected.chatModel,
        embeddingModel: selected.embeddingModel,
      }
    : next;
  switch (resolved.provider) {
    case 'openai':
    case 'openrouter':
    case 'groq':
    case 'custom':
      return new OpenAICompatibleLLMProvider(() => resolved);
    case 'anthropic':
      return new AnthropicLLMProvider(() => resolved);
    case 'google':
      return new GoogleLLMProvider(() => resolved);
    case 'ollama':
    default:
      return new OllamaLLMProvider(() => resolved);
  }
}

export function createEmbeddingProvider(settings: () => Settings): EmbeddingProvider {
  const next = settings();
  const selected = next.providers?.find((p) => p.id === next.activeProviderId);
  const resolved = selected
    ? {
        ...next,
        ...selected,
        provider: selected.provider,
        apiKey: selected.apiKey,
        apiBaseUrl: selected.apiBaseUrl,
        ollamaUrl: selected.ollamaUrl,
        chatModel: selected.chatModel,
        embeddingModel: selected.embeddingModel,
      }
    : next;
  switch (resolved.provider) {
    case 'openai':
    case 'openrouter':
    case 'groq':
    case 'custom':
      return new OpenAICompatibleEmbeddingProvider(() => resolved);
    case 'google':
      return new GoogleEmbeddingProvider(() => resolved);
    case 'anthropic':
      throw new Error(
        'Anthropic does not expose embeddings in this app. Choose Ollama or a provider with embeddings enabled.',
      );
    case 'ollama':
    default:
      return new OllamaEmbeddingProvider(new OllamaLLMProvider(() => resolved), () => resolved);
  }
}
