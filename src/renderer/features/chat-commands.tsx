import { useWorkflows } from '../stores/workflows';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { AppEvent } from '../../shared/types';
import { commandKinds, resolveSlash, slashPrefix } from '../../shared/slash-commands';
import { useAgents, useMCP, useMCPStatus, useSkills, useUI, useRuns, attempt } from '../stores';

export function useChatCommands(draft: string) {
  const { items: agents } = useAgents();
  const { items: mcp } = useMCP();
  const { items: skills } = useSkills();
  const { states } = useMCPStatus();
  const workflows = useWorkflows((s) => s.items);
  const libraries = {
    agent: agents,
    mcp,
    skills,
    workflow: workflows.map((w) => ({ ...w, enabled: true })),
  };
  const selected = useUI((s) => s.chatCommand);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prefix = slashPrefix(draft);
  const isMenu = !selected && draft.startsWith('/') && !dismissed;
  const options = prefix
    ? libraries[prefix.kind]
        .filter(
          (i) =>
            i.enabled && i.name.toLowerCase().includes(prefix.rest.replace(/^"/, '').toLowerCase()),
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
    : commandKinds
        .filter((kind) => `/${kind}`.startsWith(draft))
        .map((kind) => ({
          key: kind,
          label: `/${kind}`,
          detail:
            kind === 'skills'
              ? 'Apply skill instructions'
              : kind === 'workflow'
                ? 'Run a saved workflow'
                : kind === 'agent'
                  ? 'Run a configured agent'
                  : 'Use a server’s tools',
          command: null,
        }));
  const activeIndex = Math.min(index, Math.max(0, options.length - 1));
  const updateDraft = (value: string) => {
    useUI.setState({ draft: value });
    setIndex(0);
    setDismissed(false);
  };
  const choose = (option: (typeof options)[number]) => {
    if (option.command) {
      useUI.setState({ chatCommand: option.command });
      updateDraft('');
    } else updateDraft(`${option.label} `);
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
    if (selected)
      return {
        command: { kind: selected.kind, id: selected.id },
        query:
          draft.trim() ||
          (['agent', 'workflow'].includes(selected.kind)
            ? 'Run your configured instructions.'
            : ''),
      };
    if (/^\/(mcp|agent|skills|workflow)(\s|$)/.test(draft) || draft === '/') {
      return resolveSlash(draft, prefix ? libraries[prefix.kind] : []);
    }
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
          aria-label={prefix ? `Select ${prefix.kind}` : 'Chat commands'}
        >
          {options.map((option, i) => (
            <button
              type="button"
              role="option"
              tabIndex={-1}
              id={`slash-option-${i}`}
              aria-selected={i === activeIndex}
              key={option.key}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(option)}
            >
              <strong>{option.label}</strong>
              <span>{option.detail}</span>
            </button>
          ))}
        </div>
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
