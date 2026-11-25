import { vi } from 'vitest';
import { ScriptedChatModel } from './scripted-model';
import { capabilityToolName } from '../../src/main/services/ai/capability-tools';
import type { ChatMessage, LLMProvider } from '../../src/main/services/ollama/provider';

/** Test-only injected provider; production uses official provider integrations. */
export function useProviderBridge(
  provider: Omit<LLMProvider, 'createChatModel'> & Partial<Pick<LLMProvider, 'createChatModel'>>,
): LLMProvider {
  provider.createChatModel = (model, options) =>
    new ScriptedChatModel({ provider, model, ...options });
  return provider as LLMProvider;
}
export function toolReply(id: string, args: Record<string, unknown> = {}): ChatMessage {
  return {
    role: 'assistant',
    content: '',
    tool_calls: [
      { id: crypto.randomUUID(), function: { name: capabilityToolName(id), arguments: args } },
    ],
  };
}

/**
 * Script non-streaming `complete` replies in order (the last one repeats). Capability
 * relevance checks also use `complete` now, so they are answered from the provider's
 * `chat` script instead of consuming a scripted reply.
 */
export function scriptComplete(
  llm: Pick<LLMProvider, 'chat' | 'complete'>,
  ...replies: ChatMessage[]
) {
  const queue = [...replies];
  return vi.spyOn(llm, 'complete').mockImplementation(async (request) => {
    if (request.messages[0]?.content.includes('CAPABILITY_RELEVANCE_CHECK')) {
      let content = '';
      for await (const chunk of llm.chat(request)) content += chunk.message?.content ?? '';
      return { role: 'assistant', content };
    }
    return queue.length > 1 ? queue.shift()! : queue[0];
  });
}
