import { describe, it, expect } from 'vitest';
import { checkBedFit } from '../bedFit';
import type { GeometryGraph } from '../geometryGraph';
import type { GeometryModel } from '../geometryModel';

/**
 * Regression cover for the bed-fit axis mapping.
 *
 * The bug being locked down: the gate compared `rotatedSize.z` against BOTH
 * `profile.heightMm` and `profile.depthMm`, so the y axis was never checked
 * against depth. A part that overhung the bed in y (but was thin in z) passed —
 * while the clearance numbers printed next to it used the correct axes, so the
 * verdict and the explanation contradicted each other.
 */

/** Minimal graph stub: checkBedFit only reads boundingBoxDimensions when a graph is supplied. */
function graphOf(x: number, y: number, z: number): GeometryGraph {
  return { boundingBoxDimensions: { x, y, z } } as unknown as GeometryGraph;
}

const noModel = {} as GeometryModel;

function fit(x: number, y: number, z: number, printerId: Parameters<typeof checkBedFit>[1]) {
  return checkBedFit(noModel, printerId, graphOf(x, y, z), 'en');
}

describe('bedFit axis mapping', () => {
  const FGF = 'fgf_1800_pro'; // 1800 (w) x 1200 (d) x 1300 (h)

  it('rejects a part that overhangs depth in y, on every orientation', () => {
    // x=2000 exceeds width, y=1300 exceeds depth, z=100 is small.
    // Under the old mapping, rotateZ_90 produced (1300, 2000, 100) and both the
    // y-check and the depth-check were fed z=100, so it reported a fit.
    const result = fit(2000, 1300, 100, FGF);
    expect(result.result.fits).toBe(false);
    expect(result.result.orientations.every((o) => o.score === 0)).toBe(true);
  });

  it('accepts a part that genuinely fits inside all three axes', () => {
    const result = fit(1000, 900, 800, FGF);
    expect(result.result.fits).toBe(true);
    expect(result.result.clearanceMm.x).toBeCloseTo(800);
    expect(result.result.clearanceMm.y).toBeCloseTo(300);
    expect(result.result.clearanceMm.z).toBeCloseTo(500);
  });

  it('treats depth as an inclusive limit', () => {
    expect(fit(500, 1200, 500, FGF).result.fits).toBe(true);
  });

  /**
   * Rotation search means a single over-limit axis can often be saved by laying
   * the part down, so "does not fit" cases must be unreachable in every
   * orientation. For FGF (1800 w x 1200 d x 1300 h, depth being the tightest),
   * a sorted triple s1<=s2<=s3 fits iff s1<=1200 && s2<=1300 && s3<=1800.
   */
  it('rejects triples that cannot be saved by any rotation', () => {
    expect(fit(1300, 1250, 1210, FGF).result.fits).toBe(false); // s1=1210 > depth
    expect(fit(1500, 1400, 100, FGF).result.fits).toBe(false);  // s2=1400 > height
    expect(fit(2000, 1300, 100, FGF).result.fits).toBe(false);  // s3=2000 > width
  });

  it('accepts a tall thin part once laid down', () => {
    expect(fit(100, 100, 1400, FGF).result.fits).toBe(true);
    expect(fit(100, 100, 1400, 'bambu_x1c').result.fits).toBe(false);
    expect(fit(100, 100, 1300, FGF).result.fits).toBe(true);
  });

  it('keeps verdict and clearance consistent on an accepted fit', () => {
    const { result } = fit(1000, 900, 800, FGF);
    const p = result.printerProfile;
    const d = result.modelDimensionsMm;
    expect(d.x).toBeLessThanOrEqual(p.widthMm);
    expect(d.y).toBeLessThanOrEqual(p.depthMm);
    expect(d.z).toBeLessThanOrEqual(p.heightMm);
    expect(result.clearanceMm.x).toBeCloseTo(p.widthMm - d.x);
    expect(result.clearanceMm.y).toBeCloseTo(p.depthMm - d.y);
    expect(result.clearanceMm.z).toBeCloseTo(p.heightMm - d.z);
  });

  it('does not regress the small desktop profiles', () => {
    expect(fit(250, 250, 250, 'bambu_x1c').result.fits).toBe(true);
    expect(fit(300, 100, 100, 'bambu_x1c').result.fits).toBe(false);
    expect(fit(200, 200, 200, 'prusa_mk4').result.fits).toBe(true);
    expect(fit(200, 220, 200, 'prusa_mk4').result.fits).toBe(true);  // 220 fits width=250 after rotating
    expect(fit(260, 230, 220, 'prusa_mk4').result.fits).toBe(false); // 260 > width=250
  });
});
