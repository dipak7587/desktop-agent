import type { WorkflowFormat } from '../../shared/workflow-formats';

export function WorkflowEditorTabs({
  selected,
  onSelect,
}: {
  selected: 'default' | WorkflowFormat;
  onSelect(tab: 'default' | WorkflowFormat): void;
}) {
  return (
    <div
      className="workflow-editor-tabs"
      role="tablist"
      aria-label="Workflow editor"
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const tabs = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
        );
        const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        event.preventDefault();
        tabs[next].focus();
        tabs[next].click();
      }}
    >
      <button
        type="button"
        role="tab"
        id="workflow-tab-default"
        aria-controls="workflow-panel-default"
        aria-selected={selected === 'default'}
        tabIndex={selected === 'default' ? 0 : -1}
        onClick={() => onSelect('default')}
      >
        Default
      </button>
      <fieldset className="workflow-dynamic-tabs">
        <legend>Dynamic</legend>
        <div className="actions">
          {(['form', 'md', 'json', 'yaml'] as const).map((key) => (
            <button
              type="button"
              role="tab"
              id={`workflow-tab-${key}`}
              aria-controls="workflow-panel-dynamic"
              aria-selected={selected === key}
              tabIndex={selected === key ? 0 : -1}
              key={key}
              onClick={() => onSelect(key)}
            >
              {key === 'form' ? 'Form' : key === 'md' ? 'Markdown' : key.toUpperCase()}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
