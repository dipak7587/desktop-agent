# Local retrieval and indexing

Sources are file-backed metadata in `knowledge.json`. Normalized previews and content-hash
manifests live in `cache/`; vectors are in `rag/lancedb`. No external embedding API is used.

Supported local extensions: `.md` and `.txt` only (including recursive folder indexing). HTML URL pages
are converted with Turndown; script/style/nav/footer/form elements are excluded. A URL sync
fetches one page and follows standard HTTP redirects. It does not render JavaScript or crawl links.

The pipeline is asynchronous file/HTTP read → text normalization → overlapping chunks →
batched Ollama embeddings → LanceDB rows. Each row contains a source ID, original location,
content, start/end line, chunk index, SHA-256 content hash and vector. Tables are separated
by embedding model name to avoid mixing different embedding dimensions.

Index jobs are serialized to prevent concurrent first-table creation. Status/progress events
are emitted between documents. Cancellation uses AbortController; an interrupted or failed
sync removes the source's partial vectors and marks it for retry. On startup, interrupted
statuses become explicit errors.

URL sync deletes old vectors and previews before fetching replacement content. Local file
sync compares content and chunk-setting hashes, skips unchanged documents, replaces changed
documents, and removes chunks for deleted files. Changing the embedding model invalidates
that source's old index on its next sync. Sources must be synced after model changes.

Default ignores include `node_modules`, `.git`, `dist`, `build`, `coverage`, `.env`,
`.env.*`, credential directories and key files. Custom minimatch patterns are configurable.
Symlinks are not followed during traversal. Limits are documented in README.

Semantic search embeds the query and performs LanceDB vector search, filtered by source IDs.
Keyword search uses literal, escaped SQL substring matching. Relevance displayed for semantic
results is `1 / (1 + distance)`, a relative similarity indicator, not a calibrated probability.

Chat retrieves up to Top K chunks and places them in a separate reference context. The prompt
instructs the model to treat retrieved documents as untrusted data, cite source names, and
acknowledge insufficient evidence. Actual source excerpts are saved with assistant messages,
so later inspection shows the context used for that response.

Retrieval occurs only when Chat's **Knowledge context** is set to a source, collection, or
**All knowledge**. Chat defaults to **No knowledge context**. For saved notes, select
**Collection: Saved Text** after indexing is ready. The model receives
retrieved excerpts as context; answers are not mechanically restricted to those excerpts.
See [Chat](CHAT.md) for the user workflow.

## Saved Text

Saving, editing, importing, or deleting a note automatically refreshes the **Saved Text** collection. Existing notes are picked up on launch. Original notes remain Markdown files; only their title and body are embedded, without frontmatter. Unchanged notes skip embedding, and deleted notes are removed from retrieval. Rapid changes cancel outdated indexing and queue a fresh pass. If Ollama or the embedding model is unavailable, the note remains saved and the source shows an error; use Sync / Re-index after restoring the connection.
