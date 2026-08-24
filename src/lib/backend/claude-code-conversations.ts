import { getSetting, setSetting } from './settings';

const STORAGE_KEY = 'claudeCodeConversations';
export const CLAUDE_CONVERSATIONS_CHANGED_EVENT =
  'claude-code-conversations-changed';

export interface ClaudeCodeConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface ClaudeCodeConversation {
  id: string;
  claudeSessionId: string;
  repositoryPath: string;
  contextKey: string;
  title: string;
  contextText: string;
  messages: ClaudeCodeConversationMessage[];
  createdAt: number;
  updatedAt: number;
}

function isMessage(value: unknown): value is ClaudeCodeConversationMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  return (
    typeof message.id === 'string' &&
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string'
  );
}

function isConversation(value: unknown): value is ClaudeCodeConversation {
  if (!value || typeof value !== 'object') return false;
  const conversation = value as Record<string, unknown>;
  return (
    typeof conversation.id === 'string' &&
    typeof conversation.claudeSessionId === 'string' &&
    typeof conversation.repositoryPath === 'string' &&
    typeof conversation.contextKey === 'string' &&
    typeof conversation.title === 'string' &&
    typeof conversation.contextText === 'string' &&
    Array.isArray(conversation.messages) &&
    conversation.messages.every(isMessage) &&
    typeof conversation.createdAt === 'number' &&
    typeof conversation.updatedAt === 'number'
  );
}

export async function listClaudeCodeConversations(): Promise<
  ClaudeCodeConversation[]
> {
  const setting = await getSetting<unknown>(STORAGE_KEY);
  if (!Array.isArray(setting?.value)) return [];
  return setting.value
    .filter(isConversation)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function saveClaudeCodeConversation(
  conversation: ClaudeCodeConversation,
): Promise<void> {
  const conversations = await listClaudeCodeConversations();
  const existingIndex = conversations.findIndex(
    (item) => item.id === conversation.id,
  );
  if (existingIndex >= 0) conversations[existingIndex] = conversation;
  else conversations.unshift(conversation);
  await setSetting(STORAGE_KEY, conversations);
  window.dispatchEvent(new Event(CLAUDE_CONVERSATIONS_CHANGED_EVENT));
}

export async function getClaudeCodeConversation(
  conversationId: string,
): Promise<ClaudeCodeConversation | undefined> {
  const conversations = await listClaudeCodeConversations();
  return conversations.find((item) => item.id === conversationId);
}

export async function findLatestClaudeCodeConversation(
  contextKey: string,
  repositoryPath: string,
): Promise<ClaudeCodeConversation | undefined> {
  const conversations = await listClaudeCodeConversations();
  return conversations.find(
    (item) =>
      item.contextKey === contextKey && item.repositoryPath === repositoryPath,
  );
}
