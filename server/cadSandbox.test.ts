import { describe, expect, it } from 'vitest';
import { SANDBOX_ENV, scanSourceSafety } from './cadSandbox';

describe('scanSourceSafety', () => {
  it('allows normal build123d source (import math + build123d)', () => {
    const src = `from build123d import *
import math
def gen_step():
    body = Box(50, 50, 50)
    return body`;
    expect(scanSourceSafety(src).safe).toBe(true);
  });

  it('rejects dangerous imports', () => {
    expect(scanSourceSafety('import os\nbody = Box(1)').safe).toBe(false);
    expect(scanSourceSafety('from os import system\nbody = Box(1)').safe).toBe(false);
    expect(scanSourceSafety('import subprocess\nbody = Box(1)').safe).toBe(false);
    expect(scanSourceSafety('import socket\nbody = Box(1)').safe).toBe(false);
  });

  it('rejects dangerous calls', () => {
    expect(scanSourceSafety('eval("1+1")\nbody = Box(1)').safe).toBe(false);
    expect(scanSourceSafety('exec("x=1")\nbody = Box(1)').safe).toBe(false);
    expect(scanSourceSafety('open("/etc/passwd")\nbody = Box(1)').safe).toBe(false);
    expect(scanSourceSafety('__import__("os")\nbody = Box(1)').safe).toBe(false);
  });

  it('does not false-positive on build123d surface', () => {
    const src = `from build123d import *
def gen_step():
    body = Box(80, 60, 20, align=(Align.CENTER, Align.CENTER, Align.MIN))
    body -= Pos(0, 0, 0) * Cylinder(radius=3, height=25)
    return body`;
    expect(scanSourceSafety(src).safe).toBe(true);
  });
});

describe('SANDBOX_ENV', () => {
  it('does not leak PYTHONPATH or arbitrary host variables', () => {
    expect(SANDBOX_ENV.PYTHONPATH).toBeUndefined();
    expect(SANDBOX_ENV.PYTHONHOME).toBeUndefined();
    expect(SANDBOX_ENV.PYTHONUNBUFFERED).toBe('1');
    // Only whitelisted keys are present.
    const allowed = ['PATH', 'HOME', 'LANG', 'TMPDIR', 'PYTHONUNBUFFERED', 'PYTHONDONTWRITEBYTECODE'];
    for (const key of Object.keys(SANDBOX_ENV)) {
      expect(allowed).toContain(key);
    }
  });
});
