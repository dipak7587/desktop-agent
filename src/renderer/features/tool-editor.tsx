import { GroupInput } from '../components/group-input';
import { useEffect, useRef, useState } from 'react';
import { Modal, Markdown } from '../components/common';
import { librarySchema } from '../../shared/schemas';
import { errorMessage } from '../../shared/error-message';
import {
  generateToolSource,
  toolExamples,
  toolInputTypes,
  type ToolAnalysis,
  type ToolDefinition,
  type ToolInputDefinition,
  type ToolImportFormat,
} from '../../shared/tool-definition';
import type { LibraryItem } from '../../shared/types';

type InputDraft = ToolInputDefinition & { defaultText: string };
const draftInputs = (inputs: ToolInputDefinition[]): InputDraft[] =>
  inputs.map((input) => ({
    ...input,
    defaultText: input.defaultValue === undefined ? '' : JSON.stringify(input.defaultValue),
  }));

/** Native editing keeps OS copy/paste/select-all/undo/redo; existing Markdown renderer supplies TS highlighting. */
function SourceEditor({
  source,
  onChange,
  label = 'TypeScript source',
}: {
  source: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const lines = useRef<HTMLPreElement>(null);
  const highlight = useRef<HTMLDivElement>(null);
  const fence = '`'.repeat(
    Math.max(3, ...Array.from(source.matchAll(/`+/g), (match) => match[0].length + 1)),
  );
  const highlightedSource = `${fence}typescript\n${source}\n${fence}`;
  return (
    <>
      <label>
        {label}
        <div className="tool-code-editor">
          <pre ref={lines} aria-hidden="true">
            {source
              .split('\n')
              .map((_, index) => index + 1)
              .join('\n')}
          </pre>
          <div ref={highlight} className="tool-code-highlight" aria-hidden="true">
            <Markdown text={highlightedSource} />
          </div>
          <textarea
            aria-label={label}
            className="editor"
            rows={18}
            wrap="off"
            value={source}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
            onScroll={(e) => {
              if (lines.current) lines.current.scrollTop = e.currentTarget.scrollTop;
              if (highlight.current) {
                highlight.current.scrollTop = e.currentTarget.scrollTop;
                highlight.current.scrollLeft = e.currentTarget.scrollLeft;
              }
            }}
          />
        </div>
      </label>
      <details>
        <summary>Syntax-highlighted preview</summary>
        <Markdown text={highlightedSource} />
      </details>
    </>
  );
}

export function ToolEditor({
  initial,
  groups,
  onClose,
  onSave,
}: {
  initial: LibraryItem;
  groups: string[];
  onClose: () => void;
  onSave: (item: LibraryItem) => Promise<void>;
}) {
  const [mode, setMode] = useState<'builder' | 'typescript'>(
    initial.createdAt || initial.toolSource ? 'typescript' : 'builder',
  );
  const [definition, setDefinition] = useState<ToolDefinition>(toolExamples.starter);
  const [inputs, setInputs] = useState<InputDraft[]>(draftInputs(toolExamples.starter.inputs));
  const [source, setSource] = useState(
    initial.toolSource ??
      (initial.toolConfig?.type === 'langchain'
        ? initial.content
        : generateToolSource(toolExamples.starter)),
  );
  const [group, setGroup] = useState(initial.group ?? '');
  const [enabled, setEnabled] = useState(initial.enabled);
  const [analysis, setAnalysis] = useState<ToolAnalysis>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importFormat, setImportFormat] = useState<ToolImportFormat>('json');
  const [importText, setImportText] = useState('');
  const [testing, setTesting] = useState(false);
  const [testInput, setTestInput] = useState('{}');
  const [testOutput, setTestOutput] = useState('');
  const [testError, setTestError] = useState('');
  const [duration, setDuration] = useState<number>();
  const errorRef = useRef<HTMLDivElement>(null);
  const attempt = async (action: () => Promise<void>) => {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (failure) {
      const issues =
        failure && typeof failure === 'object' && 'issues' in failure ? failure.issues : undefined;
      setError(
        Array.isArray(issues)
          ? issues.map((issue) => `${issue.path.join('.') || 'Tool'}: ${issue.message}`).join('\n')
          : errorMessage(failure),
      );
      requestAnimationFrame(() => {
        errorRef.current?.focus();
        errorRef.current?.scrollIntoView({ block: 'start' });
      });
    } finally {
      setBusy(false);
    }
  };
  const adopt = (value: ToolAnalysis, builder = false) => {
    setSource(value.source);
    setAnalysis(value);
    setAdvanced(value.advanced);
    if (value.definition) {
      setDefinition(value.definition);
      setInputs(draftInputs(value.definition.inputs));
    }
    setMode(builder && value.definition ? 'builder' : 'typescript');
  };
  useEffect(() => {
    let active = true;
    if (initial.toolSource || initial.toolConfig?.type === 'langchain') {
      void window.workspace.tools
        .analyze(initial.toolSource ?? initial.content)
        .then((value) => {
          if (active) {
            setAnalysis(value);
            setAdvanced(value.advanced);
            if (value.definition) {
              setDefinition(value.definition);
              setInputs(draftInputs(value.definition.inputs));
            }
          }
        })
        .catch((failure) => {
          if (active) setError(errorMessage(failure));
        });
    } else if (initial.createdAt) {
      // Existing portable tools are converted by the main service when imported/loaded.
      setError('This legacy tool will be converted to LangChain TypeScript when edited.');
    }
    return () => {
      active = false;
    };
  }, [initial]);
  const builderValue = (): ToolDefinition => ({
    ...definition,
    inputs: inputs.map(({ defaultText, ...input }) => ({
      ...input,
      defaultValue: defaultText.trim() ? JSON.parse(defaultText) : undefined,
    })),
  });
  const currentSource = (validate = true) =>
    mode === 'builder' ? generateToolSource(builderValue(), validate) : source;
  const changeDefinition = (patch: Partial<ToolDefinition>) => {
    setDefinition((value) => ({ ...value, ...patch }));
    setAnalysis(undefined);
  };
  const changeInput = (index: number, patch: Partial<InputDraft>) => {
    setInputs((values) => values.map((input, i) => (i === index ? { ...input, ...patch } : input)));
    setAnalysis(undefined);
  };
  const validate = async () => {
    const result = await window.workspace.tools.analyze(currentSource());
    setSource(result.source);
    setAnalysis(result);
    setAdvanced(result.advanced);
    return result;
  };
  const switchMode = (next: 'builder' | 'typescript') => {
    if (next === mode) return;
    void attempt(async () => {
      if (next === 'typescript') {
        setSource(currentSource(false));
        setMode(next);
      } else {
        const value = await window.workspace.tools.analyze(source);
        adopt(value, true);
      }
    });
  };
  const importFile = () =>
    void attempt(async () => {
      const value = await window.workspace.tools.importSource();
      if (value) {
        adopt(value);
        setImporting(false);
      }
    });
  return (
    <Modal wide title={initial.createdAt ? `Edit ${initial.name}` : 'New Tool'} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void attempt(async () => {
            const value = await validate();
            const unchangedLegacy =
              initial.toolConfig?.type !== 'langchain' && initial.toolSource === value.source;
            await onSave(
              librarySchema.parse({
                ...initial,
                name: unchangedLegacy ? initial.name : value.name,
                description: unchangedLegacy ? initial.description : value.description,
                content: unchangedLegacy ? initial.content : value.source,
                toolSource: value.source,
                enabled,
                group,
                toolConfig: unchangedLegacy
                  ? initial.toolConfig
                  : {
                      type: 'langchain',
                      parameters: [],
                      inputSchema: value.inputSchema,
                      exportName: value.exportName,
                    },
              }),
            );
          });
        }}
      >
        {error && (
          <div
            ref={errorRef}
            tabIndex={-1}
            className="callout error-text"
            role="alert"
            style={{ whiteSpace: 'pre-wrap' }}
          >
            {error}
          </div>
        )}
        <nav className="actions settings-tabs" role="group" aria-label="Tool editor">
          <button
            type="button"
            disabled={busy}
            aria-pressed={mode === 'builder'}
            onClick={() => switchMode('builder')}
          >
            Builder
          </button>
          <button
            type="button"
            disabled={busy}
            aria-pressed={mode === 'typescript'}
            onClick={() => switchMode('typescript')}
          >
            TypeScript
          </button>
        </nav>
        {advanced && (
          <p className="callout" role="status">
            Advanced TypeScript mode. Your complete source is preserved. This tool cannot safely map
            back to the Builder.
          </p>
        )}
        <div className="actions">
          <button type="button" disabled={busy} onClick={importFile}>
            Import Tool
          </button>
          <button type="button" onClick={() => setImporting((value) => !value)}>
            Paste definition
          </button>
          <label>
            Example
            <select
              aria-label="Tool example"
              defaultValue=""
              onChange={(e) => {
                const example = toolExamples[e.target.value as keyof typeof toolExamples];
                if (example) {
                  setDefinition(example);
                  setInputs(draftInputs(example.inputs));
                  setSource(generateToolSource(example));
                  setAnalysis(undefined);
                  setAdvanced(false);
                  setMode('builder');
                }
              }}
            >
              <option value="">Choose an example</option>
              <option value="starter">New Tool template</option>
              <option value="calculator">Calculator</option>
              <option value="search">Search files template</option>
            </select>
          </label>
        </div>
        {importing && (
          <fieldset>
            <legend>Convert to TypeScript</legend>
            <label>
              Input format
              <select
                value={importFormat}
                onChange={(e) => setImportFormat(e.target.value as ToolImportFormat)}
              >
                <option value="typescript">TypeScript</option>
                <option value="json">JSON</option>
                <option value="yaml">YAML</option>
                <option value="markdown">Markdown</option>
              </select>
            </label>
            <label>
              Definition to import
              <textarea
                rows={10}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={
                  importFormat === 'json'
                    ? '{"name":"calculator","description":"Add numbers","input":{"a":{"type":"number","required":true},"b":{"type":"number","required":true}},"function":"return a + b;"}'
                    : importFormat === 'yaml'
                      ? 'name: get_weather\ndescription: Get weather information\ninput:\n  city:\n    type: string\n    required: true\nfunction: |\n  return { city };'
                      : importFormat === 'markdown'
                        ? '# Tool\n\nName: get_time\n\nDescription:\nReturn the current time.\n\n## Input\n\ntimezone:\n- type: string\n- required: true\n\n## Function\nreturn { timezone, value: new Date().toISOString() };'
                        : generateToolSource(toolExamples.starter)
                }
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void attempt(async () => {
                  adopt(await window.workspace.tools.convert(importText, importFormat));
                  setImporting(false);
                })
              }
            >
              Convert and preview
            </button>
          </fieldset>
        )}
        {mode === 'builder' ? (
          <>
            <label>
              Name
              <input
                value={definition.name}
                onChange={(e) => changeDefinition({ name: e.target.value })}
                placeholder="run_command"
              />
            </label>
            <label>
              Description
              <textarea
                required
                minLength={1}
                rows={2}
                value={definition.description}
                onChange={(e) => changeDefinition({ description: e.target.value })}
                placeholder="Describe when the agent should call this tool."
              />
            </label>
            <label>
              Tool Type
              <select value="langchain" onChange={() => {}}>
                <option value="langchain">LangChain</option>
              </select>
            </label>
            <fieldset>
              <legend>Input Schema</legend>
              {inputs.map((input, index) => (
                <fieldset key={index}>
                  <legend>Parameter {index + 1}</legend>
                  <div className="tool-input-grid">
                    <label>
                      Parameter Name
                      <input
                        value={input.name}
                        onChange={(e) => changeInput(index, { name: e.target.value })}
                        placeholder="command"
                      />
                    </label>
                    <label>
                      Type
                      <select
                        value={input.type}
                        onChange={(e) =>
                          changeInput(index, { type: e.target.value as InputDraft['type'] })
                        }
                      >
                        {toolInputTypes.map((type) => (
                          <option key={type} value={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Description
                      <input
                        value={input.description ?? ''}
                        onChange={(e) => changeInput(index, { description: e.target.value })}
                      />
                    </label>
                    <label>
                      Default value · JSON
                      <input
                        value={input.defaultText}
                        onChange={(e) => changeInput(index, { defaultText: e.target.value })}
                        placeholder={'"example", 20, true, [] or {}'}
                      />
                    </label>
                    {input.type === 'enum' && (
                      <label>
                        Enum values · one per line
                        <textarea
                          rows={3}
                          value={input.enumValues?.join('\n') ?? ''}
                          onChange={(e) =>
                            changeInput(index, {
                              enumValues: e.target.value.split('\n').filter(Boolean),
                            })
                          }
                          placeholder={'add\nsubtract'}
                        />
                      </label>
                    )}
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={input.required}
                        onChange={(e) => changeInput(index, { required: e.target.checked })}
                      />
                      Required
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setInputs((values) => values.filter((_, i) => i !== index));
                        setAnalysis(undefined);
                      }}
                    >
                      Remove input
                    </button>
                  </div>
                </fieldset>
              ))}
              <button
                type="button"
                onClick={() => {
                  setInputs((values) => [
                    ...values,
                    {
                      name: `parameter_${values.length + 1}`,
                      type: 'string',
                      required: true,
                      defaultText: '',
                    },
                  ]);
                  setAnalysis(undefined);
                }}
              >
                + Add Input
              </button>
            </fieldset>
            <p className="small muted">
              Function Logic is an async function body. Input names are available as variables;
              return the result.
            </p>
            <SourceEditor
              label="Function Logic"
              source={definition.functionBody}
              onChange={(value) => changeDefinition({ functionBody: value })}
            />
          </>
        ) : (
          <SourceEditor
            source={source}
            onChange={(value) => {
              setSource(value);
              setAnalysis(undefined);
            }}
          />
        )}
        <GroupInput value={group} onChange={setGroup} groups={groups} />
        <label className="check">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enabled
        </label>
        {analysis && (
          <div className="callout" role="status">
            {analysis.checks.map((check) => (
              <div key={check}>✓ {check}</div>
            ))}
          </div>
        )}
        <div className="actions">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void attempt(async () => {
                const formatted = await window.workspace.tools.format(currentSource(false));
                setSource(formatted);
                setMode('typescript');
                setAnalysis(undefined);
              })
            }
          >
            Format TypeScript
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void attempt(async () => {
                await validate();
              })
            }
          >
            Validate
          </button>
          <button type="button" disabled={busy} onClick={() => setTesting((value) => !value)}>
            Test Tool
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void attempt(async () => {
                await window.workspace.clipboard.writeText(currentSource(false));
              })
            }
          >
            Copy TypeScript
          </button>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? 'Working…' : 'Save Tool'}
          </button>
        </div>
        {testing && (
          <fieldset>
            <legend>Test Tool</legend>
            <label>
              Test input · JSON
              <textarea
                rows={5}
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder={'{"a":10,"b":5,"operation":"multiply"}'}
              />
            </label>
            <p className="small muted">
              Running a test executes this tool on your machine. Validation and previews do not run
              code.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void attempt(async () => {
                  setTestError('');
                  setTestOutput('');
                  setDuration(undefined);
                  const started = performance.now();
                  try {
                    const value = await validate();
                    setTestOutput(
                      await window.workspace.tools.runSource(value.source, JSON.parse(testInput)),
                    );
                  } catch (failure) {
                    setTestError(errorMessage(failure));
                  } finally {
                    setDuration(Math.round(performance.now() - started));
                  }
                })
              }
            >
              {busy ? 'Running…' : 'Run test'}
            </button>
            <p role="status">
              Execution status:{' '}
              {busy
                ? 'Running'
                : testError
                  ? 'Failed'
                  : duration !== undefined
                    ? 'Completed'
                    : 'Ready'}
              {duration !== undefined ? ` · ${duration} ms` : ''}
            </p>
            {testOutput && <pre className="log">{testOutput}</pre>}
            {testError && (
              <p className="error-text" role="alert">
                {testError}
              </p>
            )}
          </fieldset>
        )}
      </form>
    </Modal>
  );
}
