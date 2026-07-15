import * as THREE from 'three';
import type { UnifiedAnalysis } from '@/analysis';
import type { AgentContext } from '../baseAgent';
import type { Confidence, MetricsResult, TopologyResult, ValidationResult, OverhangMetrics, WallThicknessSample } from '@/analysis/types';
import type { Material } from '@/lib/materialState';

export function mockGeometry(vertices?: Float32Array, indices?: number[]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(
    vertices ?? new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0]),
    3,
  ));
  if (indices) geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function noOpConfidence(v: number): Confidence {
  return v as Confidence;
}

function sample(num: number): WallThicknessSample[] {
  return Array.from({ length: num }, (_, i) => ({
    position: { x: i, y: 0, z: 0 },
    thickness: 2,
    confidence: 0.8,
  }));
}

export function normalMetrics(): MetricsResult {
  return {
    meshVolumeMm3: 5000,
    surfaceAreaMm2: 2000,
    boundingBoxVolumeMm3: 10000,
    boundingBoxDimensionsMm: { x: 50, y: 20, z: 10 },
    minWallThicknessMm: 1.5,
    avgWallThicknessMm: 2.0,
    p1WallThicknessMm: 1.2,
    p5WallThicknessMm: 1.5,
    p10WallThicknessMm: 1.8,
    medianWallThicknessMm: 2.0,
    thinWallCount: 0,
    thinWallPercentage: 0,
    thinWallRatio: 0,
    averageConfidence: 0.85,
    lowConfidenceSampleCount: 0,
    wallThicknessSamples: sample(50),
    overhang: {
      faceCount: 5,
      totalFaceCount: 100,
      ratio: 0.05,
      severity: 'none',
      breakdownByAngleDeg: [
        { minAngle: 0, maxAngle: 30, faceCount: 80 },
        { minAngle: 30, maxAngle: 45, faceCount: 15 },
        { minAngle: 45, maxAngle: 60, faceCount: 3 },
        { minAngle: 60, maxAngle: 75, faceCount: 2 },
        { minAngle: 75, maxAngle: 90, faceCount: 0 },
      ],
    },
  };
}

export function thinWallMetrics(): MetricsResult {
  const base = normalMetrics();
  return {
    ...base,
    minWallThicknessMm: 0.3,
    p5WallThicknessMm: 0.4,
    p1WallThicknessMm: 0.25,
    avgWallThicknessMm: 0.6,
    thinWallCount: 30,
    thinWallPercentage: 60,
    thinWallRatio: 0.6,
    averageConfidence: 0.5,
    lowConfidenceSampleCount: 15,
    wallThicknessSamples: sample(50).map(s => ({ ...s, thickness: 0.5 })),
  };
}

export function overhangMetrics(): MetricsResult {
  const base = normalMetrics();
  return {
    ...base,
    overhang: {
      faceCount: 60,
      totalFaceCount: 100,
      ratio: 0.60,
      severity: 'severe',
      breakdownByAngleDeg: [
        { minAngle: 0, maxAngle: 30, faceCount: 10 },
        { minAngle: 30, maxAngle: 45, faceCount: 30 },
        { minAngle: 45, maxAngle: 60, faceCount: 35 },
        { minAngle: 60, maxAngle: 75, faceCount: 20 },
        { minAngle: 75, maxAngle: 90, faceCount: 5 },
      ],
    },
    wallThicknessSamples: sample(50),
  };
}

export function criticalBothMetrics(): MetricsResult {
  const base = normalMetrics();
  return {
    ...base,
    minWallThicknessMm: 0.2,
    p5WallThicknessMm: 0.3,
    thinWallCount: 40,
    thinWallRatio: 0.8,
    wallThicknessSamples: sample(50).map(s => ({ ...s, thickness: 0.3 })),
    overhang: {
      faceCount: 80,
      totalFaceCount: 100,
      ratio: 0.80,
      severity: 'severe',
      breakdownByAngleDeg: [
        { minAngle: 0, maxAngle: 30, faceCount: 5 },
        { minAngle: 30, maxAngle: 45, faceCount: 15 },
        { minAngle: 45, maxAngle: 60, faceCount: 30 },
        { minAngle: 60, maxAngle: 75, faceCount: 35 },
        { minAngle: 75, maxAngle: 90, faceCount: 15 },
      ],
    },
  };
}

export function normalTopology(): TopologyResult {
  return {
    triangleCount: 100,
    vertexCount: 60,
    edgeCount: 150,
    manifoldEdgeCount: 148,
    boundaryEdgeCount: 2,
    nonManifoldEdgeCount: 0,
    shellCount: 1,
    isManifold: true,
    problemEdges: [],
  };
}

export function nonManifoldTopology(): TopologyResult {
  const base = normalTopology();
  return {
    ...base,
    nonManifoldEdgeCount: 3,
    isManifold: false,
    problemEdges: [
      { a: 0, b: 1, faceCount: 3 },
      { a: 2, b: 3, faceCount: 4 },
      { a: 4, b: 5, faceCount: 3 },
    ],
  };
}

export function normalValidation(): ValidationResult {
  return {
    isWatertight: true,
    holeCount: 0,
    boundaryEdgeCount: 0,
    flippedNormalFaceCount: 0,
    totalFaceCount: 100,
    flippedNormalRatio: 0,
    normalOrientation: 'consistent_outward',
    degenerateFaceCount: 0,
  };
}

export function mockMaterial(overrides?: Partial<Material>): Material {
  return {
    name: 'PLA',
    densityGPerCm3: 1.24,
    pricePerKgUsd: 22,
    overhangThreshold: 50,
    ...overrides,
  } as Material;
}

export function buildMockUnifiedAnalysis(overrides?: {
  topology?: TopologyResult;
  validation?: ValidationResult;
  metrics?: MetricsResult;
  support?: { totalSupportVolumeMm3: number; supportFaceCount: number; difficulty: string; supportRegions?: Array<unknown> };
  bedFit?: { fits: boolean };
}): UnifiedAnalysis {
  const t = overrides?.topology ?? normalTopology();
  const v = overrides?.validation ?? normalValidation();
  const m = overrides?.metrics ?? normalMetrics();
  const s = overrides?.support;

  return {
    topology: {
      moduleName: 'topology',
      confidence: t.isManifold ? (1.0 as Confidence) : (0.7 as Confidence),
      durationMs: 1,
      result: t,
      explanation: '',
    },
    validation: {
      moduleName: 'validation',
      confidence: 0.9 as Confidence,
      durationMs: 1,
      result: v,
      explanation: '',
    },
    metrics: {
      moduleName: 'metrics',
      confidence: 0.8 as Confidence,
      durationMs: 10,
      result: m,
      explanation: '',
    },
    bedFit: overrides?.bedFit
      ? {
          moduleName: 'bedFit',
          confidence: 1.0 as Confidence,
          durationMs: 1,
          result: {
            fits: overrides.bedFit.fits,
            printerProfile: { id: 'bambu_x1c', name: 'Bambu Lab X1C', widthMm: 256, depthMm: 256, heightMm: 256 },
            modelDimensionsMm: { x: 50, y: 20, z: 10 },
            clearanceMm: { x: 206, y: 236, z: 246 },
            bestOrientation: { x: 0, y: 0, z: 0 },
            orientations: [],
          },
          explanation: '',
        }
      : null,
    support: s
      ? {
          moduleName: 'support',
          confidence: 0.6 as Confidence,
          durationMs: 2,
          result: {
            totalSupportVolumeMm3: s.totalSupportVolumeMm3 ?? 1000,
            supportFaceCount: s.supportFaceCount ?? 30,
            averageOverhangAngleDeg: 55,
            difficulty: s.difficulty as 'none' | 'easy' | 'moderate' | 'difficult' | 'very_difficult' ?? 'moderate',
            estimatedSupportGrams: 5,
            volumeByAngleDeg: [],
            supportRegions: (s.supportRegions ?? []) as Array<{
              faceCount: number; centroid: { x: number; y: number; z: number };
              boundingBoxSize: { x: number; y: number; z: number };
              normalizedDirection: { x: number; y: number; z: number };
              avgAngleDeg: number; estimatedVolumeMm3: number; zRange: { min: number; max: number };
            }>,
            largestRegionRatio: 0.5,
            tallSupportRatio: 0.3,
            zGradient: 0,
            directionality: 0.5,
          },
          explanation: '',
        }
      : null,
    printTime: null,
    timestamp: '2026-07-15T00:00:00.000Z',
    modelFileName: 'test.stl',
    overallConfidence: 0.8 as Confidence,
  };
}

export function buildAgentContext(overrides?: {
  geometry?: THREE.BufferGeometry;
  unifiedAnalysis?: UnifiedAnalysis;
  modelSize?: { x: number; y: number; z: number };
  vertexPositions?: Float32Array;
  vertexNormals?: Float32Array;
  material?: Material;
  fileName?: string;
}): AgentContext {
  const geo = overrides?.geometry ?? mockGeometry();
  const norms = geo.getAttribute('normal')?.array as Float32Array ?? new Float32Array(9);
  return {
    geometry: geo,
    unifiedAnalysis: overrides?.unifiedAnalysis ?? buildMockUnifiedAnalysis(),
    vertexPositions: overrides?.vertexPositions ?? (geo.getAttribute('position').array as Float32Array),
    vertexNormals: overrides?.vertexNormals ?? norms,
    modelSize: overrides?.modelSize ?? { x: 50, y: 20, z: 10 },
    previousOutputs: new Map(),
    fileName: overrides?.fileName ?? 'test.stl',
    material: overrides?.material ?? mockMaterial(),
    visionAnalysis: undefined,
  };
}
