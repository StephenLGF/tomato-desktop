import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  BrainCircuit,
  BookmarkCheck,
  Network,
  Settings,
  Users,
  BookOpen,
  Blocks,
  Circle,
  Clock,
  Database,
  ChevronDown,
  ChevronRight,
  Loader2,
  ClipboardList,
  TerminalSquare,
  FolderGit2,
  MessageSquare,
  Plus,
  Pencil,
  Trash2,
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '../ui/sidebar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';
import {
  useAgentSessionListActions,
  useAgentSessionListState,
} from '@/context/AgentSessionListContext';
import { useUpdateContext } from '@/context/UpdateContext';
import { useInfiniteScroll } from '@/features/agent/components/use-session-scroll';
import { useKnownDirectChildCounts } from '@/features/agent/components/use-known-direct-child-counts';
import { getLogger } from '@/lib/logger';
import { cn } from '@/lib/utils';
import { buildSidebarSessionRows } from './sidebar-recent-sessions';
import {
  inspectLocalRepository,
  listRegisteredRepositoryPaths,
  saveRegisteredRepositoryPaths,
  type LocalRepositoryInfo,
} from '@/lib/backend/repositories';
import {
  CLAUDE_CONVERSATIONS_CHANGED_EVENT,
  listClaudeCodeConversations,
  saveClaudeCodeConversation,
  type ClaudeCodeConversation,
} from '@/lib/backend/claude-code-conversations';
import { findTomatoCardIdByConversation } from '@/lib/tomato-conversation-links';

const logger = getLogger('AppSidebar');

function claudeConversationPath(conversation: ClaudeCodeConversation): string {
  const params = new URLSearchParams({
    repositoryPath: conversation.repositoryPath,
    conversation: conversation.id,
  });
  const cardId = findTomatoCardIdByConversation(conversation.id);
  if (cardId) params.set('cardId', cardId);
  return `/claude-code?${params.toString()}`;
}

/** Maps session status to a semantically meaningful dot */
function StatusDot({ status }: { status: string }) {
  if (status === 'busy') {
    // Pulsing to signal active work
    return (
      <Circle
        size={8}
        className="fill-primary text-primary flex-shrink-0 animate-pulse"
      />
    );
  }
  if (status === 'queued') {
    return (
      <Circle
        size={8}
        className="fill-warning text-warning flex-shrink-0 animate-pulse"
      />
    );
  }
  if (status === 'error') {
    return (
      <Circle
        size={8}
        className="fill-destructive text-destructive flex-shrink-0"
      />
    );
  }
  // idle and paused: dimmed — just resting
  return (
    <Circle
      size={8}
      className="fill-muted-foreground text-muted-foreground flex-shrink-0 opacity-40"
    />
  );
}

export default function AppSidebar() {
  const { t } = useTranslation();
  const { state } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const isCollapsed = state === 'collapsed';
  const activeClaudeConversationId = new URLSearchParams(location.search).get(
    'conversation',
  );
  const { status: updateStatus } = useUpdateContext();
  const hasUpdate = updateStatus === 'available';

  const {
    sessions,
    hasMoreSessions,
    isLoadingMoreSessions,
    loadingChildrenParentIds,
  } = useAgentSessionListState();
  const { loadMoreSessions, ensureChildrenLoaded, deleteSession } =
    useAgentSessionListActions();
  const [sessionPendingDeletion, setSessionPendingDeletion] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [isDeletingSession, setIsDeletingSession] = useState(false);

  const recentSessionsRootRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const [expandedSessionIds, setExpandedSessionIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [projects, setProjects] = useState<LocalRepositoryInfo[]>([]);
  const [claudeConversations, setClaudeConversations] = useState<
    ClaudeCodeConversation[]
  >([]);
  const [editingClaudeConversationId, setEditingClaudeConversationId] =
    useState<string>();
  const [editingClaudeTitle, setEditingClaudeTitle] = useState('');
  const [projectsSectionOpen, setProjectsSectionOpen] = useState(true);
  const [resourcesSectionOpen, setResourcesSectionOpen] = useState(true);
  const [expandedProjectPaths, setExpandedProjectPaths] = useState<Set<string>>(
    () => new Set(),
  );

  const loadProjects = useCallback(async () => {
    const paths = await listRegisteredRepositoryPaths();
    const results = await Promise.allSettled(paths.map(inspectLocalRepository));
    setProjects(
      results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      ),
    );
  }, []);

  useEffect(() => {
    void loadProjects();
    const refresh = () => void loadProjects();
    window.addEventListener('repository-registry-changed', refresh);
    return () =>
      window.removeEventListener('repository-registry-changed', refresh);
  }, [loadProjects]);

  const loadClaudeConversations = useCallback(async () => {
    setClaudeConversations(await listClaudeCodeConversations());
  }, []);

  useEffect(() => {
    void loadClaudeConversations();
    const refresh = () => void loadClaudeConversations();
    window.addEventListener(CLAUDE_CONVERSATIONS_CHANGED_EVENT, refresh);
    return () =>
      window.removeEventListener(CLAUDE_CONVERSATIONS_CHANGED_EVENT, refresh);
  }, [loadClaudeConversations]);

  const commitClaudeConversationTitle = useCallback(
    async (conversation: ClaudeCodeConversation) => {
      const title = editingClaudeTitle.trim();
      setEditingClaudeConversationId(undefined);
      if (!title || title === conversation.title) return;
      await saveClaudeCodeConversation({
        ...conversation,
        title,
        updatedAt: Date.now(),
      });
    },
    [editingClaudeTitle],
  );

  const addProject = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: '添加本地项目',
    });
    if (typeof selected !== 'string') return;
    try {
      const project = await inspectLocalRepository(selected);
      const paths = await listRegisteredRepositoryPaths();
      if (!paths.includes(project.path))
        await saveRegisteredRepositoryPaths([...paths, project.path]);
      setExpandedProjectPaths((current) => new Set(current).add(project.path));
      await loadProjects();
    } catch (error) {
      toast.error('无法添加项目', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [loadProjects]);

  const removeProject = useCallback(async (path: string) => {
    const paths = await listRegisteredRepositoryPaths();
    await saveRegisteredRepositoryPaths(paths.filter((item) => item !== path));
    setProjects((current) =>
      current.filter((project) => project.path !== path),
    );
  }, []);

  const knownDirectChildCountByParentId = useKnownDirectChildCounts(
    sessions,
    hasMoreSessions,
  );

  const recentSessions = useMemo(
    () =>
      buildSidebarSessionRows(
        sessions,
        expandedSessionIds,
        knownDirectChildCountByParentId,
      ),
    [sessions, expandedSessionIds, knownDirectChildCountByParentId],
  );

  const handleLoadMore = useCallback(() => {
    void loadMoreSessions().catch((error) => {
      logger.error('Failed to load more sessions', error);
      toast.error(
        t(
          'sessionHistory.toasts.loadMoreFailed',
          'Failed to load more sessions',
        ),
      );
    });
  }, [loadMoreSessions, t]);

  const handleToggleExpand = useCallback(
    (sessionId: string) => {
      setExpandedSessionIds((previous) => {
        const next = new Set(previous);
        if (next.has(sessionId)) {
          next.delete(sessionId);
        } else {
          next.add(sessionId);
          void ensureChildrenLoaded(sessionId).catch((error) => {
            logger.error('Failed to load session children', {
              sessionId,
              error,
            });
            toast.error(
              t(
                'sessionHistory.toasts.loadChildrenFailed',
                'Failed to load child sessions',
              ),
            );
          });
        }
        return next;
      });
    },
    [ensureChildrenLoaded, t],
  );

  const handleDeleteSession = useCallback(async () => {
    if (!sessionPendingDeletion || isDeletingSession) return;
    setIsDeletingSession(true);
    try {
      await deleteSession(sessionPendingDeletion.id);
      if (location.pathname === `/agent/${sessionPendingDeletion.id}`) {
        navigate('/agent', { replace: true });
      }
      toast.success(t('sessionHistory.toasts.deleted', 'Session deleted'));
      setSessionPendingDeletion(null);
    } catch (error) {
      logger.error('Failed to delete session from sidebar', error);
      toast.error(
        t('sessionHistory.toasts.deleteFailed', 'Failed to delete session'),
      );
    } finally {
      setIsDeletingSession(false);
    }
  }, [
    deleteSession,
    isDeletingSession,
    location.pathname,
    navigate,
    sessionPendingDeletion,
    t,
  ]);

  const requestSessionDeletion = useCallback(
    (session: { id: string; name?: string | null }) => {
      setSessionPendingDeletion({
        id: session.id,
        name:
          session.name || `${t('sidebar.session')} ${session.id.slice(0, 8)}`,
      });
    },
    [t],
  );

  useInfiniteScroll({
    rootRef: recentSessionsRootRef,
    loadMoreSentinelRef,
    hasMoreSessions,
    isLoadingMoreSessions,
    onLoadMore: handleLoadMore,
    displayRowsLength: recentSessions.length,
  });

  return (
    <Sidebar className="border-r" collapsible="icon">
      <SidebarHeader className="h-14 border-b shrink-0 p-0 flex flex-row items-center">
        <div
          className={cn(
            'flex flex-row items-center justify-center gap-2 transition-all duration-300 ease-in-out w-full',
            isCollapsed ? 'px-2' : 'px-4',
          )}
        >
          <BrainCircuit
            size={isCollapsed ? 24 : 32}
            className="flex-shrink-0 text-primary"
          />
          <span
            className={cn(
              'font-medium text-2xl whitespace-nowrap transition-all duration-300 ease-in-out',
              isCollapsed
                ? 'opacity-0 w-0 overflow-hidden'
                : 'opacity-100 w-auto',
            )}
          >
            {t('appName')}
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Main Section */}
        <SidebarGroup className="shrink-0">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location.pathname.startsWith('/tomato')}
                  tooltip={t('sidebar.tomatoWorkboard', '番茄工作台')}
                >
                  <Link to="/tomato" className="flex w-full items-center gap-2">
                    <ClipboardList className="shrink-0" />
                    <span>{t('sidebar.tomatoWorkboard', '番茄工作台')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location.pathname.startsWith('/agent')}
                  tooltip={t('sidebar.chat')}
                >
                  <Link to="/agent" className="flex w-full items-center gap-2">
                    <Bot className="shrink-0" />
                    <span>{t('sidebar.chat')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Projects Section */}
        <SidebarGroup className="shrink-0">
          <div className="mb-2 flex h-8 items-center justify-between px-2">
            <button
              type="button"
              className="flex min-w-0 items-center gap-1 text-sm font-semibold uppercase tracking-wide text-sidebar-foreground/70 hover:text-sidebar-foreground"
              onClick={() => setProjectsSectionOpen((open) => !open)}
            >
              {projectsSectionOpen ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              <span>项目</span>
            </button>
            {!isCollapsed && (
              <button
                type="button"
                className="rounded p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                title="添加项目"
                aria-label="添加项目"
                onClick={() => void addProject()}
              >
                <Plus className="size-4" />
              </button>
            )}
          </div>
          {projectsSectionOpen && (
            <SidebarGroupContent
              className={cn('pr-2', !isCollapsed && 'pl-3')}
            >
              <SidebarMenu>
                {projects.map((project) => {
                  const expanded = expandedProjectPaths.has(project.path);
                  const projectSessions = sessions.filter(
                    (session) => session.workspaceOverride === project.path,
                  );
                  const projectClaudeConversations = claudeConversations.filter(
                    (conversation) =>
                      conversation.repositoryPath === project.path,
                  );
                  const hasProjectConversations =
                    projectSessions.length > 0 ||
                    projectClaudeConversations.length > 0;
                  return (
                    <SidebarMenuItem key={project.path}>
                      <div className="group/project flex items-center rounded-md hover:bg-sidebar-accent">
                        <button
                          type="button"
                          className="ml-1 rounded p-1 text-muted-foreground"
                          aria-label={expanded ? '收起项目' : '展开项目'}
                          onClick={() =>
                            setExpandedProjectPaths((current) => {
                              const next = new Set(current);
                              if (next.has(project.path))
                                next.delete(project.path);
                              else next.add(project.path);
                              return next;
                            })
                          }
                        >
                          {expanded ? (
                            <ChevronDown className="size-3.5" />
                          ) : (
                            <ChevronRight className="size-3.5" />
                          )}
                        </button>
                        <div
                          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-sm"
                          title={project.path}
                        >
                          <FolderGit2 className="size-4 shrink-0" />
                          <span className="truncate">{project.name}</span>
                        </div>
                        <button
                          type="button"
                          className="rounded p-1 text-muted-foreground opacity-0 hover:text-foreground focus:opacity-100 group-hover/project:opacity-100"
                          title="新建 Claude Code 对话"
                          aria-label={`在 ${project.name} 新建 Claude Code 对话`}
                          onClick={() =>
                            navigate(
                              `/claude-code?repositoryPath=${encodeURIComponent(project.path)}`,
                            )
                          }
                        >
                          <Plus className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          className="mr-1 rounded p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover/project:opacity-100"
                          title="移除项目（不删除本地文件）"
                          aria-label={`移除项目 ${project.name}`}
                          onClick={() => void removeProject(project.path)}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                      {expanded && !isCollapsed && (
                        <div className="ml-7 border-l pl-2">
                          {!hasProjectConversations ? (
                            <div className="px-2 py-1.5 text-xs text-muted-foreground">
                              暂无对话
                            </div>
                          ) : (
                            <>
                              <div className="max-h-[13.125rem] overflow-y-auto terminal-scrollbar">
                                {projectClaudeConversations.map(
                                  (conversation) => (
                                    <div
                                      key={conversation.id}
                                      className={cn(
                                        'group/claude flex min-w-0 items-center rounded-md text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                                        location.pathname === '/claude-code' &&
                                          activeClaudeConversationId ===
                                            conversation.id &&
                                          'bg-sidebar-accent font-medium text-sidebar-accent-foreground ring-1 ring-inset ring-sidebar-border',
                                      )}
                                    >
                                      {editingClaudeConversationId ===
                                      conversation.id ? (
                                        <input
                                          autoFocus
                                          value={editingClaudeTitle}
                                          onChange={(event) =>
                                            setEditingClaudeTitle(
                                              event.target.value,
                                            )
                                          }
                                          onBlur={() =>
                                            void commitClaudeConversationTitle(
                                              conversation,
                                            )
                                          }
                                          onKeyDown={(event) => {
                                            if (event.key === 'Enter') {
                                              event.currentTarget.blur();
                                            }
                                          }}
                                          className="mx-1 min-w-0 flex-1 rounded border bg-background px-1.5 py-1 outline-none focus:ring-1 focus:ring-ring"
                                          aria-label="对话名称"
                                        />
                                      ) : (
                                        <Link
                                          to={claudeConversationPath(
                                            conversation,
                                          )}
                                          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5"
                                        >
                                          <TerminalSquare className="size-3.5 shrink-0" />
                                          <span className="truncate">
                                            {conversation.title ||
                                              'Claude Code 对话'}
                                          </span>
                                        </Link>
                                      )}
                                      <button
                                        type="button"
                                        className="mr-1 rounded p-1 opacity-0 hover:text-foreground focus:opacity-100 group-hover/claude:opacity-100"
                                        title="重命名对话"
                                        aria-label={`重命名 ${conversation.title}`}
                                        onClick={() => {
                                          setEditingClaudeConversationId(
                                            conversation.id,
                                          );
                                          setEditingClaudeTitle(
                                            conversation.title,
                                          );
                                        }}
                                      >
                                        <Pencil className="size-3" />
                                      </button>
                                    </div>
                                  ),
                                )}
                                {projectSessions.map((session) => (
                                  <div
                                    key={session.id}
                                    className={cn(
                                      'group/session flex items-center rounded-md text-xs text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                                      location.pathname ===
                                        `/agent/${session.id}` &&
                                        'bg-sidebar-accent font-medium text-sidebar-accent-foreground ring-1 ring-inset ring-sidebar-border',
                                    )}
                                  >
                                    <Link
                                      to={`/agent/${session.id}`}
                                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5"
                                    >
                                      <StatusDot status={session.status} />
                                      <span className="truncate">
                                        {session.name || '未命名对话'}
                                      </span>
                                    </Link>
                                    <button
                                      type="button"
                                      className="mr-1 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus:opacity-100 group-hover/session:opacity-100"
                                      title="删除对话"
                                      aria-label={`删除对话 ${session.name || '未命名对话'}`}
                                      onClick={() =>
                                        requestSessionDeletion(session)
                                      }
                                    >
                                      <Trash2 className="size-3.5" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          )}
        </SidebarGroup>

        {/* Resources Section */}
        <SidebarGroup className="shrink-0">
          <button
            type="button"
            className="mb-2 flex h-8 items-center gap-1 px-2 text-sm font-semibold uppercase tracking-wide text-sidebar-foreground/70 hover:text-sidebar-foreground"
            onClick={() => setResourcesSectionOpen((open) => !open)}
          >
            {resourcesSectionOpen ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            <span>{t('sidebar.library')}</span>
          </button>
          {resourcesSectionOpen && (
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname === '/cli'}
                    tooltip="CLI"
                  >
                    <Link to="/cli" className="flex w-full items-center gap-2">
                      <TerminalSquare className="shrink-0" />
                      <span>CLI</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname.startsWith('/knowledge')}
                    tooltip={t('sidebar.knowledge')}
                  >
                    <Link
                      to="/knowledge"
                      className="flex w-full items-center gap-2"
                    >
                      <Database className="shrink-0" />
                      <span>{t('sidebar.knowledge')}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname === '/assistants'}
                    tooltip={t('sidebar.assistants')}
                  >
                    <Link
                      to="/assistants"
                      className="flex w-full items-center gap-2"
                    >
                      <Users className="shrink-0" />
                      <span>{t('sidebar.assistants')}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname === '/playbooks'}
                    tooltip={t('sidebar.playbooks')}
                  >
                    <Link
                      to="/playbooks"
                      className="flex w-full items-center gap-2"
                    >
                      <BookOpen className="shrink-0" />
                      <span>{t('sidebar.playbooks')}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname === '/mcp-servers'}
                    tooltip={t('sidebar.extensions')}
                  >
                    <Link
                      to="/mcp-servers"
                      className="flex w-full items-center gap-2"
                    >
                      <Blocks className="shrink-0" />
                      <span>{t('sidebar.extensions')}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname === '/feishu-bots'}
                    tooltip={t('sidebar.feishuBots', '飞书机器人')}
                  >
                    <Link
                      to="/feishu-bots"
                      className="flex w-full items-center gap-2"
                    >
                      <MessageSquare className="shrink-0" />
                      <span>{t('sidebar.feishuBots', '飞书机器人')}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname.startsWith('/org')}
                    tooltip={t('sidebar.org')}
                  >
                    <Link to="/org" className="flex w-full items-center gap-2">
                      <Network className="shrink-0" />
                      <span>{t('sidebar.org')}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname === '/scheduled-tasks'}
                    tooltip={t('sidebar.scheduledTasks')}
                  >
                    <Link
                      to="/scheduled-tasks"
                      className="flex w-full items-center gap-2"
                    >
                      <Clock className="shrink-0" />
                      <span>{t('sidebar.scheduledTasks')}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          )}
        </SidebarGroup>

        {/* Recent Sessions – only visible when sidebar is expanded */}
        {!isCollapsed && sessions.length > 0 && (
          <SidebarGroup className="flex min-h-0 flex-1 flex-col">
            <SidebarGroupLabel className="mb-2 shrink-0 text-sm font-semibold uppercase tracking-wide">
              {t('sidebar.recentSessions')}
            </SidebarGroupLabel>
            <div className="min-h-0 flex-1 overflow-y-auto terminal-scrollbar">
              {/*
                rootRef must be a descendant of the overflow container —
                useInfiniteScroll's findScrollParent starts at parentElement.
              */}
              <div ref={recentSessionsRootRef}>
                <SidebarMenu>
                  {recentSessions.map(
                    ({
                      session,
                      nestingLevel,
                      hasExpandableChildren,
                      isExpanded,
                    }) => {
                      const isLoadingChildren = loadingChildrenParentIds.has(
                        session.id,
                      );

                      return (
                        <SidebarMenuItem
                          key={session.id}
                          className="group/session flex items-center"
                        >
                          <SidebarMenuButton
                            asChild
                            className="min-w-0 flex-1"
                            isActive={
                              location.pathname === `/agent/${session.id}`
                            }
                            tooltip={
                              session.name ||
                              `${t('sidebar.session')} ${session.id.slice(0, 8)}`
                            }
                          >
                            <Link
                              to={`/agent/${session.id}`}
                              className={cn(
                                'flex min-w-0 flex-1 items-center gap-2',
                                nestingLevel > 0 && 'text-muted-foreground',
                              )}
                              style={{
                                paddingLeft: `${nestingLevel * 12}px`,
                              }}
                            >
                              {hasExpandableChildren ? (
                                <button
                                  type="button"
                                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                                  aria-expanded={isExpanded}
                                  aria-busy={isLoadingChildren}
                                  aria-label={
                                    isLoadingChildren
                                      ? t(
                                          'sidebar.loadingSessionChildren',
                                          'Loading session children',
                                        )
                                      : isExpanded
                                        ? t(
                                            'sidebar.collapseSession',
                                            'Collapse session children',
                                          )
                                        : t(
                                            'sidebar.expandSession',
                                            'Expand session children',
                                          )
                                  }
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    handleToggleExpand(session.id);
                                  }}
                                >
                                  {isLoadingChildren ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : isExpanded ? (
                                    <ChevronDown className="h-3.5 w-3.5" />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              ) : (
                                <span className="inline-block h-4 w-4 shrink-0" />
                              )}
                              <StatusDot status={session.status} />
                              <span className="truncate text-xs">
                                {session.name ||
                                  `${t('sidebar.session')} ${session.id.slice(0, 8)}`}
                              </span>
                              {session.isBookmarked && (
                                <BookmarkCheck className="h-3.5 w-3.5 shrink-0 text-warning" />
                              )}
                            </Link>
                          </SidebarMenuButton>
                          <button
                            type="button"
                            className="mr-1 shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-destructive focus:opacity-100 group-hover/session:opacity-100"
                            title="删除对话"
                            aria-label={`删除对话 ${session.name || session.id.slice(0, 8)}`}
                            onClick={() => requestSessionDeletion(session)}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </SidebarMenuItem>
                      );
                    },
                  )}
                </SidebarMenu>
                <div ref={loadMoreSentinelRef} className="h-px w-full" />
                {hasMoreSessions ? (
                  <div className="px-2 py-2">
                    <button
                      type="button"
                      onClick={handleLoadMore}
                      disabled={isLoadingMoreSessions}
                      className={cn(
                        'flex w-full items-center justify-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground',
                        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                        'disabled:pointer-events-none disabled:opacity-50',
                      )}
                    >
                      {isLoadingMoreSessions ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>
                            {t('sessionHistory.loadingMore', 'Loading more...')}
                          </span>
                        </>
                      ) : (
                        <span>{t('sessionHistory.loadMore', 'Load more')}</span>
                      )}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip={t('sidebar.settings')}
              className="transition-all duration-200"
              isActive={location.pathname === '/settings'}
            >
              <Link
                to="/settings"
                className="flex w-full items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <Settings className="shrink-0" />
                  {!isCollapsed && (
                    <span className="truncate">{t('sidebar.settings')}</span>
                  )}
                </div>

                {hasUpdate && isCollapsed && (
                  <span className="absolute left-4 top-2 h-2 w-2 rounded-full bg-destructive" />
                )}

                {!isCollapsed && (
                  <div className="flex items-center gap-2 shrink-0">
                    {hasUpdate && (
                      <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
                    )}
                    <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md border border-border/50">
                      v{__APP_VERSION__}
                    </span>
                  </div>
                )}
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <AlertDialog
        open={sessionPendingDeletion !== null}
        onOpenChange={(open) => {
          if (!open && !isDeletingSession) setSessionPendingDeletion(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除对话？</AlertDialogTitle>
            <AlertDialogDescription>
              “{sessionPendingDeletion?.name}
              ”及其子对话、消息和工作区文件将被永久删除，此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingSession}>
              取消
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeletingSession}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                void handleDeleteSession();
              }}
            >
              {isDeletingSession ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  正在删除…
                </>
              ) : (
                '确认删除'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sidebar>
  );
}
