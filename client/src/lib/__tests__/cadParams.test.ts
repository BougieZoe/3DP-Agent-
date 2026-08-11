import { describe, it, expect } from 'vitest';
import { parseParamsFromSource } from '../cadParams';

describe('parseParamsFromSource', () => {
  it('parses annotated # PARAM entries with full metadata', () => {
    const src = `from build123d import *
# PARAM outer "Outer Diameter" mm 10 500 1
# PARAM holes "Holes" count 0 50 1
def gen_step():
    outer = 100; holes = 8
    return Box(outer, outer, 10)`;
    const params = parseParamsFromSource(src);
    expect(params.length).toBe(2);

    const outer = params.find(p => p.name === 'outer')!;
    expect(outer.label).toBe('Outer Diameter');
    expect(outer.unit).toBe('mm');
    expect(outer.min).toBe(10);
    expect(outer.max).toBe(500);
    expect(outer.step).toBe(1);
    expect(outer.value).toBe(100); // pulled from the assignment

    const holes = params.find(p => p.name === 'holes')!;
    expect(holes.min).toBe(0);
    expect(holes.max).toBe(50);
    expect(holes.section).toBe('holes');
  });

  it('auto-detects name = value assignments when no annotations exist', () => {
    const src = `from build123d import *
def gen_step():
    width = 60; height = 40; depth = 20
    return Box(width, depth, height)`;
    const params = parseParamsFromSource(src);
    expect(params.length).toBeGreaterThanOrEqual(2);
    const width = params.find(p => p.name === 'width')!;
    expect(width.value).toBe(60);
    // auto params get sensible slider bounds around the value
    expect(width.min).toBeLessThan(width.value);
    expect(width.max).toBeGreaterThan(width.value);
  });

  it('falls back to the first Box(w, d, h) call', () => {
    const src = `from build123d import *
def gen_step():
    return Box(80, 60, 5)`;
    const params = parseParamsFromSource(src);
    expect(params.map(p => p.name)).toEqual(['box_w', 'box_d', 'box_h']);
    expect(params.map(p => p.value)).toEqual([80, 60, 5]);
    expect(params.every(p => p.section === 'dimensions')).toBe(true);
  });

  it('returns [] for a source with no detectable parameters', () => {
    const src = `from build123d import *
def gen_step():
    return Sphere(10)`;
    expect(parseParamsFromSource(src)).toEqual([]);
  });

  it('maps sections from variable names', () => {
    const src = `from build123d import *
def gen_step():
    width = 80; bolt_r = 38; corner = 2; wall = 3
    return Box(width, width, wall)`;
    const params = parseParamsFromSource(src);
    expect(params.find(p => p.name === 'width')!.section).toBe('dimensions');
    expect(params.find(p => p.name === 'bolt_r')!.section).toBe('holes');
    expect(params.find(p => p.name === 'corner')!.section).toBe('details');
    expect(params.find(p => p.name === 'wall')!.section).toBe('manufacturing');
  });

  it('does not crash on a malformed annotation (holes line omits unit)', () => {
    // `# PARAM holes "Holes" 0 50 1` is missing the unit token — the parser
    // should skip it rather than throw, and still return the valid entries.
    const src = `from build123d import *
# PARAM outer "Outer Diameter" mm 10 500 1
# PARAM holes "Holes" 0 50 1
def gen_step():
    outer = 100; holes = 8
    return Box(outer, outer, 10)`;
    const params = parseParamsFromSource(src);
    expect(params.some(p => p.name === 'outer')).toBe(true);
    expect(params.some(p => p.name === 'holes')).toBe(false);
  });
});
