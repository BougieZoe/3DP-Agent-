import type { AIProviderId } from '@shared/domain/providers';
import type { Material } from '@shared/domain/material';
import { getActiveProvider, getKey, hasAnyKey } from './apiKeys';
import { getAuthSnapshot } from './authStore';
import { MUSE_GLIMMER_MODEL } from './llmProxy';

// Hosted default: the cheapest server-side provider for signed-in users
// (the server holds the key — the browser sends nothing).
export const HOSTED_DEFAULT_PROVIDER: AIProviderId = 'deepseek';

export interface LLMAccess {
  provider: AIProviderId;
  /** Empty string = server-hosted key (signed-in user). */
  key: string;
  /** Optional per-call model override (server allowlist is the security boundary). */
  model?: string;
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
  slm: ['claude', 'openai', 'deepseek', 'zhipu', 'kimi', 'fireworks', 'nemotron', 'gemini'],
  fdm: ['deepseek', 'zhipu', 'kimi', 'fireworks', 'nemotron', 'openai', 'gemini', 'claude'],
  sla: ['deepseek', 'zhipu', 'kimi', 'fireworks', 'nemotron', 'openai', 'gemini', 'claude'],
  fgf: ['deepseek', 'zhipu', 'kimi', 'fireworks', 'nemotron', 'openai', 'gemini', 'claude'],
  sls: ['deepseek', 'zhipu', 'kimi', 'fireworks', 'nemotron', 'openai', 'gemini', 'claude'],
  mjf: ['deepseek', 'zhipu', 'kimi', 'fireworks', 'nemotron', 'openai', 'gemini', 'claude'],
  concrete: ['deepseek', 'zhipu', 'kimi', 'fireworks', 'nemotron', 'openai', 'gemini', 'claude'],
  eco: ['deepseek', 'zhipu', 'kimi', 'fireworks', 'nemotron', 'openai', 'gemini', 'claude'],
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
  const access = findAvailableProvider(priorityList, isSignedIn);
  if (access && access.provider === 'fireworks') {
    // fireworks 是单 provider 多模型：解析到它就默认出 Muse Glimmer（Meta 开源 agent 脑，
    // $0.35/$1.5，比 Claude 便宜一个数量级，tool-use 基准同级最强）。
    // 注：accounts 里的 deepseek-v4-pro 在该 Fireworks 账号 serverless 已不可用，
    // glimmer 需 on-demand 部署后生效；部署前保持可调用结构不断。
    return { ...access, model: MUSE_GLIMMER_MODEL };
  }
  return access;
}

export function isLLMAvailable(): boolean {
  return !!getAuthSnapshot().user || hasAnyKey();
}
