/**
 * Tiered repair flow tests — the regression gate must run on BOTH tiers.
 *
 * Server/bridge and browser/WASM repairs are mocked; the assertion is that a
 * rejected repair returns the ORIGINAL geometry and baseline analysis (never
 * the modified mesh), with a structured verification result.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import type { UnifiedAnalysis } from '@/analysis/types';
import type { GeometrySuggestion } from '@/components/causality/counterfactualEngine';

const mocks = vi.hoisted(() => ({
  processMesh: vi.fn(),
  applyRepairWithMethodAsync: vi.fn(),
  runAnalysisInWorker: vi.fn(),
}));

vi.mock('../meshProcessClient', () => ({ processMesh: mocks.processMesh }));
vi.mock('../meshRepair', () => ({ applyRepairWithMethodAsync: mocks.applyRepairWithMethodAsync }));
vi.mock('@/analysis', () => ({
  fromThreeBufferGeometry: (g: unknown) => g,
  runAnalysisInWorker: mocks.runAnalysisInWorker,
}));
vi.mock('../meshOps', () => ({ geometryToStl: () => new Uint8Array() }));
vi.mock('../stlParser', () => ({
  parseSTL: () => new THREE.BoxGeometry(1, 1, 1),
}));

import { runTieredRepair } from '../repairFlow';

function mod<T>(result: T) {
  return { moduleName: 'x', confidence: 0.9 as never, durationMs: 1, result, explanation: '' };
}

function analysis(minWall: number, watertight = true): UnifiedAnalysis {
  return {
    topology: mod({
      triangleCount: 100,
      vertexCount: 60,
      edgeCount: 150,
      manifoldEdgeCount: 150,
      boundaryEdgeCount: 0,
      nonManifoldEdgeCount: 0,
      shellCount: 1,
      problemEdges: [],
    }),
    validation: mod({
      isWatertight: watertight,
      holeCount: 0,
      boundaryEdgeCount: 0,
      flippedNormalFaceCount: 0,
      totalFaceCount: 100,
      flippedNormalRatio: 0,
      normalOrientation: 'outward',
      degenerateFaceCount: 0,
    }),
    metrics: mod({
      meshVolumeMm3: 8000,
      volumeReliable: true,
      minWallThicknessMm: minWall,
      p5WallThicknessMm: minWall,
      thinWallRatio: 0,
      surfaceAreaMm2: 1000,
      boundingBoxDimensionsMm: { x: 10, y: 10, z: 10 },
      overhang: { ratio: 0, faceCount: 0 },
    }),
  } as unknown as UnifiedAnalysis;
}

const suggestion = {
  id: 's1',
  type: 'thicken_wall',
  label: 'thicken',
  description: 'd',
  affectedPositions: [{ x: 0, y: 0, z: 0 }],
  riskReduction: 50,
  thermalImprovement: 0,
  supportChange: 0,
  patternImpact: [],
  confidence: 0.8,
  chainComparison: [],
} as GeometrySuggestion;

const serverResult = {
  stlBytes: new Uint8Array(),
  diagnostics: { repaired: true, watertight: true, bodyCount: 1 },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runTieredRepair regression gate', () => {
  it('rejects a server repair that thins the minimum wall and keeps the original', async () => {
    const before = analysis(1.2);
    mocks.processMesh.mockResolvedValue(serverResult);
    mocks.runAnalysisInWorker.mockResolvedValue(analysis(0.8));

    const original = new THREE.BoxGeometry(1, 1, 1);
    const outcome = await runTieredRepair(original, 'part.stl', undefined, [], before);

    expect(outcome.tier).toBe('server');
    expect(outcome.accepted).toBe(false);
    expect(outcome.geometry).toBe(original);
    expect(outcome.analysis).toBe(before);
    expect(outcome.verification.regressions.map((r) => r.code)).toContain('min_wall_decreased');
    expect(outcome.note).toContain('repair rejected');
  });

  it('accepts a server repair that passes verification', async () => {
    const before = analysis(0.6, false);
    mocks.processMesh.mockResolvedValue(serverResult);
    mocks.runAnalysisInWorker.mockResolvedValue(analysis(1.2, true));

    const outcome = await runTieredRepair(new THREE.BoxGeometry(1, 1, 1), 'part.stl', undefined, [], before);

    expect(outcome.tier).toBe('server');
    expect(outcome.accepted).toBe(true);
    expect(outcome.verification.improvements.map((i) => i.code)).toContain('watertight_gained');
    expect(outcome.note).toContain('repair verified');
    expect(mocks.runAnalysisInWorker).toHaveBeenCalledTimes(1);
  });

  it('rejects a WASM repair that regresses and does not commit the thickened mesh', async () => {
    const before = analysis(1.2);
    mocks.processMesh.mockRejectedValue(new Error('Failed to fetch'));
    mocks.applyRepairWithMethodAsync.mockResolvedValue({ geometry: new THREE.BoxGeometry(2, 2, 2), method: 'manifold-offset' });
    mocks.runAnalysisInWorker.mockResolvedValue(analysis(0.5));

    const original = new THREE.BoxGeometry(1, 1, 1);
    const outcome = await runTieredRepair(original, 'part.stl', undefined, [suggestion], before);

    expect(outcome.tier).toBe('wasm');
    expect(outcome.accepted).toBe(false);
    expect(outcome.geometry).toBe(original);
    expect(outcome.analysis).toBe(before);
    expect(outcome.repairMethod).toBe('manifold-offset');
    expect(outcome.verification.regressions.map((r) => r.code)).toContain('min_wall_decreased');
  });

  it('gates the normal-offset fallback exactly like the manifold path', async () => {
    const before = analysis(1.2);
    mocks.processMesh.mockRejectedValue(new Error('Failed to fetch'));
    mocks.applyRepairWithMethodAsync.mockResolvedValue({
      geometry: new THREE.BoxGeometry(2, 2, 2),
      method: 'normal-fallback',
    });
    mocks.runAnalysisInWorker.mockResolvedValue(analysis(0.9));

    const original = new THREE.BoxGeometry(1, 1, 1);
    const outcome = await runTieredRepair(original, 'part.stl', undefined, [suggestion], before);

    expect(outcome.accepted).toBe(false);
    expect(outcome.geometry).toBe(original);
    expect(outcome.repairMethod).toBe('normal-fallback');
    expect(outcome.tier).toBe('wasm');
  });

  it('accepts a WASM repair only after re-analysis passes', async () => {
    const before = analysis(0.5);
    const repaired = new THREE.BoxGeometry(2, 2, 2);
    mocks.processMesh.mockRejectedValue(new Error('Failed to fetch'));
    mocks.applyRepairWithMethodAsync.mockResolvedValue({ geometry: repaired, method: 'manifold-offset' });
    mocks.runAnalysisInWorker.mockResolvedValue(analysis(1.2));

    const outcome = await runTieredRepair(
      new THREE.BoxGeometry(1, 1, 1),
      'part.stl',
      undefined,
      [suggestion],
      before,
    );

    expect(outcome.tier).toBe('wasm');
    expect(outcome.accepted).toBe(true);
    expect(outcome.geometry).toBe(repaired);
    expect(outcome.repairMethod).toBe('manifold-offset');
    expect(mocks.runAnalysisInWorker).toHaveBeenCalledTimes(1);
  });
});
