import { describe, expect, it } from 'vitest';
import { buildExpertContext, buildExpertSystemPrompt, objectContextLabel, parseExpertReview } from '../expertReview';
import type { ModelData } from '@/lib/ruleEngine';
import type { Material } from '@shared/domain/material';

const PLA: Material = {
  name: 'PLA', technology: 'fdm',
  category: 'Thermoplastic filament',
  description: 'test', useCase: 'test',
  overhangThreshold: 50, densityGPerCm3: 1.24, pricePerKgUsd: 22,
};

const RESIN: Material = {
  name: 'Standard Resin', technology: 'sla',
  category: 'UV-cured liquid photopolymer',
  description: 'test', useCase: 'test',
  overhangThreshold: 40, densityGPerCm3: 1.15, pricePerKgUsd: 60,
};

function sampleModel(): ModelData {
  return {
    fileName: 'cube.stl',
    wallThickness: {
      minThickness: 0.8, p1Thickness: 0.8, p5Thickness: 0.9, p10Thickness: 1.0,
      medianThickness: 2.0, avgThickness: 1.9,
      thinWallCount: 3, thinWallPercentage: 0.05, thinWallRatio: 0.05, averageConfidence: 0.9,
      areas: 12, status: 'warning',
    },
    overhang: { angle: 50, areas: 42, status: 'warning' },
    volume: 1000, surfaceArea: 600,
    dims: { x: 10, y: 10, z: 10 },
  };
}

describe('objectContextLabel', () => {
  it('labels each object context', () => {
    expect(objectContextLabel('general')).toBe('general-purpose');
    expect(objectContextLabel('structural')).toContain('structural');
    expect(objectContextLabel('large')).toContain('construction');
    expect(objectContextLabel('detailed')).toContain('fine-feature');
  });
});

describe('buildExpertContext', () => {
  it('includes material family label, object context and material metrics', () => {
    const ctx = buildExpertContext(sampleModel(), RESIN, 'detailed', 'islands: 2, suctionRisk: 60%');
    expect(ctx).toContain('SLA/DLP resin');
    expect(ctx).toContain('fine-feature');
    expect(ctx).toContain('islands: 2');
    expect(ctx).toContain('status=warning');
  });

  it('labels the material family per technology', () => {
    expect(buildExpertContext(sampleModel(), PLA, 'general')).toContain('FDM/FFF filament');
    expect(buildExpertContext(sampleModel(), RESIN, 'general')).toContain('SLA/DLP resin');
  });
});

describe('buildExpertSystemPrompt', () => {
  it('picks the SLA persona for resin material', () => {
    const prompt = buildExpertSystemPrompt('sla', 'general');
    expect(prompt).toContain('suction forces');
    expect(prompt).toContain('floating islands');
    expect(prompt).toContain('drain holes');
  });

  it('picks the FGF persona for pellet material', () => {
    const prompt = buildExpertSystemPrompt('fgf', 'large');
    expect(prompt).toContain('warpage');
    expect(prompt).toContain('delamination');
    expect(prompt).toContain('slenderness');
    expect(prompt).toContain('construction-scale');
  });

  it('picks the FDM persona by default', () => {
    const prompt = buildExpertSystemPrompt('fdm', 'structural');
    expect(prompt).toContain('overhang');
    expect(prompt).toContain('layer adhesion');
    expect(prompt).toContain('load-bearing');
  });

  it('always enforces the rule-engine priority and JSON-only contract', () => {
    const prompt = buildExpertSystemPrompt('fdm', 'general');
    expect(prompt).toContain('ground truth');
    expect(prompt).toContain('JSON only');
    expect(prompt).toContain('verdict');
  });
});

describe('parseExpertReview', () => {
  it('parses a well-formed response', () => {
    const raw = JSON.stringify({
      verdict: 'warning',
      plain: 'Your thinnest wall is 0.8mm — that is 40% below the 2mm rule of thumb.',
      findings: [{ what: 'Thin wall', why: 'Brittle under load', severity: 'high' }],
      actions: [{ do: 'Increase wall to 2mm', impact: 'high', effort: 'medium' }],
    });
    const review = parseExpertReview(raw);
    expect(review).not.toBeNull();
    expect(review!.verdict).toBe('warning');
    expect(review!.plain).toContain('0.8mm');
    expect(review!.findings).toHaveLength(1);
    expect(review!.findings[0].severity).toBe('high');
    expect(review!.actions[0].impact).toBe('high');
  });

  it('tolerates markdown fences around the JSON', () => {
    const raw = '```json\n{"verdict":"pass","plain":"Looks good.","findings":[],"actions":[]}\n```';
    const review = parseExpertReview(raw);
    expect(review).not.toBeNull();
    expect(review!.verdict).toBe('pass');
  });

  it('clamps an invalid verdict to warning', () => {
    const raw = '{"verdict":"excellent","plain":"ok","findings":[],"actions":[]}';
    expect(parseExpertReview(raw)!.verdict).toBe('warning');
  });

  it('rejects output with no plain text', () => {
    expect(parseExpertReview('{"verdict":"pass","findings":[]}')).toBeNull();
    expect(parseExpertReview('not json at all')).toBeNull();
  });

  it('normalizes severity/impact enums and drops malformed entries', () => {
    const raw = JSON.stringify({
      verdict: 'fail',
      plain: 'n',
      findings: [{ what: 'A', why: 'B', severity: 'bogus' }, { severity: 'high' }],
      actions: [{ do: 'X', impact: 'low', effort: 'high' }, 'junk'],
    });
    const review = parseExpertReview(raw)!;
    expect(review.findings[0].severity).toBe('medium'); // unknown → medium
    expect(review.actions).toHaveLength(1);            // string entry dropped
    expect(review.actions[0].effort).toBe('high');
  });
});
