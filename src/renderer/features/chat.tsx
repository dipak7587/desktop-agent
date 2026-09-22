import { ProviderSelector } from '../components/provider-selector';
import { FolderSelection } from '../components/folder-selection';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Square,
  Plus,
  MessageSquare,
  Search,
  Trash2,
  Pencil,
  Orbit,
  BookOpen,
  Terminal,
  Code2,
} from 'lucide-react';
import { useChat, useSettings, useKnowledge, useUI, useAgents, attempt } from '../stores';
import { ChatActivity, useChatCommands } from './chat-commands';
import { Markdown, CopyButton, Confirm, Modal } from '../components/common';
export function Chat() {
  const chat = useChat();
  const { settings } = useSettings();
  const agents = useAgents((s) => s.items);
  const { sources } = useKnowledge();
  const draft = useUI((s) => s.draft);
  const commands = useChatCommands(draft);
  const enabled = settings?.providers.filter((p) => p.enabled !== false) ?? [];
  const defaultProvider =
    enabled.length === 1 ? enabled[0] : enabled.find((p) => p.id === settings?.activeProviderId);
  const providerId = chat.current ? chat.providerId : (defaultProvider?.id ?? '');
  const model = chat.current ? chat.model : (defaultProvider?.chatModel ?? '');
  const selectedProvider = enabled.find((p) => p.id === providerId);
  const validSelection = !!selectedProvider?.modelIds?.includes(model);
  const agent = agents.find(
    (a) => a.id === (commands.selected?.kind === 'agent' ? commands.selected.id : chat.agentId),
  );
  const selectedAgentId = commands.selected?.kind === 'agent' ? commands.selected.id : '';
  useEffect(() => {
    if (!selectedAgentId) return;
    const a = useAgents.getState().items.find((a) => a.id === selectedAgentId);
    if (a && useChat.getState().agentId !== a.id)
      void attempt(() => useChat.getState().choose(a.providerId ?? '', a.model, a.id));
  }, [selectedAgentId]);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [project, setProject] = useState('');
  useEffect(() => {
    setProject('');
  }, [chat.current]);
  const [knowledge, setKnowledge] = useState('none');
  const [remove, setRemove] = useState<string | null>(null);
  const [removeAll, setRemoveAll] = useState(false);
  const [rename, setRename] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'instant' });
  }, [chat.messages, chat.stream]);
  async function send(regenerate = false) {
    if (chat.generating || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try {
      const request = regenerate ? { command: undefined, query: '' } : commands.resolve();
      let sendProviderId = providerId;
      let sendModel = model;
      if (request.command?.kind === 'agent' && request.command.id !== chat.agentId) {
        const selectedAgent = agents.find((a) => a.id === request.command?.id);
        if (!selectedAgent) throw new Error('Agent is unavailable');
        sendProviderId = selectedAgent.providerId ?? '';
        sendModel = selectedAgent.model;
        await chat.choose(sendProviderId, sendModel, selectedAgent.id);
      }
      if (
        request.command?.kind !== 'workflow' &&
        !enabled.find((p) => p.id === sendProviderId)?.modelIds?.includes(sendModel)
      )
        throw new Error('Select an enabled provider and available model.');
      if (!regenerate && !request.query.trim()) throw new Error('Enter a query');
      let id = useChat.getState().current;
      if (!id) {
        await chat.newChat();
        id = useChat.getState().current;
      }
      if (!id) return;
      const text = request.query;
      await window.workspace.chat.send({
        id,
        text,
        model: sendModel,
        providerId: sendProviderId || undefined,
        knowledge,
        regenerate,
        command: request.command
          ? {
              ...request.command,
              project: ['agent', 'workflow'].includes(request.command.kind)
                ? project || undefined
                : undefined,
            }
          : agent
            ? { kind: 'agent', id: agent.id, project: project || undefined }
            : undefined,
      });
      useUI.setState({ draft: '' });
      commands.clear();
      setProject('');
      await chat.load();
      await chat.open(id);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const current = chat.conversations.find((c) => c.id === chat.current);
  return (
    <div className="chat-layout">
      <section className="history">
        <div className="history-heading">
          <span>Conversations</span>
          <div className="actions">
            <button
              className="icon"
              aria-label="Delete all chats"
              title="Delete all chats"
              onClick={() => setRemoveAll(true)}
            >
              <Trash2 size={16} />
            </button>
            <button
              className="icon"
              aria-label="New chat"
              onClick={() => void attempt(chat.newChat)}
            >
              <Plus size={17} />
            </button>
          </div>
        </div>
        <div className="search-input">
          <Search size={15} />
          <input
            aria-label="Search conversations"
            placeholder="Search history…"
            value={chat.search}
            onChange={(e) => void attempt(() => chat.load(e.target.value))}
          />
        </div>
        <div className="history-list">
          {chat.conversations.map((c) => (
            <div key={c.id} className={`history-row ${chat.current === c.id ? 'selected' : ''}`}>
              <button
                className="history-open"
                disabled={!!chat.generating && chat.current !== c.id}
                onClick={() => void attempt(() => chat.open(c.id))}
              >
                <MessageSquare size={15} />
                <span>{c.title}</span>
              </button>
              <button
                className="icon small"
                aria-label={`Rename ${c.title}`}
                onClick={() => {
                  setRename(c.id);
                  setTitle(c.title);
                }}
              >
                <Pencil size={12} />
              </button>
              <button
                className="icon small"
                aria-label={`Delete ${c.title}`}
                onClick={() => setRemove(c.id)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {!chat.conversations.length && (
            <p className="small muted px-3 py-5">
              Your conversations stay on this device. Start one below.
            </p>
          )}
        </div>
        <div className="history-foot">
          <span className="status-dot" /> Stored locally
        </div>
      </section>
      <section className="conversation">
        <header className="chat-heading">
          <div>
            <h2>{current?.title ?? 'New conversation'}</h2>
            <span className="muted small">A private space to think, build, and explore.</span>
          </div>
          {agent && (
            <div className="small">
              {agent.name} · Saved:{' '}
              {settings?.providers.find((p) => p.id === agent.providerId)?.name ??
                'Unavailable provider'}{' '}
              / {agent.model}
              {(providerId !== agent.providerId || model !== agent.model) && (
                <span className="badge">Conversation override</span>
              )}
            </div>
          )}
          <ProviderSelector
            providerId={providerId}
            model={model}
            onChange={(p, m) => void attempt(() => chat.choose(p, m))}
          />
        </header>
        <div className="messages">
          {!chat.messages.length && !chat.generating ? (
            <div className="chat-welcome">
              <div className="welcome-mark">
                <Orbit size={38} strokeWidth={1.2} />
              </div>
              <div className="eyebrow">YOUR LOCAL INTELLIGENCE</div>
              <h1>Good ideas start here.</h1>
              <p>
                Talk to your models. Bring your knowledge.
                <br />
                Choose a local model or your connected provider.
              </p>
              <div className="suggestions">
                {[
                  {
                    icon: Code2,
                    title: 'Build something',
                    text: 'Help me plan a new application. Ask me about the requirements first.',
                  },
                  {
                    icon: BookOpen,
                    title: 'Explore your knowledge',
                    text: 'Summarize the key ideas in the selected knowledge sources.',
                  },
                  {
                    icon: Terminal,
                    title: 'Think it through',
                    text: 'Help me reason through a technical decision. Ask me what I am working on.',
                  },
                ].map((s) => (
                  <button key={s.title} onClick={() => useUI.setState({ draft: s.text })}>
                    <s.icon size={19} />
                    <strong>{s.title}</strong>
                    <span>{s.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-column">
              {chat.messages
                .filter(
                  (m) => m.metadata?.status !== 'streaming' || chat.generating !== chat.current,
                )
                .map((m) => (
                  <article key={m.id} className={`message ${m.role}`}>
                    <div className="message-label">
                      {m.role === 'user'
                        ? 'You'
                        : `AI Assistant · ${m.metadata?.providerNameSnapshot ?? 'Unknown provider (legacy)'} / ${m.metadata?.modelId ?? 'Unknown model'}`}
                      {m.role === 'assistant' && (
                        <span className="badge">
                          {m.metadata?.status ??
                            (m.metadata?.error
                              ? 'failed'
                              : m.metadata?.stopped
                                ? 'canceled'
                                : 'completed')}
                        </span>
                      )}
                      <CopyButton text={m.content} />
                    </div>
                    <Markdown text={m.content} />
                    {m.metadata?.command && (
                      <p className="badge">
                        /{m.metadata.command.kind} · {m.metadata.command.name}
                        {m.metadata.command.project && (
                          <span className="folder-path">📁 {m.metadata.command.project}</span>
                        )}
                      </p>
                    )}
                    {!!m.metadata?.activity?.length && (
                      <ChatActivity events={m.metadata.activity} />
                    )}
                    {m.metadata?.error && <p className="error-text">{m.metadata.error}</p>}
                    {m.metadata?.stopped && <span className="muted small">Generation stopped</span>}
                    {!!m.metadata?.sources?.length && (
                      <details className="sources">
                        <summary>Sources used: {m.metadata.sources.length}</summary>
                        {m.metadata.sources.map((s) => (
                          <div key={s.id}>
                            <strong>{s.name}</strong>
                            <p>{s.content}</p>
                          </div>
                        ))}
                      </details>
                    )}
                  </article>
                ))}
              {chat.generating === chat.current && (
                <article className="message assistant">
                  <div className="message-label">
                    AI Assistant · {chat.generatingSelection?.providerNameSnapshot} /{' '}
                    {chat.generatingSelection?.modelId} <span className="pulse">Streaming</span>
                  </div>
                  {chat.activity.length ? (
                    <ChatActivity events={chat.activity} live />
                  ) : chat.stream ? (
                    <Markdown text={chat.stream} />
                  ) : (
                    <p className="muted">Preparing your response…</p>
                  )}
                </article>
              )}
              <div ref={end} />
            </div>
          )}
        </div>
        <div className="composer-area">
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              void attempt(() => send());
            }}
          >
            {commands.selected && (
              <div className="command-chip">
                <span>
                  /{commands.selected.kind} · {commands.selected.name} ·{' '}
                  {commands.selected.kind === 'agent' ? 'this conversation' : 'this message'}
                </span>
                <div className="command-chip-actions">
                  {['agent', 'workflow'].includes(commands.selected.kind) && (
                    <FolderSelection value={project} onChange={setProject} controlsOnly />
                  )}
                  <button
                    type="button"
                    aria-label="Remove chat command"
                    onClick={() => {
                      commands.clear();
                      if (chat.agentId) void attempt(() => chat.choose(providerId, model, ''));
                    }}
                  >
                    ×
                  </button>
                </div>
              </div>
            )}
            {(agent || commands.selected?.kind === 'workflow') && (
              <p className="folder-path command-folder-path">{project || 'No folder selected'}</p>
            )}
            {!commands.selected && /^\/(agent|workflow)\s/.test(draft) && (
              <FolderSelection value={project} onChange={setProject} />
            )}
            {commands.picker}
            <textarea
              ref={commands.inputRef}
              aria-label="Message"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={commands.isMenu}
              aria-controls={commands.isMenu ? 'slash-options' : undefined}
              aria-activedescendant={commands.activeId}
              placeholder="Ask anything, or type / for skills, agents, and MCP…"
              value={draft}
              onChange={(e) => commands.updateDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || commands.onKeyDown(e)) return;
                if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
                  e.preventDefault();
                  if (!e.repeat) void attempt(() => send());
                }
              }}
            />
            {agent && (
              <div className="actions">
                <span className="small">
                  Next response: {selectedProvider?.name ?? 'Unavailable provider'} /{' '}
                  {model || 'Select model'}
                </span>
                <button
                  type="button"
                  disabled={!validSelection}
                  onClick={() =>
                    void attempt(async () => {
                      await window.workspace.library.save('agents', {
                        ...agent,
                        providerId,
                        model,
                      });
                      await useAgents.getState().load();
                    })
                  }
                >
                  Save to Agent
                </button>
              </div>
            )}
            <div className="composer-tools">
              <div className="knowledge-select">
                <BookOpen size={15} />
                <select
                  aria-label="Knowledge context"
                  value={knowledge}
                  onChange={(e) => setKnowledge(e.target.value)}
                >
                  <option value="none">No knowledge context</option>
                  <option value="all">All knowledge</option>
                  {[...new Set(sources.map((s) => s.collection).filter(Boolean))].map((c) => (
                    <option key={c} value={`collection:${c}`}>
                      Collection: {c}
                    </option>
                  ))}
                  {sources
                    .filter((s) => s.id !== 'saved-text')
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                </select>
              </div>
              {chat.generating ? (
                <button
                  type="button"
                  className="send stop"
                  aria-label="Stop generation"
                  onClick={() => void attempt(() => window.workspace.chat.stop(chat.generating!))}
                >
                  <Square size={17} />
                </button>
              ) : (
                <button
                  type="submit"
                  className="send"
                  aria-label="Send message"
                  disabled={
                    (!validSelection &&
                      commands.selected?.kind !== 'workflow' &&
                      !/^\/workflow\s/.test(draft)) ||
                    (!draft.trim() &&
                      !['agent', 'workflow'].includes(commands.selected?.kind ?? '')) ||
                    busy
                  }
                >
                  <ArrowUp size={20} />
                </button>
              )}
            </div>
          </form>
          <div className="composer-footer">
            <span>AI models can make mistakes. Verify important details.</span>
            {chat.messages.some((m) => m.role === 'assistant') &&
            !chat.generating &&
            !chat.messages.filter((m) => m.role === 'user').at(-1)?.metadata?.command ? (
              <button className="text-button" onClick={() => void attempt(() => send(true))}>
                Regenerate
              </button>
            ) : (
              <span>Enter to send · Shift + Enter for a new line</span>
            )}
          </div>
        </div>
      </section>
      {removeAll && (
        <Confirm
          title="Delete all chat history?"
          detail="This permanently removes every conversation and message from this device."
          onClose={() => setRemoveAll(false)}
          onConfirm={async () => {
            await chat.clear();
            setRemoveAll(false);
          }}
        />
      )}
      {remove && (
        <Confirm
          title="Delete conversation?"
          detail="This permanently removes its messages from this device."
          onClose={() => setRemove(null)}
          onConfirm={async () => {
            await window.workspace.chat.remove(remove);
            if (chat.current === remove) useChat.setState({ current: null, messages: [] });
            await chat.load();
          }}
        />
      )}
      {rename && (
        <Modal title="Rename conversation" onClose={() => setRename(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void attempt(async () => {
                await window.workspace.chat.rename(rename, title);
                await chat.load();
                setRename(null);
              });
            }}
          >
            <label>
              Title
              <input autoFocus required value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <div className="actions">
              <button className="primary">Save title</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
