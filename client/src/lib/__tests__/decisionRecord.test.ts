import { describe, it, expect } from "vitest";
import { getThresholds, validateThresholds } from "@/analysis/thresholds";
import { getTrafficLight } from "@/components/reportUtils";
import {
  buildDecisionBundle,
  RULES_VERSION,
  stableHash,
} from "../decisionRecord";
import { readDecisionBundle } from "@shared/domain/decisionRecord";
import { RULES_VERSION as AUDIT_RULES_VERSION } from "../auditTrail";
import {
  buildMockUnifiedAnalysis,
  normalMetrics,
  normalValidation,
} from "../../agents/__tests__/testAgentFixtures";

describe("decision bundle — machine-readable gate", () => {
  it("keeps the gate config valid and stays in sync with the single score writer", () => {
    expect(validateThresholds()).toEqual([]);

    const ua = buildMockUnifiedAnalysis({
      validation: { ...normalValidation(), isWatertight: false, holeCount: 2 },
      metrics: { ...normalMetrics(), thinWallRatio: 0.5, p5WallThicknessMm: 0.2 },
    });
    const bundle = buildDecisionBundle(ua);
    const gate = getTrafficLight(ua);

    expect(bundle.score).toBe(gate.score);
    expect(bundle.light).toBe(gate.light);

    const failed = bundle.records.filter((r) => r.state === "fail");
    expect(failed.reduce((sum, r) => sum + r.penalty, 0)).toBe(100 - bundle.score);
    for (const d of gate.deductions) {
      expect(
        failed.some((r) => r.ruleId === d.rule && r.penalty === d.penalty),
      ).toBe(true);
    }
  });

  it("emits threshold, measured value and state for every rule", () => {
    const bundle = buildDecisionBundle(buildMockUnifiedAnalysis());
    expect(bundle.schema).toBe("decision/1");
    expect(bundle.rulesVersion).toBe(RULES_VERSION);
    expect(AUDIT_RULES_VERSION).toBe(RULES_VERSION);
    expect(bundle.records).toHaveLength(8);

    const shell = bundle.records.find((r) => r.ruleId === "shell")!;
    expect(shell.threshold.op).toBe("=");
    expect(shell.threshold.value).toBe(true);
    expect(shell.measured).toBe(true);
    expect(shell.state).toBe("pass");

    const normals = bundle.records.find((r) => r.ruleId === "normals")!;
    expect(normals.threshold.value).toBe(
      getThresholds().gate.flippedNormalRatioMax,
    );
    expect(normals.threshold.source).toBe("config");
  });

  it("reports an absent module as unknown, never as pass or fail", () => {
    const ua = buildMockUnifiedAnalysis();
    ua.support = null;
    const bundle = buildDecisionBundle(ua);
    const support = bundle.records.find((r) => r.ruleId === "support")!;
    expect(support.state).toBe("unknown");
    expect(support.measured).toBeNull();
    expect(support.penalty).toBe(0);
  });

  it("hashes are deterministic, key-order independent and config-sensitive", () => {
    const ua = buildMockUnifiedAnalysis();
    const a = buildDecisionBundle(ua);
    const b = buildDecisionBundle(ua);
    expect(a.inputHash).toBe(b.inputHash);
    expect(a.thresholdsHash).toBe(b.thresholdsHash);

    expect(stableHash({ a: 1, b: 2 })).toBe(stableHash({ b: 2, a: 1 }));

    const modified = getThresholds({ gate: { flippedNormalRatioMax: 0.2 } });
    const c = buildDecisionBundle(ua, modified);
    expect(c.thresholdsHash).not.toBe(a.thresholdsHash);
    expect(
      c.records.find((r) => r.ruleId === "normals")!.threshold.value,
    ).toBe(0.2);
  });
});

describe("decision bundle — reading records written by an older build", () => {
  const ua = () => buildMockUnifiedAnalysis({
    validation: { ...normalValidation(), isWatertight: false, holeCount: 2 },
    metrics: { ...normalMetrics(), thinWallRatio: 0.5, p5WallThicknessMm: 0.2 },
  });

  it("reads a round-tripped bundle as a clean file", () => {
    const { bundle, problems } = readDecisionBundle(JSON.parse(JSON.stringify(buildDecisionBundle(ua()))));
    expect(problems).toEqual([]);
    expect(bundle).not.toBeNull();
    expect(bundle!.records.length).toBeGreaterThan(0);
  });

  it("ignores fields the contract no longer has, per record and on the envelope", () => {
    const stored = JSON.parse(JSON.stringify(buildDecisionBundle(ua())));
    // `degreeCheck` was deleted from the topology contract; records and the
    // envelope written before that deletion still carry lookalike extras.
    stored.topologyDegreeCheck = "relaxed";
    stored.records[0].degreeCheck = "strict";
    stored.records[0].someFutureField = { nested: true };

    const { bundle, problems } = readDecisionBundle(stored);
    expect(problems).toEqual([]);
    expect(bundle).not.toBeNull();
    expect(bundle!.records[0]).not.toHaveProperty("degreeCheck");
    expect(bundle!.records[0]).not.toHaveProperty("someFutureField");
  });

  it("degrades one unreadable record instead of failing the whole file", () => {
    const stored = JSON.parse(JSON.stringify(buildDecisionBundle(ua())));
    const total = stored.records.length;
    stored.records.push({ ruleId: "not-a-rule", state: "maybe" });

    const { bundle, problems } = readDecisionBundle(stored);
    expect(bundle).not.toBeNull();
    expect(bundle!.records).toHaveLength(total);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(" ")).toContain("not-a-rule");
  });

  it("refuses an envelope it cannot understand", () => {
    expect(readDecisionBundle(null).bundle).toBeNull();
    expect(readDecisionBundle({ schema: "decision/0" }).bundle).toBeNull();
  });
});
