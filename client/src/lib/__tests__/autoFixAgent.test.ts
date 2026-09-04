import { describe, it, expect } from 'vitest';
import { composeFixPlan, evaluateConvergence, CONVERGENCE_THRESHOLD, MAX_FIX_ITERATIONS } from '../autoFixAgent';
import type { CADConfidenceReport, Issue } from '@/cad-confidence/types';

function buildReport(overrides?: Partial<CADConfidenceReport>): CADConfidenceReport {
  return {
    overallScore: 45,
    verdict: 'FAIL',
    categories: [],
    semanticChecks: [],
    repairSuggestions: [],
    timestamp: new Date().toISOString(),
    generationQuality: 'SUCCESS',
    ...overrides,
  };
}

describe('autoFixAgent', () => {
  describe('composeFixPlan', () => {
    it('skips fix when score is above threshold', () => {
      const report = buildReport({ overallScore: 80, verdict: 'PASS' });
      const plan = composeFixPlan(report, [], 'a bracket', 0);
      expect(plan.shouldFix).toBe(false);
      expect(plan.reason).toContain('no fix needed');
    });

    it('skips fix at max iterations', () => {
      const report = buildReport({ overallScore: 40, verdict: 'FAIL' });
      const plan = composeFixPlan(report, [], 'a bracket', MAX_FIX_ITERATIONS);
      expect(plan.shouldFix).toBe(false);
      expect(plan.reason).toContain('Max iterations');
    });

    it('generates fix plan when score is below threshold', () => {
      const report = buildReport({ overallScore: 45, verdict: 'FAIL' });
      const issues: Issue[] = [
        { severity: 'error', message: 'Thin wall at 0.7mm', suggestion: 'Thicken to 1.5mm' },
      ];
      const plan = composeFixPlan(report, issues, 'a bracket', 0);
      expect(plan.shouldFix).toBe(true);
      expect(plan.iteration).toBe(1);
      expect(plan.editInstruction).toContain('Fix the following DfAM issues');
      expect(plan.analysisContext.printabilityScore).toBe(45);
    });

    it('includes repair suggestions in fix plan', () => {
      const report = buildReport({
        overallScore: 50,
        verdict: 'WARN',
        repairSuggestions: [
          { action: 'Rotate 30°', description: 'Reduce overhang', impact: 'high', category: 'overhang' },
        ],
      });
      const plan = composeFixPlan(report, [], 'a part', 0);
      expect(plan.shouldFix).toBe(true);
      expect(plan.editInstruction).toContain('Reduce overhang');
    });

    it('increments iteration counter', () => {
      const report = buildReport({ overallScore: 40, verdict: 'FAIL' });
      const plan = composeFixPlan(report, [], 'a bracket', 2);
      expect(plan.iteration).toBe(3);
    });
  });

  describe('evaluateConvergence', () => {
    it('converges when verdict is PASS', () => {
      const result = evaluateConvergence(45, 78, 1, 'PASS', []);
      expect(result.converged).toBe(true);
      expect(result.improvement).toBe(33);
    });

    it('converges when score exceeds threshold', () => {
      const result = evaluateConvergence(45, CONVERGENCE_THRESHOLD + 5, 1, 'WARN', []);
      expect(result.converged).toBe(true);
    });

    it('converges when improvement is too small (stagnation)', () => {
      const result = evaluateConvergence(45, 48, 1, 'FAIL', []);
      expect(result.converged).toBe(true);
      expect(result.improvement).toBe(3);
    });

    it('converges at max iterations even if not improved', () => {
      const result = evaluateConvergence(45, 45, MAX_FIX_ITERATIONS, 'FAIL', []);
      expect(result.converged).toBe(true);
    });

    it('tracks iteration and issues', () => {
      const issues: Issue[] = [{ severity: 'warning', message: 'Still has overhang' }];
      const result = evaluateConvergence(45, 60, 2, 'WARN', issues);
      expect(result.iteration).toBe(2);
      expect(result.issues).toHaveLength(1);
    });
  });
});
