/** Only unambiguous, read-only requests qualify for eager workspace context.
 * Everything else remains a model decision through the usual capability router. */
export function workspaceReadRequest(
  task: string,
): { id: string; args: Record<string, string> } | undefined {
  const request = task.trim();
  if (/\b(?:do\s+not|don['’]?t|never|without|avoid|instead|except)\b/i.test(request)) return;
  if (
    /^(?:please\s+)?(?:read|list|show|inspect)(?:\s+me)?\s+(?:my|the|this|current|project|workspace|selected|folder|folders|files|directory|contents|of|in|\s)+[.!?]?$/i.test(
      request,
    )
  )
    return { id: 'filesystem.list', args: { path: '.' } };
  const match =
    /^(?:please\s+)?(?:get|read|show|inspect|summarize|explain)(?:\s+me)?\s+(?:the\s+)?[`"']?([\w@./-]+\.[\w.-]+)[`"']?(?:\s+(?:file|details|contents|content))*[.!?]?$/i.exec(
      request,
    );
  if (!match) return;
  return { id: 'filesystem.read', args: { path: match[1] } };
}
