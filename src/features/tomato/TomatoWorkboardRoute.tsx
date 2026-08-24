import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowUpRight,
  Home,
  Circle,
  GripVertical,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  executeTomatoTransition,
  getTomatoItem,
  listTomatoTransitions,
  searchTomatoItems,
} from '@/lib/backend/tomato';
import { openExternalUrl } from '@/lib/backend/utils';
import { ClaudeCodeInlineChat } from '@/features/claude-code/ClaudeCodeInlineChat';
import {
  inspectLocalRepository,
  listRegisteredRepositoryPaths,
  type LocalRepositoryInfo,
} from '@/lib/backend/repositories';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  readTomatoConversationLinks,
  storeTomatoConversationLink,
} from '@/lib/tomato-conversation-links';

const STATUS_ORDER = ['新建', 'Bugfix', '修复中', '开发中', '待测试', '测试中'];
const FILTER_STORAGE_KEYS = {
  excludedTypes: 'moark:tomato:excluded-types',
  excludedStatuses: 'moark:tomato:excluded-statuses',
  knownTypes: 'moark:tomato:known-types',
  knownStatuses: 'moark:tomato:known-statuses',
  laneOrder: 'moark:tomato:lane-order',
  searchQuery: 'moark:tomato:search-query',
  deferredCards: 'moark:tomato:deferred-cards',
} as const;
const TOMATO_REPOSITORY_LINKS_KEY = 'libragent.tomato.repository-links.v1';
const PRIORITIES: Record<string, string> = {
  '69e65065-4b34-4109-bca9-0154e548554a': 'P0',
  '8f7912a5-9176-4a79-a269-2269ac42b5a2': 'P1',
  'ca8c3e43-3e7b-444d-8940-d0967d944921': 'P2',
  '1a3e1092-7d70-42ee-ad38-0e8d953c4c23': 'P3',
  'faae52da-28c8-46fc-96dd-db9cdb28b557': 'P4',
};
const PRIORITY_ORDER: Record<string, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
  P4: 4,
};
const PRIORITY_STYLES: Record<string, string> = {
  P0: 'border-red-500/40 bg-red-500/15 text-red-600 dark:text-red-400',
  P1: 'border-orange-500/40 bg-orange-500/15 text-orange-600 dark:text-orange-400',
  P2: 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400',
  P3: 'border-blue-500/35 bg-blue-500/10 text-blue-600 dark:text-blue-400',
  P4: 'border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-400',
};

interface NamedValue {
  name?: string;
  label?: string;
  nickname?: string;
  username?: string;
  value?: string;
  key?: string;
  transition?: string;
  targetStatus?: string;
  disabled?: boolean;
  disabledReason?: string;
}
interface TomatoCard {
  id?: string;
  itemId?: string;
  objectId?: string;
  key?: string;
  name?: string;
  title?: string;
  status?: NamedValue | string;
  itemType?: NamedValue;
  workspace?: NamedValue;
  createdBy?: NamedValue;
  updatedBy?: NamedValue;
  createdAt?: string;
  updatedAt?: string;
  version?: number;
  values?: Record<string, unknown>;
  [key: string]: unknown;
}
interface TomatoSearchResponse {
  items?: TomatoCard[];
  data?: { items?: TomatoCard[] };
  result?: { items?: TomatoCard[] };
}

const cardId = (card: TomatoCard) =>
  card.itemId ?? card.id ?? card.objectId ?? '';
const cardTitle = (card: TomatoCard) => card.name ?? card.title ?? '未命名事项';
const itemKey = (card: TomatoCard) => card.key ?? cardId(card);

function valueName(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(valueName).find(Boolean) ?? '';
  if (value && typeof value === 'object') {
    const named = value as NamedValue;
    return (
      [
        named.name,
        named.label,
        named.nickname,
        named.username,
        named.value,
        named.key,
        named.targetStatus,
        named.transition,
      ]
        .find((entry) => typeof entry === 'string' && entry.trim())
        ?.trim() ?? ''
    );
  }
  return '';
}

const statusName = (card: TomatoCard) => valueName(card.status) || '未分类';

function richText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value))
    return value.map(richText).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  return typeof record.text === 'string'
    ? record.text
    : richText(record.children);
}

function priority(card: TomatoCard): string {
  const raw = valueName(card.values?.priority);
  return PRIORITIES[raw] ?? raw;
}

function creatorName(card: TomatoCard): string {
  return (
    valueName(card.createdBy).replace(/\s*[（(][^（）()]+[）)]\s*$/u, '') ||
    '未知'
  );
}

function tomatoUrl(key: string): string {
  const workspace = key
    .replace(/-\d{4}-\d+$/u, '')
    .replace(/-\d+$/u, '')
    .toLowerCase();
  const url = new URL(
    `/_team/xly-poc/item/${encodeURIComponent(key)}`,
    'https://osc.gitee.work',
  );
  url.searchParams.set('workspace', workspace);
  url.searchParams.set('tenant', 'xly-poc');
  url.searchParams.set('hiddenHeader', 'true');
  url.searchParams.set('from', 'one');
  url.searchParams.set('frameless', 'true');
  return url.toString();
}

function formatTime(value?: string): string {
  if (!value) return '未设置';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function readStoredSet(key: string): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return new Set(
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [],
    );
  } catch {
    return new Set();
  }
}

function storeSet(key: string, values: Set<string>): void {
  localStorage.setItem(key, JSON.stringify(Array.from(values)));
}

function readRepositoryLinks(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(TOMATO_REPOSITORY_LINKS_KEY) ?? '{}',
    );
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    return {};
  }
}

function storeRepositoryLink(itemId: string, repositoryPath: string): void {
  const links = readRepositoryLinks();
  links[itemId] = repositoryPath;
  localStorage.setItem(TOMATO_REPOSITORY_LINKS_KEY, JSON.stringify(links));
}

function readStoredStrings(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function mergeLaneOrder(statuses: string[], storedOrder: string[]): string[] {
  const available = new Set(statuses);
  return [
    ...storedOrder.filter((status) => available.delete(status)),
    ...statuses.filter((status) => available.has(status)),
  ];
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

interface LaneDragState {
  pointerId: number;
  activeIndex: number;
  targetIndex: number;
  startClientX: number;
  startScrollLeft: number;
  offsetX: number;
  stride: number;
}

function CardTags({ card }: { card: TomatoCard }) {
  const creator = creatorName(card);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
      <Badge variant="secondary" className="h-5 rounded px-1.5 font-normal">
        {valueName(card.itemType) || '事项'}
      </Badge>
      {priority(card) && (
        <Badge
          variant="outline"
          className={`h-5 rounded px-1.5 font-semibold ${PRIORITY_STYLES[priority(card)] ?? ''}`}
        >
          {priority(card)}
        </Badge>
      )}
      <span
        className="inline-flex min-w-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5"
        title={`创建人：${creator}`}
      >
        <UserRound className="size-3" />
        <span className="max-w-28 truncate">{creator}</span>
      </span>
    </div>
  );
}

function TomatoDetail({
  card,
  onBack,
  onCardUpdated,
}: {
  card: TomatoCard;
  onBack: () => void;
  onCardUpdated: (card: TomatoCard) => void;
}) {
  const navigate = useNavigate();
  const [detail, setDetail] = useState<TomatoCard | null>(null);
  const [transitions, setTransitions] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [repositories, setRepositories] = useState<LocalRepositoryInfo[]>([]);
  const [repositoryPath, setRepositoryPath] = useState(
    () => readRepositoryLinks()[cardId(card)] ?? '',
  );
  const [conversationId, setConversationId] = useState<string | undefined>(
    () => readTomatoConversationLinks()[cardId(card)],
  );
  const id = cardId(card);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getTomatoItem<TomatoCard>(id),
      listTomatoTransitions<unknown>(id),
    ])
      .then(([nextDetail, transitionPayload]) => {
        if (!active) return;
        setDetail(nextDetail);
        const payload = transitionPayload as
          | { transitions?: unknown[]; data?: unknown[] }
          | unknown[];
        setTransitions(
          Array.isArray(payload)
            ? payload
            : (payload.transitions ?? payload.data ?? []),
        );
      })
      .catch((error: unknown) =>
        toast.error('加载番茄详情失败', {
          description: error instanceof Error ? error.message : '未知错误',
        }),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    setRepositoryPath(readRepositoryLinks()[id] ?? '');
    setConversationId(readTomatoConversationLinks()[id]);
  }, [id]);

  useEffect(() => {
    let active = true;
    void listRegisteredRepositoryPaths()
      .then((paths) => Promise.allSettled(paths.map(inspectLocalRepository)))
      .then((results) => {
        if (!active) return;
        setRepositories(
          results.flatMap((result) =>
            result.status === 'fulfilled' ? [result.value] : [],
          ),
        );
      });
    return () => {
      active = false;
    };
  }, []);

  const current = detail ?? card;
  const values = current.values ?? {};
  const key = itemKey(current);
  const detailFields = [
    ['根因分析', valueName(values.reason2)],
    ['RD 引入原因', valueName(values.Dropdown12)],
    ['原因描述', richText(values.Editor33)],
    ['修复版本', valueName(values.CustomVersion2)],
    ['解决方案', richText(values.Solution)],
  ].filter(([, value]) => value);
  const sprint = valueName(values.sprint) || '未设置';
  const claudeContext = [
    `番茄卡片：${key}`,
    `标题：${cardTitle(current)}`,
    `状态：${statusName(current)}`,
    `优先级：${priority(current) || '未设置'}`,
    `类型：${valueName(current.itemType) || '未设置'}`,
    `迭代：${sprint}`,
    ...detailFields.map(([label, value]) => `${label}：${value}`),
  ].join('\n');

  const handleConversationIdChange = useCallback(
    (nextConversationId: string) => {
      setConversationId(nextConversationId);
      storeTomatoConversationLink(id, nextConversationId);
    },
    [id],
  );

  const executeTransition = async (transitionValue: unknown) => {
    const transition = transitionValue as NamedValue;
    const transitionName = transition.transition?.trim();
    if (!transitionName || transition.disabled || transitioning) return;
    setTransitioning(transitionName);
    try {
      await executeTomatoTransition(id, transitionName);
      const [nextDetail, transitionPayload] = await Promise.all([
        getTomatoItem<TomatoCard>(id),
        listTomatoTransitions<unknown>(id),
      ]);
      setDetail(nextDetail);
      onCardUpdated(nextDetail);
      const payload = transitionPayload as
        | { transitions?: unknown[]; data?: unknown[] }
        | unknown[];
      setTransitions(
        Array.isArray(payload)
          ? payload
          : (payload.transitions ?? payload.data ?? []),
      );
      toast.success(`已流转到「${transition.targetStatus || transitionName}」`);
    } catch (error) {
      toast.error('番茄卡片流转失败', {
        description: error instanceof Error ? error.message : '未知错误',
      });
    } finally {
      setTransitioning(null);
    }
  };

  return (
    <div className="tomato-scrollbar h-full overflow-x-hidden overflow-y-auto bg-background">
      <header className="sticky top-0 z-10 flex min-h-14 items-center justify-between gap-4 border-b bg-background/95 px-5 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            title="返回番茄工作台首页"
          >
            <Home />
          </Button>
          <span className="font-mono text-sm text-muted-foreground">{key}</span>
        </div>
        <div className="flex items-center gap-2">
          {transitions.map((transitionValue, index) => {
            const transition = transitionValue as NamedValue;
            const transitionName =
              transition.transition || valueName(transition);
            const disabled =
              transition.disabled === true || Boolean(transitioning);
            return (
              <Button
                key={`${transitionName}-${index}`}
                variant="secondary"
                size="sm"
                disabled={disabled}
                title={transition.disabledReason}
                onClick={() => void executeTransition(transitionValue)}
              >
                {transitioning === transitionName
                  ? '流转中…'
                  : transition.targetStatus || transitionName}
              </Button>
            );
          })}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openExternalUrl(tomatoUrl(key))}
          >
            <ArrowUpRight />
            打开番茄
          </Button>
        </div>
      </header>
      {loading && !detail ? (
        <div className="flex h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在加载详情…
        </div>
      ) : (
        <div className="mx-auto grid w-full max-w-6xl grid-cols-[minmax(0,1fr)_280px] gap-10 px-8 py-7">
          <main className="min-w-0">
            <h1 className="text-2xl font-semibold leading-snug tracking-tight">
              {cardTitle(current)}
            </h1>
            <CardTags card={current} />
            <div className="mt-8 space-y-7">
              {detailFields.map(([label, value]) => (
                <section key={label}>
                  <h2 className="mb-2 text-sm font-semibold">{label}</h2>
                  <p className="whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">
                    {value}
                  </p>
                </section>
              ))}
            </div>
            <div className="mt-8">
              {conversationId && repositoryPath ? (
                <div className="mb-2 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      navigate(
                        `/claude-code?repositoryPath=${encodeURIComponent(repositoryPath)}&conversation=${encodeURIComponent(conversationId)}&cardId=${encodeURIComponent(id)}`,
                      )
                    }
                  >
                    <ArrowUpRight />
                    打开完整对话
                  </Button>
                </div>
              ) : null}
              <ClaudeCodeInlineChat
                contextKey={`tomato:${id}`}
                contextTitle={`${key} · ${cardTitle(current)}`}
                contextText={claudeContext}
                repositoryPath={repositoryPath || undefined}
                conversationId={conversationId}
                onConversationIdChange={handleConversationIdChange}
              />
            </div>
          </main>
          <aside className="h-fit rounded-xl border bg-card p-5">
            <h2 className="mb-4 text-sm font-semibold">卡片信息</h2>
            <dl className="space-y-4 text-sm">
              <div>
                <dt className="mb-2 text-muted-foreground">所属仓库</dt>
                <dd>
                  <Select
                    value={repositoryPath}
                    onValueChange={(path) => {
                      setRepositoryPath(path);
                      storeRepositoryLink(id, path);
                      setConversationId(undefined);
                      storeTomatoConversationLink(id);
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="选择仓库" />
                    </SelectTrigger>
                    <SelectContent>
                      {repositories.map((repository) => (
                        <SelectItem
                          key={repository.path}
                          value={repository.path}
                        >
                          {repository.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </dd>
              </div>
              {[
                ['迭代', sprint],
                ['状态', statusName(current)],
                ['优先级', priority(current) || '未设置'],
                ['类型', valueName(current.itemType) || '未设置'],
                ['工作区', valueName(current.workspace) || '未设置'],
                ['创建者', creatorName(current)],
                ['更新者', valueName(current.updatedBy) || '未知'],
                ['创建时间', formatTime(current.createdAt)],
                ['更新时间', formatTime(current.updatedAt)],
                ['数据版本', current.version?.toString() || '未设置'],
              ].map(([label, value]) => (
                <div key={label} className="grid grid-cols-[72px_1fr] gap-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="min-w-0 break-words">{value}</dd>
                </div>
              ))}
            </dl>
          </aside>
        </div>
      )}
    </div>
  );
}

export default function TomatoWorkboardRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedCardId = searchParams.get('cardId');
  const [cards, setCards] = useState<TomatoCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<TomatoCard | null>(null);
  const [excludedTypes, setExcludedTypes] = useState<Set<string>>(() =>
    readStoredSet(FILTER_STORAGE_KEYS.excludedTypes),
  );
  const [excludedStatuses, setExcludedStatuses] = useState<Set<string>>(() =>
    readStoredSet(FILTER_STORAGE_KEYS.excludedStatuses),
  );
  const [knownTypes, setKnownTypes] = useState<Set<string>>(() =>
    readStoredSet(FILTER_STORAGE_KEYS.knownTypes),
  );
  const [knownStatuses, setKnownStatuses] = useState<Set<string>>(() =>
    readStoredSet(FILTER_STORAGE_KEYS.knownStatuses),
  );
  const [laneOrder, setLaneOrder] = useState<string[]>(() =>
    readStoredStrings(FILTER_STORAGE_KEYS.laneOrder),
  );
  const [deferredCards, setDeferredCards] = useState<Set<string>>(() =>
    readStoredSet(FILTER_STORAGE_KEYS.deferredCards),
  );
  const [laneDrag, setLaneDrag] = useState<LaneDragState | null>(null);
  const [searchQuery, setSearchQuery] = useState(
    () => localStorage.getItem(FILTER_STORAGE_KEYS.searchQuery) ?? '',
  );
  const searchInputRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const loadCards = useCallback(
    async (notify = false) => {
      setLoading(true);
      setError(null);
      try {
        const response = await searchTomatoItems<TomatoSearchResponse>({
          size: 50,
          excludedTypes: Array.from(excludedTypes),
          excludedStatuses: Array.from(excludedStatuses),
        });
        const nextCards =
          response.items ??
          response.data?.items ??
          response.result?.items ??
          [];
        setCards(nextCards);
        setKnownTypes((current) => {
          const next = new Set(current);
          nextCards.forEach((card) =>
            next.add(valueName(card.itemType) || '事项'),
          );
          storeSet(FILTER_STORAGE_KEYS.knownTypes, next);
          return next;
        });
        setKnownStatuses((current) => {
          const next = new Set(current);
          nextCards.forEach((card) => next.add(statusName(card)));
          storeSet(FILTER_STORAGE_KEYS.knownStatuses, next);
          return next;
        });
        if (notify)
          toast.success('番茄工作台已刷新', {
            description: `已加载 ${nextCards.length} 个事项`,
          });
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : '加载番茄卡片失败';
        setError(message);
        if (notify) toast.error('番茄工作台刷新失败', { description: message });
      } finally {
        setLoading(false);
      }
    },
    [excludedStatuses, excludedTypes],
  );
  useEffect(() => void loadCards(false), [loadCards]);
  useEffect(() => {
    if (!requestedCardId) {
      setSelectedCard(null);
      return;
    }
    const card = cards.find((item) => cardId(item) === requestedCardId);
    if (card) {
      setSelectedCard((current) =>
        current && cardId(current) === requestedCardId ? current : card,
      );
    }
  }, [cards, requestedCardId]);
  useEffect(() => {
    storeSet(FILTER_STORAGE_KEYS.excludedTypes, excludedTypes);
  }, [excludedTypes]);
  useEffect(() => {
    storeSet(FILTER_STORAGE_KEYS.excludedStatuses, excludedStatuses);
  }, [excludedStatuses]);
  useEffect(() => {
    localStorage.setItem(FILTER_STORAGE_KEYS.searchQuery, searchQuery);
  }, [searchQuery]);
  useEffect(() => {
    storeSet(FILTER_STORAGE_KEYS.deferredCards, deferredCards);
  }, [deferredCards]);
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (
        event.key.toLocaleLowerCase() !== 'f' ||
        (!event.ctrlKey && !event.metaKey)
      ) {
        return;
      }
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);
  const cardTypes = useMemo(
    () =>
      Array.from(
        new Set([
          ...knownTypes,
          ...cards.map((card) => valueName(card.itemType) || '事项'),
        ]),
      ).sort((left, right) => left.localeCompare(right, 'zh-CN')),
    [cards, knownTypes],
  );
  const cardStatuses = useMemo(() => {
    const statuses = new Set([...knownStatuses, ...cards.map(statusName)]);
    return [
      ...STATUS_ORDER.filter((status) => statuses.has(status)),
      ...Array.from(statuses).filter(
        (status) => !STATUS_ORDER.includes(status),
      ),
    ];
  }, [cards, knownStatuses]);
  const orderedStatuses = useMemo(
    () => mergeLaneOrder(cardStatuses, laneOrder),
    [cardStatuses, laneOrder],
  );
  const visibleCards = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase('zh-CN');
    return cards.filter((card) => {
      const type = valueName(card.itemType) || '事项';
      if (excludedTypes.has(type) || excludedStatuses.has(statusName(card))) {
        return false;
      }
      if (!query) return true;
      return [cardTitle(card), creatorName(card)].some((value) =>
        value.toLocaleLowerCase('zh-CN').includes(query),
      );
    });
  }, [cards, excludedStatuses, excludedTypes, searchQuery]);
  const columns = useMemo(() => {
    return orderedStatuses
      .filter((status) => !excludedStatuses.has(status))
      .map((status) => ({
        status,
        cards: visibleCards
          .filter((card) => statusName(card) === status)
          .sort((left, right) => {
            const deferredDifference =
              Number(deferredCards.has(cardId(left))) -
              Number(deferredCards.has(cardId(right)));
            if (deferredDifference !== 0) return deferredDifference;
            const priorityDifference =
              (PRIORITY_ORDER[priority(left)] ?? Number.MAX_SAFE_INTEGER) -
              (PRIORITY_ORDER[priority(right)] ?? Number.MAX_SAFE_INTEGER);
            if (priorityDifference !== 0) return priorityDifference;
            return (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '');
          }),
      }))
      .filter((column) => column.cards.length > 0);
  }, [deferredCards, excludedStatuses, orderedStatuses, visibleCards]);

  const toggleDeferredCard = useCallback((id: string) => {
    if (!id) return;
    setDeferredCards((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const beginLaneDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, activeIndex: number) => {
      if (event.button !== 0 || !boardRef.current) return;
      const lane = event.currentTarget.closest('section');
      if (!(lane instanceof HTMLElement)) return;

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setLaneDrag({
        pointerId: event.pointerId,
        activeIndex,
        targetIndex: activeIndex,
        startClientX: event.clientX,
        startScrollLeft: boardRef.current.scrollLeft,
        offsetX: 0,
        stride: lane.offsetWidth + 12,
      });
    },
    [],
  );

  const moveLaneDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!laneDrag || event.pointerId !== laneDrag.pointerId) return;
      const board = boardRef.current;
      if (!board) return;

      const bounds = board.getBoundingClientRect();
      const edgeSize = 72;
      const edgeDistance = Math.min(
        edgeSize,
        Math.max(0, event.clientX - bounds.left),
      );
      const rightEdgeDistance = Math.min(
        edgeSize,
        Math.max(0, bounds.right - event.clientX),
      );
      if (event.clientX < bounds.left + edgeSize) {
        board.scrollLeft -= Math.ceil((edgeSize - edgeDistance) / 4);
      } else if (event.clientX > bounds.right - edgeSize) {
        board.scrollLeft += Math.ceil((edgeSize - rightEdgeDistance) / 4);
      }

      const contentX = event.clientX - bounds.left + board.scrollLeft - 16;
      const targetIndex = Math.max(
        0,
        Math.min(columns.length - 1, Math.floor(contentX / laneDrag.stride)),
      );
      setLaneDrag({
        ...laneDrag,
        targetIndex,
        offsetX:
          event.clientX -
          laneDrag.startClientX +
          board.scrollLeft -
          laneDrag.startScrollLeft,
      });
    },
    [columns.length, laneDrag],
  );

  const finishLaneDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!laneDrag || event.pointerId !== laneDrag.pointerId) return;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (laneDrag.activeIndex !== laneDrag.targetIndex) {
        const visibleOrder = moveItem(
          columns.map((column) => column.status),
          laneDrag.activeIndex,
          laneDrag.targetIndex,
        );
        const visibleStatuses = new Set(visibleOrder);
        let visibleIndex = 0;
        const nextOrder = orderedStatuses.map((status) =>
          visibleStatuses.has(status) ? visibleOrder[visibleIndex++] : status,
        );
        setLaneOrder(nextOrder);
        localStorage.setItem(
          FILTER_STORAGE_KEYS.laneOrder,
          JSON.stringify(nextOrder),
        );
      }
      setLaneDrag(null);
    },
    [columns, laneDrag, orderedStatuses],
  );

  const toggleBlacklist = useCallback(
    (value: string, setter: Dispatch<SetStateAction<Set<string>>>) => {
      setter((current) => {
        const next = new Set(current);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        return next;
      });
    },
    [],
  );
  if (selectedCard)
    return (
      <TomatoDetail
        card={selectedCard}
        onBack={() => {
          setSelectedCard(null);
          setSearchParams({}, { replace: true });
          void loadCards(false);
        }}
        onCardUpdated={(updatedCard) => {
          setSelectedCard(updatedCard);
          setCards((current) =>
            current.map((card) =>
              cardId(card) === cardId(updatedCard) ? updatedCard : card,
            ),
          );
        }}
      />
    );
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-5">
        <div>
          <h1 className="text-base font-semibold">番茄工作台</h1>
          <p className="text-xs text-muted-foreground">
            {visibleCards.length} / {cards.length} 个事项
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void loadCards(true)}
          disabled={loading}
        >
          <RefreshCw className={loading ? 'animate-spin' : ''} />
          刷新
        </Button>
      </header>
      <div className="flex shrink-0 items-start justify-between gap-5 border-b bg-card/40 px-5 py-3">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 w-10 shrink-0 text-xs text-muted-foreground">
              类型
            </span>
            {cardTypes.map((type) => {
              const active = !excludedTypes.has(type);
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleBlacklist(type, setExcludedTypes)}
                  className={`rounded-md border px-2 py-1 text-xs transition-colors ${active ? 'border-primary/30 bg-primary/10 font-medium text-primary' : 'border-transparent bg-muted/60 text-muted-foreground opacity-60'}`}
                >
                  {type}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 w-10 shrink-0 text-xs text-muted-foreground">
              状态
            </span>
            {cardStatuses.map((status) => {
              const active = !excludedStatuses.has(status);
              return (
                <button
                  key={status}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleBlacklist(status, setExcludedStatuses)}
                  className={`rounded-md border px-2 py-1 text-xs transition-colors ${active ? 'border-primary/30 bg-primary/10 font-medium text-primary' : 'border-transparent bg-muted/60 text-muted-foreground opacity-60'}`}
                >
                  {status}
                </button>
              );
            })}
          </div>
        </div>
        <label className="flex h-9 w-64 shrink-0 items-center gap-2 rounded-md border bg-background px-3 focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
          <Search className="size-4 text-muted-foreground" />
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索标题或创建人"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
      </div>
      {loading && cards.length === 0 ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          正在加载番茄卡片…
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center p-6 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <div
          ref={boardRef}
          className="tomato-scrollbar flex min-h-0 flex-1 gap-3 overflow-x-auto p-4"
        >
          {columns.map((column, index) => {
            const isActive = laneDrag?.activeIndex === index;
            let shiftX = 0;
            if (laneDrag) {
              if (isActive) {
                shiftX = laneDrag.offsetX;
              } else if (
                laneDrag.targetIndex > laneDrag.activeIndex &&
                index > laneDrag.activeIndex &&
                index <= laneDrag.targetIndex
              ) {
                shiftX = -laneDrag.stride;
              } else if (
                laneDrag.targetIndex < laneDrag.activeIndex &&
                index >= laneDrag.targetIndex &&
                index < laneDrag.activeIndex
              ) {
                shiftX = laneDrag.stride;
              }
            }
            return (
              <section
                key={column.status}
                style={{ transform: `translate3d(${shiftX}px, 0, 0)` }}
                className={`flex w-72 shrink-0 flex-col rounded-xl border bg-muted/45 will-change-transform ${
                  isActive
                    ? 'z-20 scale-[1.025] border-primary/40 shadow-2xl shadow-black/20 transition-[scale,box-shadow] duration-150'
                    : 'border-transparent transition-transform duration-200 ease-out'
                }`}
              >
                <header
                  className={`flex touch-none select-none items-center justify-between px-3 py-2.5 ${
                    isActive ? 'cursor-grabbing' : 'cursor-grab'
                  }`}
                  onPointerDown={(event) => beginLaneDrag(event, index)}
                  onPointerMove={moveLaneDrag}
                  onPointerUp={finishLaneDrag}
                  onPointerCancel={finishLaneDrag}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <GripVertical className="size-4 text-muted-foreground/70" />
                    <Circle className="size-2.5 fill-current text-muted-foreground" />
                    {column.status}
                  </span>
                  <Badge variant="secondary">{column.cards.length}</Badge>
                </header>
                <div className="tomato-scrollbar space-y-2 overflow-y-auto px-2 pb-2">
                  {column.cards.map((card) => {
                    const id = cardId(card);
                    const isDeferred = deferredCards.has(id);
                    return (
                      <article
                        key={id || itemKey(card)}
                        className={`group relative rounded-lg border p-3 transition-[opacity,border-color,background-color] hover:border-primary/40 ${
                          isDeferred
                            ? 'border-muted-foreground/15 bg-muted/35 opacity-55 hover:bg-muted/50 hover:opacity-80'
                            : 'bg-card hover:bg-accent/30'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCard(card);
                            setSearchParams({ cardId: id }, { replace: true });
                          }}
                          className="absolute inset-0 rounded-lg"
                          aria-label={`打开 ${itemKey(card)} 详情`}
                        />
                        <div className="pointer-events-none relative flex items-start justify-between gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            {itemKey(card)}
                          </span>
                          <div className="pointer-events-auto flex items-center gap-0.5">
                            <button
                              type="button"
                              aria-pressed={isDeferred}
                              className={`rounded p-1 opacity-0 transition-colors hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 ${
                                isDeferred
                                  ? 'text-foreground'
                                  : 'text-muted-foreground'
                              }`}
                              title={isDeferred ? '恢复处理' : '暂不处理'}
                              onClick={() => toggleDeferredCard(id)}
                            >
                              {isDeferred ? (
                                <Play className="size-3.5" />
                              ) : (
                                <Pause className="size-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              className="rounded p-1 text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100"
                              title="在浏览器打开番茄卡片"
                              onClick={() =>
                                void openExternalUrl(tomatoUrl(itemKey(card)))
                              }
                            >
                              <ArrowUpRight className="size-3.5" />
                            </button>
                          </div>
                        </div>
                        <h3 className="relative mt-1.5 line-clamp-3 pointer-events-none text-sm font-medium leading-5">
                          {cardTitle(card)}
                        </h3>
                        <div className="relative pointer-events-none">
                          <CardTags card={card} />
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
