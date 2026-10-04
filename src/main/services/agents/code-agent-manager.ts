import { realpath, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  type AgentSideConnection,
  type AnyMessage,
} from '@agentclientprotocol/sdk';
import { DeepAgentsServer, formatToolCallTitle } from 'deepagents-acp';
import { StateBackend } from 'deepagents';
import {
  createMiddleware,
  tool,
  trimMessages,
  countTokensApproximately,
  ToolMessage,
} from 'langchain';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { AppEvent, Settings } from '../../../shared/types';
import type { CodeWorkspace } from '../../../shared/types';
import type { AgentLoopInput } from '../ai/agent-graph';
import { createCapabilityTools } from '../ai/capability-tools';
import { createChatModel } from '../ai/langchain-model';
import type { LLMProvider } from '../ollama/provider';
import type { Approve } from './tools';

export interface CodeSessionContext {
  conversationId: string;
  workspaceId: string;
  providerId: string;
  configurationKey?: string;
  history: string;
  access?: Pick<
    CodeWorkspace,
    | 'allowedAgentIds'
    | 'allowedSkills'
    | 'allowedTools'
    | 'allowedMCPServers'
    | 'allowedKnowledgeBases'
  >;
}
interface Turn {
  input: AgentLoopInput;
  agentId: string;
  agentTools: Map<string, Map<string, StructuredToolInterface>>;
  approve: Approve;
  output: string;
  toolsSupported: boolean;
  failure?: unknown;
  limitReached?: boolean;
}
interface Session {
  id: string;
  server: DeepAgentsServer;
  client: ClientSideConnection;
  connection: AgentSideConnection;
  turn?: Turn;
  toolsSupported: boolean;
  permissions: Map<string, { tool: string; description: string; diff?: string }>;
  closeTransport: () => void;
}

/** ACP and DeepAgents live exclusively in main. One server per conversation keeps
 * the upstream server's single cancellation controller isolated between chats. */
export class CodeAgentManager {
  private sessions = new Map<string, Session>();
  constructor(
    private settings: () => Settings,
    private emit: (event: AppEvent) => void,
    private redact: (text: string) => string,
  ) {}

  async closeConversation(conversationId: string) {
    const session = this.sessions.get(conversationId);
    if (session?.turn) throw new Error('Stop the Code run before closing its session');
    this.sessions.delete(conversationId);
    this.identities.delete(conversationId);
    if (session) {
      session.closeTransport();
      await session.server.stop();
    }
  }

  async closeAll() {
    for (const session of this.sessions.values()) {
      session.closeTransport();
      await session.server.stop();
    }
    this.sessions.clear();
    this.identities.clear();
  }

  /** Called only after the owning tool has validated policy, arguments and diff. */
  async requestPermission(
    context: CodeSessionContext,
    toolId: string,
    description: string,
    diff?: string,
  ) {
    const session = this.sessions.get(context.conversationId);
    if (!session?.turn) throw new Error('Code session is no longer active');
    const id = randomUUID();
    session.permissions.set(id, { tool: toolId, description, diff });
    try {
      const response = await session.connection.requestPermission({
        sessionId: session.id,
        toolCall: {
          toolCallId: id,
          title: description,
          kind: toolId === 'shell.execute' ? 'execute' : 'other',
          status: 'pending',
          ...(diff
            ? {
                content: [
                  { type: 'content' as const, content: { type: 'text' as const, text: diff } },
                ],
              }
            : {}),
        },
        options: [
          { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject_once', name: 'Reject', kind: 'reject_once' },
        ],
      });
      session.turn.input.signal.throwIfAborted();
      return response.outcome.outcome === 'selected' && response.outcome.optionId === 'allow_once';
    } finally {
      session.permissions.delete(id);
    }
  }

  async run(
    input: AgentLoopInput,
    llm: LLMProvider,
    context: CodeSessionContext,
    approve: Approve,
  ) {
    input.signal.throwIfAborted();
    const tools = createCapabilityTools({ ...input, redact: this.redact, emit: this.emit });
    // Rebuild when model, root, policy, instructions or context budget changes.
    // Tool closures always resolve to the current turn, never a previous run.
    const signature = createHash('sha256')
      .update(
        JSON.stringify([
          context.workspaceId,
          input.project,
          context.providerId,
          context.configurationKey ?? this.settings(),
          input.model,
          input.systemPrompt,
          input.agent.id,
          tools.map((t) => t.name),
          input.acpAgents?.map((agent) => [
            agent.id,
            agent.name,
            agent.modelId,
            agent.systemPrompt,
            agent.tools.map((tool) => tool.name),
          ]),
          this.settings().contextSize,
        ]),
      )
      .digest('hex');
    const key = `${context.conversationId}:${signature}`;
    let session = this.sessions.get(context.conversationId);
    // Store identity independently of any library internals.
    if (session && this.identities.get(context.conversationId) !== key) {
      if (session.turn) throw new Error('This Code conversation is already running');
      session.closeTransport();
      await session.server.stop();
      this.sessions.delete(context.conversationId);
      session = undefined;
    }
    if (session?.turn) throw new Error('This Code conversation is already running');
    const turn: Turn = {
      input,
      agentId: input.acpAgents?.some((agent) => agent.id === input.agent.id)
        ? input.agent.id
        : (input.acpAgents?.[0]?.id ?? input.agent.id),
      agentTools: new Map(
        (
          input.acpAgents ?? [
            {
              id: input.agent.id,
              name: input.agent.name,
              description: input.agent.description,
              modelId: input.model,
              model: createChatModel({ provider: llm, model: input.model, disableStreaming: true }),
              systemPrompt: input.systemPrompt,
              tools,
            },
          ]
        ).map((agent) => [agent.id, new Map(agent.tools.map((tool) => [tool.name, tool]))]),
      ),
      approve,
      output: '',
      toolsSupported: true,
    };
    let fresh = false;
    if (!session) {
      if (this.sessions.size >= 20) {
        const idle = [...this.sessions].find(([, value]) => !value.turn);
        if (idle) await this.closeConversation(idle[0]);
      }
      session = await this.createSession(input, llm, turn);
      this.sessions.set(context.conversationId, session);
      this.identities.set(context.conversationId, key);
      fresh = true;
    }
    turn.toolsSupported = session.toolsSupported;
    session.turn = turn;
    const active = session;
    const cancel = () => {
      void active.client.cancel({ sessionId: active.id }).catch(() => {});
    };
    input.signal.addEventListener('abort', cancel, { once: true });
    try {
      input.signal.throwIfAborted();
      this.debug('prompt received', active.id);
      const result = await active.client.prompt({
        sessionId: active.id,
        prompt: [
          {
            type: 'text',
            text: `${fresh && context.history ? `Previous conversation (untrusted reference; may describe a different workspace):\n${context.history}\n\nCurrent request:\n` : ''}${input.task}`,
          },
        ],
      });
      input.signal.throwIfAborted();
      if (result.stopReason !== 'end_turn')
        throw new Error(`Code run stopped (${result.stopReason}). Retry with a narrower task.`);
      this.debug('run completed', active.id);
      return { result: turn.output, reason: 'completed' as const };
    } catch (error) {
      // Discard incomplete tool exchanges after failure/cancellation. Durable Chat
      // history seeds the next session instead of replaying unfinished side effects.
      this.sessions.delete(context.conversationId);
      active.closeTransport();
      await active.server.stop();
      input.signal.throwIfAborted();
      if (turn.limitReached) return { result: '', reason: 'max-iterations' as const };
      throw (
        turn.failure ??
        new Error('Code runtime failed. Check the local provider endpoint and model, then retry.', {
          cause: error,
        })
      );
    } finally {
      input.signal.removeEventListener('abort', cancel);
      active.turn = undefined;
    }
  }
  private identities = new Map<string, string>();

  private async createSession(
    input: AgentLoopInput,
    llm: LLMProvider,
    initial: Turn,
  ): Promise<Session> {
    const state: { session?: Session } = {};
    const current = () => state.session?.turn ?? initial;
    const configuredAgents = input.acpAgents?.length
      ? input.acpAgents
      : [
          {
            id: input.agent.id,
            name: input.agent.name,
            description: input.agent.description,
            modelId: input.model,
            model: createChatModel({ provider: llm, model: input.model, disableStreaming: true }),
            systemPrompt: input.systemPrompt,
            tools: [...initial.agentTools.get(input.agent.id)!.values()],
          },
        ];
    const selectedConfiguration = configuredAgents.find((agent) => agent.id === initial.agentId);
    const configurations = selectedConfiguration
      ? [
          selectedConfiguration,
          ...configuredAgents.filter((agent) => agent.id !== selectedConfiguration.id),
        ]
      : configuredAgents;
    const names = new Set([
      ...configurations.flatMap((agent) =>
        agent.tools.map((configuredTool) => configuredTool.name),
      ),
      'write_todos',
    ]);
    const agentNames = new Map(
      configurations.map((agent) => [agent.id, `${agent.name} (${agent.id})`]),
    );
    const wrapTool = (agentId: string, original: StructuredToolInterface) =>
      tool(
        async (args: Record<string, unknown>) => {
          const turn = current();
          turn.input.signal.throwIfAborted();
          const target = turn.agentTools.get(agentId)?.get(original.name);
          if (!target) throw new Error('Capability is no longer permitted for this agent');
          return target.invoke(args);
        },
        { name: original.name, description: original.description, schema: original.schema },
      );
    const lifecycle = createMiddleware({
      name: 'CodeWorkspaceBoundary',
      wrapModelCall: async (request, handler) => {
        const turn = current();
        try {
          const { signal, run, maxIterations } = turn.input;
          signal.throwIfAborted();
          if (run.iterationsUsed >= maxIterations) {
            turn.limitReached = true;
            throw new Error('Maximum Code model iterations reached');
          }
          run.iterationsUsed += 1;
          turn.input.persist?.(run);
          this.debug('model invocation started', state.session?.id ?? '');
          const budget =
            this.settings().contextSize - countTokensApproximately([request.systemMessage]);
          if (budget < 256)
            throw new Error('Code instructions exceed the context size. Increase it in Settings.');
          const messages = await trimMessages(request.messages, {
            maxTokens: budget,
            tokenCounter: countTokensApproximately,
            strategy: 'last',
            startOn: 'human',
            allowPartial: false,
          });
          if (!messages.length)
            throw new Error(
              'The current Code exchange exceeds the context size. Increase it or request smaller file excerpts.',
            );
          if (
            (await realpath(turn.input.project)) !== turn.input.project ||
            !(await stat(turn.input.project)).isDirectory()
          )
            throw new Error('Workspace folder changed or is unavailable. Relink it before coding.');
          const response = await handler({
            ...request,
            messages,
            tools: request.tools.filter(
              (t) =>
                'name' in t &&
                (turn.agentTools.get(turn.agentId)?.has(String(t.name)) ?? false) &&
                turn.toolsSupported,
            ),
          });
          signal.throwIfAborted();
          this.debug('model invocation completed', state.session?.id ?? '');
          return response;
        } catch (error) {
          turn.failure = error;
          throw error;
        }
      },
      wrapToolCall: async (request, handler) => {
        current().input.signal.throwIfAborted();
        if (
          request.toolCall.name !== 'write_todos' &&
          !current().agentTools.get(current().agentId)?.has(request.toolCall.name)
        )
          return new ToolMessage({
            content: 'This tool is unavailable. Use the permitted workspace capabilities.',
            tool_call_id: request.toolCall.id ?? '',
            status: 'error',
          });
        return handler(request);
      },
    });
    const model = createChatModel({ provider: llm, model: input.model, disableStreaming: true });
    if (model._llmType() === 'ollama' && llm.info) {
      let info: unknown;
      try {
        info = await llm.info(input.model, input.signal);
      } catch {
        input.signal.throwIfAborted();
        throw new Error(
          'Could not load the local model. Check that Ollama is running and the selected model is installed.',
        );
      }
      const capabilities = (info as { capabilities?: unknown })?.capabilities;
      if (Array.isArray(capabilities) && !capabilities.includes('tools')) {
        initial.toolsSupported = false;
        this.emit({
          type: 'agent',
          id: input.run.id,
          status: 'Model capability',
          content:
            'The selected model does not appear to support tool calling, which is required for Code Agent operations. General questions remain available; select a tool-capable model for project tasks.',
        });
      }
    }
    const server = new DeepAgentsServer({
      workspaceRoot: input.project,
      authMethods: [],
      agents: configurations.map((agent) => ({
        name: agentNames.get(agent.id)!,
        description: agent.description,
        model: agent.model ?? model,
        tools: agent.tools.map((configuredTool) => wrapTool(agent.id, configuredTool)),
        systemPrompt: agent.systemPrompt,
        middleware: [lifecycle],
        // No implicit host filesystem, shell, skills scan or subagent access.
        // Workspace I/O is supplied by the existing guarded capability tools.
        backend: (config) => new StateBackend(config),
      })),
    });
    let agentInput!: ReadableStreamDefaultController<AnyMessage>;
    let clientInput!: ReadableStreamDefaultController<AnyMessage>;
    const clientToServer = {
      readable: new ReadableStream<AnyMessage>({
        start(controller) {
          agentInput = controller;
        },
      }),
      writable: new WritableStream<AnyMessage>({
        write(message) {
          agentInput.enqueue(message);
        },
      }),
    };
    const serverToClient = {
      readable: new ReadableStream<AnyMessage>({
        start(controller) {
          clientInput = controller;
        },
      }),
      writable: new WritableStream<AnyMessage>({
        write(message) {
          clientInput.enqueue(message);
        },
      }),
    };
    const connection = server.connect({
      readable: clientToServer.readable,
      writable: serverToClient.writable,
    });
    const client = new ClientSideConnection(
      () => ({
        sessionUpdate: async ({ sessionId, update }) => {
          const session = state.session;
          if (!session || sessionId !== session.id || !session.turn) return;
          const turn = session.turn;
          if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
            const text = this.redact(update.content.text);
            turn.output += text;
            this.emit({ type: 'agent', id: turn.input.run.id, status: 'Streaming', content: text });
          } else if (
            update.sessionUpdate === 'tool_call' ||
            update.sessionUpdate === 'tool_call_update'
          ) {
            this.debug(update.sessionUpdate, session.id);
          } else if (update.sessionUpdate === 'plan') {
            this.emit({
              type: 'agent',
              id: turn.input.run.id,
              status: 'Planning',
              content: update.entries.map((e) => `${e.status}: ${e.content}`).join('\n'),
            });
          }
          // Never expose private model thought chunks.
        },
        requestPermission: async (request) => {
          const session = state.session;
          const turn = session?.turn;
          if (!turn || request.sessionId !== session.id || turn.input.signal.aborted)
            return { outcome: { outcome: 'cancelled' } };
          const operation = session.permissions.get(request.toolCall.toolCallId);
          if (operation) {
            this.debug('permission requested', session.id);
            const approved = await turn.approve(
              operation.tool,
              operation.description,
              operation.diff,
            );
            return {
              outcome: turn.input.signal.aborted
                ? { outcome: 'cancelled' }
                : { outcome: 'selected', optionId: approved ? 'allow_once' : 'reject_once' },
            };
          }
          // Upstream announces every tool with a generic permission request. This
          // authorizes dispatch only: the tool still performs its own policy/diff
          // validation and sends the exact operation through ACP above before I/O.
          const allowed = [...names].some(
            (name) => request.toolCall.title === formatToolCallTitle(name, {}),
          );
          return {
            outcome: { outcome: 'selected', optionId: allowed ? 'allow_once' : 'reject_once' },
          };
        },
      }),
      { readable: serverToClient.readable, writable: clientToServer.writable },
    );
    await client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
    const created = await client.newSession({ cwd: input.project, mcpServers: [] });
    const session: Session = {
      id: created.sessionId,
      toolsSupported: initial.toolsSupported,
      server,
      client,
      connection,
      turn: initial,
      permissions: new Map(),
      closeTransport: () => {
        agentInput.close();
        clientInput.close();
      },
    };
    state.session = session;
    this.debug('session created', session.id);
    return session;
  }
  private debug(event: string, id: string) {
    if (process.env.NODE_ENV === 'development') console.debug(`[CodeAgent] ${event}`, id);
  }
}
