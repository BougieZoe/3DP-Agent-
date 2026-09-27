import { describe, it, expect } from 'vitest';
import {
  assessScale,
  analyzeScaleGuard,
  tickHit,
  coordGridRatio,
  SCALE_GUARD_INCH_TICKS_MM,
  SCALE_GUARD_MM_TICKS,
} from '../scaleGuard';
import { runAnalysisPipeline } from '../pipeline';
import { createWatertightCubeModel } from './testMeshes';

describe('scaleGuard (ported from the Python engine)', () => {
  describe('false-positive guard', () => {
    it('leaves a regular-scale part at status ok', () => {
      // Equivalent to the calibration sample test_model (10 mm largest edge):
      // the Python guard must stay "ok" here, and so must the port.
      const r = assessScale([10, 10, 10]);
      expect(r.status).toBe('ok');
      expect(r.suggestedScale).toBe(1);
      expect(r.note).toContain('尺度与单位未见异常');
    });

    it('keeps the advisory inch hint out of the verdict', () => {
      // 10 mm < 20.32 mm advisory edge and 10 × 25.4 = 254 mm lands in the
      // build window — note gets a weak hint, status must NOT change.
      const r = assessScale([10, 10, 10]);
      expect(r.status).toBe('ok');
      expect(r.note).toContain('0.8 in');
      expect(r.signals.some((s) => s.includes('刻度核对'))).toBe(true);
    });
  });

  describe('suspect inch', () => {
    it('flags a small edge that lands in the build window after ×25.4', () => {
      const r = assessScale([0.25, 0.25, 0.25]);
      expect(r.status).toBe('suspect_inch');
      expect(r.suggestedScale).toBe(25.4);
      expect(r.maxEdgeMm).toBe(0.25);
      // 0.25 item × 25.4 = 6.35 mm, exactly the 0.25 in tick.
      expect(r.suggestedExtentsMm).toEqual([6.35, 6.35, 6.35]);
      expect(r.note).toContain('疑似英制单位（inch）被按毫米读取');
    });

    it('reports inch_preferred when only the imperial tick aligns', () => {
      const r = assessScale([0.25, 0.25, 0.25]);
      expect(r.disambiguation).toBe('inch_preferred');
      expect(r.confidence).toBe('high');
      expect(r.tickCheck?.inchTick).toBe(0.25);
      expect(r.tickCheck?.cmTick).toBeNull();
    });

    it('escalates confidence when coordinates also sit on the 1/16 inch grid', () => {
      // Component values are odd multiples of 1/16 in: perfect on the imperial
      // grid, nowhere near the 0.1 mm grid.
      const verts = new Float32Array([
        0.0625, 0.1875, 0.3125,
        0.4375, 0.5625, 0.6875,
        0.8125, 0.9375, 1.0625,
      ]);
      const r = assessScale([0.25, 0.25, 0.25], verts);
      expect(r.coordSupport).not.toBeNull();
      expect(r.coordSupport?.bias).toBe('inch');
      expect(r.coordSupport?.inchGridRatio).toBe(1);
      expect(r.coordSupport?.cmGridRatio).toBe(0);
      expect(r.confidence).toBe('high（刻度 + 坐标双重吻合）');
    });

    it('declares ambiguity instead of forcing a conclusion', () => {
      // 1.0 × 25.4 = 25.4 mm (an imperial tick) and 1.0 × 10 = 10 mm (a
      // metric tick) are both neat — the tick signal cannot disambiguate.
      const r = assessScale([1, 1, 1]);
      expect(r.status).toBe('suspect_inch');
      expect(r.disambiguation).toBe('ambiguous_ticks');
      expect(r.confidence).toBe('low');
      expect(r.note).toContain('刻度无法消歧');
    });

    it('falls back to no_tick_signal when neither tick aligns', () => {
      // 2.5 × 25.4 = 63.5 mm and 2.5 × 10 = 25 mm — neither is a neat tick.
      const r = assessScale([2.5, 2.5, 2.5]);
      expect(r.status).toBe('suspect_inch');
      expect(r.disambiguation).toBe('no_tick_signal');
      expect(r.tickCheck?.inchTick).toBeNull();
      expect(r.tickCheck?.cmTick).toBeNull();
    });
  });

  describe('oversize and unclassifiable parts', () => {
    it('flags parts beyond the desktop build envelope', () => {
      const r = assessScale([500, 500, 500]);
      expect(r.status).toBe('oversize');
      expect(r.suggestedScale).toBe(1);
      expect(r.note).toContain('未做单位换算');
    });

    it('does not call a sub-limit part a unit error when neither rescale fits', () => {
      // 0.05 × 25.4 = 1.27 mm and 0.05 × 10 = 0.5 mm: both below the build
      // window, so this stays "ok" with an explanatory note.
      const r = assessScale([0.05, 0.05, 0.05]);
      expect(r.status).toBe('ok');
      expect(r.note).toContain('未判定为单位错误');
    });
  });

  describe('degradation and purity', () => {
    it('degrades to a note instead of throwing on unusable input', () => {
      expect(() => assessScale(null)).not.toThrow();
      const r = assessScale(null);
      expect(r.status).toBe('ok');
      expect(r.suggestedScale).toBe(1);
      expect(r.note).toContain('尺度体检未能完成');

      const r2 = assessScale([]);
      expect(r2.status).toBe('ok');
      expect(r2.note).toContain('尺度体检未能完成');
    });

    it('never mutates the input extents', () => {
      const dims = [0.25, 0.25, 0.25];
      assessScale(dims);
      expect(dims).toEqual([0.25, 0.25, 0.25]);
    });

    it('wraps as a deterministic, full-confidence module result', () => {
      const model = createWatertightCubeModel();
      const mod = analyzeScaleGuard(model, [10, 10, 10]);
      expect(mod.moduleName).toBe('scaleGuard');
      expect(mod.confidence).toBe(1);
      expect(mod.result.status).toBe('ok');
    });
  });

  describe('tick helpers', () => {
    it('hits the nearest tick within tolerance', () => {
      const hit = tickHit(25.3, SCALE_GUARD_INCH_TICKS_MM);
      expect(hit?.tick).toBe(25.4);
      expect(hit!.deviation).toBeLessThanOrEqual(0.02);
      expect(tickHit(25.4, SCALE_GUARD_INCH_TICKS_MM)?.tick).toBe(25.4);
      expect(tickHit(30, SCALE_GUARD_MM_TICKS)).toBeNull();
    });

    it('returns null for non-positive or empty input', () => {
      expect(tickHit(0, SCALE_GUARD_MM_TICKS)).toBeNull();
      expect(tickHit(-5, SCALE_GUARD_MM_TICKS)).toBeNull();
      expect(coordGridRatio(null, 0.1)).toBeNull();
      expect(coordGridRatio(new Float32Array([]), 0.1)).toBeNull();
    });
  });

  describe('pipeline integration', () => {
    it('exposes scaleGuard on the unified analysis and keeps it out of scoring', () => {
      const analysis = runAnalysisPipeline(createWatertightCubeModel(), {
        fileName: 'test_model.stl',
        materialFamily: 'fdm',
      });
      expect(analysis.scaleGuard).not.toBeNull();
      // The unit-cube mesh is 1 mm on a side: below the 3 mm regular-scale
      // floor, while ×25.4 lands at 25.4 mm inside the build window — so the
      // sentinel correctly suspects an inch export.
      expect(analysis.scaleGuard?.result.status).toBe('suspect_inch');
      expect(analysis.scaleGuard?.result.suggestedScale).toBe(25.4);
      // Deterministic read-only check: full module confidence, and it cannot
      // drag down the run's overall confidence.
      expect(analysis.scaleGuard?.confidence).toBe(1);
      expect(analysis.overallConfidence).toBeLessThanOrEqual(1);
    });
  });
});
