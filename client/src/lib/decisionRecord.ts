/**
 * Machine-readable decision bundle.
 *
 * Single-writer rule: penalty, score and light come from getTrafficLight().
 * This module never recomputes the verdict — it decorates each gate rule with
 * the threshold, measured value and availability state needed to audit or
 * replay it later.
 */

import type { UnifiedAnalysis } from "@/analysis/types";
import { getThresholds, type AnalysisThresholds } from "@/analysis/thresholds";
import { deriveSupportStatus } from "@/analysis/metrics";
import { getTrafficLight, type GateDeduction } from "@/components/reportUtils";
import {
  RULES_VERSION,
  type DecisionBundle,
  type DecisionRecord,
  type GateRuleId,
  type ThresholdSpec,
} from "@shared/domain/decisionRecord";

export { RULES_VERSION };

/** Deterministic key ordering so hashes are stable across object insertion order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** FNV-1a 32-bit, hex. Enough to detect a changed config/input, not for security. */
export function stableHash(value: unknown): string {
  const input = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

const RULE_ORDER: GateRuleId[] = [
  "shell", "holes", "normals", "degenerate",
  "thinWall", "lowConfidence", "overhang", "support",
];

function thresholdFor(
  rule: GateRuleId,
  thresholds: AnalysisThresholds,
): ThresholdSpec {
  const g = thresholds.gate;
  const wt = thresholds.wallThickness.status;
  const oh = thresholds.overhang;
  switch (rule) {
    case "shell":
      return { op: "=", value: true, expression: "isWatertight === true", source: "config" };
    case "holes":
      return { op: ">", value: 0, unit: "holes", source: "config" };
    case "normals":
      return { op: ">", value: g.flippedNormalRatioMax, source: "config" };
    case "degenerate":
      return { op: ">", value: g.degenerateFaceCountMax, unit: "faces", source: "config" };
    case "thinWall":
      return {
        op: "custom",
        value: null,
        expression: `thinWallRatio > ${wt.criticalThinRatio} => critical; > ${wt.warningThinRatio} => warning; p5 < ${wt.warningMinThicknessMm} => warning`,
        source: "config",
      };
    case "lowConfidence":
      return {
        op: "custom",
        value: null,
        expression: `averageConfidence < ${g.lowConfidenceMax} AND thinWallRatio < ${g.lowConfidenceThinRatioMax}`,
        source: "config",
      };
    case "overhang":
      return {
        op: "custom",
        value: null,
        expression: `ratio > ${oh.statusCriticalRatio} => critical; > ${oh.statusWarningRatio} => warning`,
        source: "config",
      };
    case "support":
      return {
        op: "custom",
        value: null,
        expression: "deriveSupportStatus(status) === 'critical' | 'warning'",
        source: "config",
      };
  }
}

function measuredFor(
  rule: GateRuleId,
  analysis: UnifiedAnalysis,
): number | boolean | string | null {
  const v = analysis.validation?.result ?? null;
  const m = analysis.metrics?.result ?? null;
  const s = analysis.support?.result ?? null;
  switch (rule) {
    case "shell": return v ? v.isWatertight : null;
    case "holes": return v?.holeCount ?? null;
    case "normals": return v?.flippedNormalRatio ?? null;
    case "degenerate": return v?.degenerateFaceCount ?? null;
    case "thinWall": return m?.p5WallThicknessMm ?? null;
    case "lowConfidence": return m?.averageConfidence ?? null;
    case "overhang": return m?.overhang.ratio ?? null;
    case "support": return s ? deriveSupportStatus(s).status : null;
  }
}

function moduleFor(rule: GateRuleId): DecisionRecord["sourceModule"] {
  if (rule === "shell" || rule === "holes" || rule === "normals" || rule === "degenerate") return "validation";
  if (rule === "support") return "support";
  return "metrics";
}

function reasonFor(rule: GateRuleId, deduction: GateDeduction | undefined): string {
  if (!deduction) return `${rule}: no deduction`;
  const value = deduction.value === undefined ? "" : ` (${deduction.value})`;
  return `${rule}: penalty ${deduction.penalty}${value}`;
}

/** Only gate-relevant inputs are hashed — never the large sample arrays. */
function gateInputs(analysis: UnifiedAnalysis): unknown {
  const v = analysis.validation?.result;
  const m = analysis.metrics?.result;
  const s = analysis.support?.result;
  return {
    validation: v ? {
      isWatertight: v.isWatertight,
      holeCount: v.holeCount,
      boundaryEdgeCount: v.boundaryEdgeCount,
      flippedNormalRatio: v.flippedNormalRatio,
      degenerateFaceCount: v.degenerateFaceCount,
    } : null,
    metrics: m ? {
      p5WallThicknessMm: m.p5WallThicknessMm,
      thinWallRatio: m.thinWallRatio,
      averageConfidence: m.averageConfidence,
      overhangRatio: m.overhang.ratio,
    } : null,
    support: s ? deriveSupportStatus(s).status : null,
  };
}

export function buildDecisionBundle(
  analysis: UnifiedAnalysis,
  thresholds: AnalysisThresholds = getThresholds(),
): DecisionBundle {
  const { light, score, deductions } = getTrafficLight(analysis, thresholds);
  const byRule = new Map(deductions.map((d) => [d.rule, d]));

  const records: DecisionRecord[] = RULE_ORDER.map((ruleId) => {
    const deduction = byRule.get(ruleId);
    const measured = measuredFor(ruleId, analysis);
    const state = deduction ? "fail" : measured === null ? "unknown" : "pass";
    return {
      ruleId,
      rulesVersion: RULES_VERSION,
      threshold: thresholdFor(ruleId, thresholds),
      measured,
      state,
      penalty: deduction?.penalty ?? 0,
      sourceModule: moduleFor(ruleId),
      reason: reasonFor(ruleId, deduction),
    };
  });

  return {
    schema: "decision/1",
    rulesVersion: RULES_VERSION,
    thresholdsHash: stableHash(thresholds),
    inputHash: stableHash(gateInputs(analysis)),
    score,
    light,
    records,
  };
}
