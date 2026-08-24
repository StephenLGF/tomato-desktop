import { useCallback, useMemo, useRef, useState } from 'react';

interface PromptHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function useClaudePromptHistory(messages: PromptHistoryMessage[]) {
  const history = useMemo(
    () =>
      messages
        .filter((message) => message.role === 'user')
        .map((message) => message.content),
    [messages],
  );
  const [historyIndex, setHistoryIndex] = useState(-1);
  const draftBeforeNavigationRef = useRef('');

  const navigate = useCallback(
    (direction: 'previous' | 'next', currentDraft: string) => {
      if (history.length === 0) return null;

      if (direction === 'previous') {
        if (historyIndex === -1)
          draftBeforeNavigationRef.current = currentDraft;
        const nextIndex =
          historyIndex === -1
            ? history.length - 1
            : Math.max(0, historyIndex - 1);
        setHistoryIndex(nextIndex);
        return history[nextIndex];
      }

      if (historyIndex === -1) return null;
      const nextIndex = historyIndex + 1;
      if (nextIndex >= history.length) {
        setHistoryIndex(-1);
        return draftBeforeNavigationRef.current;
      }
      setHistoryIndex(nextIndex);
      return history[nextIndex];
    },
    [history, historyIndex],
  );

  const reset = useCallback(() => {
    setHistoryIndex(-1);
    draftBeforeNavigationRef.current = '';
  }, []);

  return {
    canNavigateNext: historyIndex >= 0,
    canNavigatePrevious: history.length > 0,
    navigate,
    reset,
  };
}
