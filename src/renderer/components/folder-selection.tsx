import { useState } from 'react';
import { attempt } from '../stores';
export function FolderSelection({
  value,
  onChange,
  controlsOnly = false,
}: {
  controlsOnly?: boolean;
  value: string;
  onChange: (path: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const controls = (
    <div className="actions" role="group" aria-label="Project folder controls">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void attempt(async () => {
            try {
              const path = await window.workspace.agents.project();
              if (path) onChange(path);
            } finally {
              setBusy(false);
            }
          });
        }}
      >
        {busy ? 'Selecting…' : value ? 'Change Folder' : 'Select Folder'}
      </button>
      {value && (
        <button type="button" disabled={busy} onClick={() => onChange('')}>
          Remove Folder
        </button>
      )}
    </div>
  );
  if (controlsOnly) return controls;
  return (
    <fieldset className="folder-selection">
      <legend>Project folder (optional)</legend>
      <p className="folder-path">{value || 'No folder selected'}</p>
      {controls}
    </fieldset>
  );
}
