/**
 * Analysis run recorder tests — every reported analysis gets its own record.
 *
 * Rules under test:
 *  1. A run with a fingerprint and working store yields a readable record id.
 *  2. A run without a fingerprint is not recordable (no invented identity).
 *  3. Two runs of the same bytes/context are distinct records, never merged.
 *  4. A repair run links to the previous record and stores the comparison.
 *  5. A dropped write returns null instead of a dangling id.
 */
import { describe, it, expect } from 'vitest';
import type { UnifiedAnalysis } from '@/analysis/types';
import type { Material } from '@shared/domain/material';
import { createMemoryStore, type RecordStore } from '../analysisHistory';
import { saveAnalysisRun } from '../analysisRuns';

const HASH = 'a'.repeat(64);
const PLA = { name: 'PLA', technology: 'fdm' } as Material;

function analysis(over: Partial<Record<string, unknown>> = {}): UnifiedAnalysis {
  return {
    timestamp: '2026-11-16T00:00:00.000Z',
    modelFileName: 'part.stl',
    overallConfidence: 0.9,
    ...over,
  } as unknown as UnifiedAnalysis;
}

describe('saveAnalysisRun', () => {
  it('persists a readable record with material context and an untested outcome', async () => {
    const store = createMemoryStore();
    const saved = await saveAnalysisRun({
      analysis: analysis(),
      fileName: 'part.stl',
      fileHash: HASH,
      fileSizeBytes: 1234,
      units: 'mm',
      material: PLA,
      materialFamily: 'fdm',
      store,
      id: 'run-1',
    });

    expect(saved?.id).toBe('run-1');
    const read = await store.get('run-1');
    expect(read?.model.fileHash).toBe(HASH);
    expect(read?.context.material).toBe('PLA');
    expect(read?.context.materialFamily).toBe('fdm');
    expect(read?.outcome.status).toBe('not_tested');
  });

  it('refuses to invent identity without a fingerprint', async () => {
    const store = createMemoryStore();
    const saved = await saveAnalysisRun({
      analysis: analysis(),
      fileName: 'part.stl',
      fileHash: '',
      store,
    });
    expect(saved).toBeNull();
    expect(await store.list()).toHaveLength(0);
  });

  it('creates a distinct record for a second run of the same bytes/context', async () => {
    const store = createMemoryStore();
    const base = {
      analysis: analysis(),
      fileName: 'part.stl',
      fileHash: HASH,
      material: PLA,
      materialFamily: 'fdm' as const,
      store,
    };
    const first = await saveAnalysisRun(base);
    const second = await saveAnalysisRun(base);

    expect(first?.id).not.toBe(second?.id);
    expect(await store.list()).toHaveLength(2);
  });

  it('links a repair run to the previous record with a measured comparison', async () => {
    const store = createMemoryStore();
    const before = analysis();
    const saved = await saveAnalysisRun({
      analysis: before,
      fileName: 'part.stl',
      fileHash: HASH,
      material: PLA,
      materialFamily: 'fdm',
      repair: {
        derivedFromRecordId: 'run-before',
        note: 'pymeshfix + place on plate',
        before,
      },
      store,
      id: 'run-after',
    });

    const read = await store.get(saved!.id);
    expect(read?.repair?.derivedFromRecordId).toBe('run-before');
    expect(read?.repair?.note).toBe('pymeshfix + place on plate');
    expect(read?.repair?.comparison.geometricChange).toBe('unknown');
  });

  it('returns null when the store silently drops the write', async () => {
    const dropped: RecordStore = {
      async save() {},
      async get() {
        return null;
      },
      async list() {
        return [];
      },
      async getLatestByHash() {
        return null;
      },
    };

    const saved = await saveAnalysisRun({
      analysis: analysis(),
      fileName: 'part.stl',
      fileHash: HASH,
      store: dropped,
    });
    expect(saved).toBeNull();
  });
});
