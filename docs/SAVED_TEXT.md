# Saved Text

Store reusable notes, prompts, and reference material with a title and Markdown/plain-text body.
The menu supports creating, editing, searching, copying, importing, exporting, deleting, and
sending a note to a new chat.

## Automatic RAG indexing

Creating, editing, importing, or deleting a note automatically refreshes the **Saved Text**
knowledge collection. Existing notes are picked up when the application starts. Indexing runs
in the background; inspect its status in **Knowledge Base**.

Original notes live at `<userData>/saved-text/<id>.md`, with YAML metadata and the note body.
Only the title and body are embedded into local LanceDB. Metadata is excluded. Unchanged notes
skip embedding; edits replace indexed content and deletions remove it from retrieval.

If Ollama or an embedding model is unavailable, the original note remains saved. Restore the
connection or configure an embedding model, then use **Sync / Re-index** on the Saved Text source.

## Answer questions using your notes

In **Chat**, select **Collection: Saved Text** or **All knowledge** before
asking a question. The default **No knowledge context** does not retrieve notes. **Sources used**
shows the excerpts supplied to the model. Sending a note to chat fills the chat draft; it does
not automatically select a RAG source.

Imported note definitions require YAML frontmatter. Export an existing note for a compatible
format. For ordinary `.md` or `.txt` reference files without frontmatter, add them through
[Knowledge Base](KNOWLEDGE_BASE.md).

See [Chat](CHAT.md) for retrieval behavior and [RAG](RAG.md) for indexing details.
