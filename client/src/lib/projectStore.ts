import type { ModelSnapshot } from './modelVersions';

/**
 * Local project store (IndexedDB).
 *
 * Why: the app forgot every model on reload. The user had to re-find the file
 * and re-run a 20–40s analysis just to continue where they were, and the
 * version history (localStorage) pointed at a file that was no longer loaded.
 *
 * What is stored: the original file bytes plus the metadata needed to restore
 * the session (units + last measurement snapshot). Bounded to a few recent
 * projects and a hard byte ceiling; quota errors drop the oldest entry instead
 * of failing the upload.
 */

const DB_NAME = '3dp-agent';
const DB_VERSION = 1;
const STORE = 'projects';

export const MAX_PROJECTS = 3;
export const MAX_PROJECT_BYTES = 60 * 1024 * 1024; // 60MB per file

export interface StoredProjectMeta {
  id: string;
  fileName: string;
  savedAt: number;
  sizeBytes: number;
  units: string;
  snapshot: ModelSnapshot;
}

export interface StoredProject extends StoredProjectMeta {
  blob: Blob;
}

/** Stable id for "this exact file" — re-uploading the same file overwrites. */
export function projectId(file: { name: string; size: number; lastModified: number }): string {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

export function shouldPersist(sizeBytes: number): boolean {
  return Number.isFinite(sizeBytes) && sizeBytes > 0 && sizeBytes <= MAX_PROJECT_BYTES;
}

/** Keep `items` newest-first and within the count budget. Pure, for tests. */
export function trimToBudget<T extends { savedAt: number }>(items: T[], max = MAX_PROJECTS): T[] {
  return [...items].sort((a, b) => b.savedAt - a.savedAt).slice(0, max);
}

function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const done = (db: IDBDatabase | null) => {
      if (settled) return;
      settled = true;
      resolve(db);
    };
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => done(req.result);
    req.onerror = () => done(null);
    req.onblocked = () => done(null);
    setTimeout(() => done(null), 3000);
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
      t.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveProject(
  file: File,
  units: string,
  snapshot: ModelSnapshot,
): Promise<void> {
  if (!shouldPersist(file.size)) return;
  const db = await openDb();
  if (!db) return;
  const meta: StoredProjectMeta = {
    id: projectId(file),
    fileName: file.name,
    savedAt: Date.now(),
    sizeBytes: file.size,
    units,
    snapshot,
  };
  const record: StoredProject = { ...meta, blob: file };
  const ok = await tx(db, 'readwrite', (s) => s.put(record) as IDBRequest<IDBValidKey>);
  if (ok === null) {
    // Quota or serialization failure: drop the oldest and retry once.
    const existing = await listProjects();
    if (existing.length > 0) {
      await deleteProject(existing[existing.length - 1].id);
      await tx(db, 'readwrite', (s) => s.put(record) as IDBRequest<IDBValidKey>);
    }
    return;
  }
  // Enforce the count budget: newest MAX_PROJECTS survive, the rest go.
  const all = await listProjects();
  const newestFirst = [...all].sort((a, b) => b.savedAt - a.savedAt);
  for (const stale of newestFirst.slice(MAX_PROJECTS)) {
    await deleteProject(stale.id);
  }
}

export async function listProjects(): Promise<StoredProjectMeta[]> {
  const db = await openDb();
  if (!db) return [];
  const all = await tx<StoredProject[]>(db, 'readonly', (s) => s.getAll() as IDBRequest<StoredProject[]>);
  if (!all) return [];
  return trimToBudget(
    all.map(({ blob: _blob, ...meta }) => meta),
  );
}

export async function loadProject(id: string): Promise<StoredProject | null> {
  const db = await openDb();
  if (!db) return null;
  const rec = await tx<StoredProject>(db, 'readonly', (s) => s.get(id) as IDBRequest<StoredProject>);
  if (!rec || !(rec.blob instanceof Blob)) return null;
  return rec;
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await tx(db, 'readwrite', (s) => s.delete(id) as IDBRequest<undefined>);
}
