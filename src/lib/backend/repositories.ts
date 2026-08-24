import { safeInvoke } from './core';
import { getSetting, setSetting } from './settings';

const REPOSITORY_REGISTRY_KEY = 'localRepositoryRegistry';

export interface LocalRepositoryInfo {
  path: string;
  name: string;
  isGitRepository: boolean;
  branch: string | null;
  detached: boolean;
  dirty: boolean;
  remoteUrl: string | null;
}

export function inspectLocalRepository(
  path: string,
): Promise<LocalRepositoryInfo> {
  return safeInvoke<LocalRepositoryInfo>('inspect_local_repository', { path });
}

export async function listRegisteredRepositoryPaths(): Promise<string[]> {
  const setting = await getSetting<unknown>(REPOSITORY_REGISTRY_KEY);
  return Array.isArray(setting?.value)
    ? setting.value.filter(
        (value): value is string => typeof value === 'string',
      )
    : [];
}

export async function saveRegisteredRepositoryPaths(
  paths: string[],
): Promise<void> {
  await setSetting(REPOSITORY_REGISTRY_KEY, Array.from(new Set(paths)));
  window.dispatchEvent(new CustomEvent('repository-registry-changed'));
}
