import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  isBaseMessage,
} from '@langchain/core/messages';
import { ChatGenerationChunk, type ChatResult } from '@langchain/core/outputs';
import { z } from 'zod';
import type { LLMProvider, ChatMessage, ToolCall } from '../ollama/provider';

const toolCallSchema = z.object({
  name: z.string().min(1),
  // The application's provider ToolCall shape uses `arguments`.
  arguments: z.record(z.string(), z.unknown()).optional(),
});

export interface AppChatModelFields {
  provider: LLMProvider;
  model: string;
  /** Route LangChain `.stream()` calls through the provider's non-streaming `complete()` when available. */
  disableStreaming?: boolean;
  /** Provider-specific output format hint (for example 'json'), passed through unchanged. */
  format?: unknown;
}

/**
 * LangChain chat model implementation over the application's existing
 * LLMProvider abstraction. LangChain, LangGraph and Deep Agents all call this
 * model, and it resolves back into the existing provider adapters, so chat,
 * agents and workflows keep using the same configured providers, models and
 * credentials in the main process. This is the single model entry point for
 * every AI feature in the application.
 */
export class AppChatModel extends BaseChatModel {
  lc_namespace = ['localai', 'chat'];
  private provider: LLMProvider;
  private model: string;
  private format?: unknown;
  private toolDefinitions?: {
    type: string;
    function: { name: string; description: string; parameters: unknown };
  }[];
  override disableStreaming: boolean;

  constructor(fields: AppChatModelFields) {
    super({});
    this.provider = fields.provider;
    this.model = fields.model;
    this.disableStreaming = fields.disableStreaming ?? false;
    this.format = fields.format;
  }

  _llmType() {
    return 'localai-provider';
  }

  private toProviderMessages(messages: BaseMessage[]): ChatMessage[] {
    return toProviderMessages(messages);
  }

  private textContent(message: BaseMessage): string {
    return textContent(message);
  }

  override bindTools(tools: unknown[], _kwargs?: Partial<this['ParsedCallOptions']>) {
    const definitions = tools.map((definition) => {
      const parsed = z
        .object({ name: z.string(), description: z.string().optional(), schema: z.unknown() })
        .passthrough()
        .parse(definition);
      return {
        type: 'function',
        function: {
          name: parsed.name,
          description: parsed.description ?? '',
          parameters: parsed.schema ?? { type: 'object', properties: {} },
        },
      };
    });
    const bound = new AppChatModel({
      provider: this.provider,
      model: this.model,
      disableStreaming: this.disableStreaming,
      format: this.format,
    });
    bound.toolDefinitions = definitions;
    return bound;
  }

  private async generateFromMessages(
    messages: BaseMessage[],
    tools?: unknown[],
    signal?: AbortSignal,
  ): Promise<ChatResult> {
    const request = {
      model: this.model,
      messages: toProviderMessages(messages),
      tools: tools ?? this.toolDefinitions,
      format: this.format,
      signal,
    };
    let content = '';
    let toolCalls: ToolCall[] = [];
    for await (const chunk of this.provider.chat(request)) {
      content += chunk.message?.content ?? '';
      if (chunk.message?.tool_calls?.length) toolCalls = chunk.message.tool_calls;
    }
    const message = new AIMessage({
      content,
      tool_calls: toolCalls.map((call) => {
        const parsed = toolCallSchema.parse(call.function);
        return {
          name: parsed.name,
          args: parsed.arguments ?? {},
          type: 'tool_call' as const,
          id: call.function.name,
        };
      }),
    });
    return { generations: [{ text: content, message }], llmOutput: { model: this.model } };
  }

  override async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
  ): Promise<ChatResult> {
    // The JSON-action contract and providers whose native tool calls only
    // survive the non-streaming path answer through complete() when it exists.
    if (this.disableStreaming && this.provider.complete) {
      const result = await this.provider.complete({
        model: this.model,
        messages: toProviderMessages(messages),
        tools: this.toolDefinitions,
        format: this.format,
        signal: options.signal,
      });
      const message = new AIMessage({
        content: result.content ?? '',
        tool_calls: (result.tool_calls ?? []).map((call) => {
          const parsed = toolCallSchema.parse(call.function);
          return {
            name: parsed.name,
            args: parsed.arguments ?? {},
            type: 'tool_call' as const,
            id: call.function.name,
          };
        }),
      });
      return {
        generations: [{ text: String(message.content), message }],
        llmOutput: { model: this.model },
      };
    }
    return this.generateFromMessages(messages, undefined, options.signal);
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
  ): AsyncGenerator<ChatGenerationChunk> {
    if (this.disableStreaming && this.provider.complete) {
      // Providers whose native tool calls only survive the non-streaming path
      // answer through complete(); the aggregated result is re-chunked for
      // streaming consumers.
      const result = await this.provider.complete({
        model: this.model,
        messages: toProviderMessages(messages),
        tools: this.toolDefinitions,
        format: this.format,
        signal: options.signal,
      });
      const content = result.content ?? '';
      if (content)
        yield new ChatGenerationChunk({ text: content, message: new AIMessageChunk({ content }) });
      for (const call of result.tool_calls ?? []) {
        const parsed = toolCallSchema.parse(call.function);
        yield new ChatGenerationChunk({
          text: '',
          message: new AIMessageChunk({
            content: '',
            tool_call_chunks: [
              {
                name: parsed.name,
                args: JSON.stringify(parsed.arguments ?? {}),
                id: parsed.name,
                type: 'tool_call_chunk' as const,
                index: 0,
              },
            ],
          }),
        });
      }
      return;
    }
    const request = {
      model: this.model,
      messages: toProviderMessages(messages),
      tools: this.toolDefinitions,
      format: this.format,
      signal: options.signal,
    };
    for await (const chunk of this.provider.chat(request)) {
      const content = chunk.message?.content ?? '';
      if (content)
        yield new ChatGenerationChunk({ text: content, message: new AIMessageChunk({ content }) });
      if (chunk.message?.tool_calls?.length) {
        // Streaming tool calls must use tool_call_chunks with stringified
        // arguments; plain tool_calls are lost when chunks concatenate.
        for (const call of chunk.message.tool_calls) {
          const parsed = toolCallSchema.parse(call.function);
          yield new ChatGenerationChunk({
            text: '',
            message: new AIMessageChunk({
              content: '',
              tool_call_chunks: [
                {
                  name: parsed.name,
                  args: JSON.stringify(parsed.arguments ?? {}),
                  id: parsed.name,
                  type: 'tool_call_chunk' as const,
                  index: 0,
                },
              ],
            }),
          });
        }
      }
    }
  }

  static isBaseMessage(message: unknown): boolean {
    return isBaseMessage(message);
  }

  static human(text: string) {
    return new HumanMessage(text);
  }

  static system(text: string) {
    return new SystemMessage(text);
  }

  static fromProvider(provider: LLMProvider, model: string) {
    return new AppChatModel({ provider, model });
  }
}

function textContent(message: BaseMessage): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content))
    return content
      .map((part) => (typeof part === 'string' ? part : ('text' in part ? part.text : '')))
      .join('');
  return String(content ?? '');
}

/**
 * Convert LangChain messages back into the application's provider ChatMessage
 * shape. Exported for LangGraph node implementations that own their provider
 * calls directly (the chat and agent graphs).
 */
export function toProviderMessages(messages: BaseMessage[]): ChatMessage[] {
  return messages.map((message) => {
    const role =
      message instanceof SystemMessage
        ? 'system'
        : message instanceof AIMessage
          ? 'assistant'
          : message instanceof ToolMessage
            ? 'tool'
            : 'user';
    const toolCalls = (message as AIMessage).tool_calls?.map((call) => ({
      function: { name: call.name, arguments: (call.args ?? {}) as Record<string, unknown> },
    }));
    const base: ChatMessage = { role, content: textContent(message) };
    if (message instanceof ToolMessage && message.tool_call_id)
      base.tool_name = message.tool_call_id;
    if (toolCalls?.length) base.tool_calls = toolCalls;
    return base;
  });
}
