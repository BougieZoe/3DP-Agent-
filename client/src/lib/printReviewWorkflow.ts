import * as THREE from 'three';
import type { AnalysisReport, ModelAnalysis } from '@shared/domain/analysis';
import type { AdvisorLanguage } from '@shared/domain/advisor';
import { createGeometryBounds } from '@shared/domain/geometry';
import type { PrintabilityFinding } from '@shared/domain/printability';
import { deriveOhStatus, deriveWtStatus } from '@/analysis/metrics';
import {
  completeStage,
  createPendingStage,
  failStage,
  skipStage,
  startStage,
  type WorkflowStageResult,
} from '@shared/domain/workflow';
import { generateQuickReport, type ModelData } from './ruleEngine';
import { loadSTLFile } from './stlLoader';
import { runAnalysisInWorker, fromThreeBufferGeometry, type UnifiedAnalysis } from '@/analysis';
import type { Material } from '@shared/domain/material';
import { DEFAULT_MATERIAL } from '@shared/domain/material';

function unifiedToModelData(unifiedAnalysis: UnifiedAnalysis, fileName: string, material: Material = DEFAULT_MATERIAL): ModelData {
  const metrics = unifiedAnalysis.metrics.result;
  const topology = unifiedAnalysis.topology.result;
  const triCount = topology?.triangleCount ?? 0;
  const volume = metrics?.meshVolumeMm3 ?? metrics?.boundingBoxVolumeMm3 ?? 0;
  const surfaceArea = metrics?.surfaceAreaMm2 ?? 0;
  const oh = metrics?.overhang;
  const dims = metrics?.boundingBoxDimensionsMm ?? { x: 0, y: 0, z: 0 };
  const thinWallRatio = metrics?.thinWallRatio ?? 0;
  const p5Thickness = metrics?.p5WallThicknessMm;
  const minWall = metrics?.minWallThicknessMm;
  const wtStatus = deriveWtStatus(thinWallRatio, p5Thickness);

  return {
    fileName,
    wallThickness: {
      minThickness: p5Thickness ?? metrics?.avgWallThicknessMm ?? metrics?.medianWallThicknessMm ?? minWall,
      p1Thickness: metrics?.p1WallThicknessMm ?? null,
      p5Thickness: metrics?.p5WallThicknessMm ?? null,
      p10Thickness: metrics?.p10WallThicknessMm ?? null,
      medianThickness: metrics?.medianWallThicknessMm ?? null,
      avgThickness: metrics?.avgWallThicknessMm ?? null,
      thinWallCount: metrics?.thinWallCount ?? 0,
      thinWallPercentage: metrics?.thinWallPercentage ?? 0,
      thinWallRatio: metrics?.thinWallRatio ?? 0,
      averageConfidence: metrics?.averageConfidence ?? 0,
      areas: Math.floor(triCount * 0.15),
      status: wtStatus,
    },
    overhang: {
      angle: material.overhangThreshold,
      areas: oh?.faceCount ?? 0,
      status: deriveOhStatus(oh?.ratio ?? 0),
    },
    volume,
    surfaceArea,
    dims,
  };
}

/**
 * Build a real ModelAnalysis from pipeline output. Previously this stage was
 * filled with an empty `{}` or a double-cast `report as unknown as ModelAnalysis`
 * (an AnalysisReport is a string document — unrelated to ModelAnalysis).
 * Any consumer reading typed fields off those fakes would see undefined at
 * runtime. Now the stage output is a genuine ModelAnalysis.
 */
function buildModelAnalysis(
  unifiedAnalysis: UnifiedAnalysis,
  fileName: string,
  fileSizeBytes: number,
  modelData: ModelData,
): ModelAnalysis {
  const metrics = unifiedAnalysis.metrics.result;
  const topology = unifiedAnalysis.topology.result;
  const dims = metrics?.boundingBoxDimensionsMm ?? { x: 0, y: 0, z: 0 };

  const findings: PrintabilityFinding[] = [];
  if (modelData.wallThickness.status !== 'good') {
    findings.push({
      id: `wall-thickness:${fileName}`,
      category: 'wall_thickness',
      severity: modelData.wallThickness.status === 'critical' ? 'critical' : 'warning',
      title: 'Wall thickness below recommended minimum',
      message:
        modelData.wallThickness.minThickness === null
          ? 'Wall thickness could not be measured (raycast miss).'
          : `Minimum wall thickness ~${modelData.wallThickness.minThickness.toFixed(2)} mm — risk of weak or failed prints.`,
      source: 'heuristic',
    });
  }
  if (modelData.overhang.status !== 'good') {
    findings.push({
      id: `overhang:${fileName}`,
      category: 'overhang',
      severity: modelData.overhang.status === 'critical' ? 'critical' : 'warning',
      title: 'Overhangs require support',
      message: `${modelData.overhang.areas} faces exceed the ${modelData.overhang.angle}° overhang threshold.`,
      source: 'heuristic',
    });
  }

  return {
    source: {
      id: `${fileName}:analysis`,
      fileName,
      fileSizeBytes,
      fileType: 'stl',
      units: 'mm',
    },
    metrics: {
      // Bounds are approximated from bounding-box dimensions with min at the
      // origin — the pipeline tracks dimensions, not the true mesh offset.
      bounds: createGeometryBounds({ x: 0, y: 0, z: 0 }, dims),
      triangleCount: topology?.triangleCount ?? 0,
      surfaceAreaMm2: metrics?.surfaceAreaMm2 ?? 0,
      boundingBoxVolumeMm3: metrics?.boundingBoxVolumeMm3 ?? 0,
      meshVolumeMm3: metrics?.meshVolumeMm3 ?? 0,
    },
    findings,
    legacy: {
      wallThickness: {
        minThicknessMm: modelData.wallThickness.minThickness ?? 0,
        p1ThicknessMm: modelData.wallThickness.p1Thickness,
        p5ThicknessMm: modelData.wallThickness.p5Thickness,
        p10ThicknessMm: modelData.wallThickness.p10Thickness,
        medianThicknessMm: modelData.wallThickness.medianThickness,
        avgThicknessMm: modelData.wallThickness.avgThickness,
        thinWallCount: modelData.wallThickness.thinWallCount,
        thinWallPercentage: modelData.wallThickness.thinWallPercentage,
        averageConfidence: modelData.wallThickness.averageConfidence,
        affectedAreas: modelData.wallThickness.areas,
        status: modelData.wallThickness.status,
      },
      overhang: {
        thresholdDeg: modelData.overhang.angle,
        affectedFaces: modelData.overhang.areas,
        status: modelData.overhang.status,
      },
    },
  };
}

export interface ParseMeshStageOutput {
  fileName: string;
  fileSizeBytes?: number;
  geometryAvailable: true;
}

export interface AnalyzeGeometryStageOutput {
  triangleCount: number;
  surfaceArea: number;
  boundingBoxVolume: number;
}

export interface PrintReviewWorkflowStages {
  parseMesh: WorkflowStageResult<ParseMeshStageOutput>;
  analyzeGeometry: WorkflowStageResult<AnalyzeGeometryStageOutput>;
  evaluatePrintability: WorkflowStageResult<ModelAnalysis>;
  generateReport: WorkflowStageResult<AnalysisReport>;
}

export interface LocalPrintReviewWorkflowResult {
  stages: PrintReviewWorkflowStages;
  geometry?: THREE.BufferGeometry;
  unifiedAnalysis?: UnifiedAnalysis;
  modelAnalysis?: ModelAnalysis;
  report?: AnalysisReport;
}

export interface LocalPrintReviewWorkflowOptions {
  language: AdvisorLanguage;
  generateReport?: boolean;
  material?: Material;
}

export interface LocalPrintReviewWorkflowDependencies {
  parseMesh?: (file: File) => Promise<THREE.BufferGeometry>;
  now?: () => string;
}

export async function executeLocalPrintReviewWorkflow(
  file: File,
  options: LocalPrintReviewWorkflowOptions,
  dependencies: LocalPrintReviewWorkflowDependencies = {},
): Promise<LocalPrintReviewWorkflowResult> {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const parseMesh = dependencies.parseMesh ?? loadSTLFile;
  const stages = createInitialPrintReviewStages();
  const result: LocalPrintReviewWorkflowResult = { stages };

  try {
    stages.parseMesh = startStage(stages.parseMesh, now());
    const geometry = await parseMesh(file);
    result.geometry = geometry;
    stages.parseMesh = completeStage(
      stages.parseMesh,
      {
        fileName: file.name,
        fileSizeBytes: file.size,
        geometryAvailable: true,
      },
      now(),
    );

    stages.analyzeGeometry = startStage(stages.analyzeGeometry, now());
    const model = fromThreeBufferGeometry(geometry);
    const unifiedAnalysis = await runAnalysisInWorker(model, { fileName: file.name });
    result.unifiedAnalysis = unifiedAnalysis;
    const triCount = unifiedAnalysis.topology.result?.triangleCount ?? 0;
    const surfaceArea = unifiedAnalysis.metrics.result?.surfaceAreaMm2 ?? 0;
    const boundingBoxVolume = unifiedAnalysis.metrics.result?.boundingBoxVolumeMm3 ?? 0;
    stages.analyzeGeometry = completeStage(
      stages.analyzeGeometry,
      { triangleCount: triCount, surfaceArea, boundingBoxVolume },
      now(),
    );

    stages.evaluatePrintability = startStage(stages.evaluatePrintability, now());
    const modelData = unifiedToModelData(unifiedAnalysis, file.name, options.material);
    const modelAnalysis = buildModelAnalysis(unifiedAnalysis, file.name, file.size, modelData);
    result.modelAnalysis = modelAnalysis;
    stages.evaluatePrintability = completeStage(stages.evaluatePrintability, modelAnalysis, now());

    if (options.generateReport === false) {
      stages.generateReport = skipStage(stages.generateReport, now());
      return result;
    }

    const report = createAnalysisReport(modelData, options.language, now(), options.material);
    result.report = report;

    stages.generateReport = startStage(stages.generateReport, now());
    stages.generateReport = completeStage(stages.generateReport, report, now());

    return result;
  } catch (error) {
    failActiveStage(stages, error, now());
    return result;
  }
}

export function createInitialPrintReviewStages(): PrintReviewWorkflowStages {
  return {
    parseMesh: createPendingStage('parse_mesh'),
    analyzeGeometry: createPendingStage('analyze_geometry'),
    evaluatePrintability: createPendingStage('evaluate_printability'),
    generateReport: createPendingStage('generate_report'),
  };
}

function createAnalysisReport(
  modelData: ModelData,
  language: AdvisorLanguage,
  generatedAt: string,
  material: Material = DEFAULT_MATERIAL,
): AnalysisReport {
  return {
    id: `${modelData.fileName}:local-report:${language}`,
    modelSourceId: modelData.fileName,
    format: 'plain_text',
    content: generateQuickReport(modelData, language, material),
    generatedAt,
    source: 'local_rules',
  };
}

function failActiveStage(
  stages: PrintReviewWorkflowStages,
  error: unknown,
  completedAt: string,
) {
  const stageError = {
    code: 'stage_failed',
    message: error instanceof Error ? error.message : 'Workflow stage failed',
  };

  if (stages.parseMesh.status === 'running') {
    stages.parseMesh = failStage(stages.parseMesh, stageError, completedAt);
    return;
  }
  if (stages.analyzeGeometry.status === 'running') {
    stages.analyzeGeometry = failStage(stages.analyzeGeometry, stageError, completedAt);
    return;
  }
  if (stages.evaluatePrintability.status === 'running') {
    stages.evaluatePrintability = failStage(stages.evaluatePrintability, stageError, completedAt);
    return;
  }
  if (stages.generateReport.status === 'running') {
    stages.generateReport = failStage(stages.generateReport, stageError, completedAt);
  }
}