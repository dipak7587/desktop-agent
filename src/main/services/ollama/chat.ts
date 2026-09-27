import type { ProviderRouter, SelectedProvider } from '../providers/router';
import type { AppEvent, SearchResult, ChatInput, KnowledgeSource } from '../../../shared/types';
import type { ChatCommands, PreparedCommand } from './commands';
import type { ChatDatabase } from '../../database/chat';
import type { LLMProvider } from './provider';
import type { MemoryService } from '../ai/memory';
import { ChatTurnGraph, type ChatGraphDeps } from '../ai/chat-graph';

export interface ChatServiceOptions {
  /** LangGraph checkpointer; keys durable thread state by conversation id. */
  checkpointer?: ChatGraphDeps['checkpointer'];
}

/**
 * Chat turns execute as a LangGraph StateGraph (see ai/chat-graph.ts). The
 * service keeps its existing responsibilities — admission control, command
 * preparation, persistence, event emission, cancellation — while generation
 * itself (capability routing, knowledge, memory, streaming) runs as graph
 * nodes. Providers are reached through the shared AppChatModel bridge only.
 */
export class ChatService {
  private active = new Map<string, AbortController>();
  private jobs = new Map<string, Promise<void>>();
  private graph: ChatTurnGraph;

  constructor(
    private db: ChatDatabase,
    private llm: LLMProvider,
    private emit: (e: AppEvent) => void,
    private search: (q: string, scope: string) => Promise<SearchResult[]>,
    private contextSize: () => number = () => 8192,
    private commands?: ChatCommands,
    private redact: (text: string) => string = (text) => text,
    private knowledgeSources?: () => KnowledgeSource[],
    private providers?: ProviderRouter,
    private memory?: MemoryService,
    options?: ChatServiceOptions,
  ) {
    this.graph = new ChatTurnGraph({
      db,
      llm,
      emit,
      search,
      contextSize,
      redact,
      knowledgeSources,
      memory,
      checkpointer: options?.checkpointer,
    });
  }

  stop(id: string) {
    this.active.get(id)?.abort();
  }
  async stopAll() {
    for (const c of this.active.values()) c.abort();
    await Promise.allSettled(this.jobs.values());
  }
  isActive(id: string) {
    return this.active.has(id);
  }
  async send(input: ChatInput) {
    if (this.active.has(input.id)) throw new Error('This conversation is already generating');
    this.db.get(input.id);
    const selected =
      input.command?.kind === 'workflow'
        ? undefined
        : this.providers?.capture(
            (input.providerId ?? this.db.get(input.id).providerId) || undefined,
            input.model,
          );
    this.db.setSelection(
      input.id,
      selected?.providerId ?? input.providerId ?? '',
      input.model,
      input.command?.kind === 'agent' ? input.command.id : undefined,
    );
    const controller = new AbortController();
    this.active.set(input.id, controller);
    let prepared: PreparedCommand | undefined;
    try {
      if (
        input.regenerate &&
        (input.command ||
          this.db
            .messages(input.id)
            .filter((m) => m.role === 'user')
            .at(-1)?.metadata?.command)
      )
        throw new Error('Send the command again to repeat it. Command runs cannot be regenerated.');
      if (input.command) {
        if (!this.commands) throw new Error('Chat commands are unavailable');
        prepared = await this.commands.prepare(
          input.command,
          input.model,
          input.knowledge,
          selected,
        );
      }
      controller.signal.throwIfAborted();
    } catch (e) {
      this.active.delete(input.id);
      throw e;
    }
    if (input.regenerate) this.db.removeLastAssistant(input.id);
    else {
      if (!input.text.trim()) {
        this.active.delete(input.id);
        throw new Error('Enter a message');
      }
      if (!this.db.messages(input.id).length) this.db.rename(input.id, input.text.slice(0, 70));
      this.db.add(
        input.id,
        'user',
        input.text,
        prepared ? { command: prepared.command } : undefined,
      );
    }
    this.emit({
      type: 'chat',
      id: input.id,
      status: 'generating',
      selection: selected && {
        providerId: selected.providerId,
        providerNameSnapshot: selected.providerNameSnapshot,
        modelId: selected.modelId,
      },
    });
    const job = this.generate(input, controller, prepared, selected);
    this.jobs.set(input.id, job);
    void job.finally(() => this.jobs.delete(input.id));
  }

  /** Persist an assistant message row and stream/complete/update it in place. */
  private async generate(
    input: { id: string; text: string; model: string; knowledge: string },
    controller: AbortController,
    prepared?: PreparedCommand,
    selected?: SelectedProvider,
  ) {
    let content = '';
    let sources: SearchResult[] = [];
    let failure: string | undefined;
    let question = input.text;
    const activity: AppEvent[] = [];
    const saved = this.db.add(input.id, 'assistant', '', {
      providerId: selected?.providerId,
      providerNameSnapshot: selected?.providerNameSnapshot,
      modelId: input.model,
      agentId: prepared?.command.kind === 'agent' ? prepared.command.id : undefined,
      status: 'streaming',
    });
    try {
      const history = this.db.messages(input.id).filter((m) => m.id !== saved.id);
      question = history.filter((m) => m.role === 'user').at(-1)?.content ?? input.text;
      const result = await this.graph.run({
        id: input.id,
        question,
        knowledge: input.knowledge,
        model: input.model,
        history,
        signal: controller.signal,
        command: prepared,
        selected,
        onToken: (token) => {
          content += token;
          this.db.updateMessage(saved, this.redact(content), saved.metadata);
          this.emit({ type: 'chat', id: input.id, status: 'streaming', content: token });
        },
      });
      if (result.content) content = result.content;
      sources = result.sources;
      for (const event of result.activity) activity.push(event);
      if (!content) content = '';
    } catch (e) {
      if (!controller.signal.aborted) failure = this.redact((e as Error).message);
    } finally {
      if (!controller.signal.aborted && content)
        void this.memory
          ?.maybeCapture(question, content, { conversationId: input.id }, controller.signal)
          .catch(() => {});
      const message = this.db.updateMessage(saved, this.redact(content), {
        providerId: selected?.providerId,
        providerNameSnapshot: selected?.providerNameSnapshot,
        modelId: input.model,
        agentId: prepared?.command.kind === 'agent' ? prepared.command.id : undefined,
        status: failure ? 'failed' : controller.signal.aborted ? 'canceled' : 'completed',
        sources,
        error: failure,
        stopped: controller.signal.aborted,
        command: prepared?.command,
        activity: activity.length ? activity : undefined,
      });
      this.active.delete(input.id);
      this.emit({
        type: 'chat',
        id: input.id,
        status: failure ? 'error' : controller.signal.aborted ? 'stopped' : 'done',
        message,
        error: failure,
      });
    }
  }
}
