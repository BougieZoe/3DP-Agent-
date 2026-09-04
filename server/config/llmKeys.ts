/**
 * llmKeys — server-side LLM key manager with hot-reload.
 *
 * Reads keys from a YAML config file. Watches for file changes and
 * atomically swaps the in-memory key pool — no restart needed.
 *
 * Design:
 *   - YAML defines per-provider key lists sorted by priority.
 *   - On file change (or POST /api/admin/keys/reload), the file is
 *     re-parsed and the in-memory pool is replaced atomically.
 *   - CAD bridge reads from this pool, falling back to client BYOK keys.
 *   - Same pattern as i18n: config file → in-memory cache → consumer reads.
 */

import { readFileSync, watch as watchFile } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYAML } from 'yaml';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LLMKeyEntry {
  /** The API key string. */
  key: string;
  /** Lower number = higher priority (tried first). */
  priority: number;
  /** Optional override — if omitted, uses the provider's default baseUrl. */
  baseUrl?: string;
  /** Optional override — if omitted, uses the provider's default model. */
  model?: string;
}

export interface LLMProviderConfig {
  /** Provider ID matching AIProviderId (e.g. 'zhipu', 'deepseek'). */
  id: string;
  /** Default base URL for this provider. */
  baseUrl: string;
  /** Default model name. */
  model: string;
  /** Keys sorted by priority (ascending — lower number = first). */
  keys: LLMKeyEntry[];
}

export interface LLMKeysConfig {
  providers: Record<string, LLMProviderConfig>;
}

// ---------------------------------------------------------------------------
// Provider defaults (mirrors CADWorkspace.tsx LLM_CONFIGS — keep in sync)
// ---------------------------------------------------------------------------

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  openai:    { baseUrl: 'https://api.openai.com/v1',               model: 'gpt-4o' },
  deepseek:  { baseUrl: 'https://api.deepseek.com/v1',             model: 'deepseek-chat' },
  kimi:      { baseUrl: 'https://api.moonshot.cn/v1',              model: 'kimi-k3' },
  fireworks: { baseUrl: 'https://api.fireworks.ai/inference/v1',   model: 'accounts/fireworks/models/deepseek-v4-pro' },
  zhipu:     { baseUrl: 'https://open.bigmodel.cn/api/paas/v4',    model: 'glm-4.7' },
  gemini:    { baseUrl: 'https://generativelanguage.googleapis.com/v1', model: 'gemini-2.5-flash' },
  claude:    { baseUrl: 'https://api.anthropic.com/v1',            model: 'claude-sonnet-4-20250514' },
  'amd-cloud': { baseUrl: 'http://localhost:8000/v1',              model: 'Qwen/Qwen3-8B' },
};

// ---------------------------------------------------------------------------
// Config file path
// ---------------------------------------------------------------------------

const CONFIG_FILENAME = 'llm-keys.yaml';

function configPath(): string {
  // Resolve relative to server/config/ directory
  return path.join(process.cwd(), 'server', 'config', CONFIG_FILENAME);
}

// ---------------------------------------------------------------------------
// YAML schema validation
// ---------------------------------------------------------------------------

interface RawYAMLProvider {
  key?: string;
  priority?: number;
  baseUrl?: string;
  model?: string;
}

interface RawYAMLSchema {
  providers?: Record<string, RawYAMLProvider[]>;
}

function validateAndTransform(raw: RawYAMLSchema): LLMKeysConfig {
  const providers: Record<string, LLMProviderConfig> = {};

  if (!raw || typeof raw !== 'object' || !raw.providers) {
    return { providers };
  }

  for (const [providerId, entries] of Object.entries(raw.providers)) {
    if (!Array.isArray(entries)) continue;

    const defaults = PROVIDER_DEFAULTS[providerId];
    if (!defaults) {
      // Unknown provider — skip but don't crash
      console.warn(`[llmKeys] Unknown provider "${providerId}" in config — skipping`);
      continue;
    }

    const keys: LLMKeyEntry[] = entries
      .filter((e): e is RawYAMLProvider & { key: string } =>
        typeof e === 'object' && e !== null && typeof e.key === 'string' && e.key.length > 0
      )
      .map((e) => ({
        key: e.key!,
        priority: typeof e.priority === 'number' ? e.priority : 99,
        baseUrl: typeof e.baseUrl === 'string' ? e.baseUrl : undefined,
        model: typeof e.model === 'string' ? e.model : undefined,
      }))
      .sort((a, b) => a.priority - b.priority);

    providers[providerId] = {
      id: providerId,
      baseUrl: defaults.baseUrl,
      model: defaults.model,
      keys,
    };
  }

  return { providers };
}

// ---------------------------------------------------------------------------
// In-memory state (atomic swap)
// ---------------------------------------------------------------------------

let pool: LLMKeysConfig = { providers: {} };
let lastLoadedAt: number = 0;
let lastError: string | null = null;
let watcher: ReturnType<typeof watchFile> | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Load (or reload) the YAML config file. Returns true on success. */
export async function loadKeys(): Promise<boolean> {
  const filePath = configPath();
  try {
    const content = await readFile(filePath, 'utf-8');
    const raw = parseYAML(content) as RawYAMLSchema;
    const next = validateAndTransform(raw);

    // Atomic swap
    pool = next;
    lastLoadedAt = Date.now();
    lastError = null;

    const totalKeys = Object.values(next.providers)
      .reduce((sum, p) => sum + p.keys.length, 0);
    console.log(`[llmKeys] Loaded ${totalKeys} keys for ${Object.keys(next.providers).length} providers from ${filePath}`);
    return true;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    console.error(`[llmKeys] Failed to load ${filePath}: ${lastError}`);
    return false;
  }
}

/** Synchronous load — for startup only (blocks the event loop briefly). */
export function loadKeysSync(): void {
  const filePath = configPath();
  try {
    const content = readFileSync(filePath, 'utf-8');
    const raw = parseYAML(content) as RawYAMLSchema;
    pool = validateAndTransform(raw);
    lastLoadedAt = Date.now();
    lastError = null;
    const totalKeys = Object.values(pool.providers)
      .reduce((sum, p) => sum + p.keys.length, 0);
    console.log(`[llmKeys] Loaded ${totalKeys} keys for ${Object.keys(pool.providers).length} providers`);
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    console.error(`[llmKeys] Sync load failed: ${lastError}`);
  }
}

/**
 * Start watching the YAML file for changes.
 * On change, reloads the key pool atomically.
 */
export function startWatching(): void {
  if (watcher) return;
  const filePath = configPath();
  try {
    watcher = watchFile(filePath, async (eventType: string) => {
      if (eventType === 'change') {
        console.log(`[llmKeys] Config file changed, reloading...`);
        await loadKeys();
      }
    });
    console.log(`[llmKeys] Watching ${filePath} for changes`);
  } catch (err) {
    console.warn(`[llmKeys] Could not watch config file: ${err}`);
  }
}

/** Stop watching (for graceful shutdown). */
export function stopWatching(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}

/** Get the current key pool (read-only snapshot). */
export function getKeys(): LLMKeysConfig {
  return pool;
}

/** Get keys for a specific provider, sorted by priority. */
export function getProviderKeys(providerId: string): LLMKeyEntry[] {
  return pool.providers[providerId]?.keys ?? [];
}

/**
 * Build a full LLM candidate list for a provider, merging server-side keys
 * with optional client BYOK keys. Server keys come first (higher priority).
 */
export function buildCandidates(
  providerId: string,
  clientKey?: string,
): Array<{ baseUrl: string; apiKey: string; model: string }> {
  const provider = pool.providers[providerId];
  const defaults = PROVIDER_DEFAULTS[providerId];
  if (!defaults) return [];

  const candidates: Array<{ baseUrl: string; apiKey: string; model: string }> = [];

  // Server-side keys first
  if (provider) {
    for (const entry of provider.keys) {
      if (entry.key === '__no_key__') continue; // skip placeholder
      candidates.push({
        baseUrl: entry.baseUrl ?? provider.baseUrl,
        apiKey: entry.key,
        model: entry.model ?? provider.model,
      });
    }
  }

  // Client BYOK key as fallback (if not already in server keys)
  if (clientKey && clientKey !== '__no_key__') {
    const alreadyHave = candidates.some((c) => c.apiKey === clientKey);
    if (!alreadyHave) {
      candidates.push({
        baseUrl: defaults.baseUrl,
        apiKey: clientKey,
        model: defaults.model,
      });
    }
  }

  return candidates;
}

/**
 * Build ordered candidates across ALL configured providers.
 * Returns [primary provider keys, ...fallback provider keys].
 */
export function buildAllCandidates(
  activeProvider?: string,
  clientKeys?: Record<string, string>,
): Array<{ baseUrl: string; apiKey: string; model: string }> {
  const result: Array<{ baseUrl: string; apiKey: string; model: string }> = [];
  const seen = new Set<string>();

  const order = activeProvider
    ? [activeProvider, ...Object.keys(pool.providers).filter((p) => p !== activeProvider)]
    : Object.keys(pool.providers);

  for (const providerId of order) {
    const candidates = buildCandidates(providerId, clientKeys?.[providerId]);
    for (const c of candidates) {
      if (!seen.has(c.apiKey)) {
        seen.add(c.apiKey);
        result.push(c);
      }
    }
  }

  return result;
}

/** Get last load timestamp (for admin status endpoint). */
export function getLastLoadedAt(): number {
  return lastLoadedAt;
}

/** Get last error (for admin status endpoint). */
export function getLastError(): string | null {
  return lastError;
}

/** Manual reload trigger (for POST /api/admin/keys/reload). */
export async function reloadKeys(): Promise<{
  ok: boolean;
  providers: number;
  totalKeys: number;
  error?: string;
}> {
  const success = await loadKeys();
  const totalKeys = Object.values(pool.providers)
    .reduce((sum, p) => sum + p.keys.length, 0);
  return {
    ok: success,
    providers: Object.keys(pool.providers).length,
    totalKeys,
    ...(lastError ? { error: lastError } : {}),
  };
}
