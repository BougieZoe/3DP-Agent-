/**
 * Single gate for every volume figure that reaches a user.
 *
 * `meshVolumeMm3` is only a measurement when the shell is closed; on an open
 * surface the signed-tetrahedron sum is a by-product of the triangle soup and
 * happens to land on a plausible-looking number (see MetricsResult.volumeReliable).
 * Printed on a card, a PDF or a manufacturer spec, that number is indistinguishable
 * from a real one, so nothing renders it without passing through here.
 */

import type { MetricsResult } from '@/analysis/types';

/** Rendered wherever a volume figure would normally appear. */
export const VOLUME_UNAVAILABLE = '—';

type VolumeSource = Pick<MetricsResult, 'volumeReliable' | 'meshVolumeMm3'>;

/** True only when the reading may be shown: closed shell and a positive figure. */
export function isVolumeReportable(m: VolumeSource | null | undefined): boolean {
  if (!m) return false;
  if (m.volumeReliable !== true) return false;
  return typeof m.meshVolumeMm3 === 'number' && m.meshVolumeMm3 > 0;
}

/**
 * Returns the caller-formatted figure, or the shared placeholder when the
 * shell is open. Callers keep their own unit and rounding so every surface
 * formats exactly as it did before, and only the trust decision is shared.
 */
export function formatVolume(
  m: VolumeSource | null | undefined,
  format: (mm3: number) => string,
  fallback: string = VOLUME_UNAVAILABLE,
): string {
  return isVolumeReportable(m) ? format(m!.meshVolumeMm3) : fallback;
}
