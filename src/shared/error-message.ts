export function errorMessage(value: unknown): string {
  const seen = new Set<unknown>();

  const extract = (input: unknown): string | undefined => {
    if (typeof input === 'string') {
      const text = input.trim();
      if (!text) return undefined;
      if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
        try {
          return extract(JSON.parse(text));
        } catch {
          return text;
        }
      }
      return text;
    }
    if (input instanceof Error) {
      const message = input.message.trim();
      if (message && message !== '[object Object]') return message;
      seen.add(input);
      return extract(input.cause) ?? (message || undefined);
    }
    if (!input || typeof input !== 'object' || seen.has(input)) return undefined;
    seen.add(input);

    const record = input as Record<string, unknown>;
    for (const key of ['message', 'error', 'detail', 'reason', 'cause']) {
      const result = extract(record[key]);
      if (result) return result;
    }
    for (const key of ['data', 'response', 'body']) {
      const result = extract(record[key]);
      if (result) return result;
    }
    try {
      return JSON.stringify(input);
    } catch {
      return undefined;
    }
  };

  return extract(value) ?? 'An unknown error occurred.';
}