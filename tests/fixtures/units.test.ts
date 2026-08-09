/**
 * Unit-contract tests: STL files carry no unit metadata, so units must be
 * declared explicitly and non-mm geometry normalized to millimeters before
 * analysis — never silently misread (a cm model would be 10× too small and
 * 1000× too light in every downstream metric).
 */
import { describe, it, expect } from 'vitest';
import { scaleToMillimeters } from '@/analysis/units';
import { LENGTH_UNIT_TO_MM } from '@shared/domain/geometry';
import { fromThreeBufferGeometry } from '@/analysis/geometryConversion';
import { createCubeOnBed } from './geometry';

function maxCoord(model: { positions: Float32Array }): number {
  let max = -Infinity;
  for (let i = 0; i < model.positions.length; i += 3) {
    max = Math.max(max, model.positions[i], model.positions[i + 1], model.positions[i + 2]);
  }
  return max;
}

describe('LengthUnit contract', () => {
  it('maps each unit to its millimeter scale factor', () => {
    expect(LENGTH_UNIT_TO_MM.mm).toBe(1);
    expect(LENGTH_UNIT_TO_MM.cm).toBe(10);
    expect(LENGTH_UNIT_TO_MM.inch).toBeCloseTo(25.4, 5);
  });

  it('records declared units on the geometry model', () => {
    const cm = fromThreeBufferGeometry(createCubeOnBed(1), 'cm');
    expect(cm.units).toBe('cm');
    const mm = fromThreeBufferGeometry(createCubeOnBed(1));
    expect(mm.units).toBe('mm');
  });
});

describe('scaleToMillimeters', () => {
  it('scales a 1-unit cube declared in cm to 10 mm', () => {
    const model = fromThreeBufferGeometry(createCubeOnBed(1), 'cm');
    const scaled = scaleToMillimeters(model, 'cm');
    expect(scaled.units).toBe('mm');
    expect(maxCoord(scaled)).toBeCloseTo(10, 5);
  });

  it('scales a 1-unit cube declared in inches to 25.4 mm', () => {
    const model = fromThreeBufferGeometry(createCubeOnBed(1), 'inch');
    const scaled = scaleToMillimeters(model, 'inch');
    expect(maxCoord(scaled)).toBeCloseTo(25.4, 3);
  });

  it('is a no-op (same reference) for mm input', () => {
    const model = fromThreeBufferGeometry(createCubeOnBed(20));
    expect(scaleToMillimeters(model, 'mm')).toBe(model);
  });

  it('does not mutate the input and preserves normals/topology', () => {
    const model = fromThreeBufferGeometry(createCubeOnBed(1), 'cm');
    const scaled = scaleToMillimeters(model, 'cm');
    expect(maxCoord(model)).toBeCloseTo(1, 5); // input untouched
    expect(scaled.normals).toEqual(model.normals);
    expect(scaled.indices).toEqual(model.indices);
    expect(scaled.vertexCount).toBe(model.vertexCount);
    expect(scaled.triangleCount).toBe(model.triangleCount);
  });
});
