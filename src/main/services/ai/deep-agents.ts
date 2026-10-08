import { createDeepAgent } from 'deepagents';
import { todoListMiddleware, type AnyAgentMiddleware } from 'langchain';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';

/** Deep harness shares the standard runtime's model, tools, limits and lifecycle. */
export class DeepAgentEngine {
  create(options: {
    model: BaseChatModel;
    tools: StructuredToolInterface[];
    systemPrompt: string;
    middleware: AnyAgentMiddleware[];
    checkpointer?: BaseCheckpointSaver;
  }) {
    return createDeepAgent({
      ...options,
      middleware: [todoListMiddleware(), ...options.middleware],
      // State-backed scratch storage only. Workspace operations must use the
      // application's capability tools. Lifecycle middleware enforces that list.
      permissions: [{ operations: ['read', 'write'], paths: ['/**'], mode: 'deny' }],
    });
  }
}
