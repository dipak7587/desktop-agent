import {
  createAgent,
  createMiddleware,
  modelCallLimitMiddleware,
  ToolMessage,
  trimMessages,
  countTokensApproximately,
} from 'langchain';
import { isAIMessage, SystemMessage } from '@langchain/core/messages';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import type { AppEvent, LibraryItem, RunState, Settings } from '../../../shared/types';
import type { LLMProvider } from '../ollama/provider';
import type { CapabilityRouter } from '../agents/capabilities';
import { createChatModel } from './langchain-model';
import { createCapabilityTools } from './capability-tools';
import type { DeepAgentEngine } from './deep-agents';

export interface AgentLoopInput {
  run: RunState;
  agent: LibraryItem;
  task: string;
  project: string;
  model: string;
  maxIterations: number;
  router: CapabilityRouter;
  signal: AbortSignal;
  systemPrompt: string;
  resolveToolName?: (toolId: string) => string;
  persist?: (run: RunState) => void;
  deep?: DeepAgentEngine;
}

/** Application lifecycle adapter. LangChain owns the model/tool loop and message state. */
export class AgentLoopGraph {
  onFinal?: () => void;

  constructor(
    private llm: LLMProvider,
    private settings: () => Settings,
    private emit: (event: AppEvent) => void,
    private redact: (text: string) => string,
    private checkpointer?: BaseCheckpointSaver,
  ) {}

  async run(
    input: AgentLoopInput,
  ): Promise<{ result: string; reason: 'completed' | 'max-iterations' }> {
    const { run, signal, router } = input;
    const tools = createCapabilityTools({
      run,
      signal,
      router,
      redact: this.redact,
      emit: this.emit,
      persist: input.persist,
      resolveToolName: input.resolveToolName,
    });
    const allowed = new Set(tools.map((t) => t.name));
    // Deep harness planning is internal state, not workspace access. Its default
    // filesystem and delegation tools are not authorized application capabilities.
    if (input.deep) allowed.add('write_todos');
    const lifecycle = createMiddleware({
      name: 'WorkspaceLifecycle',
      wrapModelCall: async (request, handler) => {
        signal.throwIfAborted();
        run.iterationsUsed += 1;
        input.persist?.(run);
        this.emit({
          type: 'agent',
          id: run.id,
          status: 'Planning',
          content: `Thinking… Planning the next steps… (iteration ${run.iterationsUsed} / ${input.maxIterations})`,
        });
        // Keep the task and system policy while trimming complete assistant/tool
        // exchanges with LangChain's message-aware utility.
        const first = request.messages[0];
        const budget =
          this.settings().contextSize -
          countTokensApproximately([
            new SystemMessage(input.systemPrompt),
            ...(first ? [first] : []),
          ]);
        if (budget <= 0)
          throw new Error(
            'Agent instructions and task exceed the configured context size. Shorten them or increase the context size.',
          );
        const recent = await trimMessages(request.messages.slice(1), {
          maxTokens: budget,
          tokenCounter: countTokensApproximately,
          strategy: 'last',
          startOn: 'ai',
          allowPartial: false,
        });
        if (request.messages.length > 1 && !recent.length)
          throw new Error(
            'The latest tool exchange exceeds the configured context size. Increase the context size or request a smaller result.',
          );
        const messages = [...(first ? [first] : []), ...recent];
        return handler({
          ...request,
          messages,
          tools: request.tools.filter((t) => 'name' in t && allowed.has(t.name as string)),
        });
      },
      wrapToolCall: async (request, handler) => {
        signal.throwIfAborted();
        if (!allowed.has(request.toolCall.name))
          return new ToolMessage({
            content: 'This capability is not permitted. Use an available tool or answer directly.',
            tool_call_id: request.toolCall.id ?? '',
            status: 'error',
          });
        return handler(request);
      },
    });
    const options = {
      model: createChatModel({ provider: this.llm, model: input.model, disableStreaming: true }),
      tools,
      systemPrompt: input.systemPrompt,
      middleware: [
        modelCallLimitMiddleware({ runLimit: input.maxIterations, exitBehavior: 'error' }),
        lifecycle,
      ],
      checkpointer: this.checkpointer,
    };
    const agent = input.deep ? input.deep.create(options) : createAgent(options);
    try {
      const result = await agent.invoke(
        { messages: [{ role: 'user', content: input.task }] },
        {
          signal,
          configurable: { thread_id: run.id },
          // LangGraph steps include middleware and tools; the model-call middleware
          // above is the user-visible iteration budget.
          recursionLimit: input.maxIterations * 10 + 30,
        },
      );
      signal.throwIfAborted();
      const last = result.messages.at(-1);
      if (!last || !isAIMessage(last) || last.tool_calls?.length)
        throw new Error('Agent ended without a final answer');
      if (last.invalid_tool_calls?.length)
        throw new Error(
          'The model returned invalid native tool-call arguments. Retry with a tool-capable model.',
        );
      this.onFinal?.();
      return { result: last.text, reason: 'completed' };
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof Error && error.name === 'ModelCallLimitMiddlewareError')
        return { result: '', reason: 'max-iterations' };
      throw error;
    }
  }
}
