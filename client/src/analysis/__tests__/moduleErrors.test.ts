import { describe, it, expect } from 'vitest';
import { runAnalysisPipeline } from '../pipeline';
import { fromThreeBufferGeometry } from '../geometryConversion';
import { createWatertightCube } from './testMeshes';

/**
 * A module that throws returns a zero-filled placeholder. `errors` is the only
 * thing that distinguishes "measured 0" from "never ran" (AGENTS.md: never
 * coerce unknown into pass/fail).
 */
describe('pipeline module errors', () => {
  it('reports no errors when every module completes', () => {
    const ua = runAnalysisPipeline(fromThreeBufferGeometry(createWatertightCube()), {
      fileName: 'cube.stl',
      materialFamily: 'fdm',
    });
    expect(ua.errors).toBeUndefined();
    expect(ua.topology.confidence).toBeGreaterThan(0);
    expect(ua.metrics.confidence).toBeGreaterThan(0);
    expect(ua.overallConfidence).toBeGreaterThan(0);
  });

  it('degrades an unusable model through confidence, not through fabricated errors', () => {
    // Collapse every vertex onto the origin: modules return without throwing,
    // so `errors` stays empty and overallConfidence collapses to 0. The UI must
    // read that as "inconclusive", never as a clean 0-value measurement.
    const geo = fromThreeBufferGeometry(createWatertightCube());
    for (let i = 0; i < geo.positions.length; i++) geo.positions[i] = 0;
    const ua = runAnalysisPipeline(geo, { fileName: 'degenerate.stl', materialFamily: 'fdm' });
    expect(ua.errors).toBeUndefined();
    expect(ua.overallConfidence).toBe(0);
  });
});
