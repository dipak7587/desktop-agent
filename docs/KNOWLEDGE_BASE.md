# Knowledge Base

Index local reference material and search it from this menu, Chat, or configured agents.

## Add and index sources

1. Add an individual `.md` or `.txt` file, a folder, or an HTTP(S) URL.
2. Optionally assign a collection to group sources.
3. Use **Sync / Re-index** and wait for the source to become ready.
4. Preview the indexed text or search using semantic or keyword mode.

Folder indexing is recursive and accepts only `.md` and `.txt` files, case-insensitively.
Other file extensions are skipped. Sensitive files and configured ignore patterns are excluded;
symbolic links are not followed. Individual local files have the same extension restriction.
URL sources fetch one page, without crawling links or rendering JavaScript.

Saved Text creates and updates its own **Saved Text** collection automatically. Manually added
sources require a sync to pick up changes. Local sync updates changed documents and removes
deleted documents from the index. Cancel a running sync before removing its source.

## Use the knowledge

Semantic search uses an Ollama embedding model; keyword search matches text within the indexed
chunks. Chat's **Knowledge context** selector chooses a source, collection, or all knowledge.
Its default **No knowledge context** disables retrieval. Agents use the sources selected in
their editor in Selected mode, or all eligible sources in Auto mode. Selection alone does not
trigger a search: the capability decision must find stored/project-specific information necessary.
None mode and explicit knowledge restrictions block agent retrieval. Only ready sources are
searched. Manual search and indexing in this menu remain user-initiated operations. See
[Capability decisions](CAPABILITIES.md).

An error status means indexing needs attention. Configure the embedding model or restore Ollama,
then retry **Sync / Re-index**. After changing embedding models, re-index sources.
Removing a source removes its index and cached preview, not the original local documents.

Source metadata lives in `knowledge.json`, previews and hash manifests in `cache/`, and vectors
in `rag/lancedb`, all under the app's local data directory.

See [RAG](RAG.md) for technical details, [Saved Text](SAVED_TEXT.md), and [Chat](CHAT.md).
