/**
 * Print-outcome telemetry — the seed of the confidence-gate data flywheel.
 *
 * When a user reports how a generated model actually printed, we pair that
 * outcome with the model's predicted confidence/verdict. Over time this
 * calibrates the rule-based confidence gate against real-world results
 * (the "did it print" blind spot). Stored locally for now; a hosted
 * analytics endpoint can replace localStorage later.
 */

export type PrintOutcome = 'ok' | 'issue' | 'fail';

export interface PrintFeedbackEntry {
  confidence: number;
  verdict: string;
  outcome: PrintOutcome;
  timestamp: number;
}

const STORAGE_KEY = '3dp.printFeedback';
const MAX_ENTRIES = 200;

function read(): PrintFeedbackEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as PrintFeedbackEntry[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(entries: PrintFeedbackEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* storage unavailable — ignore */
  }
}

/** Record how a model with the given confidence actually printed. */
export function recordPrintOutcome(entry: Omit<PrintFeedbackEntry, 'timestamp'>): void {
  write([...read(), { ...entry, timestamp: Date.now() }]);
}

export interface PrintStats {
  count: number;
  okRate: number | null;
  byVerdict: { pass: { total: number; ok: number }; warn: { total: number; ok: number }; fail: { total: number; ok: number } };
}

/** Aggregate recorded outcomes — e.g. "based on 12 reported prints, 75% OK". */
export function getPrintStats(): PrintStats {
  const entries = read();
  const bucket = (verdict: string) => {
    const list = entries.filter((e) => e.verdict === verdict);
    const ok = list.filter((e) => e.outcome === 'ok').length;
    return { total: list.length, ok };
  };
  const stats: PrintStats = {
    count: entries.length,
    okRate: entries.length ? entries.filter((e) => e.outcome === 'ok').length / entries.length : null,
    byVerdict: { pass: bucket('PASS'), warn: bucket('WARN'), fail: bucket('FAIL') },
  };
  return stats;
}
