import { beforeEach, describe, it, expect } from "vitest";
import {
  calibrationKey,
  clearCalibration,
  getCalibrationReport,
  recordCalibrationOutcome,
  type CalibrationContext,
} from "../printFeedback";

const ctx: CalibrationContext = {
  fileHash: 'abc123',
  rulesVersion: 1,
  thresholdsHash: 'deadbeef',
  inputHash: 'cafebabe',
  material: 'PLA',
  machine: 'x1c',
  slicerProfile: '0.2mm',
};

function record(confidence: number, outcome: 'ok' | 'issue' | 'fail', verdict = 'PASS') {
  recordCalibrationOutcome({ ...ctx, confidence, verdict, outcome });
}

describe("versioned print calibration", () => {
  beforeEach(() => localStorage.clear());

  it("keeps unknown as unknown when samples are too few", () => {
    record(0.85, 'ok');
    record(0.85, 'fail');
    const report = getCalibrationReport(ctx);
    expect(report.schema).toBe('calibration/1');
    expect(report.key).toBe(calibrationKey(ctx));
    expect(report.total).toBe(2);
    expect(report.state).toBe('unknown');
    expect(report.overallRate).toBeNull();
    expect(report.suggestion).toBeNull();
    expect(report.buckets.find((b) => b.band === 'high')!.state).toBe('unknown');
    expect(report.buckets.find((b) => b.band === 'high')!.rate).toBeNull();
  });

  it("reports measured rates once enough samples exist", () => {
    for (let i = 0; i < 5; i++) record(0.2, 'ok', 'WARN');
    for (let i = 0; i < 5; i++) record(0.8, i < 3 ? 'ok' : 'fail', 'PASS');

    const report = getCalibrationReport(ctx);
    expect(report.state).toBe('measured');
    expect(report.total).toBe(10);
    expect(report.overallRate).toBeCloseTo(0.8);

    const low = report.buckets.find((b) => b.band === 'low')!;
    expect(low.state).toBe('measured');
    expect(low.rate).toBe(1);
    const high = report.buckets.find((b) => b.band === 'high')!;
    expect(high.rate).toBeCloseTo(0.6);
  });

  it("does not mix outcomes from a different score writer", () => {
    for (let i = 0; i < 10; i++) {
      recordCalibrationOutcome({
        ...ctx,
        source: 'cad-confidence',
        confidence: 0.8,
        verdict: 'PASS',
        outcome: 'ok',
      });
    }

    expect(getCalibrationReport({ ...ctx, source: 'cad-confidence' }).total).toBe(10);
    expect(getCalibrationReport({ ...ctx, source: 'report-gate' }).total).toBe(0);
  });

  it("does not mix outcomes from a different rule set or threshold config", () => {
    for (let i = 0; i < 10; i++) record(0.8, 'ok');

    const otherRules = getCalibrationReport({ ...ctx, rulesVersion: 2 });
    expect(otherRules.total).toBe(0);
    expect(otherRules.state).toBe('unknown');

    const otherThresholds = getCalibrationReport({ ...ctx, thresholdsHash: 'feedface' });
    expect(otherThresholds.total).toBe(0);
    expect(otherThresholds.state).toBe('unknown');
  });

  it("replaces a corrected report only when a printId is supplied", () => {
    recordCalibrationOutcome({ ...ctx, printId: 'print-1', confidence: 0.9, verdict: 'PASS', outcome: 'ok' });
    recordCalibrationOutcome({ ...ctx, printId: 'print-1', confidence: 0.9, verdict: 'PASS', outcome: 'fail' });
    recordCalibrationOutcome({ ...ctx, printId: 'print-2', confidence: 0.9, verdict: 'WARN', outcome: 'ok' });
    const report = getCalibrationReport(ctx);
    expect(report.total).toBe(2);
  });

  it("suggests review when real success is below 70%, without changing rules", () => {
    for (let i = 0; i < 10; i++) record(0.8, i < 5 ? 'ok' : 'fail');
    const report = getCalibrationReport(ctx);
    expect(report.overallRate).toBe(0.5);
    expect(report.suggestion).toContain('below 70%');

    clearCalibration(ctx);
    expect(getCalibrationReport(ctx).total).toBe(0);
  });
});
