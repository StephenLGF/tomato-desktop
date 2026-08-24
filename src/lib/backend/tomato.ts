import { safeInvoke } from './core';

export interface TomatoSession {
  configured: boolean;
  host: string;
  contextId: string | null;
}

export interface SaveTomatoConnectionInput {
  host: string;
  token: string;
  contextId?: string | null;
}

export function getTomatoSession(): Promise<TomatoSession> {
  return safeInvoke<TomatoSession>('tomato_get_session');
}

export function saveTomatoConnection(
  input: SaveTomatoConnectionInput,
): Promise<TomatoSession> {
  return safeInvoke<TomatoSession>('tomato_save_connection', {
    host: input.host,
    token: input.token,
    contextId: input.contextId ?? null,
  });
}

export function disconnectTomato(): Promise<TomatoSession> {
  return safeInvoke<TomatoSession>('tomato_disconnect');
}

export interface TomatoSearchInput {
  iql?: string;
  page?: number;
  size?: number;
  fields?: string[];
  excludedTypes?: string[];
  excludedStatuses?: string[];
}

export function searchTomatoItems<T = unknown>(
  input: TomatoSearchInput = {},
): Promise<T> {
  return safeInvoke<T>('tomato_search_items', {
    iql: input.iql ?? '',
    page: input.page ?? null,
    size: input.size ?? null,
    fields: input.fields ?? null,
    excludedTypes: input.excludedTypes ?? null,
    excludedStatuses: input.excludedStatuses ?? null,
  });
}

export function getTomatoItem<T = unknown>(itemId: string): Promise<T> {
  return safeInvoke<T>('tomato_get_item', { itemId });
}

export function listTomatoTransitions<T = unknown>(itemId: string): Promise<T> {
  return safeInvoke<T>('tomato_list_transitions', { itemId });
}

export function executeTomatoTransition<T = unknown>(
  itemId: string,
  transition: string,
): Promise<T> {
  return safeInvoke<T>('tomato_execute_transition', { itemId, transition });
}
