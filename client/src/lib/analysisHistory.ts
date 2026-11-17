/**
 * Analysis History — append-style, local-only persistence for AnalysisRecords.
 *
 * Separate IndexedDB database from the analysis cache: the cache exists to
 * skip recomputation (same key overwrites); this store exists to keep a
 * traceable history (every analysis run gets its own record id).
 *
 * Privacy: records stay in the browser. Nothing here performs network I/O,
 * uploads models, or sends telemetry. Model files are never stored — only the
 * SHA-256 fingerprint and measured summaries.
 *
 * The store is behind a small RecordStore interface so tests (and any future
 * backend) can substitute an implementation without touching call sites.
 */

import {
  normalizeAnalysisRecord,
  type AnalysisRecord,
  type EngineerDecision,
  type OutcomeRecord,
} from './analysisRecord';

// ── Store interface ──────────────────────────────────────────────────────────

export interface RecordStore {
  save(record: AnalysisRecord): Promise<void>;
  get(id: string): Promise<AnalysisRecord | null>;
  list(): Promise<AnalysisRecord[]>;
  /** Most recent record for a model fingerprint, or null. */
  getLatestByHash(fileHash: string): Promise<AnalysisRecord | null>;
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function byCreatedAtDesc(a: AnalysisRecord, b: AnalysisRecord): number {
  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * Record an actual manufacturing outcome on an existing record.
 * Returns the updated record, or null when the record does not exist.
 * Only explicit statuses are written — missing details stay null.
 */
export async function updateOutcome(
  store: RecordStore,
  recordId: string,
  outcome: Partial<OutcomeRecord> & { status: OutcomeRecord['status'] },
): Promise<AnalysisRecord | null> {
  const record = await store.get(recordId);
  if (!record) return null;
  const updated: AnalysisRecord = {
    ...record,
    outcome: {
      status: outcome.status,
      recordedAt: outcome.recordedAt ?? new Date().toISOString(),
      failureLayer: outcome.failureLayer ?? null,
      failureType: outcome.failureType ?? null,
      failureMode: outcome.failureMode ?? null,
      actualSettings: outcome.actualSettings ?? null,
      notes: outcome.notes ?? null,
    },
  };
  await store.save(updated);
  return updated;
}

/** Record an engineer decision on an existing record. */
export async function recordDecision(
  store: RecordStore,
  recordId: string,
  decision: string,
  rationale: string | null = null,
): Promise<AnalysisRecord | null> {
  const record = await store.get(recordId);
  if (!record) return null;
  const engineerDecision: EngineerDecision = {
    decidedAt: new Date().toISOString(),
    decision,
    rationale,
  };
  const updated: AnalysisRecord = { ...record, decision: engineerDecision };
  await store.save(updated);
  return updated;
}

// ── Run resolution ───────────────────────────────────────────────────────────

/** Criteria identifying ONE analysis run: same bytes AND same run context. */
export interface RunCriteria {
  fileHash: string;
  /** Match only records with this material; omit to ignore material. */
  material?: string | null;
  /** Match only records with this family; omit to ignore family. */
  materialFamily?: string | null;
  /** Match only records with these source units; omit to ignore units. */
  units?: string | null;
}

/**
 * Find the record for a specific analysis run (newest match first).
 *
 * Matching requires the model fingerprint AND exact context equality on every
 * field the caller provides — the same bytes analyzed under a different
 * material/units is a DIFFERENT run with different findings, and its record
 * must never be picked by fingerprint alone. Omitted context fields are not
 * matched on. Returns null when no record matches; callers must treat that as
 * "no linked record", never as "any record for this file".
 */
export async function findRecordForRun(
  store: RecordStore,
  run: RunCriteria,
): Promise<AnalysisRecord | null> {
  const records = await store.list(); // sorted newest-first
  return (
    records.find(
      (r) =>
        r.model.fileHash === run.fileHash &&
        (run.material === undefined || (r.context.material ?? null) === run.material) &&
        (run.materialFamily === undefined ||
          (r.context.materialFamily ?? null) === run.materialFamily) &&
        (run.units === undefined || (r.model.units ?? null) === (run.units ?? null)),
    ) ?? null
  );
}

// ── In-memory store (tests, SSR fallback) ────────────────────────────────────

export function createMemoryStore(): RecordStore {
  const map = new Map<string, AnalysisRecord>();
  return {
    async save(record) {
      map.set(record.id, record);
    },
    async get(id) {
      return map.get(id) ?? null;
    },
    async list() {
      return [...map.values()].sort(byCreatedAtDesc);
    },
    async getLatestByHash(fileHash) {
      const matches = [...map.values()].filter((r) => r.model.fileHash === fileHash);
      matches.sort(byCreatedAtDesc);
      return matches[0] ?? null;
    },
  };
}

// ── IndexedDB store ──────────────────────────────────────────────────────────

const DB_NAME = '3dp-agent-analysis-history';
const DB_VERSION = 1;
const STORE_NAME = 'analysis-records';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('fileHash', 'model.fileHash', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }
    };
  });
}

/**
 * IndexedDB-backed history. All reads pass through normalizeAnalysisRecord so
 * legacy or malformed entries degrade to honest nulls instead of throwing.
 * Every method fails soft (null / no-op) when IndexedDB is unavailable.
 */
export function createIndexedDbStore(): RecordStore {
  return {
    async save(record) {
      try {
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error ?? new Error('history transaction aborted'));
          tx.objectStore(STORE_NAME).put(record);
        });
      } catch {
        // best-effort — history must never break the analysis flow
      }
    },
    async get(id) {
      try {
        const db = await openDB();
        return await new Promise<AnalysisRecord | null>((resolve, reject) => {
          const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id);
          request.onsuccess = () => resolve(normalizeAnalysisRecord(request.result));
          request.onerror = () => reject(request.error);
        });
      } catch {
        return null;
      }
    },
    async list() {
      try {
        const db = await openDB();
        return await new Promise<AnalysisRecord[]>((resolve, reject) => {
          const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll();
          request.onsuccess = () => {
            const records = (request.result as unknown[])
              .map(normalizeAnalysisRecord)
              .filter((r): r is AnalysisRecord => r !== null);
            resolve(records.sort(byCreatedAtDesc));
          };
          request.onerror = () => reject(request.error);
        });
      } catch {
        return [];
      }
    },
    async getLatestByHash(fileHash) {
      try {
        const db = await openDB();
        return await new Promise<AnalysisRecord | null>((resolve, reject) => {
          const index = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).index('fileHash');
          const request = index.getAll(IDBKeyRange.only(fileHash));
          request.onsuccess = () => {
            const records = (request.result as unknown[])
              .map(normalizeAnalysisRecord)
              .filter((r): r is AnalysisRecord => r !== null)
              .sort(byCreatedAtDesc);
            resolve(records[0] ?? null);
          };
          request.onerror = () => reject(request.error);
        });
      } catch {
        return null;
      }
    },
  };
}

/** Default shared store for app code. */
let defaultStore: RecordStore | null = null;
export function getAnalysisHistory(): RecordStore {
  if (!defaultStore) defaultStore = createIndexedDbStore();
  return defaultStore;
}

/**
 * Save a record, swallowing all errors. History is additive diagnostics — a
 * storage failure must never surface as an analysis failure.
 */
export async function saveAnalysisRecordQuietly(
  record: AnalysisRecord,
  store: RecordStore = getAnalysisHistory(),
): Promise<void> {
  try {
    await store.save(record);
  } catch {
    // intentionally silent
  }
}
