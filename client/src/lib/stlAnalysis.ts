import * as THREE from 'three';
import { computeGeometryMetrics } from './geometryMetrics';
import {
  evaluateOverhangHeuristic,
  evaluateWallThicknessHeuristic,
  type OverhangHeuristicResult,
  type WallThicknessHeuristicResult,
} from './printabilityHeuristics';

export interface AnalysisResult {
  wallThickness: WallThicknessHeuristicResult;
  overhang: OverhangHeuristicResult;
  volume: number;
  surfaceArea: number;
  triangleCount: number;
  bounds: {
    min: THREE.Vector3;
    max: THREE.Vector3;
  };
}

export function analyzeModel(geometry: THREE.BufferGeometry): AnalysisResult {
  const metrics = computeGeometryMetrics(geometry);
  return composeAnalysisResult(metrics);
}

export function composeAnalysisResult(metrics: ReturnType<typeof computeGeometryMetrics>): AnalysisResult {
  const vertexCount = metrics.positions.length / 3;

  return {
    wallThickness: evaluateWallThicknessHeuristic(metrics.size, vertexCount),
    overhang: evaluateOverhangHeuristic(metrics.normals, metrics.positions.length),
    volume: metrics.boundingBoxVolume,
    surfaceArea: metrics.surfaceArea,
    triangleCount: metrics.triangleCount,
    bounds: {
      min: metrics.bounds.min.clone(),
      max: metrics.bounds.max.clone(),
    },
  };
}
