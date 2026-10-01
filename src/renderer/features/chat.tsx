import { ChatLanding } from '../components/chat-landing';
import { defaultLanding } from '../../shared/landing';
import { defaultChatSelection } from '../../shared/chat-selection';
import { ProviderSelector } from '../components/provider-selector';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  Square,
  Plus,
  MessageSquare,
  Search,
  Trash2,
  Pencil,
  Code2,
  RotateCcw,
  FileDown,
  FolderOpen,
  Unlink,
  PanelLeftClose,
  PanelLeftOpen,
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
  const modes = useUI((s) => s.chatModes);
  const knowledge = useUI((s) => s.chatKnowledge);
  const setKnowledge = (chatKnowledge: string) => useUI.setState({ chatKnowledge });

  const showProjectControls =
    /^\/(agent|workflow)(?:\s|$)/.test(draft) ||
    ['agent', 'workflow'].includes(commands.selected?.kind ?? '') ||
    !!chat.agentId;
  const enabled = settings?.providers.filter((p) => p.enabled !== false) ?? [];
  const defaults = defaultChatSelection(settings);
  const providerId = chat.current ? chat.providerId : defaults.providerId;
  const model = chat.current ? chat.model : defaults.model;
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
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
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
    if (!regenerate && modes.includes('code') && /^\/code(?:\s|$)/.test(draft)) {
      commands.updateDraft(draft);
      commands.inputRef.current?.focus();
      return;
    }
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
        // Creating the first conversation is part of sending, not an explicit reset.
        useUI.setState({ chatCommand: commands.selected });
      }
      if (!id) return;
      const text = request.query;
      await window.workspace.chat.send({
        id,
        text,
        model: sendModel,
        providerId: sendProviderId || undefined,
        knowledge: modes.includes('kb') ? useUI.getState().chatKnowledge : 'none',
        modes,
        regenerate,
        command: request.command
          ? { ...request.command }
          : agent && modes.includes('agent')
            ? { kind: 'agent', id: agent.id }
            : undefined,
      });
      useUI.setState({ draft: '' });
      await chat.load();
      await chat.open(id);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const current = chat.conversations.find((c) => c.id === chat.current);
  return (
    <div className={`chat-layout ${historyCollapsed ? 'history-collapsed' : ''}`}>
      <section className="history">
        <div className="history-heading">
          <span>Conversations</span>
          <div className="actions">
            <button
              type="button"
              className="icon"
              aria-label="Collapse conversations"
              title="Collapse conversations"
              onClick={() => setHistoryCollapsed(true)}
            >
              <PanelLeftClose size={16} />
            </button>
            <button
              type="button"
              className="icon"
              aria-label="Delete all chats"
              title="Delete all chats"
              onClick={() => setRemoveAll(true)}
            >
              <Trash2 size={16} />
            </button>
            <button
              type="button"
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
          {historyCollapsed && (
            <button
              type="button"
              className="icon"
              aria-label="Show conversations"
              title="Show conversations"
              onClick={() => setHistoryCollapsed(false)}
            >
              <PanelLeftOpen size={17} />
            </button>
          )}
          <div>
            <h2
              className={current ? 'conversation-title' : undefined}
              title={current ? 'Double-click to rename conversation' : undefined}
              onDoubleClick={() => {
                if (!current) return;
                setRename(current.id);
                setTitle(current.title);
              }}
            >
              {current?.title ?? 'New conversation'}
            </h2>
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
              {(providerId !== agent.providerId || model !== agent.model) && (
                <button
                  type="button"
                  disabled={!validSelection || busy || !!chat.generating}
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
              )}
            </div>
          )}
          <div className="chat-heading-controls">
            {chat.workspace ? (
              <div className="workspace-indicator" aria-label="Active coding workspace">
                <Code2 size={14} />
                <span title={chat.workspace.canonicalPath}>{chat.workspace.name}</span>
                <span className="badge">Restricted</span>
                <button
                  className="icon small"
                  aria-label="Disconnect workspace from conversation"
                  title="Disconnect workspace from conversation"
                  onClick={() => void attempt(chat.disconnectWorkspace)}
                >
                  <Unlink size={13} />
                </button>
              </div>
            ) : showProjectControls ? (
              <button
                type="button"
                className="secondary chat-clear-history"
                disabled={busy || !!chat.generating}
                onClick={() => void attempt(chat.connectWorkspace)}
              >
                <FolderOpen size={14} /> Connect project
              </button>
            ) : null}
            <button
              type="button"
              className="secondary chat-clear-history"
              disabled={!current}
              title="Export this conversation as a Markdown file"
              onClick={() =>
                current && void attempt(() => window.workspace.chat.exportMarkdown(current.id))
              }
            >
              <FileDown size={14} /> Export .md
            </button>
            <ProviderSelector
              providerId={providerId}
              model={model}
              onChange={(p, m) => void attempt(() => chat.choose(p, m))}
            />
            <button
              type="button"
              className="secondary chat-clear-history"
              disabled={busy || !!chat.generating}
              title="Start a fresh chat with this model. Previous conversations stay in history."
              onClick={() => {
                setBusy(true);
                void attempt(async () => {
                  try {
                    await chat.newChat({ providerId, model });
                    useUI.setState({ draft: '' });
                    setKnowledge('all');
                    useUI.setState({ chatModes: [] });
                    commands.inputRef.current?.focus();
                  } finally {
                    setBusy(false);
                  }
                });
              }}
            >
              <RotateCcw size={14} /> Clear history
            </button>
          </div>
        </header>
        <div className="messages">
          {!chat.messages.length && !chat.generating ? (
            <ChatLanding
              landing={settings?.landing ?? defaultLanding}
              onSelect={(text) => useUI.setState({ draft: text })}
            />
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
                  /{commands.selected.kind} · {commands.selected.name} · this conversation
                </span>
                <div className="command-chip-actions">
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

            {/* {modes.some((mode) => mode !== 'kb') && !commands.selected && (
              <p className="small muted">
                Type / to choose an enabled MCP server, tool, skill, agent, workflow, or Code folder.
              </p>
            )} */}
            {commands.picker}
            <textarea
              ref={commands.inputRef}
              aria-label="Message"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={commands.isMenu}
              aria-controls={commands.isMenu ? 'slash-options' : undefined}
              aria-activedescendant={commands.activeId}
              placeholder="Ask anything, or enable a checkbox and type /…"
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

            <div className="composer-tools">
              <fieldset className="chat-modes">
                <legend>Use in this chat</legend>
                {(['kb', 'mcp', 'tools', 'skills', 'code', 'agent', 'workflow'] as const).map((mode) => (
                  <label className="check" key={mode}>
                    <input
                      type="checkbox"
                      checked={modes.includes(mode)}
                      disabled={busy || !!chat.generating}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...modes, mode]
                          : modes.filter((item) => item !== mode);
                        const selectedMode = commands.selected?.kind;
                        useUI.setState({ chatModes: next });
                        if (selectedMode === mode && !event.target.checked) commands.clear();
                        commands.updateDraft(draft);
                      }}
                    />
                    {
                      {
                        kb: 'KB',
                        mcp: 'MCP',
                        tools: 'Tools',
                        skills: 'Skills',
                        code: 'Code',
                        agent: 'Agent',
                        workflow: 'Workflow',
                      }[mode]
                    }
                  </label>
                ))}
              </fieldset>
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
