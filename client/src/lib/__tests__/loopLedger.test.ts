// @vitest-environment happy-dom
/// <reference types="vitest/globals" />
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadLedger, recordLoopPrint, clearLedger, ledgerTotals, ledgerToCSV,
  type LoopLedgerEntry,
} from '../loopLedger';

function entry(overrides: Partial<LoopLedgerEntry> = {}): LoopLedgerEntry {
  return {
    fileHash: 'abc123',
    fileName: 'wall_tower.stl',
    timestamp: '2026-09-10T00:00:00.000Z',
    material: 'PLA',
    technology: 'fdm',
    partGrams: 7.6,
    supportGrams: 0.1,
    totalWasteGrams: 0.9,
    wasteRatio: 0.115,
    fate: 'recyclable',
    firstTimeScore: 85,
    expectedFailureCostUsd: 0.12,
    monthsCompostMin: 2,
    monthsCompostMax: 5,
    ...overrides,
  };
}

describe('loopLedger', () => {
  beforeEach(() => {
    clearLedger();
  });

  it('starts empty and records one print', () => {
    expect(loadLedger()).toEqual([]);
    recordLoopPrint(entry());
    expect(loadLedger()).toHaveLength(1);
  });

  it('replaces on re-upload of the same file hash (no doubles)', () => {
    recordLoopPrint(entry({ firstTimeScore: 80 }));
    recordLoopPrint(entry({ firstTimeScore: 90 }));
    const all = loadLedger();
    expect(all).toHaveLength(1);
    expect(all[0].firstTimeScore).toBe(90);
  });

  it('keeps different files side by side', () => {
    recordLoopPrint(entry({ fileHash: 'aaa', fileName: 'a.stl' }));
    recordLoopPrint(entry({ fileHash: 'bbb', fileName: 'b.stl' }));
    expect(loadLedger()).toHaveLength(2);
  });

  it('totals virgin/waste mass and average score', () => {
    recordLoopPrint(entry({ partGrams: 7.6, totalWasteGrams: 0.9, firstTimeScore: 80 }));
    recordLoopPrint(entry({ fileHash: 'bbb', partGrams: 10, totalWasteGrams: 2, firstTimeScore: 90 }));
    const t = ledgerTotals(loadLedger());
    expect(t.prints).toBe(2);
    expect(t.virginKg).toBe(0.018); // 17.6 g, rounded to 3 decimals
    expect(t.wasteKg).toBe(0.003); // 2.9 g, rounded to 3 decimals
    expect(t.avgScore).toBe(85);
  });

  it('exports a header + one row per print as CSV', () => {
    recordLoopPrint(entry());
    const csv = ledgerToCSV(loadLedger());
    const lines = csv.split('\n');
    expect(lines[0]).toMatch(/^timestamp,file_name,material/);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('wall_tower.stl');
    expect(lines[1]).toContain('recyclable');
  });

  it('clears everything', () => {
    recordLoopPrint(entry());
    clearLedger();
    expect(loadLedger()).toEqual([]);
  });
});
