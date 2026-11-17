// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from 'vitest';
import {
  getCalibrationReport,
  getPrintStats,
  recordAnalysisOutcome,
  recordCalibrationOutcome,
  type CalibrationContext,
} from '../printFeedback';
import type { AnalysisRecord } from '../analysisRecord';
import { captureFeedback } from '../feedback';

const ctx: CalibrationContext = {
  fileHash: 'test-file',
  rulesVersion: 1,
  thresholdsHash: 'thresholds',
  inputHash: 'input',
};

function record(confidence: number, verdict: string, outcome: 'ok' | 'issue' | 'fail') {
  recordCalibrationOutcome({ ...ctx, confidence, verdict, outcome });
}


function makeRecord(over: Partial<AnalysisRecord> = {}): AnalysisRecord {
  return {
    schemaVersion: 3,
    id: 'rec-1',
    createdAt: '2026-11-18T00:00:00.000Z',
    model: {
      fileName: 'part.stl',
      fileHash: 'record-file',
      format: 'stl',
      units: 'mm',
      fileSizeBytes: 1234,
    },
    context: {
      material: 'PLA',
      materialFamily: 'FDM',
      printerId: 'x1c',
      layerHeightMm: 0.2,
      process: null,
    },
    analyzer: { rulesVersion: 1, thresholdsHash: 'thresholds', inputHash: 'gate-input' },
    geometry: {
      dimensionsMm: { x: 20, y: 20, z: 20 },
      volumeMm3: 8000,
      volumeReliable: true,
      surfaceAreaMm2: 2400,
      isWatertight: true,
      holeCount: 0,
      minWallThicknessMm: 2,
      p5WallThicknessMm: 1.8,
      thinWallRatio: 0,
      overhangRatio: 0,
    },
    findings: [],
    score: { value: 100, light: 'green', rulesVersion: 1 },
    overallConfidence: 0.82,
    slicer: null,
    repair: null,
    decision: null,
    outcome: {
      status: 'success',
      recordedAt: '2026-11-18T01:00:00.000Z',
      failureLayer: null,
      failureType: null,
      failureMode: null,
      actualSettings: null,
      notes: null,
    },
    ...over,
  };
}

const recordCtx: CalibrationContext = {
  fileHash: 'record-file',
  rulesVersion: 1,
  thresholdsHash: 'thresholds',
  inputHash: 'gate-input',
  source: 'analysis-record',
  material: 'PLA',
  machine: 'x1c',
};

describe('printFeedback', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('aggregates the versioned calibration store', () => {
    record(0.82, 'PASS', 'ok');
    record(0.6, 'WARN', 'issue');
    record(0.45, 'FAIL', 'fail');

    const stats = getPrintStats();
    expect(stats.count).toBe(3);
    expect(stats.okRate).toBeCloseTo(1 / 3);
    expect(stats.byVerdict.pass).toEqual({ total: 1, ok: 1 });
  });

  it('returns empty stats when nothing is recorded', () => {
    const stats = getPrintStats();
    expect(stats.count).toBe(0);
    expect(stats.okRate).toBeNull();
  });

  it('migrates the old unversioned list exactly once', () => {
    localStorage.setItem('3dp.printFeedback', JSON.stringify([
      { confidence: 82, verdict: 'PASS', outcome: 'ok', timestamp: 1 },
      { confidence: 0.4, verdict: 'FAIL', outcome: 'fail', timestamp: 2 },
      { confidence: 50, verdict: 'WARN', outcome: 'issue', timestamp: 3 },
    ]));

    expect(getPrintStats().count).toBe(3);
    expect(localStorage.getItem('3dp.printFeedback')).toBeNull();
    expect(getPrintStats().count).toBe(3);
  });

  it('does not treat product feedback as a print outcome', () => {
    captureFeedback('Bug report', 'Button is broken', 'bug');
    expect(getPrintStats().count).toBe(0);
  });

  it('bridges a record outcome with the record id as printId', () => {
    recordAnalysisOutcome(makeRecord());

    const report = getCalibrationReport(recordCtx);
    expect(report.total).toBe(1);
    expect(report.buckets.find((b) => b.band === 'high')!.okCount).toBe(1);
    expect(getPrintStats().byVerdict.pass).toEqual({ total: 1, ok: 1 });
  });

  it('replaces a corrected record instead of duplicating the print', () => {
    recordAnalysisOutcome(makeRecord());
    recordAnalysisOutcome(makeRecord({ outcome: { ...makeRecord().outcome, status: 'failure' } }));

    expect(getCalibrationReport(recordCtx).total).toBe(1);
    expect(getPrintStats().byVerdict.pass).toEqual({ total: 1, ok: 0 });
  });

  it('removes the calibration point when the record is reset to not tested', () => {
    recordAnalysisOutcome(makeRecord());
    expect(getPrintStats().count).toBe(1);

    recordAnalysisOutcome(makeRecord({ outcome: { ...makeRecord().outcome, status: 'not_tested' } }));
    expect(getPrintStats().count).toBe(0);
  });

  it('keeps distinct analysis runs as distinct calibration points', () => {
    recordAnalysisOutcome(makeRecord({ id: 'rec-1' }));
    recordAnalysisOutcome(makeRecord({ id: 'rec-2' }));

    expect(getCalibrationReport(recordCtx).total).toBe(2);
  });
});
