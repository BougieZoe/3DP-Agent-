import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { parseSTL } from '../stlParser';
import { autoOrientGeometry, suggestOrientation, type OrientationSuggestion } from '../autoOrient';
import { analyzeOverhang } from '@/analysis/metrics';
import { fromThreeBufferGeometry } from '@/analysis/geometryConversion';
import { runAnalysisPipeline } from '@/analysis/pipeline';
import { GOLDEN_SAMPLE_NAMES } from '@/analysis/__tests__/goldenSamples';

const STL_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../analysis/__tests__/fixtures/stl',
);

function loadGeo(name: string): THREE.BufferGeometry {
  const buf = readFileSync(path.join(STL_DIR, `${name}.stl`));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return parseSTL(ab);
}

function indicesOf(g: THREE.BufferGeometry): Uint32Array {
  const idx = g.getIndex();
  if (idx) return new Uint32Array(idx.array);
  const pos = g.getAttribute('position');
  const seq = new Uint32Array(pos.count);
  for (let i = 0; i < pos.count; i++) seq[i] = i;
  return seq;
}

describe('suggestOrientation', () => {
  it('rejects zero-contact poses on test_model: overhang-free edge perches cannot win', () => {
    const geo = autoOrientGeometry(loadGeo('test_model'));
    const s = suggestOrientation(geo, 50);
    // The four zero-overhang poses all rest on a sliver — the floor rejects them.
    const edgePoses = s.candidates.filter(c => c.overhangRatio < 0.01 && c.axis !== null);
    expect(edgePoses.length).toBeGreaterThan(0);
    for (const c of edgePoses) expect(c.baseContactOk).toBe(false);
    // Nothing stable exists anywhere: best footprint contact is 5.3%,
    // under the 10% stability guard -> distinct 'no good orientation' result.
    expect(s.rotated).toBe(false);
    expect(s.verdict).toBe('no_good_orientation');
    expect(s.reason).toContain('stable seat');
    expect(s.chosen.axis).toBeNull();
    expect(s.rotatedGeometry).toBeNull();
  });

  it('rotates a standing T-shape onto its side (real orientation change)', () => {
    // Stem 2×2×10 + cap 6×6×2 on top: the cap underside (36mm² facing down
    // above the plate) is real overhang; lying on the stem side removes it.
    const stem = new THREE.BoxGeometry(2, 2, 10);
    stem.translate(0, 0, 5);
    const cap = new THREE.BoxGeometry(6, 6, 2);
    cap.translate(0, 0, 11);
    const geo = mergeGeometries([stem, cap])!;
    const s = suggestOrientation(geo, 50);
    expect(s.rotated).toBe(true);
    expect(s.verdict).toBe('rotated');
    expect(s.reason).toBeNull();
    expect(s.chosen.axis).not.toBeNull();
    expect([90, -90, 180]).toContain(s.chosen.degrees);
    // Not exactly 0: the merged stem's top face survives inside the cap
    // (no boolean union) and counts ~4mm² of downward-facing area.
    expect(s.chosen.overhangRatio).toBeLessThan(0.05);
    expect(s.chosen.overhangRatio).toBeLessThan(s.candidates[0].overhangRatio * 0.25);
    expect(s.chosen.baseContactAreaMm2).toBeGreaterThan(s.candidates[0].baseContactAreaMm2);
    expect(s.rotatedGeometry).not.toBeNull();
  });

  it('keeps current orientation on a model with no overhang problem', () => {
    const geo = autoOrientGeometry(loadGeo('t_cube20'));
    const s = suggestOrientation(geo, 50);
    expect(s.rotated).toBe(false);
    expect(s.verdict).toBe('kept');
    expect(s.chosen.axis).toBeNull();
    expect(s.rotatedGeometry).toBeNull();
  });

  it('reports build height, base contact and floor status for every candidate', () => {
    const geo = autoOrientGeometry(loadGeo('test_model'));
    const s = suggestOrientation(geo, 50);
    expect(s.candidates.length).toBe(6);
    for (const c of s.candidates) {
      expect(c.buildHeightMm).toBeGreaterThan(0);
      expect(c.baseContactAreaMm2).toBeGreaterThanOrEqual(0);
      expect(typeof c.baseContactOk).toBe('boolean');
      expect(c.footprintMm2).toBeGreaterThan(0);
      expect(c.baseContactFraction).toBeGreaterThanOrEqual(0);
      expect(c.baseContactFraction).toBeLessThanOrEqual(1);
    }
  });

  it('scorer ratio matches the full pipeline overhang ratio on the chosen orientation (all fixtures)', () => {
    for (const name of GOLDEN_SAMPLE_NAMES) {
      const geo = autoOrientGeometry(loadGeo(name));
      const s: OrientationSuggestion = suggestOrientation(geo, 50);
      const geoOut = s.rotatedGeometry ?? geo;

      const positions = geoOut.getAttribute('position').array as Float32Array;
      const cheap = analyzeOverhang(positions, indicesOf(geoOut), 50);
      const pipeline = runAnalysisPipeline(fromThreeBufferGeometry(geoOut), {
        fileName: `${name}.stl`,
        language: 'en',
      });
      const pipelineRatio = pipeline.metrics.result.overhang.ratio;

      expect(Math.abs(cheap.ratio - pipelineRatio), name).toBeLessThan(1e-9);
      expect(Math.abs(s.chosen.overhangRatio - cheap.ratio), name).toBeLessThan(1e-9);
    }
  });
});
