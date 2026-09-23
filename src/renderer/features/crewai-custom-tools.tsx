import { useState } from 'react';
import {
  newCrewCustomTool,
  validateCustomInput,
  type CrewProject,
  type CrewCustomTool,
} from '../../shared/crewai';

export function CrewCustomTools({
  project,
  onChange,
  onTest,
  busy,
}: {
  project: CrewProject;
  onChange: (patch: Partial<CrewProject>) => void;
  onTest: (tool: CrewCustomTool, args: Record<string, unknown>) => Promise<void>;
  busy: boolean;
}) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const update = (id: string, patch: Partial<CrewCustomTool>) =>
    onChange({
      customTools: project.customTools.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    });
  return (
    <section className="crew-custom-tools">
      <h2>Custom Python tools</h2>
      <p>
        Define a synchronous <code>run(input)</code> function that returns a JSON value. Each call
        requires approval. Code runs with your user permissions; the selected folder is not a
        sandbox. Dependencies must already be installed in your configured Python environment.
      </p>
      <button
        disabled={busy || project.customTools.length >= 30}
        onClick={() => {
          const tool = newCrewCustomTool();
          let suffix = 2;
          while (project.customTools.some((t) => t.name === tool.name))
            tool.name = `count_words_${suffix++}`;
          onChange({ customTools: [...project.customTools, tool] });
        }}
      >
        Create custom tool
      </button>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {project.customTools.map((tool) => (
        <fieldset className="crew-editor-card" key={tool.id}>
          <legend>{tool.name || 'Custom tool'}</legend>
          <label>
            Tool name
            <input value={tool.name} onChange={(e) => update(tool.id, { name: e.target.value })} />
          </label>
          <label>
            Tool description
            <textarea
              value={tool.description}
              onChange={(e) => update(tool.id, { description: e.target.value })}
            />
          </label>
          <fieldset>
            <legend>Input fields</legend>
            {tool.inputs.map((field, index) => (
              <div className="crew-input-field" key={index}>
                <label>
                  Input name
                  <input
                    value={field.name}
                    onChange={(e) =>
                      update(tool.id, {
                        inputs: tool.inputs.map((f, i) =>
                          i === index ? { ...f, name: e.target.value } : f,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Input type
                  <select
                    value={field.type}
                    onChange={(e) =>
                      update(tool.id, {
                        inputs: tool.inputs.map((f, i) =>
                          i === index ? { ...f, type: e.target.value as typeof field.type } : f,
                        ),
                      })
                    }
                  >
                    {(['string', 'number', 'boolean', 'object', 'array'] as const).map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Input description
                  <input
                    value={field.description}
                    onChange={(e) =>
                      update(tool.id, {
                        inputs: tool.inputs.map((f, i) =>
                          i === index ? { ...f, description: e.target.value } : f,
                        ),
                      })
                    }
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) =>
                      update(tool.id, {
                        inputs: tool.inputs.map((f, i) =>
                          i === index ? { ...f, required: e.target.checked } : f,
                        ),
                      })
                    }
                  />
                  Required
                </label>
                <button
                  onClick={() =>
                    update(tool.id, { inputs: tool.inputs.filter((_, i) => i !== index) })
                  }
                >
                  Remove input
                </button>
              </div>
            ))}
            <button
              disabled={tool.inputs.length >= 30}
              onClick={() =>
                update(tool.id, {
                  inputs: [
                    ...tool.inputs,
                    { name: '', type: 'string', description: '', required: true },
                  ],
                })
              }
            >
              Add input
            </button>
          </fieldset>
          <label>
            Python implementation
            <textarea
              className="crew-code"
              rows={9}
              spellCheck={false}
              value={tool.code}
              onChange={(e) => update(tool.id, { code: e.target.value })}
            />
          </label>
          <label>
            Timeout (seconds)
            <input
              type="number"
              min={1}
              max={120}
              value={tool.timeoutSeconds}
              onChange={(e) => update(tool.id, { timeoutSeconds: Number(e.target.value) })}
            />
          </label>
          <fieldset>
            <legend>Available to</legend>
            {project.agents.map((agent) => (
              <label className="check" key={agent.id}>
                <input
                  type="checkbox"
                  checked={agent.tools.includes(`custom.${tool.id}`)}
                  onChange={(e) =>
                    onChange({
                      agents: project.agents.map((a) =>
                        a.id === agent.id
                          ? {
                              ...a,
                              tools: e.target.checked
                                ? [...a.tools, `custom.${tool.id}`]
                                : a.tools.filter((id) => id !== `custom.${tool.id}`),
                            }
                          : a,
                      ),
                    })
                  }
                />
                {agent.name}
              </label>
            ))}
          </fieldset>
          <label>
            Test input (JSON)
            <textarea
              rows={3}
              spellCheck={false}
              value={inputs[tool.id] ?? '{"text":"Hello from my crew"}'}
              onChange={(e) => setInputs({ ...inputs, [tool.id]: e.target.value })}
            />
          </label>
          <p className="small muted">
            Save and request a test, then review and approve its code in Runs. No model is used.
          </p>
          <div className="actions">
            <button
              disabled={busy}
              onClick={async () => {
                setError('');
                try {
                  const args = validateCustomInput(
                    tool,
                    JSON.parse(inputs[tool.id] ?? '{"text":"Hello from my crew"}'),
                  );
                  await onTest(tool, args);
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              Save and test tool
            </button>
            <button
              disabled={project.agents.some((a) => a.tools.includes(`custom.${tool.id}`))}
              onClick={() =>
                onChange({ customTools: project.customTools.filter((t) => t.id !== tool.id) })
              }
            >
              Remove custom tool
            </button>
          </div>
          {project.agents.some((a) => a.tools.includes(`custom.${tool.id}`)) && (
            <p className="small muted">Unassign this tool from all agents before removing it.</p>
          )}
        </fieldset>
      ))}
    </section>
  );
}
