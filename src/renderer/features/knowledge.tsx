import { useState } from 'react';
import { Plus, BookOpen, Search, File, Folder, Globe, RefreshCw, Square } from 'lucide-react';
import { useKnowledge, attempt } from '../stores';
import type { KnowledgeSource, SearchResult } from '../../shared/types';
import { PageHeader, Empty, Modal, Confirm, Markdown } from '../components/common';
export function Knowledge() {
  const { sources, load, progress } = useKnowledge();
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<'file' | 'folder' | 'url'>('file');
  const [url, setUrl] = useState('');
  const [collection, setCollection] = useState('');
  const [preview, setPreview] = useState<{ source: KnowledgeSource; text: string } | null>(null);
  const [remove, setRemove] = useState<KnowledgeSource | null>(null);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'semantic' | 'keyword'>('semantic');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
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
          {sources.map((source) => {
            const Icon = source.type === 'url' ? Globe : source.type === 'folder' ? Folder : File;
            const active = ['syncing', 'indexing'].includes(source.status);
            return (
              <article key={source.id} className="source-card">
                <div className="item-icon">
                  <Icon size={20} />
                </div>
                <div className="source-info">
                  <h2>
                    {source.name}
                    <span className="badge">{source.status}</span>
                  </h2>
                  <p title={source.location}>{source.location}</p>
                  <div className="small muted">
                    {source.documentCount} documents · {source.chunkCount} chunks
                    {source.collection && ` · ${source.collection}`} ·{' '}
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
                });
                await load();
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
