import { beforeEach, describe, expect, it, vi } from 'vitest';

import { safeInvoke } from './core';
import {
  disconnectTomato,
  executeTomatoTransition,
  getTomatoItem,
  getTomatoSession,
  listTomatoTransitions,
  saveTomatoConnection,
  searchTomatoItems,
} from './tomato';

vi.mock('./core', () => ({
  safeInvoke: vi.fn(),
}));

describe('tomato backend API', () => {
  beforeEach(() => {
    vi.mocked(safeInvoke).mockReset();
  });

  it('loads the native Tomato session', async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      configured: false,
      host: 'https://osc.gitee.work',
      contextId: null,
    });

    await getTomatoSession();

    expect(safeInvoke).toHaveBeenCalledWith('tomato_get_session');
  });

  it('stores connection data through Tauri without retaining the token', async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      configured: true,
      host: 'https://osc.gitee.work',
      contextId: 'team-1',
    });

    await saveTomatoConnection({
      host: 'https://osc.gitee.work',
      token: 'secret-token',
      contextId: 'team-1',
    });

    expect(safeInvoke).toHaveBeenCalledWith('tomato_save_connection', {
      host: 'https://osc.gitee.work',
      token: 'secret-token',
      contextId: 'team-1',
    });
  });

  it('disconnects through the native backend', async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      configured: false,
      host: 'https://osc.gitee.work',
      contextId: null,
    });

    await disconnectTomato();

    expect(safeInvoke).toHaveBeenCalledWith('tomato_disconnect');
  });

  it('searches items with explicit nullable pagination arguments', async () => {
    vi.mocked(safeInvoke).mockResolvedValueOnce({ items: [] });

    await searchTomatoItems({ iql: '状态 = 新建' });

    expect(safeInvoke).toHaveBeenCalledWith('tomato_search_items', {
      iql: '状态 = 新建',
      page: null,
      size: null,
      fields: null,
      excludedTypes: null,
      excludedStatuses: null,
    });
  });

  it('loads item details and transitions by native item id', async () => {
    vi.mocked(safeInvoke).mockResolvedValue({});

    await getTomatoItem('item-1');
    await listTomatoTransitions('item-1');
    await executeTomatoTransition('item-1', '开始修复');

    expect(safeInvoke).toHaveBeenNthCalledWith(1, 'tomato_get_item', {
      itemId: 'item-1',
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(2, 'tomato_list_transitions', {
      itemId: 'item-1',
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(3, 'tomato_execute_transition', {
      itemId: 'item-1',
      transition: '开始修复',
    });
  });
});
