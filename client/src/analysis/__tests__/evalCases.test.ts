import { describe, it, expect } from 'vitest';
import { EVAL_CASES, runEvalCases, formatEvalTable } from './evalCases';

describe('EVAL_CASES baseline (default thresholds)', () => {
  it('healthy cube resolves to exactly 0.4 — the trusted baseline is locked', () => {
    const cube = EVAL_CASES.find(c => c.id === 'cube');
    expect(cube).toBeDefined();
    const obs = runEvalCases();
    const cubeObs = obs.find(o => o.caseId === 'cube')!;
    expect(cubeObs.confidence).toBe(0.4);
    expect(cubeObs.trusted).toBe(true);
  });

  it('every case matches its expected verdict under default thresholds', () => {
    const obs = runEvalCases();
    for (const c of EVAL_CASES) {
      const o = obs.find(x => x.caseId === c.id)!;
      expect(o.trusted, `${c.id}: expected trusted=${c.expectTrusted} but got ${o.confidence}`)
        .toBe(c.expectTrusted);
      if (c.expectConfidence !== undefined) {
        expect(o.confidence, `${c.id}: expected confidence=${c.expectConfidence}`)
          .toBe(c.expectConfidence);
      }
    }
  });

  it('prints the baseline distribution for the calibration report', () => {
    console.log('\nBASELINE (default thresholds)\n' + formatEvalTable(runEvalCases()));
    expect(true).toBe(true);
  });
});
