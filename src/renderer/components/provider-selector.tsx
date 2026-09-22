import { useSettings, useUI, attempt } from '../stores';
export function ProviderSelector({
  providerId,
  model,
  onChange,
}: {
  providerId: string;
  model: string;
  onChange: (providerId: string, model: string) => void;
}) {
  const { settings, load } = useSettings();
  const enabled = settings?.providers.filter((p) => p.enabled !== false) ?? [];
  const selected = enabled.find((p) => p.id === providerId);
  if (!enabled.length)
    return (
      <div role="status">
        No enabled providers.{' '}
        <button type="button" onClick={() => useUI.setState({ section: 'Settings' })}>
          Set up AI Providers
        </button>
      </div>
    );
  return (
    <div className="provider-selector">
      {enabled.length > 1 && (
        <label>
          Provider
          <select
            aria-label="Provider"
            value={selected?.id ?? ''}
            onChange={(e) => {
              const p = enabled.find((p) => p.id === e.target.value)!;
              onChange(p.id, p.modelIds?.includes(p.chatModel) ? p.chatModel : '');
            }}
          >
            <option value="" disabled>
              Select provider
            </option>
            {enabled.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!selected && enabled.length === 1 && (
        <button type="button" onClick={() => onChange(enabled[0].id, enabled[0].chatModel)}>
          Use {enabled[0].name}
        </button>
      )}
      <label>
        Model
        <select
          aria-label="Model"
          value={selected?.modelIds?.includes(model) ? model : ''}
          disabled={!selected}
          onChange={(e) => onChange(providerId, e.target.value)}
        >
          <option value="">Select model</option>
          {selected?.modelIds?.map((id) => (
            <option key={id}>{id}</option>
          ))}
        </select>
      </label>
      {selected && !selected.modelIds?.length && <span role="status">No models available.</span>}
      {selected && !selected.modelIds?.length && (
        <button
          type="button"
          onClick={() =>
            void attempt(async () => {
              await window.workspace.models.list(selected.id);
              await load();
            })
          }
        >
          Refresh
        </button>
      )}
      {selected && !selected.modelIds?.length && (
        <button type="button" onClick={() => useUI.setState({ section: 'Settings' })}>
          Add model in AI Providers
        </button>
      )}
    </div>
  );
}
