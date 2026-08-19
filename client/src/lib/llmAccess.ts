import type { AIProviderId } from '@shared/domain/providers';
import { getActiveProvider, getKey, hasAnyKey } from './apiKeys';
import { getAuthSnapshot } from './authStore';

// Hosted default: the cheapest server-side provider for signed-in users
// (the server holds the key — the browser sends nothing).
export const HOSTED_DEFAULT_PROVIDER: AIProviderId = 'deepseek';

export interface LLMAccess {
  provider: AIProviderId;
  /** Empty string = server-hosted key (signed-in user). */
  key: string;
}

/**
 * Resolve which provider+key an LLM call should use:
 *  - signed-in user → hosted provider, empty key (server holds the key)
 *  - anonymous → the user's own key (BYOK), if configured
 * Returns null when no LLM path is available.
 */
export function getLLMProvider(): LLMAccess | null {
  if (getAuthSnapshot().user) return { provider: HOSTED_DEFAULT_PROVIDER, key: '' };
  const p = getActiveProvider();
  if (!p) return null;
  const key = getKey(p);
  if (!key) return null;
  return { provider: p, key };
}

export function isLLMAvailable(): boolean {
  return !!getAuthSnapshot().user || hasAnyKey();
}
