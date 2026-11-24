/**
 * Server-side verdict entry — 让可打印性判定脱离浏览器。
 *
 * 复用 client/src/analysis 的纯计算流水线（pipeline + findingExtractor），
 * 在 Node 进程内完成 STL → GeometryModel → 统一分析 → 结构化缺陷清单。
 *
 * 设计约束：
 *  - 不引入 Worker / DOM / WebGPU 依赖（那些只存在于 analysis.worker / workerPool）；
 *  - 不重新实现任何判定规则，一律调用既有模块，保证与前端结论同源；
 *  - 输出的 gate 是"服务端聚合口径"，与前端 ExecutiveSummary.verdict 分开命名，
 *    避免两套语义被当成同一个东西。
 */

import { parseSTL } from '../client/src/lib/stlParser';
import { fromThreeBufferGeometry } from '../client/src/analysis/geometryConversion';
import { runAnalysisPipeline, type PipelineOptions } from '../client/src/analysis/pipeline';
import { extractFindings } from '../client/src/analysis/findingExtractor';
import type { Finding } from '../client/src/analysis/types';
import { evaluateVerdict, type Verdict, type VerdictObservation } from './verdictPolicy';

/** 输入非法（不是可解析的 STL 等）时抛出，路由层映射为 4xx。 */
export class AnalyzeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalyzeInputError';
  }
}

export interface AnalyzeSummary {
  bboxMm: { x: number; y: number; z: number } | null;
  volumeMm3: number | null;
  volumeReliable: boolean;
  surfaceAreaMm2: number | null;
  minWallThicknessMm: number | null;
  avgWallThicknessMm: number | null;
  isWatertight: boolean;
  holeCount: number;
  boundaryEdgeCount: number;
  flippedNormalRatio: number;
  fitsBuildVolume: boolean | null;
  estimatedPrintTimeMinutes: number | null;
  estimatedSupportGrams: number | null;
  supportDifficulty: string | null;
  printTimeSource: 'estimate' | 'slicer' | null;
}

export interface AnalyzeGate {
  /**
   * 服务端聚合口径（非前端 ExecutiveSummary.verdict）：
   * 存在 critical → fail；仅 warning → warning；否则 clean。
   */
  status: 'clean' | 'warning' | 'fail';
  criticalCount: number;
  warningCount: number;
  infoCount: number;
}

export type AnalyzeFinding = Pick<
  Finding,
  'id' | 'category' | 'severity' | 'title' | 'description' | 'impact' | 'moduleSource' | 'confidence'
>;

export interface AnalyzeResult {
  modelFileName: string;
  analyzedAt: string;
  overallConfidence: number;
  topologyProfile: string | null;
  summary: AnalyzeSummary;
  gate: AnalyzeGate;
  /**
   * 真值墙结论（见 verdictPolicy）。gate 是"缺陷计数聚合"的旧口径，保留只为兼容；
   * 对外声明"能不能打"一律以 verdict 为准，二者冲突时 verdict 优先。
   */
  verdict: Verdict;
  findings: AnalyzeFinding[];
  elapsedMs: number;
}

export interface AnalyzeOptions extends PipelineOptions {
  fileName?: string;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * 把任意 ArrayBuffer 视图规整成独立的 ArrayBuffer。
 * Node 的 Buffer 常常是池化的（非零 byteOffset），直接取 .buffer 会读到无关内存。
 */
function toArrayBuffer(input: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (input instanceof Uint8Array) {
    const copy = new Uint8Array(input.byteLength);
    copy.set(input);
    return copy.buffer;
  }
  return input;
}

function aggregateGate(findings: AnalyzeFinding[]): AnalyzeGate {
  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const infoCount = findings.filter((f) => f.severity === 'info').length;
  const status: AnalyzeGate['status'] =
    criticalCount > 0 ? 'fail' : warningCount > 0 ? 'warning' : 'clean';
  return { status, criticalCount, warningCount, infoCount };
}

/** 分析一份 STL 字节流，返回结构化结论。同步执行，无 IO。 */
export function analyzeStlBuffer(
  input: ArrayBuffer | Uint8Array,
  options: AnalyzeOptions = {},
): AnalyzeResult {
  const startedAt = performance.now();
  const ab = toArrayBuffer(input);

  if (ab.byteLength === 0) {
    throw new AnalyzeInputError('empty STL payload');
  }
  if (ab.byteLength < 84) {
    // 二进制 STL 头部 80 字节 + 4 字节面数；不足即不可能是合法 STL。
    throw new AnalyzeInputError('payload too small to be a binary STL');
  }

  let geometry;
  try {
    geometry = parseSTL(ab);
  } catch (err) {
    throw new AnalyzeInputError(
      `STL parse failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const model = fromThreeBufferGeometry(geometry);
  const analysis = runAnalysisPipeline(model, options);

  const findings = extractFindings(analysis, options.language ?? 'en').map<AnalyzeFinding>((f) => ({
    id: f.id,
    category: f.category,
    severity: f.severity,
    title: f.title,
    description: f.description,
    impact: f.impact,
    moduleSource: f.moduleSource,
    confidence: f.confidence,
  }));

  const metrics = analysis.metrics?.result;
  const validation = analysis.validation?.result;
  const support = analysis.support?.result;
  const printTime = analysis.printTime?.result;
  const bedFit = analysis.bedFit?.result;

  const summary: AnalyzeSummary = {
    bboxMm: metrics?.boundingBoxDimensionsMm
      ? {
          x: metrics.boundingBoxDimensionsMm.x,
          y: metrics.boundingBoxDimensionsMm.y,
          z: metrics.boundingBoxDimensionsMm.z,
        }
      : null,
    volumeMm3: num(metrics?.meshVolumeMm3),
    volumeReliable: Boolean(metrics?.volumeReliable),
    surfaceAreaMm2: num(metrics?.surfaceAreaMm2),
    minWallThicknessMm: num(metrics?.minWallThicknessMm),
    avgWallThicknessMm: num(metrics?.avgWallThicknessMm),
    isWatertight: Boolean(validation?.isWatertight),
    holeCount: num(validation?.holeCount) ?? 0,
    boundaryEdgeCount: num(validation?.boundaryEdgeCount) ?? 0,
    flippedNormalRatio: num(validation?.flippedNormalRatio) ?? 0,
    fitsBuildVolume: typeof bedFit?.fits === 'boolean' ? bedFit.fits : null,
    estimatedPrintTimeMinutes: num(printTime?.estimatedPrintTimeMinutes),
    estimatedSupportGrams: num(support?.estimatedSupportGrams),
    supportDifficulty: typeof support?.difficulty === 'string' ? support.difficulty : null,
    printTimeSource: printTime?.source ?? null,
  };

  const observation: VerdictObservation = {
    isWatertight: summary.isWatertight,
    holeCount: summary.holeCount,
    boundaryEdgeCount: summary.boundaryEdgeCount,
    volumeReliable: summary.volumeReliable,
    minWallThicknessMm: summary.minWallThicknessMm,
    fitsBuildVolume: summary.fitsBuildVolume,
    estimatedPrintTimeMinutes: summary.estimatedPrintTimeMinutes,
    estimatedSupportGrams: summary.estimatedSupportGrams,
  };

  return {
    modelFileName: options.fileName ?? analysis.modelFileName ?? 'unnamed.stl',
    analyzedAt: new Date().toISOString(),
    overallConfidence: num(analysis.overallConfidence) ?? 0,
    topologyProfile:
      typeof analysis.topologyProfile === 'string' ? analysis.topologyProfile : null,
    summary,
    gate: aggregateGate(findings),
    verdict: evaluateVerdict(observation),
    findings,
    elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
  };
}
