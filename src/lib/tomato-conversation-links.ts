const STORAGE_KEY = 'libragent.tomato.conversation-links.v1';

export function readTomatoConversationLinks(): Record<string, string> {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? '{}',
    );
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
}

export function storeTomatoConversationLink(
  cardId: string,
  conversationId?: string,
): void {
  const links = readTomatoConversationLinks();
  if (conversationId) links[cardId] = conversationId;
  else delete links[cardId];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(links));
}

export function findTomatoCardIdByConversation(
  conversationId: string,
): string | undefined {
  return Object.entries(readTomatoConversationLinks()).find(
    ([, linkedConversationId]) => linkedConversationId === conversationId,
  )?.[0];
}
