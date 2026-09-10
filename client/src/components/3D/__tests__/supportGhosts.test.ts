import { describe, it, expect } from 'vitest';
import { computeSupportColumns } from '../SupportGhosts';

const marker = (x: number, y: number, z: number, severity = 0.5) => ({
  position: { x, y, z },
  severity,
});

describe('computeSupportColumns', () => {
  it('grows columns from the bed toward each marker along Z', () => {
    const cols = computeSupportColumns([marker(10, -5, 20)], 0);
    expect(cols).toHaveLength(1);
    expect(cols[0].height).toBe(20);
    // Single positioning point: mesh position only, geometry stays centered.
    expect(cols[0].position).toEqual({ x: 10, y: -5, z: 10 });
    expect(cols[0].radius).toBeCloseTo(0.3, 5);
  });

  it('skips markers at or below the bed', () => {
    const cols = computeSupportColumns([marker(0, 0, 0), marker(1, 1, -2), marker(2, 2, 5)], 0);
    expect(cols).toHaveLength(1);
    expect(cols[0].position.z).toBe(2.5);
  });

  it('caps at 30 columns and is fully deterministic', () => {
    const many = Array.from({ length: 50 }, (_, i) => marker(i, 0, 10));
    const a = computeSupportColumns(many, 0);
    const b = computeSupportColumns(many, 0);
    expect(a).toHaveLength(30);
    expect(a).toEqual(b); // no Math.random anywhere in the path
  });

  it('returns empty for no markers', () => {
    expect(computeSupportColumns([], 0)).toEqual([]);
  });
});
