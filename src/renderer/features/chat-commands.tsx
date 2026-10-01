import { useWorkflows } from '../stores/workflows';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { AppEvent, ChatCommand, ChatMode, CodeWorkspace } from '../../shared/types';
import { commandKinds, resolveSlash, slashPrefix } from '../../shared/slash-commands';
import {
  useAgents,
  useChat,
  useMCP,
  useMCPStatus,
  useSkills,
  useTools,
  useKnowledge,
  useUI,
  useRuns,
  attempt,
} from '../stores';

type CommandOption = {
  key: string;
  label: string;
  detail?: string;
  command?: (ChatCommand & { name: string }) | null;
  workspace?: CodeWorkspace;
  knowledge?: string;
};

export function useChatCommands(draft: string) {
  const { items: agents } = useAgents();
  const { items: mcp } = useMCP();
  const { items: skills } = useSkills();
  const { items: tools } = useTools();
  const { sources } = useKnowledge();
  const modes = useUI((s) => s.chatModes);
  const allows = (kind: string) => modes.includes(kind as (typeof modes)[number]);
  const suggests = (kind: string) => !modes.length || allows(kind);
  const { states } = useMCPStatus();
  const workflows = useWorkflows((s) => s.items);
  const libraries = {
    agent: agents,
    mcp,
    skills,
    tools,
    workflow: workflows.map((w) => ({ ...w, enabled: true })),
  };
  const hasEnabledResources = (kind: Exclude<(typeof commandKinds)[number], 'code'>) =>
    libraries[kind].some((item) => item.enabled);
  const resourceKinds = ['mcp', 'agent', 'workflow', 'skills', 'tools'] as const;
  const storedCommand = useUI((s) => s.chatCommand);
  const selected = storedCommand && allows(storedCommand.kind) ? storedCommand : null;
  const generating = useChat((s) => s.generating);
  const [workspaces, setWorkspaces] = useState<CodeWorkspace[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prefix = slashPrefix(draft);
  const codeMatch = /^\/code(?:\s+(.*))?$/.exec(draft);
  const isCode = !!codeMatch && suggests('code');
  const shouldLoadFolders = suggests('code') && (isCode || draft === '/');
  const isMenu = draft.startsWith('/') && !dismissed;
  useEffect(() => {
    if (!shouldLoadFolders) return;
    let cancelled = false;
    setLoadingFolders(true);
    void attempt(async () => {
      try {
        const folders = await window.workspace.code.list();
        if (!cancelled) setWorkspaces(folders);
      } finally {
        if (!cancelled) setLoadingFolders(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [shouldLoadFolders]);
  const folderQuery = (codeMatch?.[1] ?? '').trim().toLowerCase();
  const folders = workspaces.filter((folder) =>
    `${folder.name} ${folder.canonicalPath}`.toLowerCase().includes(folderQuery),
  );
  const knowledgeOptions: CommandOption[] = suggests('kb')
    ? [
        {
          key: 'kb:saved-text',
          label: '/store-context',
          detail: 'Saved Text context',
          knowledge: 'saved-text',
        },
        {
          key: 'kb:all',
          label: '/all-kb',
          detail: 'All indexed knowledge bases',
          knowledge: 'all',
        },
        ...sources
          .filter((source) => source.type === 'folder' && source.id !== 'saved-text')
          .map((source) => ({
            key: `kb:${source.id}`,
            label: `/${source.name}`,
            detail: `KB folder · ${source.status}`,
            knowledge: source.id,
          })),
      ]
    : [];
  const options: CommandOption[] = isCode
    ? [
        ...folders.map((workspace) => ({
          key: `workspace:${workspace.id}`,
          label: workspace.name,
          detail: `${workspace.canonicalPath}${workspace.available ? '' : ' · Relink missing folder'}`,
          workspace,
        })),
        {
          key: 'open-folder',
          label: 'Open another folder…',
          detail: 'Choose a folder to connect to this chat',
        },
      ]
    : prefix
      ? (suggests(prefix.kind) ? libraries[prefix.kind] : [])
          .filter(
            (i) =>
              i.enabled &&
              i.name.toLowerCase().includes(prefix.rest.replace(/^"/, '').toLowerCase()),
          )
          .map((i) => ({
            key: i.id,
            label: i.name,
            detail:
              prefix.kind === 'mcp'
                ? states.find((s) => s.id === i.id)?.status === 'connected'
                  ? 'Connected'
                  : 'Start in MCP before sending'
                : i.description,
            command: { kind: prefix.kind, id: i.id, name: i.name },
          }))
      : [
          ...knowledgeOptions.filter((option) =>
            option.label.toLowerCase().startsWith(draft.toLowerCase()),
          ),
          ...commandKinds
            .filter((kind) => {
              if (!suggests(kind) || !`/${kind}`.startsWith(draft)) return false;
              if (kind === 'code') return workspaces.length === 0;
              return !hasEnabledResources(kind);
            })
            .map((kind) => ({
              key: kind,
              label: `/${kind}`,
              detail:
                kind === 'tools'
                  ? 'Run a configured tool'
                  : kind === 'skills'
                    ? 'Apply skill instructions'
                    : kind === 'code'
                      ? 'Select a saved folder in Chat'
                      : kind === 'workflow'
                        ? 'Run a saved workflow'
                        : kind === 'agent'
                          ? 'Run a configured agent'
                          : 'Use a server’s tools',
              command: null,
            })),
          ...resourceKinds.flatMap((kind) =>
            suggests(kind)
              ? libraries[kind]
                  .filter((item) => item.enabled)
                  .map((item) => ({
                    key: `${kind}:${item.id}`,
                    label: `/${kind}-${item.name}`,
                    detail:
                      kind === 'mcp'
                        ? states.find((state) => state.id === item.id)?.status === 'connected'
                          ? 'Connected'
                          : 'Start in MCP before sending'
                        : item.description,
                    command: { kind, id: item.id, name: item.name },
                  }))
              : [],
          ),
          ...(suggests('code')
            ? workspaces
                .filter((workspace) =>
                  `/code-${workspace.name}`.toLowerCase().startsWith(draft.toLowerCase()),
                )
                .map((workspace) => ({
                  key: `workspace:${workspace.id}`,
                  label: `/code-${workspace.name}`,
                  detail: `${workspace.canonicalPath}${workspace.available ? '' : ' · Relink missing folder'}`,
                  workspace,
                }))
            : []),
        ];
  const activeIndex = Math.min(index, Math.max(0, options.length - 1));
  const updateDraft = (value: string) => {
    useUI.setState({ draft: value });
    setIndex(0);
    setDismissed(false);
  };
  const enableMode = (mode: ChatMode) => {
    const currentModes = useUI.getState().chatModes;
    if (!currentModes.includes(mode))
      useUI.setState({ chatModes: [...currentModes, mode] });
  };
  const choose = (option: (typeof options)[number]) => {
    if (connecting || (isCode && loadingFolders)) return;
    if (option.workspace || option.key === 'open-folder') {
      if (generating) return;
      enableMode('code');
      setConnecting(true);
      void attempt(async () => {
        try {
          const chat = useChat.getState();
          if (option.workspace) {
            if (option.workspace.available) await chat.reconnectWorkspace(option.workspace.id);
            else await chat.relinkWorkspace(option.workspace.id);
          } else await chat.connectWorkspace();
          if (useChat.getState().workspace !== chat.workspace) updateDraft('');
          inputRef.current?.focus();
        } finally {
          setConnecting(false);
        }
      });
      return;
    }
    if (option.knowledge) {
      enableMode('kb');
      useUI.setState({ chatKnowledge: option.knowledge });
      updateDraft('');
    } else if (option.command) {
      enableMode(option.command.kind);
      useUI.setState({ chatCommand: option.command });
      updateDraft('');
    } else {
      const mode = commandKinds.find((kind) => kind === option.key);
      if (mode) enableMode(mode);
      updateDraft(`${option.label} `);
    }
    inputRef.current?.focus();
  };
  useEffect(() => {
    if (isMenu)
      document.getElementById(`slash-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, isMenu]);
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || !isMenu) return false;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setDismissed(true);
      return true;
    }
    if (
      options.length &&
      ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key) &&
      !e.metaKey &&
      !e.ctrlKey &&
      !(e.key === 'Enter' && (e.shiftKey || e.altKey))
    ) {
      e.preventDefault();
      if (e.key === 'Enter') choose(options[activeIndex]);
      else
        setIndex(
          (activeIndex + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length,
        );
      return true;
    }
    return false;
  };
  const resolve = () => {
    if (!modes.length) return { command: undefined, query: draft };
    if (/^\/code(?:\s|$)/.test(draft))
      throw new Error('Select a saved folder from the /code list before sending your message.');
    if (selected && allows(selected.kind))
      return {
        command: { kind: selected.kind, id: selected.id },
        query:
          draft.trim() ||
          (['agent', 'workflow'].includes(selected.kind)
            ? 'Run your configured instructions.'
            : ''),
      };
    if (
      /^\/(mcp|tools|agent|skills|workflow)(?:[-\s]|$)/.test(draft) ||
      /^\/(mcp|tools|agent|skills|workflow)[-\s][\s\S]*$/.test(draft) ||
      draft === '/'
    ) {
      if (prefix && !allows(prefix.kind))
        throw new Error('Enable the matching checkbox before using this command.');
      return resolveSlash(draft, prefix ? libraries[prefix.kind] : []);
    }
    const kbOption = knowledgeOptions.find(
      (option) => draft === option.label || draft.startsWith(`${option.label} `),
    );
    if (kbOption) {
      useUI.setState({ chatKnowledge: kbOption.knowledge });
      return { command: undefined, query: draft.slice(kbOption.label.length).trim() };
    }
    if (
      !modes.includes('kb') &&
      !(modes.includes('agent') && useChat.getState().agentId) &&
      !(modes.includes('code') && useChat.getState().workspace) &&
      modes.some((mode) => mode !== 'kb')
    )
      throw new Error(
        'Type / and select an MCP server, tool, skill, agent, workflow, or Code folder, or uncheck it for a model-only reply.',
      );
    return { command: undefined, query: draft };
  };
  return {
    inputRef,
    selected,
    clear: () => useUI.setState({ chatCommand: null }),
    updateDraft,
    onKeyDown,
    resolve,
    activeId: isMenu && options.length ? `slash-option-${activeIndex}` : undefined,
    isMenu,
    picker: isMenu ? (
      <div className="slash-picker">
        <div
          role="listbox"
          id="slash-options"
          aria-label={isCode ? 'Saved folders' : prefix ? `Select ${prefix.kind}` : 'Chat commands'}
        >
          {options.map((option, i) => (
            <button
              type="button"
              role="option"
              tabIndex={-1}
              id={`slash-option-${i}`}
              aria-selected={i === activeIndex}
              disabled={isCode && (loadingFolders || connecting || !!generating)}
              key={option.key}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(option)}
            >
              <strong>{option.label}</strong>
              <span>{option.detail}</span>
            </button>
          ))}
        </div>
        {isCode && (
          <p className="small muted" role="status">
            {loadingFolders
              ? 'Loading saved folders…'
              : connecting
                ? 'Connecting folder…'
                : generating
                  ? 'Stop the current response before changing folders.'
                  : !folders.length
                    ? workspaces.length
                      ? 'No matching saved folders.'
                      : 'No saved folders yet. Choose a folder below.'
                    : ''}
          </p>
        )}
        {!options.length && (
          <p className="small muted">
            No matching items. Create or enable one in its sidebar menu, or finish your query and
            send.
          </p>
        )}
        <p className="small muted">↑ ↓ to browse · Enter to select · Esc to dismiss</p>
      </div>
    ) : null,
  };
}

export function ChatActivity({ events, live = false }: { events: AppEvent[]; live?: boolean }) {
  const [busy, setBusy] = useState(false);
  const last = events.at(-1);
  const runs = useRuns((s) => s.runs);
  const workflowRuns = useWorkflows((s) => s.runs);
  const childIds = new Set(events.filter((e) => e.type === 'agent').map((e) => e.id));
  for (const workflow of workflowRuns)
    if (events.some((e) => e.type === 'workflow' && e.id === workflow.id))
      for (const node of workflow.nodes) if (node.runId) childIds.add(node.runId);
  const pending = runs
    .filter(
      (run) =>
        childIds.has(run.id) && run.status === 'Running' && run.phase === 'Waiting for approval',
    )
    .map((run) => run.events.at(-1))
    .filter((e): e is AppEvent & { approval: NonNullable<AppEvent['approval']> } => !!e?.approval);

  return (
    <div className="chat-activity">
      <p role={live ? 'status' : undefined} className="small muted">
        {last?.status ?? 'Preparing command…'}
      </p>
      {!!events.length && (
        <details>
          <summary>Command activity ({events.length})</summary>
          {events.map((event, i) => (
            <div key={i} className="run-event">
              <strong>{event.status}</strong>
              {event.content && <pre className="log">{event.content}</pre>}
              {event.error && <p className="error-text">{event.error}</p>}
              {event.approval && (
                <>
                  <p>{event.approval.description}</p>
                  {event.approval.diff && <pre className="diff">{event.approval.diff}</pre>}
                </>
              )}
            </div>
          ))}
        </details>
      )}
      {live &&
        pending.map((last) => (
          <div className="approval" key={last.approval.id}>
            <h3>Approval required</h3>
            <pre className="log">{last.approval.description}</pre>
            {last.approval.diff && <pre className="diff">{last.approval.diff}</pre>}
            <div className="actions">
              {[false, true].map((approved) => (
                <button
                  key={String(approved)}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void attempt(async () => {
                      try {
                        await window.workspace.agents.approve(last.approval!.id, approved);
                      } finally {
                        setBusy(false);
                      }
                    });
                  }}
                >
                  {approved ? 'Approve operation' : 'Reject'}
                </button>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
