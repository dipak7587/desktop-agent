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
