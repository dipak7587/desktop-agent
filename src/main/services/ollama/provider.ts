import type { Model, Settings } from '../../../shared/types';
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
    const timeout = AbortSignal.timeout(path === '/api/tags' ? 10000 : 300000);
    let response: Response;
    try {
      response = await fetch(`${this.settings().ollamaUrl.replace(/\/$/, '')}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new Error(
        `Cannot reach Ollama at ${this.settings().ollamaUrl}. Check that Ollama is running and retry. ${(e as Error).message}`,
      );
    }
    if (!response.ok)
      throw new Error(`Ollama ${response.status}: ${(await response.text()).slice(0, 800)}`);
    return response;
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
      if (chunk.error) throw new Error(chunk.error);
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
