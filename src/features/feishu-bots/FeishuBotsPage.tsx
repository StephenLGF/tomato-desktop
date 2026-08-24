import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bot,
  Eye,
  EyeOff,
  KeyRound,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button, Input } from '@/components/ui';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  deleteFeishuBot,
  FEISHU_BOTS_CHANGED_EVENT,
  listFeishuBots,
  saveFeishuBot,
  type FeishuBot,
  type FeishuBotInput,
} from '@/lib/backend/feishu-bots';

const EMPTY_FORM: FeishuBotInput = {
  name: '',
  appId: '',
  appSecret: '',
  verificationToken: '',
  enabled: true,
};

function maskSecret(value: string): string {
  if (!value) return '未设置';
  if (value.length <= 6) return '••••••';
  return `${value.slice(0, 3)}••••${value.slice(-3)}`;
}

function BotDialog({
  bot,
  open,
  onOpenChange,
  onSaved,
}: {
  bot: FeishuBot | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (bot: FeishuBot) => void;
}) {
  const { t } = useTranslation('common');
  const [form, setForm] = useState<FeishuBotInput>(EMPTY_FORM);
  const [showSecret, setShowSecret] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      bot
        ? {
            id: bot.id,
            name: bot.name,
            appId: bot.appId,
            appSecret: bot.appSecret,
            verificationToken: bot.verificationToken,
            enabled: bot.enabled,
          }
        : { ...EMPTY_FORM },
    );
    setShowSecret(false);
    setShowToken(false);
  }, [bot, open]);

  const update = <K extends keyof FeishuBotInput>(
    key: K,
    value: FeishuBotInput[K],
  ) => setForm((current) => ({ ...current, [key]: value }));

  const handleSave = async () => {
    if (!form.name?.trim() || !form.appId?.trim() || !form.appSecret) {
      toast.error(
        t(
          'feishuBots.toasts.required',
          '名称、App ID 和 App Secret 不能为空',
        ),
      );
      return;
    }
    setSaving(true);
    try {
      const saved = await saveFeishuBot(form);
      onSaved(saved);
      onOpenChange(false);
      toast.success(
        t('feishuBots.toasts.saved', '机器人配置已保存'),
      );
    } catch (error) {
      toast.error(
        t('feishuBots.toasts.saveFailed', '保存机器人配置失败'),
        { description: error instanceof Error ? error.message : String(error) },
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {bot
              ? t('feishuBots.dialog.editTitle', '编辑飞书机器人')
              : t('feishuBots.dialog.addTitle', '添加飞书机器人')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'feishuBots.dialog.description',
              '填写飞书开放平台应用凭证。凭证会保存在本机数据库中。',
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <label className="flex flex-col space-y-1.5">
            <span className="text-sm font-medium">
              {t('feishuBots.fields.name', '机器人名称')}
            </span>
            <Input
              value={form.name ?? ''}
              onChange={(event) => update('name', event.target.value)}
              placeholder={t('feishuBots.fields.namePlaceholder', '例如：研发群机器人')}
              autoFocus
            />
          </label>
          <label className="flex flex-col space-y-1.5">
            <span className="text-sm font-medium">App ID</span>
            <Input
              value={form.appId ?? ''}
              onChange={(event) => update('appId', event.target.value)}
              placeholder="cli_xxxxxxxxx"
              autoComplete="off"
            />
          </label>
          <label className="flex flex-col space-y-1.5">
            <span className="text-sm font-medium">App Secret</span>
            <div className="relative">
              <Input
                type={showSecret ? 'text' : 'password'}
                value={form.appSecret ?? ''}
                onChange={(event) => update('appSecret', event.target.value)}
                placeholder={t('feishuBots.fields.secretPlaceholder', '输入 App Secret')}
                autoComplete="new-password"
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                onClick={() => setShowSecret((visible) => !visible)}
                aria-label={showSecret ? '隐藏 App Secret' : '显示 App Secret'}
              >
                {showSecret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </label>
          <label className="flex flex-col space-y-1.5">
            <span className="text-sm font-medium">
              {t('feishuBots.fields.verificationToken', 'Verification Token（可选）')}
            </span>
            <div className="relative">
              <Input
                type={showToken ? 'text' : 'password'}
                value={form.verificationToken ?? ''}
                onChange={(event) => update('verificationToken', event.target.value)}
                placeholder={t('feishuBots.fields.tokenPlaceholder', '用于事件回调校验')}
                autoComplete="off"
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                onClick={() => setShowToken((visible) => !visible)}
                aria-label={showToken ? '隐藏 Verification Token' : '显示 Verification Token'}
              >
                {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </label>
          <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">{t('feishuBots.fields.enabled', '启用机器人')}</p>
              <p className="text-xs text-muted-foreground">{t('feishuBots.fields.enabledHint', '关闭后保留配置但不参与连接')}</p>
            </div>
            <Switch
              checked={form.enabled !== false}
              onCheckedChange={(checked) => update('enabled', checked)}
              aria-label={t('feishuBots.fields.enabled', '启用机器人')}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('common.cancel', '取消')}
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? t('common.saving', '保存中…') : t('common.save', '保存')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function FeishuBotsPage() {
  const { t } = useTranslation('common');
  const [bots, setBots] = useState<FeishuBot[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingBot, setEditingBot] = useState<FeishuBot | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deletingBot, setDeletingBot] = useState<FeishuBot | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadBots = useCallback(async () => {
    try {
      setBots(await listFeishuBots());
    } catch (error) {
      toast.error(t('feishuBots.toasts.loadFailed', '加载飞书机器人失败'), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadBots();
    const refresh = () => void loadBots();
    window.addEventListener(FEISHU_BOTS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(FEISHU_BOTS_CHANGED_EVENT, refresh);
  }, [loadBots]);

  const openNewDialog = () => {
    setEditingBot(null);
    setDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingBot) return;
    setDeleting(true);
    try {
      await deleteFeishuBot(deletingBot.id);
      setBots((current) => current.filter((bot) => bot.id !== deletingBot.id));
      setDeletingBot(null);
      toast.success(t('feishuBots.toasts.deleted', '机器人配置已删除'));
    } catch (error) {
      toast.error(t('feishuBots.toasts.deleteFailed', '删除机器人失败'), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleSaved = (saved: FeishuBot) => {
    setBots((current) => {
      const found = current.some((bot) => bot.id === saved.id);
      return found
        ? current.map((bot) => (bot.id === saved.id ? saved : bot))
        : [...current, saved];
    });
  };

  return (
    <div className="h-full overflow-y-auto bg-background p-6">
      <div className="mx-auto w-full max-w-5xl space-y-8">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-6">
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-primary/10 p-3 text-primary">
              <Bot className="size-7" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {t('feishuBots.title', '飞书机器人')}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('feishuBots.description', '配置多个飞书机器人，集中管理应用凭证和启用状态。')}
              </p>
            </div>
          </div>
          <Button onClick={openNewDialog}>
            <Plus className="mr-2 size-4" />
            {t('feishuBots.add', '添加机器人')}
          </Button>
        </header>

        {loading ? (
          <div className="rounded-xl border border-dashed py-16 text-center text-sm text-muted-foreground">
            {t('feishuBots.loading', '正在加载机器人配置…')}
          </div>
        ) : bots.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed py-20 text-center">
            <Bot className="mb-3 size-10 text-muted-foreground/40" />
            <h2 className="font-medium">{t('feishuBots.emptyTitle', '还没有配置飞书机器人')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('feishuBots.emptyDescription', '添加一个机器人后，即可在这里随时查看和修改配置。')}
            </p>
            <Button className="mt-5" onClick={openNewDialog}>
              <Plus className="mr-2 size-4" />
              {t('feishuBots.add', '添加机器人')}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {bots.map((bot) => (
              <article
                key={bot.id}
                className="cursor-pointer rounded-xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
                role="button"
                tabIndex={0}
                onClick={() => {
                  setEditingBot(bot);
                  setDialogOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setEditingBot(bot);
                    setDialogOpen(true);
                  }
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="rounded-lg bg-primary/10 p-2 text-primary"><Bot className="size-5" /></div>
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold">{bot.name}</h2>
                      <p className="truncate text-xs text-muted-foreground">{bot.appId}</p>
                    </div>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${bot.enabled ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>
                    {bot.enabled ? t('feishuBots.enabled', '已启用') : t('feishuBots.disabled', '已停用')}
                  </span>
                </div>
                <div className="mt-5 space-y-2 rounded-lg bg-muted/30 p-3 text-sm">
                  <div className="flex items-center gap-2"><KeyRound className="size-4 text-muted-foreground" /><span className="text-muted-foreground">App Secret</span><span className="ml-auto font-mono text-xs">{maskSecret(bot.appSecret)}</span></div>
                  <div className="flex items-center gap-2"><KeyRound className="size-4 text-muted-foreground" /><span className="text-muted-foreground">Verification Token</span><span className="ml-auto font-mono text-xs">{maskSecret(bot.verificationToken)}</span></div>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setEditingBot(bot); setDialogOpen(true); }}>
                    <Pencil className="mr-2 size-3.5" />{t('common.edit', '编辑')}
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeletingBot(bot)}>
                    <Trash2 className="mr-2 size-3.5" />{t('common.delete', '删除')}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <BotDialog bot={editingBot} open={dialogOpen} onOpenChange={setDialogOpen} onSaved={handleSaved} />
      <AlertDialog open={Boolean(deletingBot)} onOpenChange={(open) => !open && !deleting && setDeletingBot(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('feishuBots.deleteTitle', '删除机器人配置？')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('feishuBots.deleteDescription', { name: deletingBot?.name, defaultValue: '确定删除“{{name}}”吗？此操作无法撤销。' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t('common.cancel', '取消')}</AlertDialogCancel>
            <AlertDialogAction disabled={deleting} onClick={(event) => { event.preventDefault(); void handleDelete(); }}>
              {deleting ? t('common.deleting', '删除中…') : t('common.delete', '删除')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
