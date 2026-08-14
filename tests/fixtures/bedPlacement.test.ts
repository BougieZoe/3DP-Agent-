/**
 * Physical-truth tests for auto bed placement (`dropToBed`): a mesh's lowest
 * vertex must rest exactly on the build plate (Z = 0) regardless of where it
 * started, its bounding-box bottom face aligning with the build-volume floor.
 */
import { describe, it, expect } from 'vitest';
import { dropToBed } from '@/analysis/bedPlacement';
import { fromThreeBufferGeometry } from '@/analysis/geometryConversion';
import type { GeometryModel } from '@/analysis/geometryModel';
import { createCubeOnBed } from './geometry';

function minZOf(model: GeometryModel): number {
  let min = Infinity;
  for (let i = 2; i < model.positions.length; i += 3) {
    if (model.positions[i] < min) min = model.positions[i];
  }
  return min;
}

function maxZOf(model: GeometryModel): number {
  let max = -Infinity;
  for (let i = 2; i < model.positions.length; i += 3) {
    if (model.positions[i] > max) max = model.positions[i];
  }
  return max;
}

function raisedCube(offsetZ: number): GeometryModel {
  const geo = createCubeOnBed(20);
  geo.translate(0, 0, offsetZ);
  return fromThreeBufferGeometry(geo);
}

describe('dropToBed', () => {
  it('drops a raised cube so its minZ is exactly 0', () => {
    const raised = raisedCube(5);
    expect(minZOf(raised)).toBeCloseTo(5, 5);

    const dropped = dropToBed(raised);
    expect(minZOf(dropped)).toBeCloseTo(0, 5);
    expect(maxZOf(dropped)).toBeCloseTo(20, 5);
    // Bounding box bottom face sits on the floor: maxZ - minZ is unchanged.
    expect(maxZOf(dropped) - minZOf(dropped)).toBeCloseTo(20, 5);
  });

  it('lifts a cube sunk below the bed back onto the floor', () => {
    const sunk = raisedCube(-12); // minZ = -12, maxZ = 8
    const dropped = dropToBed(sunk); // shifts +12 → minZ = 0, maxZ = 20
    expect(minZOf(dropped)).toBeCloseTo(0, 5);
    expect(maxZOf(dropped)).toBeCloseTo(20, 5);
  });

  it('is a no-op (same reference) when already on the bed', () => {
    const onBed = raisedCube(0);
    expect(dropToBed(onBed)).toBe(onBed);
    expect(minZOf(onBed)).toBe(0);
  });

  it('does not mutate the input model', () => {
    const raised = raisedCube(7);
    dropToBed(raised);
    expect(minZOf(raised)).toBeCloseTo(7, 5);
  });

  it('preserves normals and topology', () => {
    const raised = raisedCube(3);
    const dropped = dropToBed(raised);
    expect(dropped.normals).toEqual(raised.normals);
    expect(dropped.indices).toEqual(raised.indices);
    expect(dropped.vertexCount).toBe(raised.vertexCount);
    expect(dropped.triangleCount).toBe(raised.triangleCount);
  });
});
