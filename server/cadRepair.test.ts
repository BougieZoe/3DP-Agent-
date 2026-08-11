import { describe, expect, it } from 'vitest';
import { repairCadSource } from './cadRepair';

describe('repairCadSource', () => {
  it('wraps a failing fillet in try/except so the model still builds', () => {
    const src = `from build123d import *
def gen_step():
    body = Box(60, 45, 5, align=(Align.CENTER, Align.CENTER, Align.MIN))
    body = fillet(body.edges(), radius=5)
    return body`;
    const result = repairCadSource(
      src,
      'ValueError: Failed creating a fillet with radius of 5, try a smaller value',
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe('fillet');
    expect(result!.source).toContain('try:');
    expect(result!.source).toContain('fillet(body.edges(), radius=5)');
    expect(result!.source).toContain('except Exception:');
    expect(result!.source).toContain('return body');
  });

  it('degrades to the un-filleted shape without dropping later statements', () => {
    const src = `def gen_step():
    body = Box(60, 45, 5, align=(Align.CENTER, Align.CENTER, Align.MIN))
    body = fillet(body.edges(), radius=5)
    body -= Pos(0, 0, 0) * Cylinder(radius=2.5, height=6)
    return body`;
    const result = repairCadSource(src, 'failed creating a fillet');
    expect(result).not.toBeNull();
    // The hole subtraction must survive the wrap.
    expect(result!.source).toContain('body -= Pos(0, 0, 0) * Cylinder');
  });

  it('returns null for unrepairable errors (non-manifold)', () => {
    expect(repairCadSource('x', 'shell is not manifold')).toBeNull();
  });
});
