import { providerURLSchema } from '../../../shared/schemas';
import type { Model, Settings, LLMProviderName } from '../../../shared/types';
export interface ChatMessage {
  role: string;
  content: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
}
export interface ToolCall {
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
  listModels(): Promise<Model[]>;
  info?(name: string): Promise<unknown>;
  complete?(request: ChatRequest): Promise<ChatMessage>;
  chat(request: ChatRequest): AsyncIterable<ChatChunk>;
}
export interface EmbeddingProvider {
  embed(text: string, signal?: AbortSignal): Promise<number[]>;
  embedBatch(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}
export async function* parseNDJSON(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) yield JSON.parse(line);
      }
      if (buffer.length > 4_000_000) throw new Error('Ollama response exceeded limit');
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield JSON.parse(buffer);
  } finally {
    reader.releaseLock();
  }
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
  async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
    const settings = this.settings();
    const response = await this.request(
      '/api/chat',
      {
        model: request.model,
        messages: request.messages,
        stream: true,
        tools: request.tools,
        format: request.format,
        options: { temperature: settings.temperature, num_ctx: settings.contextSize },
      },
      request.signal,
    );
    if (!response.body) throw new Error('Ollama returned no response body');
    for await (const chunk of parseNDJSON(response.body)) {
      if (chunk.error)
        throw new Error('Ollama generation failed. Check the selected model and server.');
      yield chunk;
    }
  }
  async complete(request: ChatRequest): Promise<ChatMessage> {
    const s = this.settings();
    const response = await this.request(
      '/api/chat',
      {
        model: request.model,
        messages: request.messages,
        tools: request.tools,
        format: request.format,
        stream: false,
        options: { temperature: s.temperature, num_ctx: s.contextSize },
      },
      request.signal,
    );
    return (await response.json()).message;
  }
  async generate(model: string, prompt: string, signal?: AbortSignal) {
    return this.request('/api/generate', { model, prompt, stream: false }, signal).then((r) =>
      r.json(),
    );
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

function providerBaseUrl(settings: Settings) {
  const provider = settings.provider;
  const explicit = settings.apiBaseUrl.trim();
  if (explicit) return providerURLSchema.parse(explicit).replace(/\/$/, '');
  if (provider === 'custom')
    throw new Error('Set a custom API base URL for the selected provider.');
  return defaultProviderBaseUrl[provider].replace(/\/$/, '');
}

/** Shared transport: bounded requests, no redirect credential forwarding or upstream error echoes. */
async function providerFetch(settings: Settings, url: string | URL, init: RequestInit = {}) {
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
    throw new Error(`${settings.provider} HTTP ${response.status}. ${action}`);
  }
  return response;
}

export async function* parseSSE(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data: string[] = [];
  function record(line: string) {
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    if (line === '' && data.length) {
      const payload = data.join('\n');
      data = [];
      return payload;
    }
  }
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const payload = record(buffer.slice(0, index).replace(/\r$/, ''));
        buffer = buffer.slice(index + 1);
        if (payload === '[DONE]') return;
        if (payload) yield JSON.parse(payload);
      }
      if (buffer.length + data.join('').length > 4_000_000)
        throw new Error('Provider stream exceeded record limit');
      if (done) break;
    }
    if (buffer) record(buffer.replace(/\r$/, ''));
    const payload = record('');
    if (payload && payload !== '[DONE]') yield JSON.parse(payload);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

abstract class RemoteProvider implements LLMProvider {
  constructor(protected settings: () => Settings) {}
  abstract listModels(): Promise<Model[]>;
  abstract chat(request: ChatRequest): AsyncIterable<ChatChunk>;
  async complete(request: ChatRequest): Promise<ChatMessage> {
    let content = '';
    for await (const chunk of this.chat(request)) content += chunk.message?.content ?? '';
    return { role: 'assistant', content };
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
  protected async *events(path: string, body: unknown, signal?: AbortSignal) {
    const response = await this.request(path, body, signal);
    if (!response.body) throw new Error('Provider returned no response body');
    for await (const event of parseSSE(response.body)) {
      if (event.error || event.type === 'error')
        throw new Error('Provider stream failed. Check account access and retry.');
      yield event;
    }
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
  async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
    if (request.tools?.length)
      throw new Error('Native tool calls are not enabled for this adapter');
    for await (const event of this.events(
      '/chat/completions',
      {
        model: request.model,
        messages: request.messages.map(({ role, content }) => ({ role, content })),
        stream: true,
        temperature: this.settings().temperature,
      },
      request.signal,
    )) {
      const content = event.choices?.[0]?.delta?.content;
      if (content) yield { message: { content } };
    }
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
  async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
    if (request.tools?.length)
      throw new Error('Native tool calls are not enabled for this adapter');
    for await (const event of this.events(
      `/models/${encodeURIComponent(request.model.replace(/^models\//, ''))}:streamGenerateContent?alt=sse`,
      {
        systemInstruction: {
          parts: request.messages
            .filter((m) => m.role === 'system')
            .map((m) => ({ text: m.content })),
        },
        contents: request.messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
        generationConfig: { temperature: this.settings().temperature },
      },
      request.signal,
    )) {
      if (event.promptFeedback?.blockReason)
        throw new Error('Gemini blocked this prompt. Revise the request.');
      const content = event.candidates?.[0]?.content?.parts
        ?.filter((p: { thought?: boolean }) => !p.thought)
        .map((p: { text?: string }) => p.text ?? '')
        .join('');
      if (content) yield { message: { content } };
    }
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
  async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
    if (request.tools?.length)
      throw new Error('Native tool calls are not enabled for this adapter');
    for await (const event of this.events(
      '/v1/messages',
      {
        model: request.model,
        max_tokens: 4096,
        stream: true,
        system: request.messages
          .filter((m) => m.role === 'system')
          .map((m) => m.content)
          .join('\n\n'),
        messages: request.messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
          })),
      },
      request.signal,
    )) {
      if (event.delta?.text) yield { message: { content: event.delta.text } };
    }
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
