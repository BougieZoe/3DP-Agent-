import { describe, it, expect } from 'vitest';
import { runAnalysisPipeline } from '../pipeline';
import { fromThreeBufferGeometry } from '../geometryConversion';
import { createWatertightCube, createThinWall } from './testMeshes';
import { isWallConfidenceTrusted } from '../verdict';

describe('wall-confidence gate end-to-end', () => {
  it('healthy cube resolves to the trusted baseline (banner off)', () => {
    const ua = runAnalysisPipeline(fromThreeBufferGeometry(createWatertightCube()), {});
    expect(ua.metrics.confidence).toBe(0.4);
    expect(isWallConfidenceTrusted(ua.metrics.confidence)).toBe(true);
  });

  it('thin-wall mesh lands below the gate (banner on)', () => {
    const ua = runAnalysisPipeline(fromThreeBufferGeometry(createThinWall(10)), {});
    expect(ua.metrics.confidence).toBeLessThan(0.4);
    expect(isWallConfidenceTrusted(ua.metrics.confidence)).toBe(false);
  });
});