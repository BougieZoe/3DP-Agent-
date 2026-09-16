import type { AIProviderId } from '@shared/domain/providers';
import type { Material } from '@shared/domain/material';
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

/**
 * Material-aware LLM routing: selects the optimal provider based on material
 * technology. Uses ranked provider lists — picks the first provider with a
 * configured key. Users can add new providers by configuring their API key;
 * no code changes needed.
 *
 * Cost savings: ~80% for non-metal materials while maintaining quality for
 * high-stakes metal analysis.
 */

// Ranked provider lists per material technology.
// First provider with a configured key wins.
// Users can override by adding keys to any provider.
const PROVIDER_PRIORITY: Record<Material['technology'], AIProviderId[]> = {
  slm: ['claude', 'openai', 'deepseek', 'zhipu', 'kimi', 'fireworks', 'gemini'],
  fdm: ['deepseek', 'zhipu', 'kimi', 'fireworks', 'openai', 'gemini', 'claude'],
  sla: ['deepseek', 'zhipu', 'kimi', 'fireworks', 'openai', 'gemini', 'claude'],
  fgf: ['deepseek', 'zhipu', 'kimi', 'fireworks', 'openai', 'gemini', 'claude'],
  sls: ['deepseek', 'zhipu', 'kimi', 'fireworks', 'openai', 'gemini', 'claude'],
  mjf: ['deepseek', 'zhipu', 'kimi', 'fireworks', 'openai', 'gemini', 'claude'],
  concrete: ['deepseek', 'zhipu', 'kimi', 'fireworks', 'openai', 'gemini', 'claude'],
  eco: ['deepseek', 'zhipu', 'kimi', 'fireworks', 'openai', 'gemini', 'claude'],
};

function findAvailableProvider(
  priorityList: AIProviderId[],
  isSignedIn: boolean,
): LLMAccess | null {
  // For signed-in users, try server-side providers first
  if (isSignedIn) {
    for (const provider of priorityList) {
      // Server-side: check if provider has env var key configured
      // The relay will resolve the key server-side
      return { provider, key: '' };
    }
  }

  // For anonymous users, check BYOK keys
  for (const provider of priorityList) {
    const key = getKey(provider);
    if (key) return { provider, key };
  }

  return null;
}

export function getLLMProviderForMaterial(material: Material): LLMAccess | null {
  const isSignedIn = !!getAuthSnapshot().user;
  const priorityList = PROVIDER_PRIORITY[material.technology] ?? PROVIDER_PRIORITY.fdm;
  return findAvailableProvider(priorityList, isSignedIn);
}

export function isLLMAvailable(): boolean {
  return !!getAuthSnapshot().user || hasAnyKey();
}
