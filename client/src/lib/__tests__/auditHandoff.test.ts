import { describe, it, expect } from 'vitest';
import { buildAuditTrail, RULES_VERSION } from '../auditTrail';
import { buildHandoffJson } from '../handoffJson';
import { cheapestStep } from '../cheapestStep';
import { buildQuoteText } from '../handoffPack';
import { TOPOLOGY_PROFILES } from '@/analysis/topologyProfiles';
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

describe('cheapestStep single writer', () => {
  it('quote text, handoff.json and the rule agree on every fixture', () => {
    const open = buildMockUnifiedAnalysis({
      metrics: { ...normalMetrics(), meshVolumeMm3: 0, volumeReliable: false },
      validation: { ...normalValidation(), isWatertight: false, holeCount: 1 },
    });
    const closed = buildMockUnifiedAnalysis({
      metrics: normalMetrics(),
      validation: normalValidation(),
    });
    expect(cheapestStep(open)).toBe('repair');
    expect(buildHandoffJson(open, 'o.stl', { process: 'FDM', material: 'PLA' }).cheapestStep).toBe('repair');
    expect(buildQuoteText(open, 'o.stl', 'en')).toContain('mesh repair');
    const cs = cheapestStep(closed);
    expect(buildHandoffJson(closed, 'c.stl', { process: 'FDM', material: 'PLA' }).cheapestStep).toBe(cs);
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

describe('audit trail — configuration baseline', () => {
  const ua = buildMockUnifiedAnalysis({});
  const withProfile = (profile: unknown) => ({ ...ua, topologyProfile: { profile } as never });

  it('stamps a baseline id on every trail', () => {
    const trail = buildAuditTrail(ua);
    expect(trail.configBaselineId).toBeTruthy();
    expect(trail.configBaselineId).toContain('@');
  });

  it('keeps the id stable for the same configuration', () => {
    expect(buildAuditTrail(ua).configBaselineId).toBe(buildAuditTrail(ua).configBaselineId);
  });

  it('changes the id when the profile changes', () => {
    const a = buildAuditTrail(withProfile(TOPOLOGY_PROFILES['cad:tri'])).configBaselineId;
    const b = buildAuditTrail(withProfile(TOPOLOGY_PROFILES['ai-generation:quad'])).configBaselineId;
    expect(a).not.toBe(b);
  });

  it('changes the id when the same profile resolves different thresholds', () => {
    // The whole point of hashing the resolved thresholds: a config override must
    // not hide behind an unchanged profile id.
    const base = TOPOLOGY_PROFILES['cad:tri'];
    const overridden = { ...base, thresholds: { overhangThresholdDeg: 45 } };
    const a = buildAuditTrail(withProfile(base)).configBaselineId;
    const b = buildAuditTrail(withProfile(overridden)).configBaselineId;
    expect(a.startsWith('cad:tri@')).toBe(true);
    expect(b.startsWith('cad:tri@')).toBe(true);
    expect(a).not.toBe(b);
  });

  it('leaves rows inheriting the trail baseline by default', () => {
    const trail = buildAuditTrail(ua);
    expect(trail.rows.every((r) => r.configBaselineId === undefined)).toBe(true);
  });
});
