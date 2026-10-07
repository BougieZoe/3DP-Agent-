import { describe, it, expect } from 'vitest';
import { buildAuditTrail, RULES_VERSION } from '../auditTrail';
import { buildHandoffJson } from '../handoffJson';
import {
  buildMockUnifiedAnalysis,
  normalMetrics,
  normalValidation,
} from '../../agents/__tests__/testAgentFixtures';

describe('buildAuditTrail', () => {
  it('stays in sync with the score: deductions + score == 100', () => {
    for (const ua of [
      buildMockUnifiedAnalysis({ metrics: normalMetrics(), validation: normalValidation() }),
      buildMockUnifiedAnalysis({
        metrics: { ...normalMetrics(), meshVolumeMm3: 0, volumeReliable: false },
        validation: { ...normalValidation(), isWatertight: false, holeCount: 1 },
      }),
    ]) {
      const t = buildAuditTrail(ua);
      expect(t.rulesVersion).toBe(RULES_VERSION);
      expect(t.rows.length).toBeGreaterThan(0);
      if (t.score > 0) {
        const ded = t.rows.reduce((s, r) => s + r.deduction, 0);
        expect(100 - ded).toBe(t.score);
      }
    }
  });

  it('flags open shells as WATERTIGHT fail', () => {
    const ua = buildMockUnifiedAnalysis({
      validation: { ...normalValidation(), isWatertight: false, holeCount: 2 },
    });
    const t = buildAuditTrail(ua);
    const w = t.rows.find((r) => r.rule === 'WATERTIGHT');
    expect(w?.status).toBe('fail');
    expect(w?.deduction).toBe(30);
  });
});

describe('buildHandoffJson', () => {
  it('emits schema handoff/1 with blocked estimates for open shells', () => {
    const ua = buildMockUnifiedAnalysis({
      metrics: { ...normalMetrics(), meshVolumeMm3: 0, volumeReliable: false },
      validation: { ...normalValidation(), isWatertight: false, holeCount: 1 },
    });
    const j = buildHandoffJson(ua, 'open.stl', { process: 'FDM', material: 'PLA' });
    expect(j.schema).toBe('handoff/1');
    expect(j.estimates.blocked).toBe(true);
    expect(j.estimates.weightG).toBeNull();
    expect(j.geometry.watertight).toBe(false);
    expect(j.cheapestStep).toBe('repair');
    expect(j.audit.rows.length).toBeGreaterThan(0);
  });
});
