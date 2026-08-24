import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Loader2, RotateCcw, Send, Square } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  cancelClaudeCodeMessage,
  CLAUDE_RUNTIME_CHANGED_EVENT,
  detectCliCapabilities,
  getActiveClaudeRequestId,
  sendClaudeCodeMessage,
} from '@/lib/backend/cli';
import {
  CLAUDE_CONVERSATIONS_CHANGED_EVENT,
  findLatestClaudeCodeConversation,
  getClaudeCodeConversation,
  saveClaudeCodeConversation,
  type ClaudeCodeConversationMessage,
} from '@/lib/backend/claude-code-conversations';

interface ClaudeCodeInlineChatProps {
  contextKey: string;
  contextTitle: string;
  contextText: string;
  repositoryPath?: string;
  conversationId?: string;
  onConversationIdChange?: (conversationId: string) => void;
}

export function ClaudeCodeInlineChat({
  contextKey,
  contextTitle,
  contextText,
  repositoryPath,
  conversationId,
  onConversationIdChange,
}: ClaudeCodeInlineChatProps) {
  const [sessionId, setSessionId] = useState<string>();
  const [storedConversationId, setStoredConversationId] = useState<string>();
  const [messages, setMessages] = useState<ClaudeCodeConversationMessage[]>([]);
  const [createdAt, setCreatedAt] = useState<number>();
  const [conversationTitle, setConversationTitle] = useState<string>();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [queuedPrompt, setQueuedPrompt] = useState<string>();
  const [streamStatus, setStreamStatus] = useState('');
  const [cliReady, setCliReady] = useState<boolean>();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamTextRef = useRef('');
  const activeRequestIdRef = useRef<string>();
  const isComposingRef = useRef(false);
  const compositionEndedAtRef = useRef(0);

  const resetConversation = useCallback(() => {
    setSessionId(undefined);
    setStoredConversationId(undefined);
    setMessages([]);
    setCreatedAt(undefined);
    setConversationTitle(undefined);
    setDraft('');
    setStreamStatus('');
    streamTextRef.current = '';
  }, []);

  useEffect(() => {
    let active = true;
    if (!repositoryPath) {
      resetConversation();
      return;
    }
    const request = conversationId
      ? getClaudeCodeConversation(conversationId).then(
          (conversation) =>
            conversation ??
            findLatestClaudeCodeConversation(contextKey, repositoryPath),
        )
      : findLatestClaudeCodeConversation(contextKey, repositoryPath);
    void request
      .then((conversation) => {
        if (!active) return;
        if (!conversation) {
          resetConversation();
          return;
        }
        setSessionId(conversation.claudeSessionId || undefined);
        setStoredConversationId(conversation.id);
        onConversationIdChange?.(conversation.id);
        setMessages(conversation.messages);
        setCreatedAt(conversation.createdAt);
        setConversationTitle(conversation.title);
        setDraft('');
      })
      .catch(() => {
        if (active) resetConversation();
      });
    return () => {
      active = false;
    };
  }, [
    contextKey,
    conversationId,
    onConversationIdChange,
    repositoryPath,
    resetConversation,
  ]);

  useEffect(() => {
    const targetConversationId = storedConversationId ?? conversationId;
    if (!targetConversationId || sending) return;
    const refresh = () => {
      void getClaudeCodeConversation(targetConversationId).then(
        (conversation) => {
          if (!conversation) return;
          setSessionId(conversation.claudeSessionId || undefined);
          setConversationTitle(conversation.title);
          setMessages(conversation.messages);
        },
      );
    };
    window.addEventListener(CLAUDE_CONVERSATIONS_CHANGED_EVENT, refresh);
    return () =>
      window.removeEventListener(CLAUDE_CONVERSATIONS_CHANGED_EVENT, refresh);
  }, [conversationId, sending, storedConversationId]);

  useEffect(() => {
    const targetConversationId = storedConversationId ?? conversationId;
    if (!targetConversationId) return;
    const syncRuntime = () => {
      const requestId = getActiveClaudeRequestId(targetConversationId);
      activeRequestIdRef.current = requestId;
      setSending(Boolean(requestId));
      if (requestId) setStreamStatus('Claude Code 正在后台处理…');
    };
    syncRuntime();
    window.addEventListener(CLAUDE_RUNTIME_CHANGED_EVENT, syncRuntime);
    return () =>
      window.removeEventListener(CLAUDE_RUNTIME_CHANGED_EVENT, syncRuntime);
  }, [conversationId, storedConversationId]);

  useEffect(() => {
    void detectCliCapabilities()
      .then((capabilities) => {
        setCliReady(
          capabilities.some(
            (capability) =>
              capability.id === 'claude-code' && capability.available,
          ),
        );
      })
      .catch(() => setCliReady(false));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const sendMessage = useCallback(
    async (promptOverride?: string) => {
      const userText = (promptOverride ?? draft).trim();
      if (!userText || sending || !repositoryPath) return;

      const userMessage: ClaudeCodeConversationMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        content: userText,
      };
      const streamingMessageId = crypto.randomUUID();
      const currentConversationId = storedConversationId ?? crypto.randomUUID();
      const now = Date.now();
      const nextCreatedAt = createdAt ?? now;
      const currentTitle = conversationTitle ?? userText;
      const pendingMessages = [
        ...messages,
        userMessage,
        { id: streamingMessageId, role: 'assistant' as const, content: '' },
      ];
      streamTextRef.current = '';
      setStreamStatus('正在连接 Claude Code');
      setStoredConversationId(currentConversationId);
      onConversationIdChange?.(currentConversationId);
      setCreatedAt(nextCreatedAt);
      setConversationTitle(currentTitle);
      setMessages(pendingMessages);
      setDraft('');
      setSending(true);

      try {
        await saveClaudeCodeConversation({
          id: currentConversationId,
          claudeSessionId: sessionId ?? '',
          repositoryPath,
          contextKey,
          title: currentTitle,
          contextText,
          messages: pendingMessages,
          createdAt: nextCreatedAt,
          updatedAt: now,
        });
        const prompt = sessionId
          ? userText
          : `以下是当前页面上下文：\n\n${contextText}\n\n用户请求：\n${userText}`;
        const response = await sendClaudeCodeMessage({
          prompt,
          workspacePath: repositoryPath,
          sessionId,
          conversationId: currentConversationId,
          onRequestStart: (requestId) => {
            activeRequestIdRef.current = requestId;
          },
          onStream: (event) => {
            if (event.kind === 'session_id') {
              setSessionId(event.text);
              return;
            }
            if (event.kind === 'status') {
              setStreamStatus(event.text);
              return;
            }
            streamTextRef.current += event.text;
            setStreamStatus('正在生成回复');
            setMessages((current) =>
              current.map((message) =>
                message.id === streamingMessageId
                  ? { ...message, content: streamTextRef.current }
                  : message,
              ),
            );
          },
        });
        const assistantMessage: ClaudeCodeConversationMessage = {
          id: streamingMessageId,
          role: 'assistant',
          content: response.result,
        };
        const nextMessages = [...messages, userMessage, assistantMessage];
        const completedAt = Date.now();
        setSessionId(response.sessionId);
        setMessages(nextMessages);
        setStreamStatus('');
        await saveClaudeCodeConversation({
          id: currentConversationId,
          claudeSessionId: response.sessionId,
          repositoryPath,
          contextKey,
          title: currentTitle,
          contextText,
          messages: nextMessages,
          createdAt: nextCreatedAt,
          updatedAt: completedAt,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const wasPaused = errorMessage.includes('Claude Code 已暂停');
        const failedMessages = [
          ...messages,
          userMessage,
          {
            id: streamingMessageId,
            role: 'assistant' as const,
            content: wasPaused
              ? streamTextRef.current || '已暂停'
              : `Claude Code 执行失败：${errorMessage}`,
          },
        ];
        setMessages(failedMessages);
        await saveClaudeCodeConversation({
          id: currentConversationId,
          claudeSessionId: sessionId ?? '',
          repositoryPath,
          contextKey,
          title: currentTitle,
          contextText,
          messages: failedMessages,
          createdAt: nextCreatedAt,
          updatedAt: Date.now(),
        });
        if (!wasPaused) {
          toast.error('Claude Code 执行失败', { description: errorMessage });
        }
      } finally {
        activeRequestIdRef.current = undefined;
        setSending(false);
        setStreamStatus('');
      }
    },
    [
      contextKey,
      contextText,
      contextTitle,
      conversationTitle,
      createdAt,
      draft,
      messages,
      onConversationIdChange,
      repositoryPath,
      sending,
      sessionId,
      storedConversationId,
    ],
  );

  useEffect(() => {
    if (sending || !queuedPrompt) return;
    const prompt = queuedPrompt;
    setQueuedPrompt(undefined);
    void sendMessage(prompt);
  }, [queuedPrompt, sendMessage, sending]);

  const pauseOrInterject = useCallback(async () => {
    const requestId = activeRequestIdRef.current;
    if (!requestId) return;
    const interjection = draft.trim();
    if (interjection) {
      setQueuedPrompt(interjection);
      setDraft('');
    }
    await cancelClaudeCodeMessage(requestId);
  }, [draft]);

  return (
    <section className="flex h-[520px] min-h-0 flex-col overflow-x-hidden overflow-y-hidden rounded-lg border bg-background">
      <header className="flex items-center justify-between gap-4 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Claude Code</h2>
          <p className="truncate text-xs text-muted-foreground">
            {contextTitle}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={cliReady ? 'default' : 'secondary'}>
            {cliReady === undefined
              ? '检测中'
              : cliReady
                ? 'CLI 可用'
                : 'CLI 不可用'}
          </Badge>
          <Button
            variant="ghost"
            size="icon"
            onClick={resetConversation}
            disabled={sending || messages.length === 0}
            title="新建会话"
          >
            <RotateCcw />
          </Button>
        </div>
      </header>

      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4">
        <div className="min-w-0 space-y-5">
          {messages.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center text-center">
              <Bot className="mb-3 size-9 text-muted-foreground" />
              <p className="text-sm font-medium">
                {repositoryPath ? '直接描述需要处理的任务' : '请先选择所属仓库'}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                页面上下文将在首轮自动附带
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <article
                key={message.id}
                className={`flex min-w-0 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={
                    message.role === 'user'
                      ? 'max-w-[75%] rounded-lg bg-muted px-3 py-2'
                      : 'min-w-0 w-full'
                  }
                >
                  {message.role === 'user' ? (
                    <div className="whitespace-pre-wrap break-words text-sm text-foreground">
                      {message.content}
                    </div>
                  ) : (
                    <div className="prose prose-sm max-w-full min-w-0 break-words [overflow-wrap:anywhere] dark:prose-invert [&_pre]:max-w-full [&_pre]:overflow-x-hidden [&_code]:break-words [&_code]:whitespace-pre-wrap">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              </article>
            ))
          )}
          {sending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {streamStatus || 'Claude Code 正在处理…'}
            </div>
          ) : null}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
              compositionEndedAtRef.current = performance.now();
            }}
            onKeyDown={(event) => {
              const nativeEvent = event.nativeEvent as KeyboardEvent;
              if (
                isComposingRef.current ||
                nativeEvent.isComposing ||
                nativeEvent.keyCode === 229 ||
                (event.key === 'Enter' &&
                  performance.now() - compositionEndedAtRef.current < 150)
              )
                return;
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void (sending ? pauseOrInterject() : sendMessage());
              }
            }}
            placeholder="向 Claude Code 提问"
            disabled={cliReady !== true || !repositoryPath}
            className="max-h-32 min-h-11 resize-none"
          />
          <Button
            size="icon"
            onClick={() => void (sending ? pauseOrInterject() : sendMessage())}
            disabled={
              cliReady !== true ||
              !repositoryPath ||
              (!sending && draft.trim().length === 0)
            }
            title={sending ? (draft.trim() ? '插话' : '暂停') : '发送'}
          >
            {sending ? draft.trim() ? <Send /> : <Square /> : <Send />}
          </Button>
        </div>
      </div>
    </section>
  );
}
