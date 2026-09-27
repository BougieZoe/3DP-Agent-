/**
 * Scale / unit sentinel — 1:1 semantic port of the Python engine's scale guard
 * (3dp-agent/web_console.py: SCALE_GUARD_* constants + `_tick_hit` /
 * `_coord_grid_ratio` / `_scale_guard`).
 *
 * Why it lives here now: the two head-to-head calibration rounds
 * (引擎对标报告_20260927 / 第二轮对标_共识层同层对比_20260927) established that
 * the front-end `analysis/*` pipeline owns the authoritative geometry and
 * printability judgement — and that the only genuinely accurate capability the
 * front end was missing was the scale sentinel. Python's guard was verified
 * 8/8 with no false positive on regular-scale parts, so it is ported verbatim
 * in semantics; nothing else from the Python scorer is borrowed (its
 * min_wall_mm / overhang / bed-fit defects are explicitly NOT ported).
 *
 * Contract (unchanged from the Python implementation):
 *  - Read-only: never rescales, never mutates geometry, never feeds a score.
 *  - Never throws: any failure degrades to `status: 'ok'` with an explanatory
 *    note, so the sentinel can never break the analysis pipeline.
 *  - `status` is only `ok` on the regular-scale window, so ordinary parts
 *    never receive a unit warning (false-positive guard).
 *  - Tick-alignment and vertex-coordinate signals are ADVISORY ONLY: they may
 *    raise the stated confidence, but they can never flip the verdict nor the
 *    suggested scale. Ambiguity is reported, never resolved by force.
 *
 * Field-name mapping (TS camelCase ⇄ Python snake_case) is noted per field so
 * the two engines can still be diffed field-by-field during calibration.
 */

import type { GeometryModel } from './geometryModel';
import { moduleResult, type AnalysisModuleResult, type Confidence } from './types';

// ─── Thresholds (mirrors SCALE_GUARD_* in web_console.py) ─────────────────────

/** Lower bound of a regular part's largest edge (mm). */
export const SCALE_GUARD_SMALL_EDGE_MM = 3.0;
/** 0.8 in — advisory note only, never participates in grading. */
export const SCALE_GUARD_ADVISORY_EDGE_MM = 20.32;
/** Lower bound of a common desktop-machine build envelope (mm). */
export const SCALE_GUARD_BUILD_MIN_MM = 5.0;
/** Upper bound of a common desktop-machine build envelope (mm). */
export const SCALE_GUARD_BUILD_MAX_MM = 300.0;
/** Above this, the part is flagged oversize for a desktop machine (mm). */
export const SCALE_GUARD_OVERSIZE_MM = 400.0;

/** Neat imperial ticks, in inches. */
export const SCALE_GUARD_INCH_TICKS: readonly number[] = [0.25, 0.5, 1.0, 2.0, 3.0, 4.0, 6.0, 8.0];
/** The same ticks expressed in mm — both sides must share one unit to compare. */
export const SCALE_GUARD_INCH_TICKS_MM: readonly number[] =
  SCALE_GUARD_INCH_TICKS.map((t) => Number((t * 25.4).toFixed(4)));
/** Neat metric ticks, in mm. */
export const SCALE_GUARD_MM_TICKS: readonly number[] = [1.0, 2.0, 5.0, 10.0, 20.0, 50.0];
/** Relative tolerance for a tick hit (±2%). */
export const SCALE_GUARD_TICK_TOL = 0.02;

/** Cap on sampled vertices for the weak coordinate signal (bounds the cost). */
export const SCALE_GUARD_COORD_CAP = 4096;
/** Grid steps: 1/16 inch and 0.1 mm. */
export const SCALE_GUARD_COORD_STEP = { inch: 0.0625, cm: 0.1 } as const;
/** Relative tolerance for "vertex lies on the grid". */
export const SCALE_GUARD_COORD_TOL = 0.02;
/** Ratio at/above which the coordinates count as "neat". */
export const SCALE_GUARD_COORD_HI = 0.9;
/** Ratio at/below which the coordinates count as "not neat". */
export const SCALE_GUARD_COORD_LO = 0.3;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ScaleGuardStatus = 'ok' | 'oversize' | 'suspect_inch' | 'suspect_cm';

export type ScaleGuardDisambiguation =
  | 'n/a'
  | 'inch_preferred'
  | 'cm_preferred'
  | 'ambiguous_ticks'
  | 'no_tick_signal';

/** Tick-alignment check (`tick_check` in Python). */
export interface ScaleGuardTickCheck {
  /** max edge × 25.4, in mm. */
  inchValue: number;
  inchTicks: number[];
  /** The neat imperial tick that was hit, in inches (null when none). */
  inchTick: number | null;
  /** Same tick, in mm (null when none). */
  inchTickMm: number | null;
  inchDeviation: number | null;
  /** max edge × 10, in mm. */
  cmValue: number;
  cmTicks: number[];
  cmTick: number | null;
  cmDeviation: number | null;
  tolerance: number;
}

export type ScaleGuardCoordBias = 'undetermined' | 'ambiguous_both' | 'inch' | 'cm';

/** Weak vertex-coordinate signal (`coord_support` in Python). */
export interface ScaleGuardCoordSupport {
  sourceField: string;
  sampleVertices: number;
  inchGridRatio: number | null;
  cmGridRatio: number | null;
  bias: ScaleGuardCoordBias;
}

export interface ScaleGuardResult {
  status: ScaleGuardStatus;
  maxEdgeMm: number | null;
  signals: string[];
  /** 1 = keep as-is, 25.4 = likely inch misread, 10 = likely cm misread. */
  suggestedScale: number;
  suggestedExtentsMm: number[];
  note: string;
  tickCheck: ScaleGuardTickCheck | null;
  coordSupport: ScaleGuardCoordSupport | null;
  disambiguation: ScaleGuardDisambiguation;
  /** Free-text confidence, deliberately not a number (matches Python). */
  confidence: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Mirrors Python's `_fmt(value, digits)` — i.e. the text form of
 * `round(value, digits)`. Python prints a float with a trailing `.0`
 * (500.0, 5.0, 0.0) where JS's `String(number)` drops it, so the decimal part
 * is re-attached. Every note / signal string embeds this form, which keeps the
 * front end diffable character-for-character against the Python engine.
 */
function fmt(value: number, digits: number): string {
  const rounded = Number(value.toFixed(digits));
  const s = String(rounded);
  return s.includes('.') ? s : `${s}.0`;
}

/** Numeric form for structured fields; mirrors Python's `round(value, digits)`. */
function roundNum(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}

/**
 * Tick-alignment test (`_tick_hit`). Returns the closest hit and its relative
 * deviation, or null. Any anomaly degrades to "no hit" rather than throwing.
 */
export function tickHit(
  value: number,
  ticks: readonly number[],
  tol: number = SCALE_GUARD_TICK_TOL,
): { tick: number; deviation: number } | null {
  try {
    const v = Number(value);
    if (!(v > 0)) return null;
    let best: { tick: number; deviation: number } | null = null;
    for (const t of ticks) {
      const tf = Number(t);
      if (!(tf > 0)) continue;
      const dev = Math.abs(v - tf) / tf;
      if (dev <= tol && (best === null || dev < best.deviation)) {
        best = { tick: tf, deviation: dev };
      }
    }
    return best;
  } catch {
    return null;
  }
}

/**
 * Fraction of vertex coordinates that land on an integer multiple of `step`
 * (`_coord_grid_ratio`) — a weak corroborating signal only. Missing / empty /
 * malformed input returns null so the caller simply skips the signal.
 */
export function coordGridRatio(
  positions: ArrayLike<number> | null | undefined,
  step: number,
  tol: number = SCALE_GUARD_COORD_TOL,
  cap: number = SCALE_GUARD_COORD_CAP,
): number | null {
  try {
    if (positions == null || positions.length === 0) return null;
    const rows = Math.min(cap, Math.floor(positions.length / 3));
    let total = 0;
    let hit = 0;
    for (let i = 0; i < rows * 3; i++) {
      const x = Math.abs(Number(positions[i]));
      total += 1;
      const r = x / step;
      if (Math.abs(r - Math.round(r)) <= tol) hit += 1;
    }
    if (total === 0) return null;
    return roundNum(hit / total, 4);
  } catch {
    return null;
  }
}

// ─── Sentinel ─────────────────────────────────────────────────────────────────

/**
 * Scale / unit sentinel. `dimensionsMm` is the model's axis-aligned extents in
 * millimetres (as produced by the metrics module); `positions` is the optional
 * vertex array used only for the weak coordinate signal.
 *
 * Mirrors `_scale_guard(size, vertices)` exactly, including every note string,
 * so the front end's output can be diffed against the Python engine's.
 */
export function assessScale(
  dimensionsMm: readonly number[] | null | undefined,
  positions?: ArrayLike<number> | null,
): ScaleGuardResult {
  try {
    const edges = (dimensionsMm ?? []).map((v) => Number(v));
    if (edges.length === 0) throw new Error('extents 为空');

    const L = Math.max(...edges);
    const lo = SCALE_GUARD_BUILD_MIN_MM;
    const hi = SCALE_GUARD_BUILD_MAX_MM;
    const small = SCALE_GUARD_SMALL_EDGE_MM;

    const rawEdges = edges.map((e) => roundNum(e, 3));
    const inchEdges = edges.map((e) => roundNum(e * 25.4, 3));
    const cmEdges = edges.map((e) => roundNum(e * 10.0, 3));
    const inchOk = lo <= L * 25.4 && L * 25.4 <= hi;
    const cmOk = lo <= L * 10.0 && L * 10.0 <= hi;

    // ── Disambiguation signals (advisory, never grade-shifting) ──
    const inchHit = tickHit(L * 25.4, SCALE_GUARD_INCH_TICKS_MM);
    const cmHit = tickHit(L * 10.0, SCALE_GUARD_MM_TICKS);
    const inchTickMm = inchHit?.tick ?? null;
    const inchDev = inchHit?.deviation ?? null;
    const cmTick = cmHit?.tick ?? null;
    const cmDev = cmHit?.deviation ?? null;
    const inchTick = inchTickMm === null ? null : roundNum(inchTickMm / 25.4, 4);

    const tickCheck: ScaleGuardTickCheck = {
      inchValue: roundNum(L * 25.4, 4),
      inchTicks: [...SCALE_GUARD_INCH_TICKS],
      inchTick,
      inchTickMm,
      inchDeviation: inchDev === null ? null : roundNum(inchDev, 4),
      cmValue: roundNum(L * 10.0, 4),
      cmTicks: [...SCALE_GUARD_MM_TICKS],
      cmTick,
      cmDeviation: cmDev === null ? null : roundNum(cmDev, 4),
      tolerance: SCALE_GUARD_TICK_TOL,
    };

    let coordSupport: ScaleGuardCoordSupport | null = null;
    if (positions != null) {
      const inchRatio = coordGridRatio(positions, SCALE_GUARD_COORD_STEP.inch);
      const cmRatio = coordGridRatio(positions, SCALE_GUARD_COORD_STEP.cm);
      if (inchRatio !== null || cmRatio !== null) {
        let bias: ScaleGuardCoordBias = 'undetermined';
        if (inchRatio !== null && cmRatio !== null) {
          const hiR = SCALE_GUARD_COORD_HI;
          const loR = SCALE_GUARD_COORD_LO;
          if (inchRatio >= hiR && cmRatio >= hiR) bias = 'ambiguous_both';
          else if (inchRatio >= hiR && cmRatio <= loR && inchRatio > cmRatio) bias = 'inch';
          else if (cmRatio >= hiR && inchRatio <= loR && cmRatio > inchRatio) bias = 'cm';
        }
        coordSupport = {
          sourceField: 'mesh.vertices（顶点坐标矩阵，按 mm 解释）',
          sampleVertices: Math.min(SCALE_GUARD_COORD_CAP, Math.floor(positions.length / 3)),
          inchGridRatio: inchRatio,
          cmGridRatio: cmRatio,
          bias,
        };
      }
    }

    let status: ScaleGuardStatus = 'ok';
    let suggestedScale = 1;
    let suggestedExtents: number[] = rawEdges;
    let signals: string[] = [];
    let disambiguation: ScaleGuardDisambiguation = 'n/a';
    let confidence = 'n/a';
    let note: string;

    // Tick summary line, phrased per outcome (identical wording to Python).
    let tickLine: string;
    if (inchTick !== null && cmTick === null) {
      tickLine =
        `刻度核对：×25.4 后 = ${fmt(L * 25.4, 2)} mm = ${fmt(L, 4)} inch（命中整齐英制刻度，` +
        `偏差 ${fmt((inchDev ?? 0) * 100, 2)}%）；×10 后 = ${fmt(L * 10.0, 2)} mm 未命中整齐公制刻度`;
    } else if (cmTick !== null && inchTick === null) {
      tickLine =
        `刻度核对：×10 后 = ${fmt(L * 10.0, 2)} mm = ${fmt(L, 4)} cm（命中整齐公制刻度，` +
        `偏差 ${fmt((cmDev ?? 0) * 100, 2)}%）；×25.4 后 = ${fmt(L * 25.4, 2)} mm 未命中整齐英制刻度`;
    } else if (inchTick !== null && cmTick !== null) {
      tickLine =
        `刻度核对：×25.4 后 = ${fmt(L, 4)} inch 与 ×10 后 = ${fmt(L * 10.0, 4)} mm ` +
        `均命中整齐刻度，两种解释同样自洽，刻度信号无法消歧`;
    } else {
      tickLine =
        `刻度核对：×25.4 后 = ${fmt(L * 25.4, 2)} mm、×10 后 = ${fmt(L * 10.0, 2)} mm 均未命中` +
        `整齐刻度，刻度信号不提供单位倾向`;
    }

    if (L > SCALE_GUARD_OVERSIZE_MM) {
      status = 'oversize';
      signals = [
        `最大边 ${fmt(L, 2)} mm > ${fmt(SCALE_GUARD_OVERSIZE_MM, 0)} mm，超出常见桌面机成型尺寸上限`,
      ];
      note = '疑似超出常见桌面机成型幅面：未做单位换算，请确认是否需要缩放或拆分模型';
    } else if (L < small) {
      const base = `最大边 ${fmt(L, 2)} mm < ${fmt(small, 2)} mm 常规零件尺度下限`;
      if (inchOk) {
        status = 'suspect_inch';
        suggestedScale = 25.4;
        suggestedExtents = inchEdges;
        signals = [
          base,
          `×25.4 换算后最大边 ${fmt(L * 25.4, 2)} mm，落入 ${fmt(lo, 0)}~${fmt(hi, 0)} mm 常见桌面机幅面内`,
        ];
        if (cmOk) {
          signals.push(
            `×10 换算后最大边 ${fmt(L * 10.0, 2)} mm 亦落在同一区间，厘米解释无法排除，` +
            `此处按英寸优先提示，请人工确认上游导出单位`,
          );
          note = '疑似英制单位（inch）被按毫米读取；厘米（cm）解释同样成立，请确认导出单位';
        } else {
          note = '疑似英制单位（inch）被按毫米读取';
        }
        if (inchTick !== null && cmTick === null) {
          disambiguation = 'inch_preferred';
          confidence = 'high';
          if (coordSupport !== null && coordSupport.bias === 'inch') {
            confidence = 'high（刻度 + 坐标双重吻合）';
          } else if (coordSupport !== null && coordSupport.bias === 'cm') {
            confidence = 'medium（刻度支持英寸，坐标特征未支持）';
          }
          signals.push(
            `刻度吻合：×25.4 后 = ${fmt(L, 4)} inch（整齐英制刻度，偏差 ${fmt((inchDev ?? 0) * 100, 2)}%），` +
            `而 ×10 后 = ${fmt(L * 10.0, 2)} mm 未命中整齐公制刻度，刻度信号支持英寸解释`,
          );
          note +=
            `；刻度信号支持英寸解释：×25.4 后 = ${fmt(L, 4)} inch` +
            `（整齐英制刻度，偏差 ${fmt((inchDev ?? 0) * 100, 2)}%）`;
        } else if (inchTick !== null && cmTick !== null) {
          disambiguation = 'ambiguous_ticks';
          confidence = 'low';
          signals.push(
            `刻度吻合：×25.4 后 = ${fmt(L, 4)} inch 与 ×10 后 = ${fmt(L * 10.0, 4)} mm 均命中整齐` +
            `刻度，两种解释同样自洽，刻度信号无法消歧，严禁据此强行下结论`,
          );
          note +=
            `；刻度信号：×25.4 后 = ${fmt(L, 4)} inch 与 ×10 后 = ${fmt(L * 10.0, 4)} mm ` +
            `均为整齐刻度，刻度无法消歧，歧义保持，请人工确认上游导出单位`;
        } else {
          disambiguation = 'no_tick_signal';
          confidence = 'low';
          signals.push(tickLine);
        }
      } else if (cmOk) {
        status = 'suspect_cm';
        suggestedScale = 10;
        suggestedExtents = cmEdges;
        signals = [
          base,
          `×10 换算后最大边 ${fmt(L * 10.0, 2)} mm 落入 ${fmt(lo, 0)}~${fmt(hi, 0)} mm 常见桌面机幅面内，` +
          `且 ×25.4 换算后 ${fmt(L * 25.4, 2)} mm 已超出该区间`,
        ];
        note = '疑似厘米单位（cm）被按毫米读取';
        if (cmTick !== null && inchTick === null) {
          disambiguation = 'cm_preferred';
          confidence = 'high';
          signals.push(
            `刻度吻合：×10 后 = ${fmt(L, 4)} cm（整齐公制刻度，偏差 ${fmt((cmDev ?? 0) * 100, 2)}%），` +
            `而 ×25.4 后 = ${fmt(L * 25.4, 2)} mm 未命中整齐英制刻度，刻度信号支持厘米解释`,
          );
          note +=
            `；刻度信号支持厘米解释：×10 后 = ${fmt(L, 4)} cm` +
            `（整齐公制刻度，偏差 ${fmt((cmDev ?? 0) * 100, 2)}%）`;
        } else {
          signals.push(tickLine);
        }
      } else {
        signals = [
          base,
          `×10 / ×25.4 换算后最大边分别为 ${fmt(L * 10.0, 2)} mm / ${fmt(L * 25.4, 2)} mm，` +
          `均未落入 ${fmt(lo, 0)}~${fmt(hi, 0)} mm 常见幅面内`,
        ];
        note =
          '最大边低于常规零件尺度下限，但两种单位换算后仍不在常见幅面内：可能为占位 / 异常模型，未判定为单位错误';
      }
    } else {
      signals = [
        `最大边 ${fmt(L, 2)} mm 落在 ${fmt(small, 2)}~${fmt(SCALE_GUARD_OVERSIZE_MM, 0)} mm 常规区间内，未命中单位异常档`,
      ];
      note = '尺度与单位未见异常';
      if (L < SCALE_GUARD_ADVISORY_EDGE_MM && inchOk) {
        note +=
          `；提示：最大边小于 ${fmt(SCALE_GUARD_ADVISORY_EDGE_MM, 2)} mm（0.8 in），若上游导出单位为` +
          `英寸，×25.4 后最大边为 ${fmt(L * 25.4, 2)} mm（当前未判定为异常）`;
      }
      signals.push(tickLine);
    }

    // Weak coordinate signal — corroboration only, never verdict-flipping.
    if (
      coordSupport !== null &&
      (coordSupport.bias === 'inch' || coordSupport.bias === 'cm' || coordSupport.bias === 'ambiguous_both')
    ) {
      const cb = coordSupport.bias;
      const cdesc =
        cb === 'inch'
          ? '顶点坐标更吻合 1/16 inch 网格'
          : cb === 'cm'
            ? '顶点坐标更吻合 0.1 mm 网格'
            : '顶点坐标对 1/16 inch 与 0.1 mm 两种网格同样吻合';
      const ir = coordSupport.inchGridRatio;
      const cr = coordSupport.cmGridRatio;
      signals.push(
        `坐标弱信号（来源 ${coordSupport.sourceField}）：${cdesc}（1/16 inch 网格吻合率 ` +
          `${ir === null ? '未采集' : fmt(ir, 4)}，0.1 mm 网格吻合率 ${cr === null ? '未采集' : fmt(cr, 4)}）；仅作旁证，不单独定性`,
      );
    }

    return {
      status,
      maxEdgeMm: roundNum(L, 3),
      signals,
      suggestedScale,
      suggestedExtentsMm: suggestedExtents,
      note,
      tickCheck,
      coordSupport,
      disambiguation,
      confidence,
    };
  } catch (exc) {
    // Read-only health check: no exception may ever affect the pipeline.
    return {
      status: 'ok',
      maxEdgeMm: null,
      signals: [],
      suggestedScale: 1,
      suggestedExtentsMm: [],
      note: `尺度体检未能完成（${exc instanceof Error ? exc.name : typeof exc}），已跳过，不影响分析结论`,
      tickCheck: null,
      coordSupport: null,
      disambiguation: 'n/a',
      confidence: 'n/a',
    };
  }
}

/**
 * Pipeline-facing wrapper: runs the sentinel over a model's bounding-box
 * extents and wraps the result as a standard analysis module result.
 *
 * Returns null only when the model has no usable extents (nothing to check).
 * Confidence is 1.0 because the sentinel is a deterministic, exception-free
 * rule — the fuzziness lives in the result's own `confidence` field, not in
 * whether the module ran.
 */
export function analyzeScaleGuard(
  model: GeometryModel,
  dimensionsMm: readonly number[],
): AnalysisModuleResult<ScaleGuardResult> {
  const result = assessScale(dimensionsMm, model.positions);
  return moduleResult(
    'scaleGuard',
    1.0 as Confidence,
    0,
    result,
    '尺度 / 单位哨兵：只读体检，标注疑似英寸 / 厘米误读与超幅面，绝不自动换算、不参与评分。',
  );
}
