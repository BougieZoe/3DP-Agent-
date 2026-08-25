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
 * Generate a cache key from file bytes and analysis options.
 * This is the primary lookup key for the cache.
 */
export async function generateCacheKey(
  fileBytes: ArrayBuffer,
  options: PipelineOptions,
): Promise<string> {
  const [fileHash, optionsKey] = await Promise.all([
    sha256(fileBytes),
    Promise.resolve(canonicalizeOptions(options)),
  ]);
  // Combine into a single key
  const combined = `${fileHash}|${optionsKey}`;
  return sha256(new TextEncoder().encode(combined));
}

/**
 * Look up a cached analysis result.
 * Returns null if not found or expired.
 */
export async function getCachedAnalysis(
  fileBytes: ArrayBuffer,
  options: PipelineOptions,
): Promise<CachedAnalysis | null> {
  try {
    const cacheKey = await generateCacheKey(fileBytes, options);
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(cacheKey);
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
          delTx.objectStore(STORE_NAME).delete(cacheKey);
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
 * Automatically evicts oldest entries when exceeding MAX_ENTRIES.
 */
export async function setCachedAnalysis(
  fileBytes: ArrayBuffer,
  options: PipelineOptions,
  result: UnifiedAnalysis,
  fileName: string,
  fileSize: number,
): Promise<void> {
  try {
    const [cacheKey, fileHash] = await Promise.all([
      generateCacheKey(fileBytes, options),
      sha256(fileBytes),
    ]);
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
