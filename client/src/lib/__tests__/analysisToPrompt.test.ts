import { describe, it, expect } from 'vitest';
import {
  issuesToEditInstruction,
  issuesToFullPrompt,
  prioritizeIssues,
  type DfamIssue,
} from '../analysisToPrompt';

describe('analysisToPrompt', () => {
  const thinWallIssue: DfamIssue = {
    type: 'wall_thickening',
    priority: 'critical',
    description: 'Wall thickness 0.7mm is below minimum 1.5mm',
    implementation: 'Add 0.8mm offset to all thin walls',
  };

  const overhangIssue: DfamIssue = {
    type: 'overhang',
    priority: 'high',
    description: '72° overhang exceeds 45° threshold',
    recommendation: 'Rotate model 32° to reduce overhang',
  };

  const supportIssue: DfamIssue = {
    type: 'support_addition',
    priority: 'medium',
    description: 'Large unsupported span detected',
    implementation: 'Add support pillars under overhangs',
  };

  it('converts issues to edit instruction', () => {
    const result = issuesToEditInstruction([thinWallIssue, overhangIssue]);
    expect(result).toContain('Fix the following DfAM issues');
    expect(result).toContain('Increase wall thickness');
    expect(result).toContain('Reduce overhangs');
    expect(result).toContain('Preserve the original design intent');
  });

  it('returns empty string for no issues', () => {
    expect(issuesToEditInstruction([])).toBe('');
  });

  it('deduplicates by category', () => {
    const duplicate: DfamIssue = {
      type: 'wall_thickening',
      priority: 'high',
      description: 'Another thin wall issue',
    };
    const result = issuesToEditInstruction([thinWallIssue, duplicate]);
    // Should only have one wall_thickness action
    const wallMatches = result.match(/Increase wall thickness/g);
    expect(wallMatches?.length).toBe(1);
  });

  it('handles unknown issue types with fallback', () => {
    const unknown: DfamIssue = {
      type: 'custom_issue',
      description: 'Something unusual',
      recommendation: 'Do something about it',
    };
    const result = issuesToEditInstruction([unknown]);
    expect(result).toContain('Do something about it');
  });

  it('composes full prompt with issues', () => {
    const result = issuesToFullPrompt('A bracket', [thinWallIssue]);
    expect(result).toContain('A bracket');
    expect(result).toContain('CRITICAL MANUFACTURING REQUIREMENTS');
    expect(result).toContain('Increase wall thickness');
  });

  it('returns original prompt when no issues', () => {
    expect(issuesToFullPrompt('A bracket', [])).toBe('A bracket');
  });

  it('prioritizes issues by severity', () => {
    const low: DfamIssue = { type: 'hole_fill', priority: 'low', description: 'Minor' };
    const critical: DfamIssue = { type: 'wall_thickening', priority: 'critical', description: 'Major' };
    const medium: DfamIssue = { type: 'overhang', priority: 'medium', description: 'Medium' };

    const result = prioritizeIssues([low, critical, medium], 2);
    expect(result).toHaveLength(2);
    expect(result[0].priority).toBe('critical');
    expect(result[1].priority).toBe('medium');
  });

  it('limits to maxCount', () => {
    const issues: DfamIssue[] = Array.from({ length: 10 }, (_, i) => ({
      type: `type_${i}`,
      priority: 'medium' as const,
      description: `Issue ${i}`,
    }));
    const result = prioritizeIssues(issues, 3);
    expect(result).toHaveLength(3);
  });
});
