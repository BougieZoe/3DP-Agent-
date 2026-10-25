import { describe, expect, it } from 'vitest';
import { FailurePredictor } from '../failurePredictor';
import { GeometryAnalyst } from '../geometryAnalyst';
import {
  buildAgentContext,
  buildMockUnifiedAnalysis,
  normalMetrics,
  thinWallMetrics,
} from './testAgentFixtures';

// AGENTS.md rule 6: markers must be tested with a <600-vertex model.
const SMALL_VERTEX_COUNT = 300; // 900 floats < 600 vertices requirement satisfied (300 < 600)
const smallPositions = () => new Float32Array(SMALL_VERTEX_COUNT * 3).fill(1);

describe('thin-wall markers are measured-only (<600-vertex model)', () => {
  it('failurePredictor emits no thin_wall markers without a measured thin-wall signal', () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: normalMetrics() }),
      vertexPositions: smallPositions(),
    });
    // normalMetrics() has samples but thinWallRatio === 0 -> no fake markers.
    // @ts-expect-error private method under test
    const markers = new FailurePredictor().generateWallMarkers(ctx, 'high');
    const thinMarkers = markers.filter((m) => m.type === 'thin_wall');
    expect(thinMarkers).toHaveLength(0);
  });

  it('failurePredictor emits thin_wall markers on real sample positions when measured signal exists', () => {
    const metrics = thinWallMetrics(); // thinWallRatio 0.6, 50 samples at 0.5mm
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics }),
      vertexPositions: smallPositions(),
    });
    // @ts-expect-error private method under test
    const markers = new FailurePredictor().generateWallMarkers(ctx, 'high');
    const thinMarkers = markers.filter((m) => m.type === 'thin_wall');
    expect(thinMarkers.length).toBeGreaterThan(0);
    const samplePositions = metrics.wallThicknessSamples.map((s) =>
      `${s.position.x},${s.position.y},${s.position.z}`,
    );
    for (const m of thinMarkers) {
      expect(samplePositions).toContain(`${m.position.x},${m.position.y},${m.position.z}`);
    }
  });

  it('geometryAnalyst emits no thin_wall markers without a measured thin-wall signal', () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: normalMetrics() }),
      vertexPositions: smallPositions(),
    });
    // @ts-expect-error private method under test
    const markers = new GeometryAnalyst().collectWallThicknessMarkers(ctx);
    const thinMarkers = markers.filter((m) => m.type === 'thin_wall');
    expect(thinMarkers).toHaveLength(0);
  });

  it('geometryAnalyst emits thin_wall markers on real sample positions when measured signal exists', () => {
    const metrics = thinWallMetrics();
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics }),
      vertexPositions: smallPositions(),
    });
    // @ts-expect-error private method under test
    const markers = new GeometryAnalyst().collectWallThicknessMarkers(ctx);
    const thinMarkers = markers.filter((m) => m.type === 'thin_wall');
    expect(thinMarkers.length).toBeGreaterThan(0);
    const samplePositions = metrics.wallThicknessSamples.map((s) =>
      `${s.position.x},${s.position.y},${s.position.z}`,
    );
    for (const m of thinMarkers) {
      expect(samplePositions).toContain(`${m.position.x},${m.position.y},${m.position.z}`);
    }
  });
});
