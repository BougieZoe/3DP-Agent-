import { describe, it, expect } from 'vitest';
import { runAnalysisPipeline } from '../pipeline';
import { createTerrainGridModel } from '../../analysis/__tests__/testMeshes';
import { buildMockUnifiedAnalysis, normalMetrics } from '../../agents/__tests__/testAgentFixtures';

describe('runAnalysisPipeline (direct call, Worker unavailable path)', () => {
  it('returns UnifiedAnalysis with correct shape', () => {
    const model = createTerrainGridModel(10, 10, 10);
    const result = runAnalysisPipeline(model, { fileName: 'test.stl' });
    expect(result).toHaveProperty('topology');
    expect(result).toHaveProperty('validation');
    expect(result).toHaveProperty('metrics');
    expect(result.modelFileName).toBe('test.stl');
    expect(result.timestamp).toBeTruthy();
  });

  it('calculates topology correctly', () => {
    const model = createTerrainGridModel(10, 4, 4);
    const result = runAnalysisPipeline(model);
    expect(result.topology.result.triangleCount).toBeGreaterThan(0);
    expect(result.topology.result.vertexCount).toBeGreaterThan(0);
  });

  it('calculates metrics when profiling is enabled', () => {
    const model = createTerrainGridModel(10, 10, 10);
    const result = runAnalysisPipeline(model, { enableProfiling: true });
    expect(result.profiling).toBeDefined();
    expect(Object.keys(result.profiling!).length).toBeGreaterThan(0);
    expect(result.profiling!.buildGeometryGraph).toBeGreaterThan(0);
    expect(result.profiling!.metrics).toBeGreaterThan(0);
  });

  it('profiling includes sub-module breakdown', () => {
    const model = createTerrainGridModel(10, 20, 20);
    const result = runAnalysisPipeline(model, { enableProfiling: true });
    expect(result.profiling!.computeMeshVolume).toBeGreaterThanOrEqual(0);
    expect(result.profiling!.sampleWallThickness).toBeGreaterThan(0);
    expect(result.profiling!.analyzeOverhang).toBeGreaterThanOrEqual(0);
  });

  it('includes printTime when volume is positive', () => {
    const model = createTerrainGridModel(10, 10, 10);
    const result = runAnalysisPipeline(model, {
      printerId: 'bambu_x1c',
      layerHeightMm: 0.2,
    });
    expect(result.printTime).not.toBeNull();
    if (result.printTime) {
      expect(result.printTime.result.estimatedPrintTimeMinutes).toBeGreaterThan(0);
      expect(result.printTime.result.layerCount).toBeGreaterThan(0);
    }
  });

  it('returns null printTime for zero volume', () => {
    const model = createTerrainGridModel(10, 1, 1);
    const result = runAnalysisPipeline(model);
    expect(result.printTime).toBeNull();
  });

  it('supports result is null when volume is zero', () => {
    const model = createTerrainGridModel(10, 1, 1);
    const result = runAnalysisPipeline(model);
    expect(result.support).toBeNull();
  });

  it('overallConfidence is minimum of all module confidences', () => {
    const model = createTerrainGridModel(10, 10, 10);
    const result = runAnalysisPipeline(model);
    const confidences = [
      result.topology.confidence,
      result.validation.confidence,
      result.metrics.confidence,
    ].filter(c => c > 0);
    const minConfidence = Math.min(...confidences);
    expect(result.overallConfidence).toBe(minConfidence);
  });
});

describe('workerBridge fallback path', () => {
  it('runAnalysisInWorker falls back to sync when Worker is undefined', async () => {
    const { runAnalysisInWorker } = await import('../workerBridge');
    const model = createTerrainGridModel(10, 10, 10);
    const result = await runAnalysisInWorker(model, { fileName: 'fallback.stl' });
    expect(result.modelFileName).toBe('fallback.stl');
    expect(result.topology.result.triangleCount).toBeGreaterThan(0);
    expect(result.metrics.result.meshVolumeMm3).toBeGreaterThan(0);
  });

  it('fallback preserves profiling payload', async () => {
    const { runAnalysisInWorker } = await import('../workerBridge');
    const model = createTerrainGridModel(10, 20, 20);
    const result = await runAnalysisInWorker(model, { enableProfiling: true });
    expect(result.profiling).toBeDefined();
    expect(Object.keys(result.profiling!).length).toBeGreaterThan(3);
    expect(result.profiling!.sampleWallThickness).toBeGreaterThan(0);
  });

  it('fallback result shape matches UnifiedAnalysis contract', async () => {
    const { runAnalysisInWorker } = await import('../workerBridge');
    const model = createTerrainGridModel(10, 10, 10);
    const result = await runAnalysisInWorker(model);
    expect(result).toHaveProperty('topology');
    expect(result.topology).toHaveProperty('moduleName');
    expect(result.topology).toHaveProperty('result');
    expect(result.topology).toHaveProperty('confidence');
    expect(result).toHaveProperty('validation');
    expect(result).toHaveProperty('metrics');
    expect(result).toHaveProperty('overallConfidence');
    expect(result).toHaveProperty('timestamp');
  });
});
