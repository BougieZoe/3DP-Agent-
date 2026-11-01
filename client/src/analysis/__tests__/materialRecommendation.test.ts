import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { recommendMaterials } from '../materialRecommendation';
import { fromThreeBufferGeometry } from '../geometryConversion';
import type { GeometryModel } from '../geometryModel';
import { createScaledWatertightCubeModel } from './testMeshes';

const OVERHANG_WARNING = 'Overhangs may need support';

// A tall cylinder: fromThreeBufferGeometry maps three.js Y-up space to the
// model's Z-up space, so CylinderGeometry (axis along Y) converts to a LYING
// cylinder; rotateX(90deg) first makes it STANDING in model space. Standing it
// has no downward-facing overhang faces; lying, the lower shell overhangs >45deg.
function tallCylinderModel(lying: boolean): GeometryModel {
  const geo = new THREE.CylinderGeometry(5, 5, 40, 24);
  if (!lying) {
    geo.rotateX(Math.PI / 2);
  }
  return fromThreeBufferGeometry(geo);
}

function warningsPerMaterial(model: GeometryModel): { name: string; warnings: string[] }[] {
  return recommendMaterials({ technology: 'fdm', model, topN: 3 }).recommendations
    .map((r) => ({ name: r.material.name, warnings: r.warnings }));
}

describe('recommendMaterials overhang warning', () => {
  it('warns on the lying tall cylinder but not on the standing one', () => {
    const standing = warningsPerMaterial(tallCylinderModel(false));
    const lying = warningsPerMaterial(tallCylinderModel(true));

    for (const { name, warnings } of standing) {
      expect(warnings, `standing cylinder: ${name}`).not.toContain(OVERHANG_WARNING);
    }
    for (const { name, warnings } of lying) {
      expect(warnings, `lying cylinder: ${name}`).toContain(OVERHANG_WARNING);
    }
  });

  it('does not warn on a cube resting on the plate', () => {
    const recs = warningsPerMaterial(createScaledWatertightCubeModel(20));
    for (const { name, warnings } of recs) {
      expect(warnings, `cube: ${name}`).not.toContain(OVERHANG_WARNING);
    }
  });
});
