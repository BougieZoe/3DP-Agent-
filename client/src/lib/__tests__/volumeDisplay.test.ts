import { describe, it, expect } from 'vitest';
import {
  formatVolume,
  isVolumeReportable,
  VOLUME_UNAVAILABLE,
} from '../volumeDisplay';

describe('volumeDisplay', () => {
  const closed = { volumeReliable: true, meshVolumeMm3: 8000 };
  // t_openbox: a 20mm cube missing one face. The signed-tetrahedron sum still
  // returns 6666.67mm³, which reads exactly like a measurement.
  const open = { volumeReliable: false, meshVolumeMm3: 6666.67 };

  it('accepts only a closed shell with a positive reading', () => {
    expect(isVolumeReportable(closed)).toBe(true);
    expect(isVolumeReportable(open)).toBe(false);
    expect(isVolumeReportable(null)).toBe(false);
    expect(isVolumeReportable(undefined)).toBe(false);
    expect(isVolumeReportable({ volumeReliable: true, meshVolumeMm3: 0 })).toBe(false);
    expect(isVolumeReportable({ volumeReliable: true, meshVolumeMm3: -1 })).toBe(false);
  });

  it('renders the figure when closed and the placeholder when open', () => {
    const cm3 = (v: number) => `${(v / 1000).toFixed(2)} cm³`;
    expect(formatVolume(closed, cm3)).toBe('8.00 cm³');
    expect(formatVolume(open, cm3)).toBe(VOLUME_UNAVAILABLE);
    expect(formatVolume(undefined, cm3)).toBe(VOLUME_UNAVAILABLE);
  });

  it('lets callers keep their own fallback for machine-read fields', () => {
    expect(formatVolume(open, (v) => String(v), 'null')).toBe('null');
  });
});
