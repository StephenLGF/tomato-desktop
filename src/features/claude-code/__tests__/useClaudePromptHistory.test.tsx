import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useClaudePromptHistory } from '../useClaudePromptHistory';

const messages = [
  { role: 'user' as const, content: '第一条任务' },
  { role: 'assistant' as const, content: '第一条回复' },
  { role: 'user' as const, content: '第二条任务' },
];

describe('useClaudePromptHistory', () => {
  it('navigates sent prompts and restores the unsent draft', () => {
    const { result } = renderHook(() => useClaudePromptHistory(messages));
    let recalled: string | null = null;

    act(() => {
      recalled = result.current.navigate('previous', '未发送草稿');
    });
    expect(recalled).toBe('第二条任务');
    act(() => {
      recalled = result.current.navigate('previous', '第二条任务');
    });
    expect(recalled).toBe('第一条任务');
    act(() => {
      recalled = result.current.navigate('next', '第一条任务');
    });
    expect(recalled).toBe('第二条任务');
    act(() => {
      recalled = result.current.navigate('next', '第二条任务');
    });
    expect(recalled).toBe('未发送草稿');
  });

  it('ignores assistant messages', () => {
    const { result } = renderHook(() => useClaudePromptHistory(messages));

    let recalled: string | null = null;
    act(() => {
      recalled = result.current.navigate('previous', '');
    });
    expect(recalled).toBe('第二条任务');
  });
});
