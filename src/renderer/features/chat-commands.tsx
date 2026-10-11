import { useWorkflows } from '../stores/workflows';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { AppEvent, ChatCommand, ChatMode, CodeWorkspace } from '../../shared/types';
import {
  globalCommands,
  globalCommand,
  namedResource,
  resolveSlash,
  slashPrefix,
} from '../../shared/slash-commands';
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
  command?: ChatCommand & { name: string };
  workspace?: CodeWorkspace;
  knowledge?: string;
  draft?: string;
  action?: 'clear' | 'help' | 'connect';
  unavailable?: boolean;
};

export function useChatCommands(draft: string) {
  const { items: agents } = useAgents();
  const { items: mcp } = useMCP();
  const { items: skills } = useSkills();
  const { items: tools } = useTools();
  const { sources } = useKnowledge();
  const { states } = useMCPStatus();
  const workflows = useWorkflows((s) => s.items);
  const libraries = {
    agent: agents,
    mcp,
    skills,
    tools,
    workflow: workflows.map((w) => ({ ...w, enabled: true })),
  };
  const selected = useUI((s) => s.chatCommand);
  const generating = useChat((s) => s.generating);
  const [workspaces, setWorkspaces] = useState<CodeWorkspace[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prefix = slashPrefix(draft);
  const codeMatch = /^\/code(?:[-\s]+(.*))?$/.exec(draft);
  const kbMatch = /^\/kb(?:\s+(.*))?$/.exec(draft);
  const help = /^\/help\s*$/.test(draft);
  const isCode = !!codeMatch;
  const isMenu = draft.startsWith('/') && !dismissed;
  const shouldLoadFolders = isCode;
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
  const knowledgeOptions: CommandOption[] = [
    {
      key: 'kb:saved-text',
      label: '/store-context',
      detail: 'Saved Text context',
      knowledge: 'saved-text',
    },
    { key: 'kb:all', label: '/all-kb', detail: 'All indexed knowledge bases', knowledge: 'all' },
    ...sources
      .filter((source) => source.type === 'folder' && source.id !== 'saved-text')
      .map((source) => ({
        key: `kb:${source.id}`,
        label: `/${source.name}`,
        detail: `KB folder · ${source.status}`,
        knowledge: source.id,
      })),
  ];
  // A selected server opens a second level containing only its discovered tools.
  let server: ReturnType<typeof namedResource<(typeof mcp)[number]>>;
  try {
    server = prefix?.kind === 'mcp' ? namedResource(prefix.rest, mcp) : undefined;
  } catch {
    /* Ambiguous typed names remain in the resource picker. */
  }
  const serverState = states.find((state) => state.id === server?.item.id);
  const nestedQuery = server?.rest.replace(/^"/, '').toLowerCase() ?? '';
  const rootOptions: CommandOption[] = globalCommands.map((entry) => ({
    key: entry.name,
    label: `/${entry.name}`,
    detail: help ? `${entry.description} · ${entry.usage}` : entry.description,
    ...(entry.name === 'clear' || entry.name === 'help'
      ? { action: entry.name }
      : { draft: `/${entry.name} ` }),
  }));
  const options: CommandOption[] = help
    ? rootOptions
    : isCode
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
      : kbMatch
        ? knowledgeOptions.filter((option) =>
            `${option.label} ${option.detail}`
              .toLowerCase()
              .includes((kbMatch[1] ?? '').toLowerCase()),
          )
        : server
          ? [
              ...(!nestedQuery
                ? [
                    {
                      key: 'ask-server',
                      label: 'Ask this server',
                      detail: `Let the model choose among ${server.item.name} tools`,
                      command: { kind: 'mcp' as const, id: server.item.id, name: server.item.name },
                      unavailable: !server.item.enabled,
                    },
                  ]
                : []),
              ...(serverState?.status !== 'connected' && !nestedQuery
                ? [
                    {
                      key: 'connect',
                      label: 'Connect and load tools',
                      detail: serverState?.status ?? 'Disconnected',
                      action: 'connect' as const,
                      unavailable: !server.item.enabled || connecting,
                    },
                  ]
                : []),
              ...(serverState?.tools ?? [])
                .filter((tool) => tool.name.toLowerCase().includes(nestedQuery))
                .map((tool) => ({
                  key: `mcp-tool:${tool.name}`,
                  label: tool.name,
                  detail: tool.description,
                  command: {
                    kind: 'mcp' as const,
                    id: server!.item.id,
                    name: `${server!.item.name} · ${tool.name}`,
                    tool: tool.name,
                  },
                  unavailable: !server!.item.enabled,
                })),
            ]
          : prefix
            ? libraries[prefix.kind]
                .filter((item) =>
                  item.name.toLowerCase().includes(prefix.rest.replace(/^"/, '').toLowerCase()),
                )
                .map((item) => ({
                  key: item.id,
                  label: item.name,
                  unavailable: !item.enabled,
                  detail: !item.enabled
                    ? 'Disabled — enable in its sidebar menu'
                    : prefix.kind === 'mcp'
                      ? (states.find((state) => state.id === item.id)?.status ?? 'Disconnected')
                      : item.description,
                  ...(prefix.kind === 'mcp'
                    ? { draft: `/mcp ${JSON.stringify(item.name)} ` }
                    : { command: { kind: prefix.kind, id: item.id, name: item.name } }),
                }))
            : [
                ...rootOptions.filter((option) => option.label.startsWith(draft.toLowerCase())),
                // Keep existing knowledge shortcuts, without hiding global command categories.
                ...knowledgeOptions.filter(
                  (option) =>
                    option.label.toLowerCase().startsWith(draft.toLowerCase()) &&
                    !rootOptions.some((root) => root.label === option.label),
                ),
              ];
  const activeIndex = Math.min(index, Math.max(0, options.length - 1));
  const updateDraft = (value: string) => {
    useUI.setState({ draft: value });
    setIndex(0);
    setDismissed(false);
  };
  const enableMode = (mode: ChatMode) => {
    const currentModes = useUI.getState().chatModes;
    if (!currentModes.includes(mode)) useUI.setState({ chatModes: [...currentModes, mode] });
  };
  const clearCurrent = async () => {
    const chat = useChat.getState();
    if (chat.current) {
      await window.workspace.chat.clearConversation(chat.current);
      if (useChat.getState().current === chat.current)
        useChat.setState({ messages: [], stream: '', activity: [], generating: null });
      await chat.load();
    }
    if (useChat.getState().current !== chat.current) return;
    useUI.setState({ chatCommand: null });
    updateDraft('');
  };
  const handleLocalCommand = async () => {
    const command = globalCommand(draft);
    if (command?.name === 'clear') {
      await clearCurrent();
      return true;
    }
    if (
      command ||
      draft === '/' ||
      isCode ||
      kbMatch ||
      help ||
      (prefix && !prefix.rest.trim()) ||
      (server && !server.rest.trim())
    ) {
      updateDraft(draft);
      inputRef.current?.focus();
      return true;
    }
    return false;
  };
  const choose = (option: CommandOption) => {
    if (option.unavailable || connecting || (isCode && loadingFolders)) return;
    if (option.action === 'clear') {
      void attempt(clearCurrent);
      return;
    }
    if (option.action === 'help') {
      updateDraft('/help');
      return;
    }
    if (option.action === 'connect' && server) {
      setConnecting(true);
      void attempt(async () => {
        try {
          await window.workspace.mcp.action(server!.item.id, 'start');
          await useMCPStatus.getState().load();
        } finally {
          setConnecting(false);
        }
      });
      return;
    }
    if (option.workspace || option.key === 'open-folder') {
      if (generating) return;
      setConnecting(true);
      void attempt(async () => {
        try {
          const chat = useChat.getState();
          if (option.workspace) {
            if (option.workspace.available) await chat.reconnectWorkspace(option.workspace.id);
            else await chat.relinkWorkspace(option.workspace.id);
          } else await chat.connectWorkspace();
          if (useChat.getState().workspace !== chat.workspace) {
            enableMode('code');
            updateDraft('');
          }
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
      useUI.setState({ chatCommand: option.command });
      updateDraft('');
    } else if (option.draft) updateDraft(option.draft);
    inputRef.current?.focus();
  };
  const back = () => {
    if (server) updateDraft('/mcp ');
    else if (prefix || isCode || kbMatch || help) updateDraft('/');
    else setDismissed(true);
    inputRef.current?.focus();
  };
  useEffect(() => {
    if (isMenu)
      document.getElementById(`slash-option-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, isMenu]);
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || !isMenu) return false;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      back();
      return true;
    }
    if (
      options.length &&
      ['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key) &&
      !event.metaKey &&
      !event.ctrlKey &&
      !(event.key === 'Enter' && (event.shiftKey || event.altKey))
    ) {
      event.preventDefault();
      if (event.key === 'Enter') choose(options[activeIndex]);
      else
        setIndex(
          (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length,
        );
      return true;
    }
    return false;
  };
  const resolve = () => {
    if (prefix) return resolveSlash(draft, libraries[prefix.kind], serverState?.tools);
    if (isCode || kbMatch || help || globalCommand(draft) || draft === '/')
      throw new Error('Select an option from the command list.');
    const kbOption = knowledgeOptions.find(
      (option) => draft === option.label || draft.startsWith(`${option.label} `),
    );
    if (kbOption) {
      enableMode('kb');
      useUI.setState({ chatKnowledge: kbOption.knowledge });
      return { command: undefined, query: draft.slice(kbOption.label.length).trim() };
    }
    if (draft.startsWith('/'))
      throw new Error('Unknown command. Type /help to see available commands.');
    if (selected)
      return {
        command: { kind: selected.kind, id: selected.id, tool: selected.tool },
        query:
          draft.trim() ||
          (['agent', 'workflow'].includes(selected.kind)
            ? 'Run your configured instructions.'
            : ''),
      };
    return { command: undefined, query: draft };
  };
  return {
    inputRef,
    selected,
    clear: () => useUI.setState({ chatCommand: null }),
    updateDraft,
    onKeyDown,
    resolve,
    handleLocalCommand,
    localCommand: !!globalCommand(draft) || draft === '/' || isCode || !!kbMatch,
    activeId: isMenu && options.length ? `slash-option-${activeIndex}` : undefined,
    isMenu,
    picker: isMenu ? (
      <div className="slash-picker">
        {(prefix || isCode || kbMatch || help) && (
          <button type="button" className="text-button" onClick={back}>
            ← Back
          </button>
        )}
        <div
          role="listbox"
          id="slash-options"
          aria-label={
            help
              ? 'Command help'
              : server
                ? `Tools from ${server.item.name}`
                : isCode
                  ? 'Saved folders'
                  : kbMatch
                    ? 'Knowledge sources'
                    : prefix
                      ? `Select ${prefix.kind}`
                      : 'Chat commands'
          }
        >
          {options.map((option, i) => (
            <button
              type="button"
              role="option"
              tabIndex={-1}
              id={`slash-option-${i}`}
              aria-selected={i === activeIndex}
              aria-disabled={
                option.unavailable || (isCode && (loadingFolders || connecting || !!generating))
              }
              key={option.key}
              onMouseDown={(event) => event.preventDefault()}
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
            No matching items. Add one in its sidebar menu, or finish your query and send.
          </p>
        )}
        <p className="small muted">↑ ↓ to browse · Enter to select · Esc to go back</p>
      </div>
    ) : null,
  };
}

export function ChatActivity({
  events,
  live = false,
  streaming = false,
}: {
  events: AppEvent[];
  live?: boolean;
  streaming?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const last = events.at(-1);
  const label =
    last?.status === 'Streaming' || (!last && streaming)
      ? 'Writing response'
      : last?.status === 'Running Tool'
        ? 'Running tools'
        : (last?.status ?? 'Preparing response');
  const toolDetail =
    live && /^(Running tools?|Tool completed|Tool failed)$/i.test(last?.status ?? '')
      ? last?.content?.split('\n')[0]
      : undefined;
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
      <p
        role={live ? 'status' : undefined}
        className="small muted chat-progress"
        aria-atomic="true"
      >
        <span>
          {label}
          {toolDetail ? ` · ${toolDetail}` : ''}
        </span>
        {live && (
          <span className="progress-dots" aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        )}
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
