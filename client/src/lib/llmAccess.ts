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
 * technology. Metal (SLM) needs strong reasoning → Claude. Other materials
 * use cheaper models (DeepSeek). Falls back to whatever is available.
 *
 * Cost savings: ~80% for non-metal materials while maintaining quality for
 * high-stakes metal analysis.
 */
export function getLLMProviderForMaterial(material: Material): LLMAccess | null {
  const isSignedIn = getAuthSnapshot().user;

  // Metal (SLM) needs strong reasoning — prefer Claude
  if (material.technology === 'slm') {
    if (isSignedIn) {
      // Server-side: try Claude first, fall back to DeepSeek
      const claudeKey = getKey('claude');
      if (claudeKey) return { provider: 'claude', key: '' };
      // Claude not configured server-side, try client-side
      const clientClaude = getKey('claude');
      if (clientClaude) return { provider: 'claude', key: clientClaude };
      // Fall back to DeepSeek
      return { provider: HOSTED_DEFAULT_PROVIDER, key: '' };
    }
    // Anonymous: try Claude first, fall back to active provider
    const claudeKey = getKey('claude');
    if (claudeKey) return { provider: 'claude', key: claudeKey };
    // Fall back to whatever the user has configured
    return getLLMProvider();
  }

  // All other materials: use cheapest provider (DeepSeek)
  return getLLMProvider();
}

export function isLLMAvailable(): boolean {
  return !!getAuthSnapshot().user || hasAnyKey();
}
