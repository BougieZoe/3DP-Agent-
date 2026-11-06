import type { UnifiedAnalysis } from '@/analysis/types';

/**
 * Model version history.
 *
 * Why: every corrective action (repair, re-orient, unit change) replaced the
 * previous state in place. The user could not answer "is this better than
 * before?" without remembering numbers, and reloading lost the record entirely.
 *
 * What is stored: metrics only, never geometry. A version is a *measurement
 * snapshot* plus what caused it — enough to show a delta and to prove a fix
 * worked, small enough to keep in localStorage (a 400k-triangle mesh is not).
 */

export type VersionAction = 'upload' | 'orientation' | 'repair' | 'units';

export interface ModelSnapshot {
  minWallMm: number | null;
  thinWallRatio: number;
  overhangFaces: number;
  overhangRatio: number;
  isWatertight: boolean;
  volumeReliable: boolean;
  volumeMm3: number;
  triangleCount: number;
}

export interface ModelVersion {
  id: string;
  at: number;
  action: VersionAction;
  snapshot: ModelSnapshot;
  /**
   * 'discarded' = the action ran, the measurement regressed, the model was
   * left untouched. Recorded so "I clicked it and nothing happened" has an
   * explanation instead of silence.
   */
  outcome?: 'applied' | 'discarded';
  /** Free-text detail, e.g. "rotated 90° about X" or a repair note. */
  note?: string;
}

export interface SnapshotDelta {
  minWallMm: number | null;
  thinWallRatio: number;
  overhangFaces: number;
  overhangRatio: number;
  volumeMm3: number | null;
}

const STORAGE_PREFIX = '3dp.versions.';
export const MAX_VERSIONS = 20;

const finite = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) ? n : null;

/** Extract the measured facts worth comparing between two model states. */
export function snapshotFromAnalysis(analysis: UnifiedAnalysis | null | undefined): ModelSnapshot {
  const m = analysis?.metrics?.result;
  const v = analysis?.validation?.result;
  const t = analysis?.topology?.result;
  // Same selection the verdict bar and report use (p5 → avg → median → min),
  // so the history never shows a different "wall" than the headline.
  const headlineWall = finite(m?.p5WallThicknessMm)
    ?? finite(m?.avgWallThicknessMm)
    ?? finite(m?.medianWallThicknessMm)
    ?? finite(m?.minWallThicknessMm);
  return {
    minWallMm: headlineWall,
    thinWallRatio: finite(m?.thinWallRatio) ?? 0,
    overhangFaces: finite(m?.overhang?.faceCount) ?? 0,
    overhangRatio: finite(m?.overhang?.ratio) ?? 0,
    isWatertight: v?.isWatertight === true,
    volumeReliable: m?.volumeReliable === true,
    volumeMm3: finite(m?.meshVolumeMm3) ?? 0,
    triangleCount: finite(t?.triangleCount) ?? 0,
  };
}

/** `to - from`, i.e. positive min-wall is an improvement, positive overhang is worse. */
export function diffSnapshots(from: ModelSnapshot, to: ModelSnapshot): SnapshotDelta {
  return {
    minWallMm: from.minWallMm != null && to.minWallMm != null ? to.minWallMm - from.minWallMm : null,
    thinWallRatio: to.thinWallRatio - from.thinWallRatio,
    overhangFaces: to.overhangFaces - from.overhangFaces,
    overhangRatio: to.overhangRatio - from.overhangRatio,
    volumeMm3: from.volumeReliable && to.volumeReliable ? to.volumeMm3 - from.volumeMm3 : null,
  };
}

const keyFor = (fileName: string) => `${STORAGE_PREFIX}${fileName.slice(0, 180)}`;

function isVersion(x: unknown): x is ModelVersion {
  if (!x || typeof x !== 'object') return false;
  const v = x as Partial<ModelVersion>;
  return typeof v.id === 'string' && typeof v.at === 'number' && !!v.snapshot && typeof v.action === 'string';
}

export function loadVersions(fileName: string): ModelVersion[] {
  try {
    const raw = localStorage.getItem(keyFor(fileName));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isVersion).sort((a, b) => a.at - b.at).slice(-MAX_VERSIONS);
  } catch {
    return [];
  }
}

function saveVersions(fileName: string, versions: ModelVersion[]): void {
  try {
    localStorage.setItem(keyFor(fileName), JSON.stringify(versions.slice(-MAX_VERSIONS)));
  } catch {
    /* storage unavailable or full — history simply won't persist */
  }
}

/**
 * Append a version and return the resulting list.
 * Consecutive duplicates (same action + identical snapshot) are collapsed so a
 * re-render or a no-op action cannot inflate the history.
 */
export function appendVersion(
  fileName: string,
  entry: Omit<ModelVersion, 'id'>,
): ModelVersion[] {
  const existing = loadVersions(fileName);
  const last = existing[existing.length - 1];
  if (
    last
    && last.action === entry.action
    && (last.outcome ?? 'applied') === (entry.outcome ?? 'applied')
    && JSON.stringify(last.snapshot) === JSON.stringify(entry.snapshot)
  ) {
    return existing;
  }
  const next: ModelVersion[] = [
    ...existing,
    { ...entry, id: `${entry.at}-${Math.random().toString(36).slice(2, 8)}` },
  ].slice(-MAX_VERSIONS);
  saveVersions(fileName, next);
  return next;
}

export function clearVersions(fileName: string): void {
  try {
    localStorage.removeItem(keyFor(fileName));
  } catch {
    /* ignore */
  }
}
