import { describe, it, expect } from 'vitest';
import { parseRequirements } from '../requirementAgent';

describe('RequirementAgent — rule-based parser', () => {
  it('extracts all fields from a complete request', () => {
    const result = parseRequirements(
      '我需要500个FGF打印的PLA+零件，尺寸大概是800 x 600 x 400mm，预算不超过5万元',
    );
    expect(result.material).toBe('PLA');
    expect(result.buildSizeMm).toEqual({ widthMm: 800, depthMm: 600, heightMm: 400 });
    expect(result.quantity).toBe(500);
    expect(result.processHint).toBe('FGF');
    expect(result.budgetRange).toBeDefined();
    expect(result.confidence).toBe(1);
    expect(result.missingFields).toHaveLength(0);
  });

  it('returns low confidence and accurate missing fields for sparse input', () => {
    const result = parseRequirements('我需要打印几个ABS零件');
    expect(result.material).toBe('ABS');
    expect(result.quantity).toBeUndefined();
    expect(result.buildSizeMm).toBeUndefined();
    expect(result.budgetRange).toBeUndefined();
    expect(result.processHint).toBeUndefined();
    expect(result.confidence).toBeLessThan(0.5);
    expect(result.missingFields).toContain('buildSizeMm');
    expect(result.missingFields).toContain('budgetRange');
    expect(result.missingFields).toContain('quantity');
    expect(result.missingFields).toContain('processHint');
  });

  it('returns empty fields and zero confidence for irrelevant text', () => {
    const result = parseRequirements('你好，最近天气不错');
    expect(result.material).toBeUndefined();
    expect(result.buildSizeMm).toBeUndefined();
    expect(result.budgetRange).toBeUndefined();
    expect(result.quantity).toBeUndefined();
    expect(result.processHint).toBeUndefined();
    expect(result.confidence).toBe(0);
    expect(result.missingFields).toHaveLength(5);
  });
});
