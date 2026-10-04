import { useState } from 'react';
import {
  Plus,
  BookOpen,
  Search,
  File,
  Folder,
  Globe,
  RefreshCw,
  Square,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useKnowledge, attempt } from '../stores';
import type { KnowledgeSource, SearchResult } from '../../shared/types';
import { BUILT_IN_GROUP } from '../../shared/types';
import { PageHeader, Empty, Modal, Confirm, Markdown } from '../components/common';
export function Knowledge() {
  const { sources, load, progress } = useKnowledge();
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<'file' | 'folder' | 'url'>('file');
  const [url, setUrl] = useState('');
  const [collection, setCollection] = useState('');
  const [group, setGroup] = useState('');
  const [addingNewGroup, setAddingNewGroup] = useState(false);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [groupChoice, setGroupChoice] = useState('');
  const [grouping, setGrouping] = useState(false);
  const [groupingAction, setGroupingAction] = useState<'assign' | 'rename'>('assign');
  const [groupToDelete, setGroupToDelete] = useState<string | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);
  const [preview, setPreview] = useState<{ source: KnowledgeSource; text: string } | null>(null);
  const [remove, setRemove] = useState<KnowledgeSource | null>(null);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'semantic' | 'keyword'>('semantic');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const groups = [
    ...new Set([
      ...sources.map((source) => source.group).filter((group): group is string => !!group),
      BUILT_IN_GROUP,
    ]),
  ].sort((a, b) => a.localeCompare(b)) as string[];
  const visibleSources = sources.filter(
    (source) => activeGroup === null || (source.group ?? '') === activeGroup,
  );
  const openGrouping = (name = activeGroup ?? '', action: 'assign' | 'rename' = 'assign') => {
    setSelected(
      action === 'rename'
        ? sources.filter((source) => source.group === name).map((source) => source.id)
        : selected,
    );
    setGroupName(name);
    setGroupChoice(action === 'rename' || groups.includes(name) ? name : '');
    setGroupingAction(action);
    setGrouping(true);
  };
  const saveGroup = async (ids: string[], name: string) => {
    await window.workspace.knowledge.setGroup(ids, name);
    setSelected([]);
    setActiveGroup(name);
    await load();
  };
  return (
    <div className="page">
      <PageHeader
        eyebrow="LOCAL RETRIEVAL"
        title="Knowledge Base"
        description="Give your models context they can actually use."
        actions={
          <button className="primary" onClick={() => setAdding(true)}>
            <Plus size={17} />
            Add source
          </button>
        }
      />
      <div className="knowledge-stats">
        <div>
          <span>Sources</span>
          <strong>{sources.length}</strong>
        </div>
        <div>
          <span>Documents</span>
          <strong>{sources.reduce((a, s) => a + s.documentCount, 0)}</strong>
        </div>
        <div>
          <span>Indexed chunks</span>
          <strong>{sources.reduce((a, s) => a + s.chunkCount, 0)}</strong>
        </div>
        <div>
          <span>Storage</span>
          <strong className="small">Local · LanceDB</strong>
        </div>
      </div>
      {!!sources.length && (
        <>
          <nav className="library-groups" aria-label="Knowledge Base groups">
            {[null, '', ...groups].map((name) => {
              const label = name === null ? 'All' : name || 'Ungrouped';
              const count = sources.filter(
                (source) => name === null || (source.group ?? '') === name,
              ).length;
              return (
                <div className="library-group-tab" key={name === null ? 'all' : `group:${name}`}>
                  <button
                    type="button"
                    aria-pressed={activeGroup === name}
                    onClick={() => {
                      setActiveGroup(name);
                      setSelected([]);
                    }}
                  >
                    {label} <span className="badge">{count}</span>
                  </button>
                </div>
              );
            })}
          </nav>
          <div className="section-toolbar library-selection-toolbar">
            <label className="check">
              <input
                type="checkbox"
                checked={
                  !!visibleSources.length && visibleSources.every((s) => selected.includes(s.id))
                }
                disabled={!visibleSources.length}
                onChange={(event) =>
                  setSelected(event.target.checked ? visibleSources.map((source) => source.id) : [])
                }
              />
              Select all sources
            </label>
            <span>{selected.length} sources selected</span>
            <div className="mcp-group-actions">
              <button disabled={!selected.length} onClick={() => openGrouping()}>
                Move to group
              </button>
              <button
                disabled={
                  savingGroup ||
                  !selected.some((id) => sources.some((source) => source.id === id && source.group))
                }
                onClick={() =>
                  void attempt(async () => {
                    setSavingGroup(true);
                    try {
                      await saveGroup(selected, '');
                    } finally {
                      setSavingGroup(false);
                    }
                  })
                }
              >
                Remove from group
              </button>
              {!!activeGroup && activeGroup !== BUILT_IN_GROUP && (
                <button
                  className="edit"
                  aria-label={`Edit ${activeGroup} group`}
                  title={`Edit ${activeGroup} group`}
                  disabled={savingGroup}
                  onClick={() => openGrouping(activeGroup, 'rename')}
                >
                  <Pencil size={14} />
                  Edit Group
                </button>
              )}
              {!!activeGroup && activeGroup !== BUILT_IN_GROUP && (
                <button
                  className="danger"
                  disabled={savingGroup}
                  onClick={() => setGroupToDelete(activeGroup)}
                >
                  <Trash2 size={14} />
                  Delete group
                </button>
              )}
            </div>
          </div>
        </>
      )}
      <form
        className="knowledge-search"
        onSubmit={(e) => {
          e.preventDefault();
          setSearching(true);
          void attempt(async () => {
            try {
              setResults(await window.workspace.knowledge.search(query, mode));
            } finally {
              setSearching(false);
            }
          });
        }}
      >
        <div className="search-input">
          <Search size={17} />
          <input
            aria-label="Search knowledge"
            required
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your knowledge…"
          />
        </div>
        <select
          aria-label="Search method"
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
        >
          <option value="semantic">Semantic search</option>
          <option value="keyword">Keyword search</option>
        </select>
        <button disabled={searching}>{searching ? 'Searching…' : 'Search'}</button>
        {results && (
          <button type="button" onClick={() => setResults(null)}>
            Clear
          </button>
        )}
      </form>
      {results && (
        <section className="search-results">
          <h2>{results.length} results</h2>
          {results.map((result) => (
            <article key={result.id}>
              <div className="flex justify-between">
                <strong>{result.name}</strong>
                <span className="badge">{Math.round(result.score * 100)}% relevance</span>
              </div>
              <p className="small muted">{result.location}</p>
              <Markdown text={result.content} />
            </article>
          ))}
        </section>
      )}
      {!sources.length ? (
        <Empty
          icon={<BookOpen size={30} />}
          title="Turn your documents into context"
          description="Add Markdown, text files, a local folder, or a URL. Everything is indexed on your machine."
          action={
            <button onClick={() => setAdding(true)}>
              <Plus size={16} />
              Add your first source
            </button>
          }
        />
      ) : (
        <div className="source-list">
          {visibleSources.map((source) => {
            const Icon = source.type === 'url' ? Globe : source.type === 'folder' ? Folder : File;
            const active = ['syncing', 'indexing'].includes(source.status);
            return (
              <article key={source.id} className="source-card">
                <div className="item-icon">
                  <Icon size={20} />
                </div>
                <div className="source-info">
                  <h2>
                    <label
                      className="check source-select"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        aria-label={`Select ${source.name}`}
                        checked={selected.includes(source.id)}
                        onChange={(event) =>
                          setSelected((ids) =>
                            event.target.checked
                              ? [...ids, source.id]
                              : ids.filter((id) => id !== source.id),
                          )
                        }
                      />
                    </label>
                    {source.name}
                    <span className="badge">{source.status}</span>
                  </h2>
                  <p title={source.location}>{source.location}</p>
                  <div className="small muted">
                    {source.documentCount} documents · {source.chunkCount} chunks
                    {source.collection && ` · ${source.collection}`}
                    {source.group && ` · Group: ${source.group}`} ·{' '}
                    {source.lastSyncedAt
                      ? `Synced ${new Date(source.lastSyncedAt).toLocaleString()}`
                      : 'Not synced yet'}
                  </div>
                  {active && (
                    <p className="progress-text" role="status">
                      {progress[source.id] ?? 'Preparing source…'}
                    </p>
                  )}
                  {source.error && <p className="error-text">{source.error}</p>}
                </div>
                <div className="actions">
                  <button
                    onClick={() =>
                      void attempt(async () =>
                        setPreview({
                          source,
                          text: await window.workspace.knowledge.preview(source.id),
                        }),
                      )
                    }
                  >
                    Preview
                  </button>
                  {active ? (
                    <button
                      onClick={() => void attempt(() => window.workspace.knowledge.stop(source.id))}
                    >
                      <Square size={13} />
                      Cancel
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        void attempt(async () => {
                          await window.workspace.knowledge.sync(source.id);
                          await load();
                        })
                      }
                    >
                      <RefreshCw size={14} />
                      Sync / Re-index
                    </button>
                  )}
                  <button
                    disabled={active}
                    className="danger-text text-button"
                    onClick={() => setRemove(source)}
                  >
                    Remove
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {adding && (
        <Modal title="Add knowledge source" onClose={() => setAdding(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void attempt(async () => {
                await window.workspace.knowledge.add({
                  type,
                  url: type === 'url' ? url : undefined,
                  collection,
                  group,
                });
                await load();
                setGroup('');
                setAddingNewGroup(false);
                setAdding(false);
              });
            }}
          >
            <label>
              Source type
              <select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                <option value="file">Local file</option>
                <option value="folder">Local folder</option>
                <option value="url">URL</option>
              </select>
            </label>
            {type === 'url' ? (
              <label>
                URL
                <input
                  type="url"
                  required
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/docs"
                />
              </label>
            ) : (
              <p className="callout">
                Choose {type === 'folder' ? 'a folder' : 'a file'} using the system picker. Only .md
                and .txt files are indexed, including inside folders. Generated files and secrets
                are excluded.
              </p>
            )}
            <label>
              Collection · optional
              <input
                value={collection}
                onChange={(e) => setCollection(e.target.value)}
                placeholder="e.g. Project documentation"
              />
            </label>
            <label>
              Group · optional
              <select
                value={addingNewGroup ? '__new_group__' : group}
                onChange={(event) => {
                  const next = event.target.value;
                  setAddingNewGroup(next === '__new_group__');
                  setGroup(next === '__new_group__' ? '' : next);
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
                  value={group}
                  onChange={(event) => setGroup(event.target.value)}
                  maxLength={100}
                  placeholder="e.g. Research"
                />
              </label>
            )}
            <div className="actions">
              <button className="primary">{type === 'url' ? 'Add URL' : 'Choose ' + type}</button>
            </div>
          </form>
        </Modal>
      )}
      {preview && (
        <Modal wide title={preview.source.name} onClose={() => setPreview(null)}>
          <p className="small muted">{preview.source.location}</p>
          <Markdown text={preview.text} />
        </Modal>
      )}
      {grouping && (
        <Modal
          title={groupingAction === 'rename' ? 'Rename group' : 'Move sources to group'}
          onClose={() => {
            if (!savingGroup) setGrouping(false);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void attempt(async () => {
                setSavingGroup(true);
                try {
                  await saveGroup(selected, groupName.trim());
                  setGrouping(false);
                } finally {
                  setSavingGroup(false);
                }
              });
            }}
          >
            <p>
              {groupingAction === 'rename'
                ? `Rename this group for ${selected.length} sources.`
                : `Move ${selected.length} selected sources to a group. Enter a new name to add a group.`}
            </p>
            {groupingAction === 'rename' ? (
              <label>
                Group
                <input
                  autoFocus
                  required
                  value={groupName}
                  onChange={(event) => setGroupName(event.target.value)}
                  maxLength={100}
                  disabled={savingGroup}
                />
              </label>
            ) : (
              <>
                <label>
                  Group
                  <select
                    value={groupChoice === '__new_group__' ? groupChoice : groupName}
                    disabled={savingGroup}
                    onChange={(event) => {
                      const next = event.target.value;
                      setGroupChoice(next);
                      setGroupName(next === '__new_group__' ? '' : next);
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
                {groupChoice === '__new_group__' && (
                  <label>
                    New group name
                    <input
                      autoFocus
                      value={groupName}
                      onChange={(event) => setGroupName(event.target.value)}
                      maxLength={100}
                      placeholder="e.g. Research"
                      disabled={savingGroup}
                    />
                  </label>
                )}
              </>
            )}
            <div className="actions">
              <button type="button" disabled={savingGroup} onClick={() => setGrouping(false)}>
                Cancel
              </button>
              <button className="primary" disabled={savingGroup}>
                {savingGroup ? 'Saving…' : groupingAction === 'rename' ? 'Rename group' : 'Move'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {groupToDelete && (
        <Confirm
          title={`Delete ${groupToDelete} group?`}
          detail="Sources in this group will become ungrouped. They will not be removed from the Knowledge Base."
          onClose={() => setGroupToDelete(null)}
          onConfirm={async () => {
            const ids = sources
              .filter((source) => source.group === groupToDelete)
              .map((source) => source.id);
            await saveGroup(ids, '');
            if (activeGroup === groupToDelete) setActiveGroup('');
          }}
        />
      )}
      {remove && (
        <Confirm
          title={`Remove ${remove.name}?`}
          detail="Removes the preview and all indexed vectors. Your original files remain untouched."
          onClose={() => setRemove(null)}
          onConfirm={async () => {
            await window.workspace.knowledge.remove(remove.id);
            await load();
          }}
        />
      )}
    </div>
  );
}
