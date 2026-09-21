import { capabilityConfig } from '../../shared/capabilities';
import type { AgentCapabilityConfig, LibraryItem } from '../../shared/types';

export function CapabilitySettings({
  item,
  onChange,
  skills,
  tools,
  servers,
  knowledge,
}: {
  item: LibraryItem;
  onChange: (config: AgentCapabilityConfig) => void;
  skills: { id: string; name: string }[];
  tools: { id: string; name: string }[];
  servers: { id: string; name: string }[];
  knowledge: { id: string; name: string }[];
}) {
  const config = capabilityConfig(item);
  const update = (patch: Partial<AgentCapabilityConfig>) => onChange({ ...config, ...patch });
  const groups = [
    { title: 'Skills', key: 'skills', flag: 'allowSkills', options: skills },
    { title: 'MCP servers', key: 'mcpServers', flag: 'allowMCP', options: servers },
    {
      title: 'Tools',
      key: 'tools',
      flag: 'allowTools',
      options: tools.filter((t) => !t.id.startsWith('mcp:')),
    },
    {
      title: 'Individual MCP tools',
      key: 'tools',
      flag: 'allowMCP',
      options: tools.filter((t) => t.id.startsWith('mcp:')),
    },
    {
      title: 'Knowledge sources',
      key: 'knowledgeBases',
      flag: 'allowKnowledgeBase',
      options: knowledge,
    },
  ] as const;
  const permissions = groups.flatMap((group) =>
    config.mode === 'none' || !config[group.flag]
      ? []
      : group.options
          .filter((option) => config.mode === 'auto' || config[group.key].includes(option.id))
          .map((option) => ({
            ...option,
            id:
              group.key === 'skills'
                ? `skill:${option.id}`
                : group.key === 'mcpServers'
                  ? `mcp:${option.id}`
                  : group.key === 'knowledgeBases'
                    ? `knowledge:${option.id}`
                    : option.id,
          })),
  );
  return (
    <fieldset>
      <legend>Agent Capabilities</legend>
      <fieldset>
        <legend>Capability mode</legend>
        {(['auto', 'selected', 'none'] as const).map((mode) => (
          <label className="check" key={mode}>
            <input
              type="radio"
              name="capability-mode"
              value={mode}
              checked={config.mode === mode}
              onChange={() => update({ mode })}
            />
            {mode === 'auto' ? 'Auto' : mode === 'selected' ? 'Selected' : 'None'}
          </label>
        ))}
      </fieldset>
      <p className="small muted">
        Auto considers all enabled capabilities. Selected considers only your choices. None answers
        without capabilities. Selection never triggers execution.
      </p>
      {groups.map((group) => (
        <fieldset key={group.title} disabled={config.mode === 'none'}>
          <legend>{group.title}</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={config[group.flag]}
              onChange={(e) => update({ [group.flag]: e.target.checked })}
            />
            Allow {group.title}
          </label>
          <div className="check-grid">
            {group.options.map((option) => (
              <label className="check" key={option.id}>
                <input
                  type="checkbox"
                  disabled={config.mode !== 'selected' || !config[group.flag]}
                  checked={config[group.key].includes(option.id)}
                  onChange={(e) =>
                    update({
                      [group.key]: e.target.checked
                        ? [...config[group.key], option.id]
                        : config[group.key].filter((id) => id !== option.id),
                    })
                  }
                />
                {option.name}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <details>
        <summary>Capability permissions</summary>
        <p className="small muted">
          Defaults: MCP and custom tools ask; local tools follow Settings and show change previews.
          Always allow skips approval for that capability. Deny always blocks it.
        </p>
        {!permissions.length && (
          <p className="small muted">
            {config.mode === 'none'
              ? 'Capabilities are disabled in None mode.'
              : 'Select a capability to configure its permission.'}
          </p>
        )}
        {permissions.map((option) => (
          <label key={option.id}>
            Permission: {option.name}
            <select
              aria-label={`Permission: ${option.name}`}
              value={config.permissions[option.id] ?? ''}
              onChange={(e) => {
                const next = { ...config.permissions };
                if (e.target.value)
                  next[option.id] = e.target.value as 'ask' | 'deny' | 'always_allow';
                else delete next[option.id];
                update({ permissions: next });
              }}
            >
              <option value="">Default</option>
              <option value="always_allow">Always allow</option>
              <option value="ask">Ask</option>
              <option value="deny">Deny</option>
            </select>
          </label>
        ))}
      </details>
      <label className="check">
        <input
          type="checkbox"
          checked={config.trace}
          onChange={(e) => update({ trace: e.target.checked })}
        />
        Show capability decisions in history and Chat
      </label>
    </fieldset>
  );
}
