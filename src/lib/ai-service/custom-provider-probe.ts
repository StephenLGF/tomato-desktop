import OpenAI from 'openai';

import { createLlmFetch } from './desktop-fetch';
import { withTimeout } from '@/lib/retry-utils';

const PROBE_TIMEOUT_MS = 20_000;

/** Validates an OpenAI-compatible endpoint using the current form values. */
export async function probeCustomOpenAIProvider(
  baseUrl: string,
  apiKey?: string,
): Promise<string[]> {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
  if (!normalizedBaseUrl) {
    throw new Error('Base URL is required.');
  }

  const client = new OpenAI({
    apiKey: apiKey?.trim() || 'no-api-key',
    baseURL: normalizedBaseUrl,
    dangerouslyAllowBrowser: true,
    fetch: createLlmFetch(),
  });
  const page = await withTimeout(client.models.list(), PROBE_TIMEOUT_MS);
  const modelIds = page.data
    .map((model) => model.id?.trim())
    .filter((modelId): modelId is string => Boolean(modelId));

  if (modelIds.length === 0) {
    throw new Error('The endpoint responded but returned no models.');
  }

  return [...new Set(modelIds)].sort();
}
