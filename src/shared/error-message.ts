export function errorMessage(value: unknown): string {
  const seen = new Set<unknown>();

  const extract = (input: unknown): string | undefined => {
    if (typeof input === 'string') {
      const text = input.trim();
      if (!text || text === '[object Object]') return undefined;
      if (
        (text.startsWith('{') && text.endsWith('}')) ||
        (text.startsWith('[') && text.endsWith(']'))
      ) {
        try {
          return extract(JSON.parse(text));
        } catch {
          return text;
        }
      }
      return text;
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
      const serialized = JSON.stringify(input);
      return serialized === '{}' ? undefined : serialized;
    } catch {
      return undefined;
    }
  };

  return extract(value) ?? 'An unknown error occurred.';
}
