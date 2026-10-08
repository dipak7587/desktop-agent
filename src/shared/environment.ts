/** Expand explicit references once; substituted values are never interpreted again. */
export function expandEnvironment(text: string, resolve: (name: string) => string): string {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => resolve(name));
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isHttpUrlTemplate(value: string): boolean {
  return /\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(value) || isHttpUrl(value);
}
