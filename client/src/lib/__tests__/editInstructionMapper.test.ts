import { describe, it, expect } from 'vitest';
import {
  mapIssueToSnippet,
  generateEditPlan,
  wrapEditPlanAsGenerator,
  getSupportedFixTypes,
  hasRuleBasedFix,
  type DfamIssue,
} from '../editInstructionMapper';

describe('editInstructionMapper', () => {
  describe('mapIssueToSnippet', () => {
    it('generates thin wall fix code', () => {
      const issue: DfamIssue = {
        type: 'thin_wall',
        description: 'Wall thickness 0.7mm below minimum 1.5mm',
        currentValue: 0.7,
        targetValue: 1.5,
      };
      const snippet = mapIssueToSnippet(issue);
      expect(snippet).not.toBeNull();
      expect(snippet!.issueType).toBe('thin_wall');
      expect(snippet!.code).toContain('offset');
      expect(snippet!.code).toContain('0.80');
    });

    it('generates overhang fix code', () => {
      const issue: DfamIssue = {
        type: 'overhang',
        description: '72° overhang detected',
      };
      const snippet = mapIssueToSnippet(issue);
      expect(snippet).not.toBeNull();
      expect(snippet!.code).toContain('rib');
    });

    it('generates stress concentration fix code', () => {
      const issue: DfamIssue = {
        type: 'fillet_add',
        description: 'Sharp internal corner detected',
      };
      const snippet = mapIssueToSnippet(issue);
      expect(snippet).not.toBeNull();
      expect(snippet!.code).toContain('fillet');
    });

    it('returns null for unknown issue type', () => {
      const issue: DfamIssue = {
        type: 'unknown_future_issue',
        description: 'Something we do not handle yet',
      };
      const snippet = mapIssueToSnippet(issue);
      expect(snippet).toBeNull();
    });

    it('uses default target thickness when not provided', () => {
      const issue: DfamIssue = {
        type: 'thin_wall',
        description: 'Wall too thin',
      };
      const snippet = mapIssueToSnippet(issue);
      expect(snippet).not.toBeNull();
      // Default target is 1.5mm, current is 1.0mm → delta 0.5mm
      expect(snippet!.code).toContain('0.50');
    });
  });

  describe('generateEditPlan', () => {
    it('produces plan from mixed issue types', () => {
      const issues: DfamIssue[] = [
        { type: 'thin_wall', description: 'Wall too thin', priority: 'high' },
        { type: 'overhang', description: 'Overhang detected', priority: 'medium' },
        { type: 'fillet_add', description: 'Sharp corner', priority: 'low' },
      ];
      const plan = generateEditPlan(issues);
      expect(plan.snippets.length).toBe(3);
      expect(plan.combinedCode).toContain('offset');
      expect(plan.combinedCode).toContain('rib');
      expect(plan.combinedCode).toContain('fillet');
      expect(plan.requiresRegeneration).toBe(false);
    });

    it('marks regeneration needed for unmapped issues', () => {
      const issues: DfamIssue[] = [
        { type: 'unknown_type', description: 'Unknown problem' },
      ];
      const plan = generateEditPlan(issues);
      expect(plan.snippets.length).toBe(0);
      expect(plan.requiresRegeneration).toBe(true);
    });

    it('deduplicates by issue type keeping highest priority', () => {
      const issues: DfamIssue[] = [
        { type: 'thin_wall', description: 'Low priority', priority: 'low' },
        { type: 'thin_wall', description: 'High priority', priority: 'high' },
      ];
      const plan = generateEditPlan(issues);
      expect(plan.snippets.length).toBe(1);
    });

    it('sorts by priority descending', () => {
      const issues: DfamIssue[] = [
        { type: 'overhang', description: 'Low', priority: 'low' },
        { type: 'thin_wall', description: 'Critical', priority: 'critical' },
        { type: 'fillet_add', description: 'Medium', priority: 'medium' },
      ];
      const plan = generateEditPlan(issues);
      expect(plan.snippets[0].issueType).toBe('thin_wall');
      expect(plan.snippets[1].issueType).toBe('stress_concentration');
      expect(plan.snippets[2].issueType).toBe('overhang');
    });

    it('returns empty plan for empty issues', () => {
      const plan = generateEditPlan([]);
      expect(plan.snippets.length).toBe(0);
      expect(plan.combinedCode).toBe('');
    });
  });

  describe('wrapEditPlanAsGenerator', () => {
    it('produces valid Python source', () => {
      const plan = generateEditPlan([
        { type: 'thin_wall', description: 'Wall too thin' },
      ]);
      const source = wrapEditPlanAsGenerator(plan, 'test bracket');
      expect(source).toContain('from build123d import *');
      expect(source).toContain('def gen_step()');
      expect(source).toContain('return part');
      expect(source).toContain('test bracket');
    });
  });

  describe('getSupportedFixTypes', () => {
    it('returns non-empty list', () => {
      const types = getSupportedFixTypes();
      expect(types.length).toBeGreaterThan(0);
      expect(types).toContain('thin_wall');
      expect(types).toContain('overhang');
      expect(types).toContain('fillet_add');
    });
  });

  describe('hasRuleBasedFix', () => {
    it('returns true for known types', () => {
      expect(hasRuleBasedFix('thin_wall')).toBe(true);
      expect(hasRuleBasedFix('overhang')).toBe(true);
      expect(hasRuleBasedFix('warping')).toBe(true);
    });

    it('returns false for unknown types', () => {
      expect(hasRuleBasedFix('future_foo')).toBe(false);
    });
  });
});
