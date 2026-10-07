/** Names are unique within a resource category, including bundled resources. */
export function assertUniqueName(
  items: readonly { id: string; name: string }[],
  input: { id?: string; name: string },
  label: string,
) {
  const normalize = (name: string) => name.trim().toLowerCase();
  if (items.some((item) => item.id !== input.id && normalize(item.name) === normalize(input.name)))
    throw new Error(
      `${label} named "${input.name.trim()}" already exists. Choose a different name.`,
    );
}

/** Keep the uniqueness check and file write together across concurrent saves. */
export class SaveQueue {
  private pending: Promise<unknown> = Promise.resolve();
  run<T>(save: () => Promise<T>): Promise<T> {
    const result = this.pending.then(save, save);
    this.pending = result.catch(() => undefined);
    return result;
  }
}
