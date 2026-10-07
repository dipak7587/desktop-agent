import { useRef, useState } from 'react';
import type { AgentWorkflow } from '../../shared/workflows';
import { validateWorkflow } from '../../shared/workflows';
import {
  hookNames,
  type DeclarativeWorkflow,
  type WorkflowStep,
} from '../../shared/declarative-workflows';
import {
  parseWorkflow,
  serializeWorkflow,
  type WorkflowFormat,
} from '../../shared/workflow-formats';
import { Modal } from '../components/common';
import { useWorkflows } from '../stores/workflows';

function JsonField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange(value: unknown): void;
}) {
  const [previous, setPrevious] = useState(value);
  const [text, setText] = useState(JSON.stringify(value === undefined ? {} : value, null, 2));
  if (previous !== value) {
    setPrevious(value);
    try {
      if (JSON.stringify(JSON.parse(text)) !== JSON.stringify(value === undefined ? {} : value))
        setText(JSON.stringify(value === undefined ? {} : value, null, 2));
    } catch {
      setText(JSON.stringify(value === undefined ? {} : value, null, 2));
    }
  }
  return (
    <label>
      {label}
      <textarea
        name={label}
        rows={4}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            e.target.setCustomValidity('');
          } catch {
            e.target.setCustomValidity(`${label} must be valid JSON`);
          }
        }}
      />
    </label>
  );
}
const newStep = (type: WorkflowStep['type'] = 'agent'): WorkflowStep => ({
  id: `step_${crypto.randomUUID().slice(0, 8)}`,
  type,
  ...(type === 'agent' ? { agent: '{{workflow.config.defaultAgent}}', input: {} } : {}),
  ...(type === 'tool' ? { tool: '', input: {} } : {}),
  ...(['sequence', 'parallel', 'loop', 'repeat'].includes(type) ? { steps: [] } : {}),
  ...(type === 'loop' ? { over: '{{input.items}}', as: 'item', mode: 'sequential' } : {}),
  ...(type === 'condition' ? { if: '{{input.enabled == true}}', then: [], else: [] } : {}),
  ...(type === 'switch' ? { value: '{{input.kind}}', cases: { default: [] } } : {}),
  ...(type === 'repeat'
    ? { until: '{{steps.check.output.passed == true}}', maxIterations: 5 }
    : {}),
});
function Hooks({
  value,
  onChange,
  depth,
}: {
  value: WorkflowStep['hooks'];
  onChange(value: WorkflowStep['hooks']): void;
  depth: number;
}) {
  const [name, setName] = useState<(typeof hookNames)[number]>('before');
  return (
    <details>
      <summary>Hooks</summary>
      {Object.entries(value === undefined ? {} : value).map(([key, steps]) => (
        <fieldset key={key}>
          <legend>{key}</legend>
          <Steps
            value={steps}
            onChange={(items) => onChange({ ...value, [key]: items })}
            depth={depth + 1}
          />
          <button
            type="button"
            onClick={() => {
              const next = { ...value };
              delete next[key as typeof name];
              onChange(next);
            }}
          >
            Remove {key} hook
          </button>
        </fieldset>
      ))}
      <label>
        Hook event
        <select
          name="hook-event"
          value={name}
          onChange={(e) => setName(e.target.value as typeof name)}
        >
          {hookNames.map((key) => (
            <option key={key}>{key}</option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => onChange({ ...value, [name]: value?.[name] ?? [] })}>
        Add hook
      </button>
    </details>
  );
}
function Steps({
  value,
  onChange,
  depth = 1,
}: {
  value: WorkflowStep[];
  onChange(value: WorkflowStep[]): void;
  depth?: number;
}) {
  if (depth > 20)
    return <p role="alert">Maximum editor nesting reached. Reduce nesting in source mode.</p>;
  const patch = (index: number, update: Partial<WorkflowStep>) =>
    onChange(value.map((step, i) => (i === index ? { ...step, ...update } : step)));
  return (
    <div>
      {value.map((step, i) => (
        <fieldset key={i} className="workflow-node-editor">
          <legend>
            Step {i + 1}: {step.type}
          </legend>
          <div className="actions">
            <button
              type="button"
              disabled={i === 0}
              onClick={() => {
                const next = [...value];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                onChange(next);
              }}
            >
              Move up
            </button>
            <button
              type="button"
              disabled={i === value.length - 1}
              onClick={() => {
                const next = [...value];
                [next[i + 1], next[i]] = [next[i], next[i + 1]];
                onChange(next);
              }}
            >
              Move down
            </button>
            <button type="button" onClick={() => onChange(value.filter((_, index) => index !== i))}>
              Remove step
            </button>
          </div>
          <label>
            Step ID
            <input
              name={`step-id-${i}`}
              value={step.id ?? ''}
              onChange={(e) => patch(i, { id: e.target.value || undefined })}
            />
          </label>
          <label>
            Step type
            <select
              name={`step-type-${i}`}
              value={step.type}
              onChange={(e) =>
                onChange(
                  value.map((item, index) =>
                    index === i
                      ? { ...newStep(e.target.value as WorkflowStep['type']), id: item.id }
                      : item,
                  ),
                )
              }
            >
              {[
                'agent',
                'tool',
                'sequence',
                'parallel',
                'loop',
                'condition',
                'switch',
                'repeat',
              ].map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </label>
          {(step.type === 'agent' || step.type === 'tool') && (
            <>
              <label>
                {step.type === 'agent'
                  ? 'Agent ID or expression'
                  : 'Permission agent (optional with defaultAgent)'}
                <input
                  name={`step-agent-${i}`}
                  required={step.type === 'agent'}
                  value={step.agent ?? ''}
                  onChange={(e) => patch(i, { agent: e.target.value || undefined })}
                />
              </label>
              {step.type === 'tool' && (
                <label>
                  Tool ID or expression
                  <input
                    name={`step-tool-${i}`}
                    required
                    value={step.tool ?? ''}
                    onChange={(e) => patch(i, { tool: e.target.value })}
                  />
                </label>
              )}
              <JsonField
                key={`${step.type}-${i}-input`}
                label="Step input (JSON values and expressions)"
                value={step.input}
                onChange={(input) => patch(i, { input })}
              />
            </>
          )}
          {step.type === 'loop' && (
            <>
              <label>
                Loop over
                <input
                  name={`over-${i}`}
                  value={typeof step.over === 'string' ? step.over : JSON.stringify(step.over)}
                  onChange={(e) => {
                    let over: unknown = e.target.value;
                    try {
                      over = JSON.parse(e.target.value);
                    } catch {
                      /* Expression */
                    }
                    patch(i, { over });
                  }}
                />
              </label>
              <label>
                Item variable
                <input
                  name={`as-${i}`}
                  required
                  value={step.as ?? ''}
                  onChange={(e) => patch(i, { as: e.target.value })}
                />
              </label>
              <label>
                Loop mode
                <select
                  name={`mode-${i}`}
                  value={step.mode ?? 'sequential'}
                  onChange={(e) => patch(i, { mode: e.target.value as 'sequential' | 'parallel' })}
                >
                  <option>sequential</option>
                  <option>parallel</option>
                </select>
              </label>
            </>
          )}
          {(step.type === 'parallel' || step.type === 'loop') && (
            <label>
              Maximum concurrency
              <input
                name={`concurrency-${i}`}
                type="number"
                min={1}
                max={32}
                value={step.maxConcurrency ?? 4}
                onChange={(e) => patch(i, { maxConcurrency: Number(e.target.value) })}
              />
            </label>
          )}
          {step.type === 'condition' && (
            <>
              <label>
                Condition expression
                <input
                  name={`condition-${i}`}
                  value={typeof step.if === 'boolean' ? `{{${step.if}}}` : String(step.if ?? '')}
                  onChange={(e) => patch(i, { if: e.target.value })}
                />
              </label>
              <fieldset>
                <legend>Then</legend>
                <Steps
                  value={step.then ?? []}
                  onChange={(then) => patch(i, { then })}
                  depth={depth + 1}
                />
              </fieldset>
              <fieldset>
                <legend>Else</legend>
                <Steps
                  value={step.else ?? []}
                  onChange={(other) => patch(i, { else: other })}
                  depth={depth + 1}
                />
              </fieldset>
            </>
          )}
          {step.type === 'switch' && (
            <>
              <label>
                Switch value
                <input
                  name={`switch-${i}`}
                  value={String(step.value ?? '')}
                  onChange={(e) => patch(i, { value: e.target.value })}
                />
              </label>
              <JsonField
                label="Switch cases (step arrays by case name)"
                value={step.cases}
                onChange={(cases) => patch(i, { cases: cases as WorkflowStep['cases'] })}
              />
            </>
          )}
          {step.type === 'repeat' && (
            <>
              <label>
                Until expression
                <input
                  name={`until-${i}`}
                  value={
                    typeof step.until === 'boolean' ? `{{${step.until}}}` : String(step.until ?? '')
                  }
                  onChange={(e) => patch(i, { until: e.target.value })}
                />
              </label>
              <label>
                Maximum repeat iterations
                <input
                  name={`repeat-${i}`}
                  type="number"
                  min={1}
                  max={100}
                  value={step.maxIterations ?? 5}
                  onChange={(e) => patch(i, { maxIterations: Number(e.target.value) })}
                />
              </label>
            </>
          )}
          {step.steps && (
            <fieldset>
              <legend>Nested steps</legend>
              <Steps
                value={step.steps}
                onChange={(steps) => patch(i, { steps })}
                depth={depth + 1}
              />
            </fieldset>
          )}
          <details>
            <summary>Retry</summary>
            <label>
              Maximum attempts
              <input
                name={`attempts-${i}`}
                type="number"
                min={1}
                max={10}
                value={step.retry?.maxAttempts ?? 1}
                onChange={(e) =>
                  patch(i, { retry: { ...step.retry, maxAttempts: Number(e.target.value) } })
                }
              />
            </label>
            <label>
              Retry delay (milliseconds)
              <input
                name={`delay-${i}`}
                type="number"
                min={0}
                max={60000}
                value={step.retry?.delayMs ?? 0}
                onChange={(e) =>
                  patch(i, {
                    retry: {
                      maxAttempts: step.retry?.maxAttempts ?? 1,
                      ...step.retry,
                      delayMs: Number(e.target.value),
                    },
                  })
                }
              />
            </label>
            <label>
              Retry error types (comma separated, empty for all)
              <input
                name={`retry-on-${i}`}
                value={step.retry?.on?.join(', ') ?? ''}
                onChange={(e) =>
                  patch(i, {
                    retry: {
                      ...step.retry,
                      maxAttempts: step.retry?.maxAttempts ?? 1,
                      on: e.target.value.trim()
                        ? e.target.value.split(',').map((item) => item.trim())
                        : undefined,
                    },
                  })
                }
              />
            </label>
          </details>
          <Hooks value={step.hooks} onChange={(hooks) => patch(i, { hooks })} depth={depth} />
        </fieldset>
      ))}
      <button type="button" onClick={() => onChange([...value, newStep()])}>
        Add step
      </button>
    </div>
  );
}

export function DeclarativeWorkflowEditor({
  initial,
  onClose,
  onChangeType,
}: {
  initial: AgentWorkflow;
  onClose(): void;
  onChangeType?: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [workflow, setWorkflow] = useState(initial);
  const [format, setFormat] = useState<WorkflowFormat>('form');
  const [source, setSource] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const definition = workflow.definition!;
  const patch = (update: Partial<DeclarativeWorkflow>) =>
    setWorkflow((value) => ({ ...value, definition: { ...value.definition!, ...update } }));
  const current = () =>
    format === 'form'
      ? validateWorkflow({
          ...workflow,
          name: definition.name,
          description: definition.description ?? '',
        })
      : parseWorkflow(source, format, workflow);
  const changeFormat = (next: WorkflowFormat) => {
    if (
      format === 'form' &&
      Array.from(formRef.current?.querySelectorAll('textarea') ?? []).some(
        (field) => !field.reportValidity(),
      )
    )
      return;
    try {
      const value =
        format === 'form'
          ? { ...workflow, name: definition.name, description: definition.description ?? '' }
          : parseWorkflow(source, format, workflow);
      if (!value.definition)
        throw new Error('Use a declarative document with steps in this editor.');
      setWorkflow(value);
      setSource(next === 'form' ? '' : serializeWorkflow(value, next));
      setFormat(next);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal title={initial.name ? 'Edit workflow' : 'New workflow'} wide onClose={onClose}>
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          void (async () => {
            try {
              await window.workspace.workflows.save(current());
              await useWorkflows.getState().load();
              onClose();
            } catch (error) {
              setError((error as Error).message);
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        {onChangeType && (
          <label>
            Workflow type
            <select name="workflowType" value="dynamic" onChange={onChangeType}>
              <option value="dynamic">Dynamic</option>
              <option value="default">Default (agent graph)</option>
            </select>
          </label>
        )}
        <fieldset className="workflow-type-group">
          <legend>Dynamic</legend>
          <div className="actions" role="group" aria-label="Workflow format">
            {(['form', 'md', 'json', 'yaml'] as const).map((key) => (
              <button
                type="button"
                aria-pressed={format === key}
                key={key}
                onClick={() => changeFormat(key)}
              >
                {key === 'form' ? 'Form' : key === 'md' ? 'Markdown' : key.toUpperCase()}
              </button>
            ))}
          </div>
          <label>
            Import workflow file
            <input
              name="workflow-file"
              type="file"
              accept=".md,.json,.yaml,.yml"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                void (async () => {
                  try {
                    const ext = file.name.split('.').at(-1);
                    const value = parseWorkflow(
                      await file.text(),
                      ext === 'json' ? 'json' : ext === 'md' ? 'md' : 'yaml',
                      workflow,
                    );
                    if (!value.definition)
                      throw new Error('Import a declarative workflow with steps.');
                    setWorkflow(value);
                    setFormat('form');
                    setSource('');
                    setError('');
                  } catch (error) {
                    setError((error as Error).message);
                  }
                })();
              }}
            />
          </label>
          {format !== 'form' ? (
            <label>
              Workflow source ({format})
              <textarea
                name="workflow-source"
                rows={24}
                spellCheck={false}
                value={source}
                onChange={(e) => {
                  setSource(e.target.value);
                  setError('');
                }}
              />
            </label>
          ) : (
            <div key={JSON.stringify([workflow.id, source])}>
              <label>
                Name (required)
                <input
                  name="name"
                  required
                  maxLength={200}
                  value={definition.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </label>
              <label>
                Description
                <textarea
                  name="description"
                  value={definition.description ?? ''}
                  onChange={(e) => patch({ description: e.target.value })}
                />
              </label>
              <JsonField
                label="Input definitions"
                value={definition.inputs}
                onChange={(inputs) => patch({ inputs: inputs as DeclarativeWorkflow['inputs'] })}
              />
              <JsonField
                label="Agent aliases"
                value={definition.agents}
                onChange={(agents) => patch({ agents: agents as DeclarativeWorkflow['agents'] })}
              />
              <JsonField
                label="Tool aliases"
                value={definition.tools}
                onChange={(tools) => patch({ tools: tools as DeclarativeWorkflow['tools'] })}
              />
              <JsonField
                label="Workflow config (including defaultAgent)"
                value={definition.config}
                onChange={(config) => patch({ config: config as DeclarativeWorkflow['config'] })}
              />
              <label>
                Maximum total step executions
                <input
                  name="maxIterations"
                  type="number"
                  min={1}
                  max={100}
                  value={workflow.maxIterations}
                  onChange={(e) =>
                    setWorkflow({ ...workflow, maxIterations: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Maximum nesting depth
                <input
                  name="maxDepth"
                  type="number"
                  min={1}
                  max={100}
                  value={workflow.maxDepth}
                  onChange={(e) => setWorkflow({ ...workflow, maxDepth: Number(e.target.value) })}
                />
              </label>
              <Hooks value={definition.hooks} onChange={(hooks) => patch({ hooks })} depth={0} />
              <Steps value={definition.steps} onChange={(steps) => patch({ steps })} />
            </div>
          )}
        </fieldset>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="actions">
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save workflow'}
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                current();
                setError('');
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Validate
          </button>
          {(['md', 'json', 'yaml'] as const).map((kind) => (
            <button
              type="button"
              key={kind}
              onClick={() => {
                try {
                  if (!formRef.current?.reportValidity()) return;
                  const value = current();
                  const url = URL.createObjectURL(
                    new Blob([serializeWorkflow(value, kind)], { type: 'text/plain' }),
                  );
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `${value.id}.${kind}`;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Export {kind.toUpperCase()}
            </button>
          ))}
        </div>
      </form>
    </Modal>
  );
}
