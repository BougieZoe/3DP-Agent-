// client/src/lib/stlPipeline.ts
// Explicit pipeline: File → ArrayBuffer → parse → metrics → printability → ModelAnalysis
// stlLoader.ts remains as a compatibility facade and is NOT replaced.

import { loadSTLFile } from './stlLoader';
import type { GeometryMetrics, BoundingBox } from '../../../shared/domain/geometry';
import { emptyBoundingBox, boundingBoxDimensions } from '../../../shared/domain/geometry';
import type { PrintabilityFinding, PrintabilitySummary } from '../../../shared/domain/printability';
import { scoreFromFindings } from '../../../shared/domain/printability';
import type { ModelAnalysis, WorkflowStageResult } from '../../../shared/domain/analysis';
import { createAnalysis } from '../../../shared/domain/analysis';

// ─── Stage 1: parse geometry metrics from STL ──────────────────────────────

export async function parseGeometryMetrics(file: File): Promise<GeometryMetrics> {
  const geometry = await loadSTLFile(file);  // Three.js BufferGeometry (runtime artifact)

  const pos = geometry.attributes.position;
  const triangleCount = pos.count / 3;
  const vertexCount = pos.count;

  const bb: BoundingBox = emptyBoundingBox();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (x < bb.minX) bb.minX = x; if (x > bb.maxX) bb.maxX = x;
    if (y < bb.minY) bb.minY = y; if (y > bb.maxY) bb.maxY = y;
    if (z < bb.minZ) bb.minZ = z; if (z > bb.maxZ) bb.maxZ = z;
  }

  const dims = boundingBoxDimensions(bb);

  // Naive volume estimate via bounding box (replace with divergence theorem later)
  const volume = (dims.width * dims.depth * dims.height) / 1000; // cm³

  // Surface area: sum of triangle areas
  let surfaceArea = 0;
  for (let i = 0; i < pos.count; i += 3) {
    const ax = pos.getX(i),   ay = pos.getY(i),   az = pos.getZ(i);
    const bx = pos.getX(i+1), by = pos.getY(i+1), bz = pos.getZ(i+1);
    const cx = pos.getX(i+2), cy = pos.getY(i+2), cz = pos.getZ(i+2);
    const abx = bx-ax, aby = by-ay, abz = bz-az;
    const acx = cx-ax, acy = cy-ay, acz = cz-az;
    const crossX = aby*acz - abz*acy;
    const crossY = abz*acx - abx*acz;
    const crossZ = abx*acy - aby*acx;
    surfaceArea += 0.5 * Math.sqrt(crossX**2 + crossY**2 + crossZ**2);
  }
  surfaceArea = surfaceArea / 100; // mm² → cm²

  return {
    triangleCount,
    vertexCount,
    volume,
    surfaceArea,
    boundingBox: bb,
    dimensions: {
      width:  dims.width,
      depth:  dims.depth,
      height: dims.height,
    },
    isManifold: true,   // heuristic — real check deferred
    hasNormals: geometry.attributes.normal !== undefined,
  };
}

// ─── Stage 2: evaluate printability from geometry ─────────────────────────

export function evaluatePrintability(metrics: GeometryMetrics): PrintabilitySummary {
  const findings: PrintabilityFinding[] = [];

  const { width, depth, height } = metrics.dimensions;
  const maxDim = Math.max(width, depth, height);

  // Size check: common desktop FDM bed limit ~220mm
  if (maxDim > 220) {
    findings.push({
      id: 'size-exceeds-bed',
      category: 'size',
      severity: 'error',
      title: 'Model exceeds typical print bed',
      description: `Largest dimension is ${maxDim.toFixed(1)}mm, which exceeds 220mm.`,
      value: maxDim,
      threshold: 220,
      unit: 'mm',
    });
  }

  // Size check: very small model
  if (maxDim < 5) {
    findings.push({
      id: 'size-too-small',
      category: 'size',
      severity: 'warning',
      title: 'Model may be too small',
      description: `Largest dimension is ${maxDim.toFixed(1)}mm. Details under 0.4mm may not print.`,
      value: maxDim,
      threshold: 5,
      unit: 'mm',
    });
  }

  // Triangle density check
  const area = metrics.surfaceArea;
  const density = area > 0 ? metrics.triangleCount / area : 0;
  if (density < 0.5) {
    findings.push({
      id: 'low-resolution',
      category: 'geometry',
      severity: 'info',
      title: 'Low mesh resolution',
      description: 'The mesh may appear faceted when printed.',
      value: density,
      unit: 'triangles/cm²',
    });
  }

  const score = scoreFromFindings(findings);
  return {
    score,
    findings,
    errorCount:   findings.filter(f => f.severity === 'error').length,
    warningCount: findings.filter(f => f.severity === 'warning').length,
    printable:    score !== 'poor',
  };
}

// ─── Stage 3: compose ModelAnalysis ───────────────────────────────────────

export async function analyzeModel(file: File): Promise<{
  analysis: ModelAnalysis;
  stages: WorkflowStageResult[];
}> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const stages: WorkflowStageResult[] = [];

  // Stage: parse
  const parseStart = Date.now();
  stages.push({ stage: 'parse_mesh', status: 'running', startedAt: new Date().toISOString() });

  let geometry: GeometryMetrics;
  try {
    geometry = await parseGeometryMetrics(file);
    stages[0] = {
      ...stages[0],
      status: 'completed',
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - parseStart,
      output: geometry,
    };
  } catch (err) {
    const analysis = { ...createAnalysis(id, file.name, file.size), status: 'failed' as const, errorMessage: String(err) };
    stages[0] = { ...stages[0], status: 'failed', error: String(err) };
    return { analysis, stages };
  }

  // Stage: printability
  const printStart = Date.now();
  stages.push({ stage: 'evaluate_printability', status: 'running', startedAt: new Date().toISOString() });
  const printability = evaluatePrintability(geometry);
  stages[1] = {
    ...stages[1],
    status: 'completed',
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - printStart,
    output: printability,
  };

  const analysis: ModelAnalysis = {
    ...createAnalysis(id, file.name, file.size),
    status: 'completed',
    geometry,
    printability,
  };

  return { analysis, stages };
}