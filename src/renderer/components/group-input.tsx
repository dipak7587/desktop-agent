import { useState } from 'react';

export function GroupInput({
  value,
  onChange,
  groups,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  groups: string[];
  disabled?: boolean;
}) {
  const [addingNewGroup, setAddingNewGroup] = useState(false);
  return (
    <>
      <label>
        Group
        <select
          aria-label="Group"
          value={addingNewGroup ? '__new_group__' : value}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value;
            setAddingNewGroup(next === '__new_group__');
            onChange(next === '__new_group__' ? '' : next);
          }}
        >
          <option value="">Ungrouped</option>
          {groups.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          <option value="__new_group__">Add new group…</option>
        </select>
      </label>
      {addingNewGroup && (
        <label>
          New group name
          <input
            autoFocus
            value={value}
            onChange={(event) => onChange(event.target.value)}
            maxLength={100}
            placeholder="e.g. Video Studio"
            disabled={disabled}
          />
        </label>
      )}
    </>
  );
}
