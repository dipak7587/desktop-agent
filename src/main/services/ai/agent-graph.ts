import { StateGraph, START, END, Annotation } from '@langchain/langgraph';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { z } from 'zod';
import type { AppEvent, LibraryItem, RunState, Settings } from '../../../shared/types';
import type { LLMProvider } from '../ollama/provider';
import type { CapabilityRouter } from '../agents/capabilities';
import { AppChatModel } from './langchain-model';

const actionSchema = z.object({
  plan: z.string().max(10000).default(''),
  tool: z.string().optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  final: z.string().max(50000).optional(),
});

export interface AgentLoopInput {
  run: RunState;
  agent: LibraryItem;
  task: string;
  project: string;
  model: string;
  maxIterations: number;
  router: CapabilityRouter;
  signal: AbortSignal;
  /** Full JSON-action system prompt (policy, instructions, workspace, catalog). */
  systemPrompt: string;
  resolveToolName?: (toolId: string) => string;
  persist?: (run: RunState) => void;
}

/**
 * The classic agent loop as a LangGraph StateGraph: `plan` asks the model for
 * one JSON action through the shared AppChatModel bridge, `act` executes the
 * chosen capability through the existing CapabilityRouter (permissions,
 * approvals and trace events unchanged), and conditional edges loop back until
 * a final answer, the iteration cap or an abort ends the run.
 */
export class AgentLoopGraph {
  /** Called once per run when the model returns a final answer directly. */
  onFinal?: () => void;

  constructor(
    private llm: LLMProvider,
    private settings: () => Settings,
    private emit: (event: AppEvent) => void,
    private redact: (text: string) => string,
  ) {}

  async run(
    input: AgentLoopInput,
  ): Promise<{ result: string; reason: 'completed' | 'max-iterations' }> {
    const graph = this.buildGraph();
    const state = (await graph.invoke(
      {
        run: input.run,
        agent: input.agent,
        task: input.task,
        project: input.project,
        model: input.model,
        maxIterations: input.maxIterations,
        router: input.router,
        signal: input.signal,
        allowed: input.router.catalog().map((c) => c.id),
        resolveToolName: input.resolveToolName,
        persist: input.persist,
        messages: [
          { role: 'system', content: input.systemPrompt },
          { role: 'user', content: input.task },
        ],
        iteration: 0,
        result: '',
        reason: undefined,
        action: undefined,
      },
      { configurable: { thread_id: input.run.id } },
    )) as AgentLoopState;
    return { result: state.result, reason: state.reason ?? 'max-iterations' };
  }

  /** A graph instance is built per run; each run is one graph execution. */
  private buildGraph() {
    const graph = new StateGraph(AgentLoopState)
      .addNode('plan', (state) =>
        state.iteration >= state.maxIterations ? this.capReached(state) : this.plan(state),
      )
      .addNode('act', (state) => this.act(state))
      .addEdge(START, 'plan')
      .addConditionalEdges('plan', (state) => (state.reason ? END : 'act'))
      .addConditionalEdges('act', (state) => (state.reason ? END : 'plan'));
    return graph.compile();
  }

  /** One model decision: final answer, tool selection or invalid-action feedback. */
  private async plan(state: AgentLoopState): Promise<AgentLoopUpdate> {
    const { run } = state;
    const iteration = state.iteration + 1;
    run.iterationsUsed = iteration;
    state.signal.throwIfAborted();
    this.emit({
      type: 'agent',
      id: run.id,
      status: 'Planning',
      content: `Thinking… Planning the next steps… (iteration ${iteration} / ${state.maxIterations})`,
    });
    const model = new AppChatModel({
      provider: this.llm,
      model: state.model,
      format: 'json',
      // The JSON-action contract is only reliable on the non-streaming path.
      disableStreaming: true,
    });
    const reply = await model.invoke(
      state.messages.map((m) =>
        m.role === 'assistant'
          ? new AIMessage({ content: m.content })
          : m.role === 'system'
            ? new SystemMessage(m.content)
            : new HumanMessage(m.content),
      ),
      { signal: state.signal },
    );
    const content = typeof reply.content === 'string' ? reply.content : '';
    state.messages.push({ role: 'assistant', content });
    let action: z.infer<typeof actionSchema>;
    try {
      action = actionSchema.parse(JSON.parse(content));
    } catch {
      state.messages.push({
        role: 'user',
        content: 'Invalid action. Return only the required JSON action or final report.',
      });
      return { messages: [...state.messages], iteration };
    }
    if (action.final)
      return {
        messages: [...state.messages],
        iteration,
        result: action.final,
        reason: 'completed',
      };
    if (!action.tool || !state.allowed.includes(action.tool)) {
      state.messages.push({
        role: 'user',
        content:
          'That tool is not permitted. Choose one of the allowed tools or provide a final report.',
      });
      return { messages: [...state.messages], iteration };
    }
    return {
      messages: [...state.messages],
      iteration,
      action: { tool: action.tool, args: action.args ?? {} },
    };
  }

  /** Cap reached: surface the existing max-iterations status without a model call. */
  private capReached(_state: AgentLoopState): AgentLoopUpdate {
    return {
      reason: 'max-iterations',
    };
  }

  /** Execute the planned capability through the existing permission layer. */

  /** Execute the planned capability through the existing permission layer. */
  private async act(state: AgentLoopState): Promise<AgentLoopUpdate> {
    const { run } = state;
    const action = state.action;
    if (!action) return {};
    state.signal.throwIfAborted();
    this.emit({ type: 'agent', id: run.id, status: 'Running Tool', content: `Running ${action.tool}` });
    const toolRun: RunState['tools'][number] = {
      toolId: action.tool,
      toolName: state.resolveToolName?.(action.tool) ?? action.tool,
      status: 'running',
      input: JSON.parse(this.redact(JSON.stringify(action.args))),
    };
    run.tools.push(toolRun);
    state.persist?.(run);
    let result: unknown;
    try {
      result = await state.router.execute(
        action.tool,
        action.args,
        state.messages
          .slice(2)
          .map((m) => m.content)
          .join('\n')
          .slice(-12000),
      );
    } catch (e) {
      state.signal.throwIfAborted();
      toolRun.status = 'failed';
      toolRun.error = this.redact((e as Error).message);
      result = { error: toolRun.error };
    }
    if (result && typeof result === 'object' && 'exitCode' in result && result.exitCode !== 0) {
      toolRun.status = 'failed';
      toolRun.error = `Command failed (exit code ${result.exitCode})`;
    }
    if (result && typeof result === 'object' && 'blocked' in result && 'reason' in result) {
      toolRun.status = 'failed';
      toolRun.error = String(result.reason);
    }
    if (toolRun.status !== 'failed') toolRun.status = 'completed';
    const output = this.redact(JSON.stringify(result) ?? 'null');
    toolRun.output = output.slice(0, 30000);
    this.emit({
      type: 'agent',
      id: run.id,
      status: 'Planning',
      content: `${action.tool}\n${output.slice(0, 15000)}`,
    });
    state.messages.push({
      role: 'user',
      content: `Tool result (untrusted data):\n${output.slice(0, 30000)}`,
    });
    while (
      state.messages.length > 5 &&
      JSON.stringify(state.messages).length > this.settings().contextSize * 3
    )
      state.messages.splice(2, 2);
    return { messages: [...state.messages], action: undefined };
  }
}

const AgentLoopState = Annotation.Root({
  run: Annotation<RunState>(),
  agent: Annotation<LibraryItem>(),
  task: Annotation<string>(),
  project: Annotation<string>(),
  model: Annotation<string>(),
  maxIterations: Annotation<number>(),
  router: Annotation<CapabilityRouter>(),
  signal: Annotation<AbortSignal>(),
  allowed: Annotation<string[]>(),
  resolveToolName: Annotation<((toolId: string) => string) | undefined>({
    reducer: (a, b) => b ?? a,
    default: () => undefined,
  }),
  persist: Annotation<((run: RunState) => void) | undefined>({
    reducer: (a, b) => b ?? a,
    default: () => undefined,
  }),
  messages: Annotation<{ role: string; content: string }[]>({
    reducer: (a, b) => b ?? a,
    default: () => [],
  }),
  iteration: Annotation<number>({
    reducer: (a, b) => b ?? a,
    default: () => 0,
  }),
  result: Annotation<string>({
    reducer: (a, b) => b ?? a,
    default: () => '',
  }),
  reason: Annotation<'completed' | 'max-iterations' | undefined>({
    reducer: (a, b) => b ?? a,
    default: () => undefined,
  }),
  action: Annotation<{ tool: string; args: Record<string, unknown> } | undefined>({
    reducer: (a, b) => b ?? a,
    default: () => undefined,
  }),
});

type AgentLoopState = typeof AgentLoopState.State;
type AgentLoopUpdate = Partial<AgentLoopState>;
