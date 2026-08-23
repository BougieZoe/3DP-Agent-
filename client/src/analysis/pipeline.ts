import { moduleResult, PRINTER_PROFILES, type UnifiedAnalysis, type AnalysisModuleResult, type Confidence, type TopologyResult, type ValidationResult, type MetricsResult, type BedFitResult, type SupportResult, type PrintTimeResult, type SlicerBackedMetrics } from './types';
import { CONTENT, translate, type ContentLang } from '@shared/i18n/content';
import { analyzeTopology } from './topology';
import { validateMesh } from './validation';
import { computeMetrics } from './metrics';
import { computeResinMetrics, type ResinResult } from './resin';
import { computeFgfMetrics, type FgfResult } from './fgf';
import { computePbfMetrics, type PbfResult, type PbfKind } from './pbf';
import { computeConcreteMetrics, type ConcreteResult } from './concrete';
import { computeEcoMetrics, type EcoResult } from './eco';
import { checkBedFit } from './bedFit';
import { estimateSupportVolume } from './support';
import { estimatePrintTime } from './printTime';
import { buildGeometryGraph } from './geometryGraph';
import { getThresholds, type ThresholdsOverride } from './thresholds';
import { type GeometryModel } from './geometryModel';
import type { PrinterProfileId } from './types';
import type { Material } from '@shared/domain/material';

export interface PipelineOptions {
  printerId?: PrinterProfileId;
  layerHeightMm?: number;
  fileName?: string;
  material?: Material;
  /** Print technology family — selects the per-family metrics module. */
  materialFamily?: 'fdm' | 'sla' | 'fgf' | 'sls' | 'slm' | 'mjf' | 'concrete' | 'eco';
  /** UI language — module explanations/reasons are localized. */
  language?: ContentLang;
  /**
   * Threshold overrides (deep-merged over DEFAULT_ANALYSIS_THRESHOLDS).
   * Intended for tests and calibration runs; production callers omit it.
   */
  thresholds?: ThresholdsOverride;
  /**
   * When true, each module (and the wall-thickness sub-modules) records its
   * own wall-clock duration in the result's `profiling` map. This is the
   * instrumentation the telemetry/BVH decision relies on.
   */
  enableProfiling?: boolean;
  /**
   * Ground-truth metrics parsed from a real slicer run (server /api/slice).
   * When present, the printTime module uses the slicer's print time / filament /
   * layer count instead of the volumetric estimate. Absent on the cloud tier
   * without a slicer binary — the estimate path stays honest (source: 'estimate').
   */
  slicer?: SlicerBackedMetrics;
}

export function runAnalysisPipeline(
  model: GeometryModel,
  options: PipelineOptions = {},
): UnifiedAnalysis {
  const now = new Date().toISOString();
  const fileName = options.fileName ?? 'unknown.stl';
  const mat = options.material;
  const lang = options.language ?? 'en';
  const thresholds = getThresholds(options.thresholds);

  const profiling = options.enableProfiling ? ({} as Record<string, number>) : undefined;
  const time = <T>(key: string, fn: () => T): T => {
    if (!profiling) return fn();
    const start = performance.now();
    const result = fn();
    profiling[key] = performance.now() - start;
    return result;
  };

  const graph = time('buildGeometryGraph', () => buildGeometryGraph(model));

  const emptyTopology: TopologyResult = { triangleCount: 0, vertexCount: 0, edgeCount: 0, manifoldEdgeCount: 0, boundaryEdgeCount: 0, nonManifoldEdgeCount: 0, shellCount: 0, isManifold: false, problemEdges: [] };
  const emptyValidation: ValidationResult = { isWatertight: false, holeCount: 0, boundaryEdgeCount: 0, flippedNormalFaceCount: 0, totalFaceCount: 0, flippedNormalRatio: 0, normalOrientation: 'unknown', degenerateFaceCount: 0 };
  const emptyMetrics: MetricsResult = { meshVolumeMm3: 0, surfaceAreaMm2: 0, boundingBoxVolumeMm3: 0, boundingBoxDimensionsMm: { x: 0, y: 0, z: 0 }, minWallThicknessMm: null, avgWallThicknessMm: null, p1WallThicknessMm: null, p5WallThicknessMm: null, p10WallThicknessMm: null, medianWallThicknessMm: null, thinWallCount: 0, thinWallPercentage: 0, thinWallRatio: 0, averageConfidence: 0, wallThicknessSamples: [], overhang: { faceCount: 0, totalFaceCount: 0, ratio: 0, severity: 'none', breakdownByAngleDeg: [], overhangAreaMm2: 0, totalAreaMm2: 0 } };

  const failResult = <T>(moduleName: string, error: unknown, defaultValue: T): AnalysisModuleResult<T> => {
    const message = error instanceof Error
      ? error.message
      : translate(CONTENT, 'analysis.unknownError', lang);
    return moduleResult(
      moduleName,
      0.0 as Confidence,
      0,
      defaultValue,
      translate(CONTENT, 'analysis.failed', lang, { message }),
    );
  };

  const topology = time('topology', () => {
    try { return analyzeTopology(model, fileName, graph, lang); }
    catch (e) { return failResult('topology', e, emptyTopology); }
  });

  const validation = time('validation', () => {
    try { return validateMesh(model, graph, lang, thresholds); }
    catch (e) { return failResult('validation', e, emptyValidation); }
  });

  const metrics = time('metrics', () => {
    try { return computeMetrics(model, graph, mat?.overhangThreshold, profiling, lang, thresholds); }
    catch (e) { return failResult('metrics', e, emptyMetrics); }
  });

  const bedFit = time('bedFit', () => {
    try {
      if (topology.result.triangleCount === 0) return null;
      return checkBedFit(model, options.printerId ?? 'bambu_x1c', graph, lang);
    } catch (e) { return null; }
  });

  const support = time('support', () => {
    try {
      if (metrics.result.meshVolumeMm3 <= 0) return null;
      return estimateSupportVolume(model, graph, mat?.overhangThreshold, mat ? mat.densityGPerCm3 / 1000 : undefined, lang, thresholds);
    } catch (e) { return null; }
  });

  const printTime = time('printTime', () => {
    try {
      if (metrics.result.meshVolumeMm3 <= 0) return null;
      return estimatePrintTime(metrics.result, options.printerId ?? 'bambu_x1c', options.layerHeightMm ?? 0.2, mat?.densityGPerCm3, mat?.pricePerKgUsd, lang, thresholds, options.slicer);
    } catch (e) { return null; }
  });

  // Resin-specific module — only computed when the caller selects the resin family.
  const EMPTY_RESIN: ResinResult = { shellCount: 0, enclosedCavity: false, islandCount: 0, suctionRisk: 0, cureRisk: 0, orientation: 'default', footprintAreaMm2: 0 };
  const resin = time('resin', () => {
    try {
      if (options.materialFamily !== 'sla') return null;
      return moduleResult('sla', 1.0 as Confidence, 0, computeResinMetrics(model), 'SLA/DLP resin printability metrics (suction, islands, drain holes).');
    } catch (e) {
      return options.materialFamily === 'sla' ? failResult('sla', e, EMPTY_RESIN) : null;
    }
  });

  // FGF (large-format pellet) module — only when the FGF family is selected.
  const EMPTY_FGF: FgfResult = { partScale: 'small', maxDimMm: 0, partHeightMm: 0, footprintAreaMm2: 0, warpageRisk: 0, delaminationRisk: 0, slenderness: 0, orientation: 'upright' };
  const fgf = time('fgf', () => {
    try {
      if (options.materialFamily !== 'fgf') return null;
      return moduleResult('fgf', 1.0 as Confidence, 0, computeFgfMetrics(model), 'FGF large-format printability metrics (geometric proxies).');
    } catch (e) {
      return options.materialFamily === 'fgf' ? failResult('fgf', e, EMPTY_FGF) : null;
    }
  });

  // Powder Bed Fusion module (SLS / SLM / MJF) — geometric proxies, not FEA.
  const PBF_FAMILIES: PbfKind[] = ['sls', 'slm', 'mjf'];
  const EMPTY_PBF: PbfResult = { kind: 'sls', shellCount: 1, powderTrap: false, largestFlatPlateMm2: 0, flatPlateRatio: 0, overhangRatio: 0, overhangAreaMm2: 0, distortionRisk: 0, selfSupporting: true, footprintAreaMm2: 0, orientation: 'upright' };
  const pbf = time('pbf', () => {
    try {
      const fam = options.materialFamily;
      if (!fam || !PBF_FAMILIES.includes(fam as PbfKind)) return null;
      return moduleResult('pbf', 1.0 as Confidence, 0, computePbfMetrics(model, fam as PbfKind), 'Powder Bed Fusion printability metrics (geometric proxies — not thermal simulation).');
    } catch (e) {
      return PBF_FAMILIES.includes(options.materialFamily as PbfKind) ? failResult('pbf', e, EMPTY_PBF) : null;
    }
  });

  // Concrete (construction-scale) module — geometric proxies, not structural simulation.
  const EMPTY_CONCRETE: ConcreteResult = { featureResolutionRisk: 0, overhangSagRisk: 0, crackRisk: 0, printTimeHours: 0, concerns: [] };
  const concrete = time('concrete', () => {
    try {
      if (options.materialFamily !== 'concrete') return null;
      const m = metrics.result;
      return moduleResult('concrete', 1.0 as Confidence, 0, computeConcreteMetrics({
        minWallThicknessMm: m.minWallThicknessMm,
        overhangRatio: m.overhang?.ratio ?? 0,
        surfaceAreaMm2: m.surfaceAreaMm2,
        volumeMm3: m.meshVolumeMm3,
      }), 'Concrete construction-scale printability (geometric proxies — not structural engineering).');
    } catch (e) {
      return options.materialFamily === 'concrete' ? failResult('concrete', e, EMPTY_CONCRETE) : null;
    }
  });

  // Eco-material advisory — material knowledge + thin-wall geometry.
  const EMPTY_ECO: EcoResult = { moistureRisk: 0, degradationRisk: 0, brittlenessRisk: 0, concerns: [] };
  const eco = time('eco', () => {
    try {
      if (options.materialFamily !== 'eco') return null;
      return moduleResult('eco', 1.0 as Confidence, 0, computeEcoMetrics({
        moistureRisk: mat?.moistureRisk ?? 0.3,
        degradationRisk: mat?.degradationRisk ?? 0.3,
        brittlenessRisk: mat?.brittlenessRisk ?? 0.3,
        thinWallRatio: metrics.result.thinWallRatio,
      }), 'Eco-material advisory (material properties + thin-wall geometry).');
    } catch (e) {
      return options.materialFamily === 'eco' ? failResult('eco', e, EMPTY_ECO) : null;
    }
  });

  const confidences = [topology, validation, metrics, bedFit, support, printTime, resin, fgf, pbf, concrete, eco]
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
    resin,
    fgf,
    pbf,
    concrete,
    eco,
    timestamp: now,
    modelFileName: fileName,
    overallConfidence,
    profiling,
  };
}
