// client/src/lib/loopLedger.ts
//
// LOOP ledger — per-print circularity records accumulated across uploads.
// Pure localStorage (same pattern as printFeedback): no account, no network,
// nothing leaves the machine. Powers the LOOP tab ledger card + ESG CSV export.

import type { WasteFate } from '@/analysis/loop';

export interface LoopLedgerEntry {
  /** Content hash of the source file — re-upload replaces, never duplicates. */
  fileHash: string;
  fileName: string;
  /** ISO timestamp of the analysis run. */
  timestamp: string;
  material: string;
  technology: string;
  partGrams: number;
  supportGrams: number;
  totalWasteGrams: number;
  wasteRatio: number;
  fate: WasteFate;
  firstTimeScore: number;
  expectedFailureCostUsd: number;
  monthsCompostMin: number | null;
  monthsCompostMax: number | null;
}

const STORAGE_KEY = '3dp.loopLedger.v1';
const MAX_ENTRIES = 500;

export function loadLedger(): LoopLedgerEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as LoopLedgerEntry[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(entries: LoopLedgerEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* storage unavailable or full — ledger is best-effort */
  }
}

/** Record one print; same fileHash replaces the previous entry. */
export function recordLoopPrint(entry: LoopLedgerEntry): LoopLedgerEntry[] {
  const entries = loadLedger().filter((e) => e.fileHash !== entry.fileHash);
  entries.push(entry);
  save(entries);
  return entries;
}

export function clearLedger(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export interface LedgerTotals {
  prints: number;
  virginKg: number;
  wasteKg: number;
  avgScore: number;
}

export function ledgerTotals(entries: LoopLedgerEntry[]): LedgerTotals {
  if (entries.length === 0) return { prints: 0, virginKg: 0, wasteKg: 0, avgScore: 0 };
  const virginKg = entries.reduce((s, e) => s + e.partGrams / 1000, 0);
  const wasteKg = entries.reduce((s, e) => s + e.totalWasteGrams / 1000, 0);
  const avgScore = entries.reduce((s, e) => s + e.firstTimeScore, 0) / entries.length;
  const round3 = (n: number): number => Math.round(n * 1000) / 1000;
  return {
    prints: entries.length,
    virginKg: round3(virginKg),
    wasteKg: round3(wasteKg),
    avgScore: Math.round(avgScore),
  };
}

const CSV_HEADER = 'timestamp,file_name,material,technology,part_g,support_g,waste_g,waste_ratio,fate,first_time_score,expected_failure_usd,compost_months_min,compost_months_max';

function csvCell(v: string | number | null): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function ledgerToCSV(entries: LoopLedgerEntry[]): string {
  const lines = entries.map((e) => [
    e.timestamp, e.fileName, e.material, e.technology,
    e.partGrams, e.supportGrams, e.totalWasteGrams, e.wasteRatio,
    e.fate, e.firstTimeScore, e.expectedFailureCostUsd, e.monthsCompostMin, e.monthsCompostMax,
  ].map(csvCell).join(','));
  return [CSV_HEADER, ...lines].join('\n');
}
