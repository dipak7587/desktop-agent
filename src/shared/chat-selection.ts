import type { Settings } from './types';

/** Apply the remembered choice only to new chats; existing conversations retain theirs. */
export function defaultChatSelection(settings: Settings | null | undefined) {
  const enabled = settings?.providers.filter((p) => p.enabled !== false) ?? [];
  const remembered = settings?.lastChatSelection;
  if (
    remembered &&
    enabled.some((p) => p.id === remembered.providerId && p.modelIds?.includes(remembered.model))
  ) {
    return remembered;
  }
  const provider =
    enabled.length === 1 ? enabled[0] : enabled.find((p) => p.id === settings?.activeProviderId);
  return {
    providerId: provider?.id ?? '',
    model: provider?.modelIds?.includes(provider.chatModel) ? provider.chatModel : '',
  };
}
