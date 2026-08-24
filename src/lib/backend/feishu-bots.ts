import { createId } from '@paralleldrive/cuid2';
import { getSetting, setSetting } from './settings';

const FEISHU_BOTS_KEY = 'libragent.feishu.bots.v1';
export const FEISHU_BOTS_CHANGED_EVENT = 'feishu-bots-changed';

export interface FeishuBot {
  id: string;
  name: string;
  appId: string;
  appSecret: string;
  verificationToken: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export type FeishuBotInput = Omit<
  FeishuBot,
  'id' | 'createdAt' | 'updatedAt'
> & {
  id?: string;
  createdAt?: number;
  updatedAt?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeBot(value: unknown): FeishuBot | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const appId = typeof value.appId === 'string' ? value.appId.trim() : '';
  const appSecret =
    typeof value.appSecret === 'string' ? value.appSecret : '';
  const verificationToken =
    typeof value.verificationToken === 'string' ? value.verificationToken : '';
  if (!id || !name || !appId || !appSecret) return null;

  return {
    id,
    name,
    appId,
    appSecret,
    verificationToken,
    enabled: value.enabled !== false,
    createdAt:
      typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
    updatedAt:
      typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
  };
}

export async function listFeishuBots(): Promise<FeishuBot[]> {
  const setting = await getSetting<unknown>(FEISHU_BOTS_KEY);
  if (!Array.isArray(setting?.value)) return [];
  return setting.value.flatMap((value) => {
    const bot = normalizeBot(value);
    return bot ? [bot] : [];
  });
}

export async function saveFeishuBot(input: FeishuBotInput): Promise<FeishuBot> {
  const name = input.name.trim();
  const appId = input.appId.trim();
  const appSecret = input.appSecret;
  if (!name || !appId || !appSecret) {
    throw new Error('名称、App ID 和 App Secret 不能为空');
  }

  const current = await listFeishuBots();
  const existing = input.id ? current.find((bot) => bot.id === input.id) : null;
  const now = Date.now();
  const bot: FeishuBot = {
    id: existing?.id ?? input.id ?? createId(),
    name,
    appId,
    appSecret,
    verificationToken: input.verificationToken,
    enabled: input.enabled,
    createdAt: existing?.createdAt ?? input.createdAt ?? now,
    updatedAt: now,
  };
  const next = existing
    ? current.map((item) => (item.id === bot.id ? bot : item))
    : [...current, bot];
  await setSetting(FEISHU_BOTS_KEY, next);
  window.dispatchEvent(new CustomEvent(FEISHU_BOTS_CHANGED_EVENT));
  return bot;
}

export async function deleteFeishuBot(id: string): Promise<void> {
  const current = await listFeishuBots();
  await setSetting(
    FEISHU_BOTS_KEY,
    current.filter((bot) => bot.id !== id),
  );
  window.dispatchEvent(new CustomEvent(FEISHU_BOTS_CHANGED_EVENT));
}
