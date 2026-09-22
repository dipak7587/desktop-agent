import { Workflows } from './features/workflows';
import { useWorkflows } from './stores/workflows';
import { useEffect, useState } from 'react';
import {
  MessageSquare,
  Plug,
  Wrench,
  Zap,
  FileText,
  Bot,
  BookOpen,
  Settings as SettingsIcon,
  Orbit,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  X,
  ArrowUpRight,
} from 'lucide-react';
import type { Section } from '../shared/types';
import {
  useUI,
  useSettings,
  useChat,
  useKnowledge,
  libraryStores,
  useMCPStatus,
  useRuns,
  attempt,
} from './stores';
import { Chat } from './features/chat';
import { Library } from './features/libraries';
import { Knowledge } from './features/knowledge';
import { Settings } from './features/settings';
import { Modal } from './components/common';
const nav = [
  { name: 'Chat', icon: MessageSquare },
  { name: 'MCP', icon: Plug },
  { name: 'Tools', icon: Wrench },
  { name: 'Skills', icon: Zap },
  { name: 'Saved Text', icon: FileText },
  { name: 'Agents', icon: Bot },
  { name: 'Workflows', icon: Orbit },
  { name: 'Knowledge Base', icon: BookOpen },
] as const;
export function App() {
  const { section, setSection, error, notice } = useUI();
  const { settings, status } = useSettings();
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void attempt(async () => {
      await useSettings.getState().load();
      const results = await Promise.allSettled([
        useChat.getState().load(),
        useKnowledge.getState().load(),
        ...Object.values(libraryStores).map((s) => s.getState().load()),
        useMCPStatus.getState().load(),
        useRuns.getState().load(),
        useWorkflows.getState().load(),
      ]);
      const failures = results.filter((result) => result.status === 'rejected');
      if (failures.length)
        useUI.setState({ error: failures.map((result) => String(result.reason)).join('\n') });
      setReady(true);
      await useSettings.getState().refresh();
    });
    return window.workspace.onEvent((e) => {
      if (e.type === 'chat') useChat.getState().event(e);
      if (e.type === 'knowledge') {
        if (e.content)
          useKnowledge.setState((s) => ({ progress: { ...s.progress, [e.id]: e.content! } }));
        void attempt(() => useKnowledge.getState().load());
      }
      if (e.type === 'mcp') void attempt(() => useMCPStatus.getState().load());
      if (e.type === 'workflow') void attempt(() => useWorkflows.getState().load());
      if (e.type === 'agent') void attempt(() => useRuns.getState().load());
    });
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearch((s) => !s);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setSection('Chat');
        void attempt(() => useChat.getState().newChat());
      }
      if (e.key === 'Escape') {
        const id = useChat.getState().generating;
        if (id) void attempt(() => window.workspace.chat.stop(id));
        for (const r of useWorkflows.getState().runs)
          if (!['completed', 'failed', 'cancelled'].includes(r.status))
            void attempt(() => window.workspace.workflows.stop(r.id));
        for (const r of useRuns.getState().runs)
          if (
            !['Completed', 'Stopped', 'Failed', 'Cancelled', 'Max iterations reached'].includes(
              r.status,
            )
          )
            void attempt(() => window.workspace.agents.stop(r.id));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setSection]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => useUI.setState({ notice: '' }), 3000);
    return () => clearTimeout(timer);
  }, [notice]);
  return (
    <div className={`shell ${collapsed ? 'collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Orbit size={23} />
          </div>
          {!collapsed && (
            <div>
              <strong>{settings?.appName.replace(' Workspace', '') ?? 'LocalAI'}</strong>
              <span>WORKSPACE</span>
            </div>
          )}
        </div>
        <button
          className="global-search"
          onClick={() => setSearch(true)}
          aria-label="Search workspace"
        >
          <Search size={16} />
          {!collapsed && (
            <>
              <span>Search anything</span>
              <kbd>⌘ K</kbd>
            </>
          )}
        </button>
        {!collapsed && <div className="nav-label">WORKSPACE</div>}
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <button
              key={n.name}
              aria-current={section === n.name ? 'page' : undefined}
              title={n.name}
              onClick={() => setSection(n.name)}
            >
              <n.icon size={18} />
              {!collapsed && n.name}
              {!collapsed && section === n.name && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {!collapsed && (
            <div className="local-card">
              <div>
                <span className={`status-dot ${status.startsWith('Connected') ? '' : 'offline'}`} />
                <strong>
                  {status.startsWith('Connected') ? 'Provider connected' : 'Local workspace'}
                </strong>
              </div>
              <p>
                {status.startsWith('Connected')
                  ? 'Your intelligence. On your terms.'
                  : 'Configure AI Providers in Settings.'}
              </p>
              <span>
                No cloud backend required
                <ArrowUpRight size={12} />
              </span>
            </div>
          )}
          <button
            className={section === 'Settings' ? 'active' : ''}
            title="Settings"
            onClick={() => setSection('Settings')}
          >
            <SettingsIcon size={18} />
            {!collapsed && 'Settings'}
          </button>
          <button
            title="Toggle sidebar"
            aria-label="Toggle sidebar"
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}{' '}
            {!collapsed && <span className="small muted">Collapse sidebar</span>}
          </button>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <div>
            <span className="muted">Workspace</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{section}</strong>
          </div>
          <div className="topbar-right">
            <span className="local-badge">
              <span className="status-dot" />
              LOCAL FIRST
            </span>
            <span className="version">v0.1</span>
          </div>
        </div>
        {!ready ? (
          <div className="empty">
            <Orbit size={32} />
            <h2>Opening your workspace…</h2>
            {error && <p>{error}</p>}
          </div>
        ) : section === 'Chat' ? (
          <Chat />
        ) : section === 'Workflows' ? (
          <Workflows />
        ) : section === 'Knowledge Base' ? (
          <Knowledge />
        ) : section === 'Settings' ? (
          <Settings />
        ) : (
          <Library
            key={section}
            kind={
              section === 'Skills'
                ? 'skills'
                : section === 'Saved Text'
                  ? 'saved-text'
                  : section === 'MCP'
                    ? 'mcp'
                    : section === 'Tools'
                      ? 'tools'
                      : 'agents'
            }
          />
        )}
      </main>
      {error && (
        <div className="toast error" role="alert">
          <span>{error}</span>
          <button
            className="icon"
            aria-label="Dismiss error"
            onClick={() => useUI.setState({ error: '' })}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      {search && <GlobalSearch onClose={() => setSearch(false)} />}
    </div>
  );
}
function GlobalSearch({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ name: string; section: Section; id?: string }[]>([]);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(
      () =>
        void attempt(async () => {
          const chats = await window.workspace.chat.list(query);
          const libraries = await Promise.all(
            Object.entries(libraryStores).map(async ([kind, store]) => ({
              kind,
              items: store.getState().items,
            })),
          );
          const sources = useKnowledge.getState().sources;
          const results: { name: string; section: Section; id?: string }[] = [
            ...nav
              .filter((n) => n.name.toLowerCase().includes(query.toLowerCase()))
              .map((n) => ({ name: n.name, section: n.name })),
            ...chats.map((c) => ({ name: c.title, section: 'Chat' as const, id: c.id })),
            ...libraries.flatMap(({ kind, items }) =>
              items
                .filter((i) =>
                  (i.name + ' ' + i.content).toLowerCase().includes(query.toLowerCase()),
                )
                .map((i) => ({
                  name: i.name,
                  section: (
                    {
                      skills: 'Skills',
                      agents: 'Agents',
                      mcp: 'MCP',
                      tools: 'Tools',
                      'saved-text': 'Saved Text',
                    } as Record<string, Section>
                  )[kind],
                })),
            ),
            ...sources
              .filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))
              .map((s) => ({ name: s.name, section: 'Knowledge Base' as const })),
          ];
          if (alive) setResults(results.slice(0, 30));
        }),
      150,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);
  return (
    <Modal title="Search workspace" onClose={onClose}>
      <div className="search-input">
        <Search size={18} />
        <input
          autoFocus
          aria-label="Global search"
          placeholder="Chats, skills, agents, notes, knowledge…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="command-results">
        {results.map((r, i) => (
          <button
            key={i}
            onClick={() =>
              void attempt(async () => {
                if (r.section === 'Chat' && r.id) await useChat.getState().open(r.id);
                useUI.setState({ section: r.section });
                onClose();
              })
            }
          >
            <span>{r.name}</span>
            <span className="muted small">{r.section}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
