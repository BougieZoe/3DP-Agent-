import { moduleResult, PRINTER_PROFILES, type UnifiedAnalysis, type AnalysisModuleResult, type Confidence, type TopologyResult, type ValidationResult, type MetricsResult, type BedFitResult, type SupportResult, type PrintTimeResult } from './types';
import { analyzeTopology } from './topology';
import { validateMesh } from './validation';
import { computeMetrics } from './metrics';
import { checkBedFit } from './bedFit';
import { estimateSupportVolume } from './support';
import { estimatePrintTime } from './printTime';
import { buildGeometryGraph } from './geometryGraph';
import { type GeometryModel } from './geometryModel';
import type { PrinterProfileId } from './types';

export interface PipelineOptions {
  printerId?: PrinterProfileId;
  layerHeightMm?: number;
  fileName?: string;
}

export function runAnalysisPipeline(
  model: GeometryModel,
  options: PipelineOptions = {},
): UnifiedAnalysis {
  const now = new Date().toISOString();
  const fileName = options.fileName ?? 'unknown.stl';

  const graph = buildGeometryGraph(model);

  const emptyTopology: TopologyResult = { triangleCount: 0, vertexCount: 0, edgeCount: 0, manifoldEdgeCount: 0, boundaryEdgeCount: 0, nonManifoldEdgeCount: 0, shellCount: 0, isManifold: false, problemEdges: [] };
  const emptyValidation: ValidationResult = { isWatertight: false, holeCount: 0, boundaryEdgeCount: 0, flippedNormalFaceCount: 0, totalFaceCount: 0, flippedNormalRatio: 0, normalOrientation: 'unknown', degenerateFaceCount: 0 };
  const emptyMetrics: MetricsResult = { meshVolumeMm3: 0, surfaceAreaMm2: 0, boundingBoxVolumeMm3: 0, boundingBoxDimensionsMm: { x: 0, y: 0, z: 0 }, minWallThicknessMm: null, avgWallThicknessMm: null, p1WallThicknessMm: null, p5WallThicknessMm: null, p10WallThicknessMm: null, medianWallThicknessMm: null, thinWallCount: 0, thinWallPercentage: 0, thinWallRatio: 0, averageConfidence: 0, lowConfidenceSampleCount: 0, wallThicknessSamples: [], overhang: { faceCount: 0, totalFaceCount: 0, ratio: 0, severity: 'none', breakdownByAngleDeg: [] } };

  const failResult = <T>(moduleName: string, error: unknown, defaultValue: T): AnalysisModuleResult<T> => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return moduleResult(moduleName, 0.0 as Confidence, 0, defaultValue, `Failed: ${message}`);
  };

  const topology = (() => {
    try { return analyzeTopology(model, fileName, graph); }
    catch (e) { return failResult('topology', e, emptyTopology); }
  })();

  const validation = (() => {
    try { return validateMesh(model, graph); }
    catch (e) { return failResult('validation', e, emptyValidation); }
  })();

  const metrics = (() => {
    try { return computeMetrics(model, graph); }
    catch (e) { return failResult('metrics', e, emptyMetrics); }
  })();

  const bedFit = (() => {
    try {
      if (topology.result.triangleCount === 0) return null;
      return checkBedFit(model, options.printerId ?? 'bambu_x1c', graph);
    } catch (e) { return null; }
  })();

  const support = (() => {
    try {
      if (metrics.result.meshVolumeMm3 <= 0) return null;
      return estimateSupportVolume(model, graph);
    } catch (e) { return null; }
  })();

  const printTime = (() => {
    try {
      if (metrics.result.meshVolumeMm3 <= 0) return null;
      return estimatePrintTime(metrics.result, options.printerId ?? 'bambu_x1c', options.layerHeightMm ?? 0.2);
    } catch (e) { return null; }
  })();

  const confidences = [topology, validation, metrics, bedFit, support, printTime]
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .map(m => m.confidence);
  const overallConfidence = confidences.length > 0
    ? Math.min(...confidences) as Confidence
    : 0.0 as Confidence;

  return {
    topology,
    validation,
    metrics,
    bedFit,
    support,
    printTime,
    timestamp: now,
    modelFileName: fileName,
    overallConfidence,
  };
}
