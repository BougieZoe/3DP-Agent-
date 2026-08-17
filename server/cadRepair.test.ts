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

  it('replaces a failing Wedge with an equal-size Box so later combines still run', () => {
    const src = `from build123d import *

def gen_step():
    width = 80
    depth = 60
    house_h = 40
    roof_h = 20
    body = Box(width, depth, house_h, align=(Align.CENTER, Align.CENTER, Align.MIN))
    left_roof = Pos(-width/2, -depth/2, house_h) * Wedge(width/2, depth, roof_h, xmin=0, zmin=0, xmax=width/2, zmax=roof_h)
    right_roof = Pos(0, -depth/2, house_h) * Wedge(width/2, depth, roof_h, xmin=0, zmin=roof_h, xmax=width/2, zmax=0)
    house = body + left_roof + right_roof
    return house`;
    const result = repairCadSource(src, 'OCP.OCP.Standard.Standard_Failure ... make_wedge');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('wedge');
    // Wedge calls replaced with Box — the variables stay defined, combines live.
    expect(result!.source).not.toContain('Wedge(');
    expect(result!.source.match(/Box\(/g)?.length).toBeGreaterThanOrEqual(3);
    expect(result!.source).toContain('house = body + left_roof + right_roof');
    expect(result!.source).toContain('return house');
  });

  it('renames a wrong keyword argument reported in the traceback', () => {
    const src = `def gen_step():
    body = Box(60, 40, 30)
    roof = Pos(0, 0, 30) * Cone(bottom_r=20, top_r=0, height=15)
    return body + roof`;
    const result = repairCadSource(
      src,
      "TypeError: Cone.__init__() got an unexpected keyword argument 'bottom_r'",
    );
    expect(result).not.toBeNull();
    expect(result!.type).toBe('kwargs');
    expect(result!.source).toContain('Cone(bottom_radius=20, top_r=0');
  });

  it('renames the radius kwarg and leaves unrelated names alone', () => {
    const src = `def gen_step():
    body = Cylinder(r=10, height=20)
    return body`;
    const result = repairCadSource(src, "got an unexpected keyword argument 'r'");
    expect(result).not.toBeNull();
    expect(result!.source).toContain('Cylinder(radius=10, height=20)');
  });

  it('replaces a failing Wedge with a Box and keeps unrelated statements', () => {
    const src = `def gen_step():
    body = Box(20, 20, 20)
    roof = Wedge(10, 10, 10, xmin=0, zmin=0, xmax=1, zmax=1)
    fin = Box(5, 5, 5)
    return body + roof + fin`;
    const result = repairCadSource(src, 'Standard_Failure in make_wedge');
    expect(result).not.toBeNull();
    expect(result!.source).toContain('roof = Box(10, 10, 10, align=');
    expect(result!.source).toContain('fin = Box(5, 5, 5)');
    expect(result!.source).toContain('return body + roof + fin');
  });

  it('returns null for an unknown kwarg name', () => {
    const src = `def gen_step():
    body = Box(10, 10, 10)
    return body`;
    expect(repairCadSource(src, "got an unexpected keyword argument 'florp'")).toBeNull();
  });
});
