/**
 * findRecordForRun tests — outcome-to-record linkage guard (Phase 1 D2).
 *
 * The rule under test: an observed manufacturing outcome must attach to the
 * record of the SPECIFIC analysis run (same bytes + same context), never to
 * an arbitrary record that merely shares the file fingerprint. These tests
 * pin the matcher's behavior that PrintOutcomeCard and the upload flow rely
 * on to satisfy handoff requirement D2 ("do not attach a historical result to
 * a different analysis just because its model fingerprint matches").
 *
 * Uses the in-memory RecordStore — no IndexedDB, no fetch.
 */
import { describe, it, expect } from 'vitest';
import type { UnifiedAnalysis } from '@/analysis/types';
import { buildAnalysisRecord, type AnalysisRecord } from '../analysisRecord';
import { createMemoryStore, findRecordForRun, updateOutcome } from '../analysisHistory';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function makeAnalysis(): UnifiedAnalysis {
  return {
    timestamp: '2026-10-16T00:00:00.000Z',
    modelFileName: 'part.stl',
    overallConfidence: 0.9,
  } as unknown as UnifiedAnalysis;
}

function makeRecord(over: {
  id: string;
  fileHash?: string;
  material?: string;
  materialFamily?: string | null;
  units?: string;
  createdAt?: string;
}): AnalysisRecord {
  return buildAnalysisRecord({
    id: over.id,
    createdAt: over.createdAt,
    analysis: makeAnalysis(),
    fileName: 'part.stl',
    fileHash: over.fileHash ?? HASH_A,
    fileSizeBytes: 1234,
    units: over.units ?? 'mm',
    context: {
      material: over.material ?? 'PLA',
      materialFamily: over.materialFamily === undefined ? 'fdm' : over.materialFamily,
    },
  });
}

describe('findRecordForRun', () => {
  it('matches on fingerprint AND context, newest first', async () => {
    const store = createMemoryStore();
    await store.save(makeRecord({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' }));
    await store.save(makeRecord({ id: 'new', createdAt: '2026-02-01T00:00:00.000Z' }));

    const found = await findRecordForRun(store, {
      fileHash: HASH_A,
      material: 'PLA',
      materialFamily: 'fdm',
    });
    expect(found?.id).toBe('new');
  });

  it('does NOT match a record from a different material context', async () => {
    const store = createMemoryStore();
    // Same bytes, different material: two distinct analysis runs.
    await store.save(makeRecord({ id: 'pla-run', material: 'PLA' }));
    await store.save(makeRecord({ id: 'petg-run', material: 'PETG' }));

    const found = await findRecordForRun(store, {
      fileHash: HASH_A,
      material: 'PLA',
      materialFamily: 'fdm',
    });
    expect(found?.id).toBe('pla-run'); // never the PETG run despite same hash
  });

  it('does NOT match a record from a different units context', async () => {
    const store = createMemoryStore();
    await store.save(makeRecord({ id: 'mm-run', units: 'mm' }));
    await store.save(makeRecord({ id: 'inch-run', units: 'inch' }));

    const found = await findRecordForRun(store, { fileHash: HASH_A, units: 'inch' });
    expect(found?.id).toBe('inch-run');
  });

  it('does NOT match a different file fingerprint', async () => {
    const store = createMemoryStore();
    await store.save(makeRecord({ id: 'a-run', fileHash: HASH_A }));

    expect(await findRecordForRun(store, { fileHash: HASH_B, material: 'PLA' })).toBeNull();
  });

  it('returns null (never a guess) when only the fingerprint matches', async () => {
    const store = createMemoryStore();
    await store.save(makeRecord({ id: 'abs-resin', materialFamily: 'sla' }));

    // Caller asks for an fdm run of the same bytes: no such record exists.
    const found = await findRecordForRun(store, {
      fileHash: HASH_A,
      material: 'PLA',
      materialFamily: 'fdm',
    });
    expect(found).toBeNull();
  });

  it('resolves to the run whose recorded outcome updateOutcome wrote', async () => {
    const store = createMemoryStore();
    await store.save(makeRecord({ id: 'run-a', material: 'PLA' }));
    await store.save(makeRecord({ id: 'run-b', material: 'PETG' }));

    const target = await findRecordForRun(store, { fileHash: HASH_A, material: 'PETG' });
    await updateOutcome(store, target!.id, { status: 'failure', notes: 'delamination' });

    expect((await store.get('run-b'))?.outcome.status).toBe('failure');
    // The PLA run is untouched — outcomes never bleed across runs.
    expect((await store.get('run-a'))?.outcome.status).toBe('not_tested');
  });
});
