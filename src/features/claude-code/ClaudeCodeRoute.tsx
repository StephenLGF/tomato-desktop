import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Bot,
  Loader2,
  Plus,
  Send,
  Square,
  TerminalSquare,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  cancelClaudeCodeMessage,
  CLAUDE_RUNTIME_CHANGED_EVENT,
  detectCliCapabilities,
  getActiveClaudeRequestId,
  listClaudeCodeModels,
  sendClaudeCodeMessage,
  type ClaudeCodeModelOption,
} from '@/lib/backend/cli';
import {
  inspectLocalRepository,
  listRegisteredRepositoryPaths,
  type LocalRepositoryInfo,
} from '@/lib/backend/repositories';
import {
  CLAUDE_CONVERSATIONS_CHANGED_EVENT,
  getClaudeCodeConversation,
  saveClaudeCodeConversation,
} from '@/lib/backend/claude-code-conversations';
import { findTomatoCardIdByConversation } from '@/lib/tomato-conversation-links';
import { useClaudePromptHistory } from './useClaudePromptHistory';

type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type StoredConversation = {
  workspacePath: string;
  conversationId?: string;
  createdAt?: number;
  title?: string;
  sessionId?: string;
  messages: ConversationMessage[];
};

const STORAGE_KEY = 'libragent.claude-code.v1';
const MODEL_STORAGE_KEY = 'libragent.claude-code.model';
const FALLBACK_CLAUDE_MODELS: ClaudeCodeModelOption[] = [
  { value: 'default', label: '默认模型', configuredModel: null },
  { value: 'opus', label: 'Opus', configuredModel: null },
  { value: 'fable', label: 'Fable', configuredModel: null },
  { value: 'sonnet', label: 'Sonnet', configuredModel: null },
  { value: 'haiku', label: 'Haiku', configuredModel: null },
];

function loadStoredConversation(): StoredConversation {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { workspacePath: '', messages: [] };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return { workspacePath: '', messages: [] };
    }
    const value = parsed as Record<string, unknown>;
    return {
      workspacePath:
        typeof value.workspacePath === 'string' ? value.workspacePath : '',
      sessionId:
        typeof value.sessionId === 'string' ? value.sessionId : undefined,
      conversationId:
        typeof value.conversationId === 'string'
          ? value.conversationId
          : undefined,
      createdAt:
        typeof value.createdAt === 'number' ? value.createdAt : undefined,
      title: typeof value.title === 'string' ? value.title : undefined,
      messages: Array.isArray(value.messages)
        ? value.messages.filter(
            (item): item is ConversationMessage =>
              typeof item === 'object' &&
              item !== null &&
              typeof item.id === 'string' &&
              (item.role === 'user' || item.role === 'assistant') &&
              typeof item.content === 'string',
          )
        : [],
    };
  } catch {
    return { workspacePath: '', messages: [] };
  }
}

export default function ClaudeCodeRoute() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedConversationId = searchParams.get('conversation');
  const requestedRepositoryPath = searchParams.get('repositoryPath');
  const requestedTomatoCardId = searchParams.get('cardId');
  const linkedTomatoCardId = requestedConversationId
    ? findTomatoCardIdByConversation(requestedConversationId)
    : undefined;
  const [stored] = useState(loadStoredConversation);
  const [workspacePath, setWorkspacePath] = useState(stored.workspacePath);
  const [conversationId, setConversationId] = useState(stored.conversationId);
  const [createdAt, setCreatedAt] = useState(stored.createdAt);
  const [conversationTitle, setConversationTitle] = useState(stored.title);
  const [conversationContextKey, setConversationContextKey] =
    useState<string>();
  const [conversationContextText, setConversationContextText] =
    useState<string>();
  const [sessionId, setSessionId] = useState(stored.sessionId);
  const [messages, setMessages] = useState<ConversationMessage[]>(
    stored.messages,
  );
  const [draft, setDraft] = useState('');
  const [selectedModel, setSelectedModel] = useState(
    () => localStorage.getItem(MODEL_STORAGE_KEY) ?? 'default',
  );
  const [claudeModels, setClaudeModels] = useState(FALLBACK_CLAUDE_MODELS);
  const [sending, setSending] = useState(false);
  const [queuedPrompt, setQueuedPrompt] = useState<string>();
  const [streamStatus, setStreamStatus] = useState('Claude Code 正在处理任务…');
  const [repositories, setRepositories] = useState<LocalRepositoryInfo[]>([]);
  const [cliStatus, setCliStatus] = useState<'checking' | 'ready' | 'missing'>(
    'checking',
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamTextRef = useRef('');
  const activeRequestIdRef = useRef<string>();
  const runningConversationIdRef = useRef<string>();
  const visibleConversationIdRef = useRef<string>();
  const isComposingRef = useRef(false);
  const compositionEndedAtRef = useRef(0);
  const promptHistory = useClaudePromptHistory(messages);

  const resetConversation = useCallback(() => {
    setSessionId(undefined);
    setConversationId(undefined);
    setCreatedAt(undefined);
    setConversationTitle(undefined);
    setConversationContextKey(undefined);
    setConversationContextText(undefined);
    setMessages([]);
    setStreamStatus('Claude Code 正在处理任务…');
    streamTextRef.current = '';
  }, []);

  useEffect(() => {
    localStorage.setItem(MODEL_STORAGE_KEY, selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    const refreshModels = () => {
      void listClaudeCodeModels()
        .then(setClaudeModels)
        .catch(() => setClaudeModels(FALLBACK_CLAUDE_MODELS));
    };
    refreshModels();
    window.addEventListener('focus', refreshModels);
    return () => window.removeEventListener('focus', refreshModels);
  }, []);

  useEffect(() => {
    void detectCliCapabilities()
      .then((capabilities) => {
        const claude = capabilities.find((item) => item.id === 'claude-code');
        setCliStatus(claude?.available ? 'ready' : 'missing');
      })
      .catch(() => setCliStatus('missing'));
  }, []);

  useEffect(() => {
    let active = true;
    visibleConversationIdRef.current = requestedConversationId ?? undefined;
    if (
      activeRequestIdRef.current &&
      runningConversationIdRef.current !== requestedConversationId
    ) {
      activeRequestIdRef.current = undefined;
      runningConversationIdRef.current = undefined;
      setSending(false);
      setStreamStatus('Claude Code 正在处理任务…');
    }
    if (!requestedConversationId) {
      if (requestedRepositoryPath) {
        setWorkspacePath(requestedRepositoryPath);
        setConversationId(undefined);
        setCreatedAt(undefined);
        setConversationTitle(undefined);
        setConversationContextKey(undefined);
        setConversationContextText(undefined);
        setSessionId(undefined);
        setMessages([]);
        setDraft('');
      }
      return;
    }

    void getClaudeCodeConversation(requestedConversationId)
      .then((conversation) => {
        if (!active || !conversation) return;
        setWorkspacePath(conversation.repositoryPath);
        setConversationId(conversation.id);
        setCreatedAt(conversation.createdAt);
        setConversationTitle(conversation.title);
        setConversationContextKey(
          requestedTomatoCardId || linkedTomatoCardId
            ? `tomato:${requestedTomatoCardId ?? linkedTomatoCardId}`
            : conversation.contextKey,
        );
        setConversationContextText(conversation.contextText);
        setSessionId(conversation.claudeSessionId || undefined);
        setMessages(conversation.messages);
        setDraft('');
      })
      .catch((error) => {
        if (!active) return;
        toast.error('无法加载 Claude Code 对话', {
          description: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      active = false;
    };
  }, [
    linkedTomatoCardId,
    requestedConversationId,
    requestedRepositoryPath,
    requestedTomatoCardId,
  ]);

  useEffect(() => {
    if (!requestedConversationId) return;
    const syncRuntime = () => {
      const requestId = getActiveClaudeRequestId(requestedConversationId);
      if (requestId) {
        activeRequestIdRef.current = requestId;
        runningConversationIdRef.current = requestedConversationId;
        setSending(true);
        setStreamStatus('Claude Code 正在后台处理…');
      } else if (runningConversationIdRef.current === requestedConversationId) {
        activeRequestIdRef.current = undefined;
        runningConversationIdRef.current = undefined;
        setSending(false);
      }
    };
    syncRuntime();
    window.addEventListener(CLAUDE_RUNTIME_CHANGED_EVENT, syncRuntime);
    return () =>
      window.removeEventListener(CLAUDE_RUNTIME_CHANGED_EVENT, syncRuntime);
  }, [requestedConversationId]);

  useEffect(() => {
    if (!requestedConversationId) return;
    const refresh = () => {
      if (runningConversationIdRef.current === requestedConversationId) return;
      void getClaudeCodeConversation(requestedConversationId).then(
        (conversation) => {
          if (!conversation) return;
          setSessionId(conversation.claudeSessionId || undefined);
          setConversationTitle(conversation.title);
          setConversationContextKey(conversation.contextKey);
          setConversationContextText(conversation.contextText);
          setMessages(conversation.messages);
        },
      );
    };
    window.addEventListener(CLAUDE_CONVERSATIONS_CHANGED_EVENT, refresh);
    return () =>
      window.removeEventListener(CLAUDE_CONVERSATIONS_CHANGED_EVENT, refresh);
  }, [requestedConversationId]);

  const loadRepositories = useCallback(async () => {
    const paths = await listRegisteredRepositoryPaths();
    const results = await Promise.allSettled(paths.map(inspectLocalRepository));
    const availableRepositories = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    setRepositories(availableRepositories);
    if (
      workspacePath &&
      !availableRepositories.some(
        (repository) => repository.path === workspacePath,
      )
    ) {
      setWorkspacePath('');
      resetConversation();
    }
  }, [resetConversation, workspacePath]);

  useEffect(() => {
    void loadRepositories();
    const refresh = () => void loadRepositories();
    window.addEventListener('repository-registry-changed', refresh);
    return () =>
      window.removeEventListener('repository-registry-changed', refresh);
  }, [loadRepositories]);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        workspacePath,
        conversationId,
        createdAt,
        title: conversationTitle,
        sessionId,
        messages,
      }),
    );
  }, [
    conversationId,
    conversationTitle,
    createdAt,
    messages,
    sessionId,
    workspacePath,
  ]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const sendMessage = useCallback(
    async (promptOverride?: string) => {
      const prompt = (promptOverride ?? draft).trim();
      if (!prompt || sending) return;
      if (!workspacePath.trim()) {
        toast.error('请先选择仓库');
        return;
      }

      const assistantMessageId = crypto.randomUUID();
      const currentConversationId = conversationId ?? crypto.randomUUID();
      visibleConversationIdRef.current = currentConversationId;
      runningConversationIdRef.current = currentConversationId;
      const now = Date.now();
      const nextCreatedAt = createdAt ?? now;
      const currentTitle = conversationTitle ?? prompt;
      const currentContextKey =
        conversationContextKey ?? `repository:${workspacePath}`;
      const pendingMessages: ConversationMessage[] = [
        ...messages,
        { id: crypto.randomUUID(), role: 'user', content: prompt },
        { id: assistantMessageId, role: 'assistant', content: '' },
      ];
      setConversationId(currentConversationId);
      setCreatedAt(nextCreatedAt);
      setConversationTitle(currentTitle);
      setMessages(pendingMessages);
      setDraft('');
      setSending(true);
      setStreamStatus('Claude Code 正在处理任务…');
      streamTextRef.current = '';

      const repository = repositories.find(
        (item) => item.path === workspacePath,
      );
      const currentContextText =
        conversationContextText ??
        `本地仓库：${repository?.name ?? workspacePath}\n路径：${workspacePath}`;
      try {
        await saveClaudeCodeConversation({
          id: currentConversationId,
          claudeSessionId: sessionId ?? '',
          repositoryPath: workspacePath,
          contextKey: currentContextKey,
          title: currentTitle,
          contextText: currentContextText,
          messages: pendingMessages,
          createdAt: nextCreatedAt,
          updatedAt: now,
        });
        setSearchParams(
          {
            repositoryPath: workspacePath,
            conversation: currentConversationId,
          },
          { replace: true },
        );
        const response = await sendClaudeCodeMessage({
          prompt,
          workspacePath,
          model: selectedModel === 'default' ? undefined : selectedModel,
          sessionId,
          conversationId: currentConversationId,
          onRequestStart: (requestId) => {
            activeRequestIdRef.current = requestId;
          },
          onStream: (event) => {
            if (visibleConversationIdRef.current !== currentConversationId)
              return;
            if (event.kind === 'session_id') {
              setSessionId(event.text);
              void saveClaudeCodeConversation({
                id: currentConversationId,
                claudeSessionId: event.text,
                repositoryPath: workspacePath,
                contextKey: currentContextKey,
                title: currentTitle,
                contextText: currentContextText,
                messages: pendingMessages,
                createdAt: nextCreatedAt,
                updatedAt: Date.now(),
              });
              return;
            }
            if (event.kind === 'status') {
              setStreamStatus(event.text);
              return;
            }

            streamTextRef.current += event.text;
            const streamedContent = streamTextRef.current;
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessageId
                  ? { ...message, content: streamedContent }
                  : message,
              ),
            );
          },
        });
        if (visibleConversationIdRef.current === currentConversationId) {
          setSessionId(response.sessionId);
        }
        const completedMessages = pendingMessages.map((message) =>
          message.id === assistantMessageId
            ? { ...message, content: response.result }
            : message,
        );
        if (visibleConversationIdRef.current === currentConversationId) {
          setMessages(completedMessages);
        }
        await saveClaudeCodeConversation({
          id: currentConversationId,
          claudeSessionId: response.sessionId,
          repositoryPath: workspacePath,
          contextKey: currentContextKey,
          title: currentTitle,
          contextText: currentContextText,
          messages: completedMessages,
          createdAt: nextCreatedAt,
          updatedAt: Date.now(),
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        const wasPaused = errorMessage.includes('Claude Code 已暂停');
        const failedMessages = pendingMessages.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                content: wasPaused
                  ? streamTextRef.current || '已暂停'
                  : `Claude Code 执行失败：${errorMessage}`,
              }
            : message,
        );
        if (visibleConversationIdRef.current === currentConversationId) {
          setMessages(failedMessages);
        }
        await saveClaudeCodeConversation({
          id: currentConversationId,
          claudeSessionId: sessionId ?? '',
          repositoryPath: workspacePath,
          contextKey: currentContextKey,
          title: currentTitle,
          contextText: currentContextText,
          messages: failedMessages,
          createdAt: nextCreatedAt,
          updatedAt: Date.now(),
        });
        if (!wasPaused) {
          toast.error('Claude Code 执行失败', { description: errorMessage });
        }
      } finally {
        if (runningConversationIdRef.current === currentConversationId) {
          activeRequestIdRef.current = undefined;
          runningConversationIdRef.current = undefined;
        }
        if (
          visibleConversationIdRef.current === currentConversationId &&
          runningConversationIdRef.current !== currentConversationId
        ) {
          setSending(false);
        }
      }
    },
    [
      conversationId,
      conversationContextKey,
      conversationContextText,
      conversationTitle,
      createdAt,
      draft,
      messages,
      repositories,
      selectedModel,
      sending,
      sessionId,
      setSearchParams,
      workspacePath,
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

  const recallPrompt = useCallback(
    (direction: 'previous' | 'next') => {
      const recalled = promptHistory.navigate(direction, draft);
      if (recalled !== null) setDraft(recalled);
    },
    [draft, promptHistory],
  );

  const tomatoCardId =
    requestedTomatoCardId ??
    linkedTomatoCardId ??
    (conversationContextKey?.startsWith('tomato:')
      ? conversationContextKey.slice('tomato:'.length)
      : undefined);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex min-h-14 items-center justify-between gap-4 border-b px-5 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <TerminalSquare className="size-5 shrink-0" />
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">
              Claude Code 助手
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              独立 Claude CLI 会话
            </p>
          </div>
          <Badge variant={cliStatus === 'ready' ? 'default' : 'secondary'}>
            {cliStatus === 'checking'
              ? '检测中'
              : cliStatus === 'ready'
                ? 'CLI 可用'
                : 'CLI 不可用'}
          </Badge>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {tomatoCardId ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                navigate(`/tomato?cardId=${encodeURIComponent(tomatoCardId)}`)
              }
            >
              <ArrowLeft />
              返回番茄卡片
            </Button>
          ) : null}
          <Select
            value={workspacePath}
            onValueChange={(path) => {
              setSearchParams({}, { replace: true });
              setWorkspacePath(path);
              resetConversation();
            }}
            disabled={sending}
          >
            <SelectTrigger className="h-8 w-44 text-xs">
              <SelectValue placeholder="选择仓库" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {repositories.map((repository) => (
                  <SelectItem
                    key={repository.path}
                    value={repository.path}
                    title={repository.path}
                  >
                    {repository.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSearchParams(
                workspacePath ? { repositoryPath: workspacePath } : {},
                { replace: true },
              );
              resetConversation();
            }}
            disabled={sending || messages.length === 0}
          >
            <Plus />
            新建对话
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        <div className="mx-auto max-w-4xl space-y-5">
          {messages.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center text-center">
              <Bot className="mb-4 size-10 text-muted-foreground" />
              <h2 className="text-sm font-medium">从代码库中的任务开始</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Claude Code 可读取、修改文件并执行命令
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <article
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
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
                    <div className="prose prose-sm max-w-none break-words text-foreground dark:prose-invert">
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
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {streamStatus}
            </div>
          ) : null}
          <div ref={messagesEndRef} />
        </div>
      </main>

      <footer className="shrink-0 border-t bg-background/95 px-5 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto max-w-4xl rounded-xl border bg-background p-2 shadow-sm focus-within:ring-2 focus-within:ring-ring/40">
          <Textarea
            value={draft}
            onChange={(event) => {
              promptHistory.reset();
              setDraft(event.target.value);
            }}
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
                return;
              }
              if (
                event.key === 'ArrowUp' &&
                !event.currentTarget.value
                  .slice(0, event.currentTarget.selectionStart)
                  .includes('\n')
              ) {
                event.preventDefault();
                recallPrompt('previous');
              } else if (
                event.key === 'ArrowDown' &&
                !event.currentTarget.value
                  .slice(event.currentTarget.selectionStart)
                  .includes('\n')
              ) {
                event.preventDefault();
                recallPrompt('next');
              }
            }}
            placeholder="给 Claude Code 分配任务"
            disabled={cliStatus !== 'ready'}
            className="max-h-48 min-h-16 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center justify-between gap-2 px-1 pt-1">
            <Select
              value={selectedModel}
              onValueChange={setSelectedModel}
              disabled={sending}
            >
              <SelectTrigger size="sm" className="w-56 border-0 shadow-none">
                <SelectValue aria-label="选择 Claude 模型" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {claudeModels.map((model) => (
                    <SelectItem key={model.value} value={model.value}>
                      {model.configuredModel
                        ? `${model.label} · ${model.configuredModel}`
                        : model.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button
              size="icon"
              onClick={() =>
                void (sending ? pauseOrInterject() : sendMessage())
              }
              disabled={cliStatus !== 'ready' || (!sending && !draft.trim())}
              title={sending ? (draft.trim() ? '插话' : '暂停') : '发送'}
            >
              {sending ? draft.trim() ? <Send /> : <Square /> : <Send />}
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}
