/**
 * Analysis Cache — IndexedDB-backed cache for analysis results
 *
 * Caches UnifiedAnalysis results keyed by (file content hash + options).
 * Avoids re-running the full pipeline when the same STL is uploaded with
 * identical parameters — saves CPU and makes the UI feel instant on repeat
 * uploads.
 *
 * Strategy:
 *  1. Hash the raw STL bytes (SHA-256 via SubtleCrypto).
 *  2. Canonicalize PipelineOptions into a stable string.
 *  3. Concatenate → SHA-256 → IndexedDB key.
 *  4. Store { result, createdAt, fileName, fileSize } with a configurable TTL.
 *
 * The hash/key helpers are split out because the raw file buffer is
 * TRANSFERRED to the parse worker after hashing (single-read memory flow):
 * callers compute the key first, then can no longer touch the buffer.
 */

import type { UnifiedAnalysis } from '@/analysis/types';
import type { PipelineOptions } from '@/analysis/pipeline';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CachedAnalysis {
  /** The cached analysis result */
  result: UnifiedAnalysis;
  /** ISO timestamp when the entry was created */
  createdAt: string;
  /** Original file name (for display only) */
  fileName: string;
  /** File size in bytes (for display only) */
  fileSize: number;
  /** Hash of the file content */
  fileHash: string;
  /** Canonicalized options string */
  optionsKey: string;
}

interface CacheStats {
  entries: number;
  totalSizeBytes: number;
  oldestEntry: string | null;
  newestEntry: string | null;
}

// ── Constants ──────────────────────────────────────────────────────────────

const DB_NAME = '3dp-agent-analysis-cache';
const DB_VERSION = 1;
const STORE_NAME = 'analysis-results';
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_ENTRIES = 50;
/**
 * Bump when the stored analysis shape changes incompatibly — old entries lack
 * new fields (e.g. the per-vertex wallThicknessMap added for surface-mapped
 * mobile heatmaps) and must be re-analyzed rather than served stale.
 */
const CACHE_KEY_PREFIX = 'v2:';

// ── IndexedDB helpers ──────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
        store.createIndex('fileHash', 'fileHash', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });
}

// ── Hashing ────────────────────────────────────────────────────────────────

/** SHA-256 hash of an ArrayBuffer, returned as hex string */
async function sha256(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Hash the raw file bytes (call BEFORE transferring the buffer to a worker). */
export async function hashFileBytes(fileBytes: ArrayBuffer): Promise<string> {
  return sha256(fileBytes);
}

/**
 * Canonicalize PipelineOptions into a stable, deterministic string.
 * Only includes fields that actually affect the analysis output.
 */
function canonicalizeOptions(options: PipelineOptions): string {
  const relevant: Record<string, unknown> = {};

  // Only include options that change the analysis result
  if (options.materialFamily) relevant.materialFamily = options.materialFamily;
  if (options.printerId) relevant.printerId = options.printerId;
  if (options.layerHeightMm) relevant.layerHeightMm = options.layerHeightMm;
  if (options.language) relevant.language = options.language;
  if (options.material) {
    // Only include material name, not the full object (stable across versions)
    relevant.material = options.material.name;
  }
  if (options.secondaryMaterial) {
    relevant.secondaryMaterial = options.secondaryMaterial.name;
  }
  if (options.fiberReinforced) relevant.fiberReinforced = options.fiberReinforced;
  if (options.fiberType) relevant.fiberType = options.fiberType;
  if (options.thresholds) relevant.thresholds = options.thresholds;

  return JSON.stringify(relevant, Object.keys(relevant).sort());
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Build the final cache key from a precomputed file hash + options.
 * `hashFileBytes` must run while the raw buffer is still alive.
 */
export async function cacheKeyFromParts(
  fileHash: string,
  options: PipelineOptions,
): Promise<string> {
  const optionsKey = canonicalizeOptions(options);
  const combined = `${fileHash}|${optionsKey}`;
  const hash = await sha256(new TextEncoder().encode(combined));
  return CACHE_KEY_PREFIX + hash;
}

/**
 * Generate a cache key from file bytes and analysis options.
 * Convenience wrapper; the split helpers avoid hashing the same buffer twice.
 */
export async function generateCacheKey(
  fileBytes: ArrayBuffer,
  options: PipelineOptions,
): Promise<string> {
  const fileHash = await hashFileBytes(fileBytes);
  return cacheKeyFromParts(fileHash, options);
}

/**
 * Look up a cached analysis result.
 * Pass a precomputed `cacheKey` when the file buffer has already been
 * transferred to a worker (the hash can no longer be recomputed).
 * Returns null if not found or expired.
 */
export async function getCachedAnalysis(
  fileBytes: ArrayBuffer | null,
  options: PipelineOptions,
  cacheKey?: string,
): Promise<CachedAnalysis | null> {
  try {
    const key = cacheKey ?? (fileBytes ? await generateCacheKey(fileBytes, options) : null);
    if (!key) return null;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => {
        const entry = request.result as CachedAnalysis | undefined;
        if (!entry) {
          resolve(null);
          return;
        }
        // Check TTL
        const age = Date.now() - new Date(entry.createdAt).getTime();
        if (age > DEFAULT_TTL_MS) {
          // Expired — delete it asynchronously
          const delTx = db.transaction(STORE_NAME, 'readwrite');
          delTx.objectStore(STORE_NAME).delete(key);
          resolve(null);
          return;
        }
        resolve(entry);
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    // IndexedDB unavailable (SSR, private browsing, etc.) — degrade gracefully
    return null;
  }
}

/**
 * Store an analysis result in the cache.
 * Pass `precomputed` ({ cacheKey, fileHash }) when the file buffer has already
 * been transferred to a worker. Automatically evicts oldest entries when
 * exceeding MAX_ENTRIES.
 */
export async function setCachedAnalysis(
  fileBytes: ArrayBuffer | null,
  options: PipelineOptions,
  result: UnifiedAnalysis,
  fileName: string,
  fileSize: number,
  precomputed?: { cacheKey: string; fileHash: string },
): Promise<void> {
  try {
    const cacheKey = precomputed?.cacheKey ?? (fileBytes ? await generateCacheKey(fileBytes, options) : null);
    if (!cacheKey) return;
    const fileHash = precomputed?.fileHash ?? (fileBytes ? await hashFileBytes(fileBytes) : '');
    const optionsKey = canonicalizeOptions(options);

    const entry: CachedAnalysis & { cacheKey: string } = {
      cacheKey,
      result,
      createdAt: new Date().toISOString(),
      fileName,
      fileSize,
      fileHash,
      optionsKey,
    };

    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(entry);

    // Evict oldest entries if over limit
    const countReq = store.count();
    countReq.onsuccess = () => {
      if (countReq.result > MAX_ENTRIES) {
        const index = store.index('createdAt');
        const cursor = index.openCursor();
        let toDelete = countReq.result - MAX_ENTRIES;
        cursor.onsuccess = () => {
          if (cursor.result && toDelete > 0) {
            cursor.result.delete();
            toDelete--;
            cursor.result.continue();
          }
        };
      }
    };
  } catch {
    // Silently fail — caching is best-effort
  }
}

/**
 * Get cache statistics for display in the UI.
 */
export async function getCacheStats(): Promise<CacheStats> {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const countReq = store.count();
      countReq.onsuccess = () => {
        const entries = countReq.result;
        if (entries === 0) {
          resolve({ entries: 0, totalSizeBytes: 0, oldestEntry: null, newestEntry: null });
          return;
        }

        // Sample a few entries to estimate size
        const index = store.index('createdAt');
        let oldest: string | null = null;
        let newest: string | null = null;
        let totalSize = 0;
        let sampled = 0;

        const cursorReq = index.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            const entry = cursor.value as CachedAnalysis & { cacheKey: string };
            if (!oldest) oldest = entry.createdAt;
            newest = entry.createdAt;
            // Rough estimate: JSON size of the result
            totalSize += JSON.stringify(entry.result).length * 2; // UTF-16
            sampled++;
            if (sampled < 5) cursor.continue();
            else {
              // Extrapolate
              const avgSize = totalSize / sampled;
              resolve({
                entries,
                totalSizeBytes: Math.round(avgSize * entries),
                oldestEntry: oldest,
                newestEntry: newest,
              });
            }
          } else {
            resolve({
              entries,
              totalSizeBytes: totalSize,
              oldestEntry: oldest,
              newestEntry: newest,
            });
          }
        };
        cursorReq.onerror = () => {
          resolve({ entries, totalSizeBytes: 0, oldestEntry: null, newestEntry: null });
        };
      };
      countReq.onerror = () => {
        resolve({ entries: 0, totalSizeBytes: 0, oldestEntry: null, newestEntry: null });
      };
    });
  } catch {
    return { entries: 0, totalSizeBytes: 0, oldestEntry: null, newestEntry: null };
  }
}

/**
 * Clear the entire analysis cache.
 */
export async function clearAnalysisCache(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
  } catch {
    // Silently fail
  }
}

/**
 * Remove a specific cache entry by file hash.
 */
export async function removeByFileHash(fileHash: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('fileHash');
    const request = index.openCursor(IDBKeyRange.only(fileHash));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
  } catch {
    // Silently fail
  }
}
