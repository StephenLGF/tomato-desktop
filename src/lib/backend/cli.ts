import { safeInvoke } from './core';
import { listen } from '@tauri-apps/api/event';

export interface CliCapability {
  id: string;
  name: string;
  command: string;
  description: string;
  installed: boolean;
  version: string | null;
  available: boolean;
  status: string;
  capabilities: string[];
}

export function detectCliCapabilities(): Promise<CliCapability[]> {
  return safeInvoke<CliCapability[]>('detect_cli_capabilities');
}

export interface ClaudeCodeModelOption {
  value: string;
  label: string;
  configuredModel: string | null;
}

export function listClaudeCodeModels(): Promise<ClaudeCodeModelOption[]> {
  return safeInvoke<ClaudeCodeModelOption[]>('list_claude_code_models');
}

export interface ClaudeCodeResponse {
  sessionId: string;
  result: string;
  totalCostUsd: number | null;
  durationMs: number | null;
  numTurns: number | null;
}

export interface ClaudeCodeStreamEvent {
  requestId: string;
  kind: 'text_delta' | 'status' | 'session_id';
  text: string;
}

const activeClaudeRequests = new Map<string, string>();
export const CLAUDE_RUNTIME_CHANGED_EVENT = 'claude-code-runtime-changed';

export function getActiveClaudeRequestId(
  conversationId: string,
): string | undefined {
  return activeClaudeRequests.get(conversationId);
}

export function listActiveClaudeConversationIds(): string[] {
  return [...activeClaudeRequests.keys()];
}

export function sendClaudeCodeMessage(request: {
  prompt: string;
  workspacePath: string;
  model?: string;
  sessionId?: string;
  onStream?: (event: ClaudeCodeStreamEvent) => void;
  onRequestStart?: (requestId: string) => void;
  conversationId?: string;
}): Promise<ClaudeCodeResponse> {
  return sendClaudeCodeMessageWithStream(request);
}

async function sendClaudeCodeMessageWithStream(request: {
  prompt: string;
  workspacePath: string;
  model?: string;
  sessionId?: string;
  onStream?: (event: ClaudeCodeStreamEvent) => void;
  onRequestStart?: (requestId: string) => void;
  conversationId?: string;
}): Promise<ClaudeCodeResponse> {
  const requestId = crypto.randomUUID();
  if (request.conversationId) {
    activeClaudeRequests.set(request.conversationId, requestId);
    window.dispatchEvent(new Event(CLAUDE_RUNTIME_CHANGED_EVENT));
  }
  request.onRequestStart?.(requestId);
  const unlisten = await listen<ClaudeCodeStreamEvent>(
    'claude-code:stream',
    (event) => {
      if (event.payload.requestId === requestId) {
        request.onStream?.(event.payload);
      }
    },
  );
  try {
    return await safeInvoke<ClaudeCodeResponse>(
      'claude_code_chat',
      {
        request: {
          requestId,
          prompt: request.prompt,
          workspacePath: request.workspacePath,
          sessionId: request.sessionId,
          model: request.model,
        },
      },
      { loggedArgs: null },
    );
  } finally {
    unlisten();
    if (
      request.conversationId &&
      activeClaudeRequests.get(request.conversationId) === requestId
    ) {
      activeClaudeRequests.delete(request.conversationId);
      window.dispatchEvent(new Event(CLAUDE_RUNTIME_CHANGED_EVENT));
    }
  }
}

export function cancelClaudeCodeMessage(requestId: string): Promise<boolean> {
  return safeInvoke<boolean>('cancel_claude_code_chat', { requestId });
}
