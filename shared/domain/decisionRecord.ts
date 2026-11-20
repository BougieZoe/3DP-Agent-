/**
 * Machine-readable decision contracts.
 *
 * A DecisionRecord is the audit-grade form of one gate rule: the threshold it
 * applied, the value that was measured, the resulting state, and the version
 * of the rule set that produced it. It is intentionally framework-free so the
 * client, the Node bridge and the Go backend can all emit the same shape.
 *
 * Versioning rule: bump RULES_VERSION only when a rule id, its threshold or
 * its penalty changes. Threshold *values* are additionally pinned by
 * `thresholdsHash` on the bundle, so a config override is distinguishable
 * from a code-level rule change.
 */

export const RULES_VERSION = 1;

export type DecisionState = "pass" | "fail" | "unknown";

export type GateRuleId =
  | "shell"
  | "holes"
  | "normals"
  | "degenerate"
  | "thinWall"
  | "lowConfidence"
  | "overhang"
  | "support";

export interface ThresholdSpec {
  /** Comparison operator actually used by the gate writer. */
  op: ">" | ">=" | "<" | "<=" | "=" | "custom";
  /** Primary threshold value. `null` when the rule is composite/boolean. */
  value: number | boolean | null;
  unit?: string;
  /** Exact expression for composite rules (thin wall, support, low confidence). */
  expression?: string;
  /** `config` = thresholds.ts, `gate` = literal inside the score writer. */
  source: "config" | "gate";
}

export interface DecisionRecord {
  ruleId: GateRuleId;
  rulesVersion: number;
  threshold: ThresholdSpec;
  /** Measured value behind the decision; null when the module was absent. */
  measured: number | boolean | string | null;
  unit?: string;
  state: DecisionState;
  /** Score points removed by this rule. 0 for pass/unknown. */
  penalty: number;
  /** Module that produced the measurement (validation / metrics / support). */
  sourceModule: "validation" | "metrics" | "support" | "gate";
  /** Human-readable reason, kept for report copy. Not a substitute for fields above. */
  reason: string;
}

export interface DecisionBundle {
  schema: "decision/1";
  rulesVersion: number;
  /** FNV-1a over the canonical thresholds config used for this run. */
  thresholdsHash: string;
  /** FNV-1a over the canonical analysis inputs used by the gate. */
  inputHash: string;
  score: number;
  light: "green" | "yellow" | "red";
  records: DecisionRecord[];
}

// ─── Forward-compatible reading ──────────────────────────────────────────────
//
// Deleting a field from the contract is only safe if the reader tolerates the
// field's continued presence in records written before the deletion. Without
// this, every historical `decisions.jsonl` becomes unreadable at the exact
// moment the field count changes.

const GATE_RULE_IDS: readonly GateRuleId[] = [
  "shell", "holes", "normals", "degenerate", "thinWall", "lowConfidence", "overhang", "support",
];
const SOURCE_MODULES: readonly DecisionRecord["sourceModule"][] = ["validation", "metrics", "support", "gate"];
const DECISION_STATES: readonly DecisionState[] = ["pass", "fail", "unknown"];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Project one stored record onto the current contract.
 *
 * Known fields are copied, unknown fields (including fields deleted from the
 * contract, like the old topology `degreeCheck`) are dropped in silence.
 * A record missing something required yields a problem string and is skipped —
 * one unreadable row must not poison the rest of the bundle.
 */
function readDecisionRecord(raw: unknown, index: number): { record: DecisionRecord | null; problems: string[] } {
  const src = asRecord(raw);
  if (!src) return { record: null, problems: [`records[${index}] is not an object`] };

  const problems: string[] = [];
  const ruleId = src.ruleId;
  const state = src.state;
  const sourceModule = src.sourceModule;
  const threshold = asRecord(src.threshold);

  if (!GATE_RULE_IDS.includes(ruleId as GateRuleId)) {
    problems.push(`records[${index}].ruleId "${String(ruleId)}" is not a known gate rule`);
  }
  if (!DECISION_STATES.includes(state as DecisionState)) {
    problems.push(`records[${index}].state "${String(state)}" is not pass/fail/unknown`);
  }
  if (!SOURCE_MODULES.includes(sourceModule as DecisionRecord["sourceModule"])) {
    problems.push(`records[${index}].sourceModule "${String(sourceModule)}" is not a known module`);
  }
  if (!threshold || typeof threshold.op !== "string" || typeof threshold.source !== "string") {
    problems.push(`records[${index}].threshold is missing op/source`);
  }
  if (typeof src.rulesVersion !== "number") {
    problems.push(`records[${index}].rulesVersion is not a number`);
  }
  if (typeof src.penalty !== "number") {
    problems.push(`records[${index}].penalty is not a number`);
  }
  if (problems.length > 0) return { record: null, problems };

  const record: DecisionRecord = {
    ruleId: ruleId as GateRuleId,
    rulesVersion: src.rulesVersion as number,
    threshold: {
      op: threshold!.op as ThresholdSpec["op"],
      value: (threshold!.value ?? null) as ThresholdSpec["value"],
      ...(typeof threshold!.unit === "string" ? { unit: threshold!.unit } : {}),
      ...(typeof threshold!.expression === "string" ? { expression: threshold!.expression } : {}),
      source: threshold!.source as ThresholdSpec["source"],
    },
    measured:
      typeof src.measured === "number" || typeof src.measured === "boolean" || typeof src.measured === "string"
        ? src.measured
        : null,
    ...(typeof src.unit === "string" ? { unit: src.unit } : {}),
    state: state as DecisionState,
    penalty: src.penalty as number,
    sourceModule: sourceModule as DecisionRecord["sourceModule"],
    reason: typeof src.reason === "string" ? src.reason : "",
  };
  return { record, problems: [] };
}

/**
 * Read a persisted bundle without rejecting it for field drift.
 *
 * Returns `bundle: null` only when the envelope itself is unusable (not an
 * object, wrong schema). Record-level surprises degrade to `problems`, so a
 * reader can show "3 of 9 rules unreadable" instead of failing the whole load.
 */
export function readDecisionBundle(raw: unknown): { bundle: DecisionBundle | null; problems: string[] } {
  const src = asRecord(raw);
  if (!src) return { bundle: null, problems: ["bundle is not an object"] };
  if (src.schema !== "decision/1") {
    return { bundle: null, problems: [`bundle.schema is ${String(src.schema)}, expected decision/1`] };
  }

  const problems: string[] = [];
  const numeric = (key: keyof DecisionBundle): number => {
    if (typeof src[key] !== "number") {
      problems.push(`bundle.${String(key)} is not a number`);
      return 0;
    }
    return src[key] as number;
  };
  const text = (key: keyof DecisionBundle): string => {
    if (typeof src[key] !== "string") {
      problems.push(`bundle.${String(key)} is not a string`);
      return "";
    }
    return src[key] as string;
  };

  const records: DecisionRecord[] = [];
  const rawRecords = Array.isArray(src.records) ? src.records : [];
  if (!Array.isArray(src.records)) problems.push("bundle.records is not an array");
  rawRecords.forEach((entry, i) => {
    const read = readDecisionRecord(entry, i);
    problems.push(...read.problems);
    if (read.record) records.push(read.record);
  });

  const light = src.light;
  return {
    bundle: {
      schema: "decision/1",
      rulesVersion: numeric("rulesVersion"),
      thresholdsHash: text("thresholdsHash"),
      inputHash: text("inputHash"),
      score: numeric("score"),
      light: light === "green" || light === "yellow" || light === "red" ? light : "red",
      records,
    },
    problems,
  };
}
