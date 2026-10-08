import { randomUUID } from 'node:crypto';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, AIMessageChunk, type BaseMessage, ToolMessage } from '@langchain/core/messages';
import { ChatGenerationChunk } from '@langchain/core/outputs';
import { convertToOpenAITool } from '@langchain/core/utils/function_calling';
import type { ChatMessage, LLMProvider } from '../../src/main/services/ollama/provider';

type Fields = {
  provider: Pick<LLMProvider, 'chat' | 'complete'>;
  model: string;
  disableStreaming?: boolean;
  format?: unknown;
};
/** Scripted model for deterministic service tests, never shipped in the app. */
export class ScriptedChatModel extends BaseChatModel {
  lc_namespace = ['tests', 'scripted'];
  private definitions: ReturnType<typeof convertToOpenAITool>[] = [];
  constructor(private fields: Fields) {
    super({});
    this.disableStreaming = fields.disableStreaming ?? false;
  }
  _llmType() {
    return 'scripted';
  }
  override bindTools(tools: Parameters<NonNullable<BaseChatModel['bindTools']>>[0]) {
    const bound = new ScriptedChatModel(this.fields);
    bound.definitions = tools.map((t) => convertToOpenAITool(t));
    return bound;
  }
  private request(messages: BaseMessage[], signal?: AbortSignal) {
    return {
      model: this.fields.model,
      tools: this.definitions.length ? this.definitions : undefined,
      format: this.fields.format,
      signal,
      messages: messages.map((m): ChatMessage => ({
        role: m.type === 'ai' ? 'assistant' : m.type === 'human' ? 'user' : m.type,
        content: m.text,
        ...(m instanceof AIMessage
          ? {
              tool_calls: m.tool_calls?.map((t) => ({
                id: t.id,
                function: { name: t.name, arguments: t.args },
              })),
            }
          : {}),
        ...(m instanceof ToolMessage ? { tool_call_id: m.tool_call_id } : {}),
      })),
    };
  }
  async _generate(messages: BaseMessage[], options: this['ParsedCallOptions']) {
    const request = this.request(messages, options.signal);
    let response: ChatMessage = { role: 'assistant', content: '' };
    if (this.disableStreaming && this.fields.provider.complete)
      response = await this.fields.provider.complete(request);
    else
      for await (const chunk of this.fields.provider.chat(request)) {
        response.content += chunk.message?.content ?? '';
        if (chunk.message?.tool_calls)
          response.tool_calls = [...(response.tool_calls ?? []), ...chunk.message.tool_calls];
      }
    const message = new AIMessage({
      content: response.content,
      tool_calls: response.tool_calls?.map((t) => ({
        name: t.function.name,
        args: t.function.arguments,
        id: t.id ?? randomUUID(),
        type: 'tool_call',
      })),
    });
    return { generations: [{ text: message.text, message }] };
  }
  async *_streamResponseChunks(messages: BaseMessage[], options: this['ParsedCallOptions']) {
    for await (const chunk of this.fields.provider.chat(this.request(messages, options.signal))) {
      const content = chunk.message?.content ?? '';
      yield new ChatGenerationChunk({ text: content, message: new AIMessageChunk({ content }) });
    }
  }
}
