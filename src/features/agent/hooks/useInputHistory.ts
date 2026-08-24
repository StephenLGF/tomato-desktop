import { useState, useEffect, useCallback, useMemo } from 'react';
import type { Message } from '@/models/chat';

/**
 * Hook for managing input history navigation (like terminal command history).
 * Allows users to navigate through previously sent messages using up/down arrows.
 */
export function useInputHistory(messages: Message[]) {
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [temporaryInput, setTemporaryInput] = useState('');

  // Extract text content from user messages
  const history = useMemo(() => {
    return messages
      .filter((m) => m.role === 'user')
      .map((m) => {
        // Extract text from MCPContent array
        const textContent = m.content
          .filter((c) => c.type === 'text')
          .map((c) => c.text)
          .join('\n');
        return textContent;
      })
      .filter((text) => text.trim().length > 0);
  }, [messages]);

  // Reset index when history changes (new message sent)
  useEffect(() => {
    setHistoryIndex(-1);
    setTemporaryInput('');
  }, [history.length]);

  const navigateUp = useCallback(
    (currentInput: string) => {
      if (history.length === 0) return null;

      // First up arrow: save current input and show most recent
      if (historyIndex === -1) {
        setTemporaryInput(currentInput);
        setHistoryIndex(history.length - 1);
        return history[history.length - 1];
      }

      // Navigate to older message
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        return history[newIndex];
      }

      return null;
    },
    [history, historyIndex],
  );

  const navigateDown = useCallback(
    (_currentInput: string) => {
      if (historyIndex === -1) return null;

      // Navigate to newer message
      if (historyIndex < history.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        return history[newIndex];
      }

      // At the newest: restore temporary input
      setHistoryIndex(-1);
      const restored = temporaryInput;
      setTemporaryInput('');
      return restored;
    },
    [history, historyIndex, temporaryInput],
  );

  const reset = useCallback(() => {
    setHistoryIndex(-1);
    setTemporaryInput('');
  }, []);

  return {
    navigateUp,
    navigateDown,
    reset,
    hasHistory: history.length > 0,
    isNavigating: historyIndex !== -1,
  };
}
