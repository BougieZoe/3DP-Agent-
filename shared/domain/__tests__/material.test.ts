import { describe, expect, it } from 'vitest';
import { MATERIALS, materialsForTechnology, defaultMaterialKeyFor, defaultMaterialFor } from '../material';

describe('material registry — PBF families', () => {
  it('registers SLS polymer powders', () => {
    const sls = materialsForTechnology('sls');
    const names = sls.map(m => m.name);
    expect(names).toContain('PA12 (Nylon 12)');
    expect(names).toContain('PA11 (Nylon 11)');
    expect(names).toContain('TPU Powder');
    // Polymer PBF is self-supporting → generous overhang threshold.
    for (const m of sls) expect(m.overhangThreshold).toBe(65);
  });

  it('registers MJF polymer powder', () => {
    const mjf = materialsForTechnology('mjf');
    expect(mjf.map(m => m.name)).toContain('PA12 (MJF)');
  });

  it('registers SLM metal powders with low overhang threshold (needs supports)', () => {
    const slm = materialsForTechnology('slm');
    const names = slm.map(m => m.name);
    expect(names).toContain('316L Stainless');
    expect(names).toContain('Ti-6Al-4V');
    expect(names).toContain('AlSi10Mg');
    for (const m of slm) {
      expect(m.overhangThreshold).toBe(45);
      expect(m.densityGPerCm3).toBeGreaterThan(2.0); // all metals
    }
  });

  it('is honest about metal density (316L ~8 g/cm³, Ti64 ~4.4 g/cm³)', () => {
    expect(MATERIALS.STEEL_316L.densityGPerCm3).toBeCloseTo(7.98, 1);
    expect(MATERIALS.TI64.densityGPerCm3).toBeCloseTo(4.43, 1);
  });

  it('each PBF material has a description and useCase', () => {
    for (const tech of ['sls', 'slm', 'mjf'] as const) {
      for (const m of materialsForTechnology(tech)) {
        expect(m.description.length).toBeGreaterThan(40);
        expect(m.useCase.length).toBeGreaterThan(5);
        expect(m.category.length).toBeGreaterThan(5);
      }
    }
  });

  it('default material per PBF family is a valid registry entry', () => {
    for (const tech of ['sls', 'slm', 'mjf'] as const) {
      const key = defaultMaterialKeyFor(tech);
      expect(MATERIALS[key].technology).toBe(tech);
      expect(defaultMaterialFor(tech)).toBe(MATERIALS[key]);
    }
  });
});
