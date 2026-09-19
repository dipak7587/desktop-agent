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
  const { settings, models, status, loading, refresh } = useSettings();
  const { sources } = useKnowledge();
  const draft = useUI((s) => s.draft);
  const commands = useChatCommands(draft);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [knowledge, setKnowledge] = useState('none');
  const [remove, setRemove] = useState<string | null>(null);
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
      const model =
        request.command?.kind === 'agent'
          ? useAgents.getState().items.find((a) => a.id === request.command?.id)?.model ||
            settings?.chatModel
          : settings?.chatModel;
      if (!model) throw new Error('Select an installed chat model in Settings');
      if (!regenerate && !request.query.trim()) throw new Error('Enter a query');
      const project =
        request.command?.kind === 'agent' ? await window.workspace.agents.project() : undefined;
      if (project === null) return;
      let id = chat.current;
      if (!id) {
        await chat.newChat();
        id = useChat.getState().current;
      }
      if (!id) return;
      const text = request.query;
      await window.workspace.chat.send({
        id,
        text,
        model,
        knowledge,
        regenerate,
        command: request.command ? { ...request.command, project } : undefined,
      });
      useUI.setState({ draft: '' });
      commands.clear();
      await chat.open(id);
      await chat.load();
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
          <button className="icon" aria-label="New chat" onClick={() => void attempt(chat.newChat)}>
            <Plus size={17} />
          </button>
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
          <select
            aria-label="Chat model"
            value={settings?.chatModel ?? ''}
            onChange={(e) =>
              settings &&
              void attempt(() =>
                useSettings.getState().save({ ...settings, chatModel: e.target.value }),
              )
            }
          >
            <option value="">Select model</option>
            {models
              .filter((m) => !m.capabilities || m.capabilities.includes('completion'))
              .map((m) => (
                <option key={m.name}>{m.name}</option>
              ))}
          </select>
        </header>
        {!status.startsWith('Connected') && (
          <div className="connection-banner">
            <div>
              <strong>Ollama not connected</strong>
              <p>{loading ? 'Checking your local connection…' : status}</p>
            </div>
            <button onClick={() => void refresh()} disabled={loading}>
              Retry
            </button>
            <button onClick={() => void attempt(() => window.workspace.system.openOllamaDocs())}>
              Set up Ollama
            </button>
          </div>
        )}
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
                Keep your work on your machine.
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
              {chat.messages.map((m) => (
                <article key={m.id} className={`message ${m.role}`}>
                  <div className="message-label">
                    {m.role === 'user' ? 'You' : 'Local assistant'}
                    <CopyButton text={m.content} />
                  </div>
                  <Markdown text={m.content} />
                  {m.metadata?.command && (
                    <p className="badge">
                      /{m.metadata.command.kind} · {m.metadata.command.name}
                    </p>
                  )}
                  {!!m.metadata?.activity?.length && <ChatActivity events={m.metadata.activity} />}
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
                    Local assistant <span className="pulse">Generating</span>
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
                  /{commands.selected.kind} · {commands.selected.name} · this message
                </span>
                <button type="button" aria-label="Remove chat command" onClick={commands.clear}>
                  ×
                </button>
              </div>
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
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void attempt(() => send());
                }
              }}
            />
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
                  disabled={!draft.trim() || busy}
                >
                  <ArrowUp size={20} />
                </button>
              )}
            </div>
          </form>
          <div className="composer-footer">
            <span>Local models can make mistakes. Verify important details.</span>
            {chat.messages.some((m) => m.role === 'assistant') &&
            !chat.generating &&
            !chat.messages.filter((m) => m.role === 'user').at(-1)?.metadata?.command ? (
              <button className="text-button" onClick={() => void attempt(() => send(true))}>
                Regenerate
              </button>
            ) : (
              <span>⌘ / Ctrl + Enter to send</span>
            )}
          </div>
        </div>
      </section>
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
