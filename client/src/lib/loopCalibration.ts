// client/src/lib/loopCalibration.ts
//
// Calibration hook for the LOOP first-time-right score.
//
// The score's weights are heuristic until fitted against real outcomes.
// This module records every prediction (with geometry features) so a future
// fitting pass can learn weights from printFeedback outcomes. Pairing is by
// fileHash when feedback carries file context, else nearest-prior-prediction
// in time — provisional by design, documented as such. Local only.

import type { SupportDifficulty } from '@/analysis/types';
import type { ScoreBand } from '@/analysis/loop';
import type { PrintOutcome } from './printFeedback';

export interface LoopPrediction {
  fileHash: string;
  fileName: string;
  /** ISO timestamp of the analysis run. */
  timestamp: string;
  material: string;
  score: number;
  band: ScoreBand;
  drivers: string[];
  wasteRatio: number;
  thinWallRatio: number;
  overhangRatio: number;
  supportDifficulty: SupportDifficulty;
}

export interface OutcomeReport {
  /** Epoch ms (printFeedback uses Date.now()). */
  timestamp: number;
  outcome: PrintOutcome;
}

export interface CalibratedPair {
  prediction: LoopPrediction;
  outcome: PrintOutcome;
}

const STORAGE_KEY = '3dp.loopPredictions.v1';
const MAX_ENTRIES = 500;

export function getLoopPredictions(): LoopPrediction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as LoopPrediction[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function logLoopPrediction(p: LoopPrediction): void {
  try {
    const all = [...getLoopPredictions(), p];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(-MAX_ENTRIES)));
  } catch {
    /* best-effort */
  }
}

export function clearLoopPredictions(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Pair each outcome with the latest prediction at or before it.
 * Provisional: without file context on the feedback side, time proximity
 * is the only signal. Unmatched outcomes (no prior prediction) are dropped.
 */
export function pairWithFeedback(
  predictions: LoopPrediction[],
  outcomes: OutcomeReport[],
): CalibratedPair[] {
  const sorted = [...predictions].sort(
    (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)
  );
  const pairs: CalibratedPair[] = [];
  for (const o of outcomes) {
    let best: LoopPrediction | null = null;
    for (const p of sorted) {
      if (Date.parse(p.timestamp) <= o.timestamp) best = p;
      else break;
    }
    if (best) pairs.push({ prediction: best, outcome: o.outcome });
  }
  return pairs;
}
