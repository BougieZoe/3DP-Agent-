import { describe, it, expect } from 'vitest';
import { extractParamsFromPrompt, computeChecks } from '../cadGenerator';
import { DEFAULT_MATERIAL } from '../materialState';

describe('extractParamsFromPrompt', () => {
  describe('dimensions (width × depth)', () => {
    it('extracts width and depth from "W×D" pattern', () => {
      const r = extractParamsFromPrompt('100×50');
      expect(r.width).toBe(100);
      expect(r.depth).toBe(50);
    });

    it('extracts width and depth from "W x D" pattern', () => {
      const r = extractParamsFromPrompt('80 x 60');
      expect(r.width).toBe(80);
      expect(r.depth).toBe(60);
    });

    it('handles "mm" suffix', () => {
      const r = extractParamsFromPrompt('120mm × 90mm plate');
      expect(r.width).toBe(120);
      expect(r.depth).toBe(90);
    });

    it('ignores dimensions outside 1–1000 range', () => {
      const r = extractParamsFromPrompt('0.5 × 2000');
      expect(r.width).toBeUndefined();
      expect(r.depth).toBeUndefined();
    });
  });

  describe('height', () => {
    it('extracts height from "height N" pattern', () => {
      const r = extractParamsFromPrompt('height 65');
      expect(r.height).toBe(65);
    });

    it('extracts height from "高 N" Chinese pattern', () => {
      const r = extractParamsFromPrompt('高 120mm');
      expect(r.height).toBe(120);
    });

    it('extracts height from "h N" shorthand', () => {
      const r = extractParamsFromPrompt('h 30');
      expect(r.height).toBe(30);
    });

    it('ignores height outside valid range', () => {
      const r = extractParamsFromPrompt('height 2000');
      expect(r.height).toBeUndefined();
    });
  });

  describe('thickness', () => {
    it('extracts thickness from "thickness N"', () => {
      const r = extractParamsFromPrompt('thickness 8');
      expect(r.thickness).toBe(8);
    });

    it('extracts thickness from "壁厚 N" Chinese', () => {
      const r = extractParamsFromPrompt('壁厚 3');
      expect(r.thickness).toBe(3);
    });

    it('extracts thickness from "thick N" shorthand', () => {
      const r = extractParamsFromPrompt('thick 5');
      expect(r.thickness).toBe(5);
    });

    it('clamps thickness to 0.2–100 range', () => {
      const r = extractParamsFromPrompt('thickness 200');
      expect(r.thickness).toBeUndefined();
    });
  });

  describe('hole count', () => {
    it('extracts hole count from "N holes" pattern', () => {
      const r = extractParamsFromPrompt('4 holes');
      expect(r.holeCount).toBe(4);
    });

    it('extracts hole count from word form', () => {
      const r = extractParamsFromPrompt('six holes');
      expect(r.holeCount).toBe(6);
    });

    it('extracts hole count from Chinese "N 个孔"', () => {
      const r = extractParamsFromPrompt('8个孔');
      expect(r.holeCount).toBe(8);
    });

    it('prefers word-form over digits when both present', () => {
      const r = extractParamsFromPrompt('four 8mm holes');
      expect(r.holeCount).toBe(4);
    });

    it('ignores hole count outside valid range', () => {
      const r = extractParamsFromPrompt('200 holes');
      expect(r.holeCount).toBeUndefined();
    });
  });

  describe('hole and circle diameters', () => {
    it('extracts hole diameter from "Nmm hole"', () => {
      const r = extractParamsFromPrompt('6mm holes');
      expect(r.holeDiameter).toBe(6);
    });

    it('extracts hole diameter from "Nmm dia"', () => {
      const r = extractParamsFromPrompt('5mm dia holes');
      expect(r.holeDiameter).toBe(5);
    });

    it('extracts hole diameter from Chinese "N mm 孔直径"', () => {
      const r = extractParamsFromPrompt('10mm 孔直径');
      expect(r.holeDiameter).toBe(10);
    });

    it('extracts outer diameter from "outer diameter N"', () => {
      const r = extractParamsFromPrompt('outer diameter 120');
      expect(r.outerDiameter).toBe(120);
    });

    it('extracts outer diameter from "外径 N" Chinese', () => {
      const r = extractParamsFromPrompt('外径 80mm');
      expect(r.outerDiameter).toBe(80);
    });

    it('extracts inner diameter from "内径 N" Chinese', () => {
      const r = extractParamsFromPrompt('内径 40mm');
      expect(r.innerDiameter).toBe(40);
    });

    it('ignores diameter outside valid range', () => {
      const r = extractParamsFromPrompt('hole diameter 2000');
      expect(r.holeDiameter).toBeUndefined();
    });
  });

  describe('corner radius', () => {
    it('extracts corner radius from "corner radius N"', () => {
      const r = extractParamsFromPrompt('corner radius 8');
      expect(r.cornerRadius).toBe(8);
    });

    it('extracts corner radius from "corner radius N"', () => {
      const r = extractParamsFromPrompt('corner radius 8');
      expect(r.cornerRadius).toBe(8);
    });
  });

  describe('malformed and ambiguous prompts', () => {
    it('returns empty object for empty string', () => {
      const r = extractParamsFromPrompt('');
      expect(Object.keys(r).length).toBe(0);
    });

    it('returns empty object for gibberish', () => {
      const r = extractParamsFromPrompt('asdf qwerty zxcv');
      expect(Object.keys(r).length).toBe(0);
    });

    it('partially extracts when some dimensions are invalid', () => {
      const r = extractParamsFromPrompt('width 2000 height 60');
      expect(r.width).toBeUndefined();
      expect(r.height).toBe(60);
    });

    it('handles mm suffix correctly', () => {
      const r = extractParamsFromPrompt('thickness 6mm height 50mm');
      expect(r.thickness).toBe(6);
      expect(r.height).toBe(50);
    });

    it('handles mixed unit strings', () => {
      const r = extractParamsFromPrompt('100 x 80 x 30');
      expect(r.width).toBe(100);
      expect(r.depth).toBe(80);
    });
  });

  describe('integration: realistic prompts', () => {
    it('parses complex English prompt', () => {
      const r = extractParamsFromPrompt(
        'Create a mounting plate 120mm x 80mm with height 10mm, thickness 5mm, 4 holes of 6mm diameter'
      );
      expect(r.width).toBe(120);
      expect(r.depth).toBe(80);
      expect(r.height).toBe(10);
      expect(r.thickness).toBe(5);
      expect(r.holeCount).toBe(4);
      expect(r.holeDiameter).toBe(6);
    });

    it('parses complex Chinese prompt', () => {
      const r = extractParamsFromPrompt(
        '做一个法兰 外径 150mm 内径 80mm 厚度 15mm 8个孔 孔直径 10mm'
      );
      expect(r.outerDiameter).toBe(150);
      expect(r.innerDiameter).toBe(80);
      expect(r.thickness).toBe(15);
      expect(r.holeCount).toBe(8);
      expect(r.holeDiameter).toBe(10);
    });

    it('parses flange-like dimensions', () => {
      const r = extractParamsFromPrompt('outer diameter 200mm inner diameter 100mm');
      expect(r.outerDiameter).toBe(200);
      expect(r.innerDiameter).toBe(100);
    });
  });
});

describe('computeChecks', () => {
  const baseParams = {
    width: 100, depth: 80, height: 60, thickness: 15,
    outerDiameter: 100, innerDiameter: 50, holeDiameter: 8,
    holeCount: 6, boltCircleDiameter: 80,
    drawerCount: 2, legHeight: 40,
    wallThickness: 2, clearance: 0.2, cornerRadius: 5, tubeDiameter: 20,
  };

  it('approves adequate wall thickness', () => {
    const checks = computeChecks(baseParams, DEFAULT_MATERIAL);
    const wallCheck = checks.find(c => c.includes('adequate'));
    expect(wallCheck).toBeTruthy();
  });

  it('warns on thin wall thickness', () => {
    const checks = computeChecks({ ...baseParams, thickness: 1 });
    const thinCheck = checks.find(c => c.includes('consider thickening'));
    expect(thinCheck).toBeTruthy();
  });

  it('reports too thin for FDM', () => {
    const checks = computeChecks({ ...baseParams, thickness: 0.5 });
    const tooThin = checks.find(c => c.includes('too thin'));
    expect(tooThin).toBeTruthy();
  });

  it('checks bed fit', () => {
    const checks = computeChecks({ ...baseParams, width: 300, depth: 200 });
    const bedCheck = checks.find(c => c.includes('exceed'));
    expect(bedCheck).toBeTruthy();
  });

  it('confirms bed fit for small models', () => {
    const checks = computeChecks({ ...baseParams, width: 100, depth: 80 });
    const bedCheck = checks.find(c => c.includes('Bed fit OK'));
    expect(bedCheck).toBeTruthy();
  });

  it('includes material info', () => {
    const checks = computeChecks(baseParams, DEFAULT_MATERIAL);
    const matCheck = checks.find(c => c.includes('PLA'));
    expect(matCheck).toBeTruthy();
  });
});
