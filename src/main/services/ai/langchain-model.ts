import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { LLMProvider } from '../ollama/provider';

/** Resolve the official LangChain model from a captured provider configuration. */
export function createChatModel(fields: {
  provider: LLMProvider;
  model: string;
  disableStreaming?: boolean;
  format?: unknown;
}): BaseChatModel {
  return fields.provider.createChatModel(fields.model, {
    disableStreaming: fields.disableStreaming,
    format: fields.format,
  });
}
