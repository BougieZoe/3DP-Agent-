#!/usr/bin/env python3
"""CLI harness for the server-side thicken worker (design validation).

Runs server/mesh_thicken.py exactly the way the Express bridge will (argv +
JSON sidecar + exit code) and checks the two properties that make the operation
trustworthy:

  1. a ball offset grows every dimension by exactly 2*delta
  2. the measured minimum wall grows by that same 2*delta

Exit code mirrors the worker for the pass/fail case (0 ok, 2 not closed).

    python3 scripts/verify-bridge-thicken.py model.stl 0.15
"""
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKER = os.path.join(ROOT, 'server', 'mesh_thicken.py')


def run_worker(python, model, delta):
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, 'out.stl')
        diag_path = os.path.join(tmp, 'diag.json')
        proc = subprocess.run(
            [python, '-I', WORKER, model, out, str(delta), diag_path],
            capture_output=True, text=True, timeout=180,
        )
        diag = {}
        if os.path.exists(diag_path):
            with open(diag_path, encoding='utf-8') as fh:
                diag = json.load(fh)
        size = os.path.getsize(out) if os.path.exists(out) else 0
        return proc.returncode, diag, size, proc.stderr.strip()


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    model = sys.argv[1]
    delta = float(sys.argv[2]) if len(sys.argv) > 2 else 0.15
    python = os.environ.get('THICKEN_PYTHON', sys.executable)

    code, diag, size, stderr = run_worker(python, model, delta)
    status = diag.get('status', 'no-diag')
    print(f'{os.path.basename(model)}  delta={delta}mm  status={status}  exit={code}')

    if status in ('not_closed', 'too_large'):
        why = 'input is not a closed solid (repair first)' if status == 'not_closed' else 'over the triangle budget'
        print(f'  rejected: {why} — expected contract behaviour')
        print(f'  detail: {diag.get("error", "")}')
        return 0 if code in (2, 3) else 1
    if status != 'ok':
        print(f'  FAIL: {diag.get("error", stderr)}')
        return 1

    before = diag['minWallBeforeMm']
    after = diag['minWallAfterMm']
    growth = diag['growthMm']
    expected_growth = 2 * delta
    wall_gain = after - before

    print(f'  triangles   {diag["inputTriangles"]:,} -> {diag["outputTriangles"]:,}')
    print(f'  watertight  {diag["watertightBefore"]} -> {diag["watertightAfter"]}')
    print(f'  min wall    {before:.3f}mm -> {after:.3f}mm  (gain {wall_gain:+.3f}, expected {expected_growth:+.3f})')
    print(f'  bbox growth {growth:.3f}mm  (expected {expected_growth:.3f})')
    print(f'  stl         {size:,} bytes   elapsed {diag["elapsedMs"]}ms')

    ok_growth = abs(growth - expected_growth) < 0.02
    ok_wall = abs(wall_gain - expected_growth) < 0.08  # ray samples are ~400 points
    print(f'  verdict     growth {"OK" if ok_growth else "MISMATCH"}, wall {"OK" if ok_wall else "MISMATCH"}')
    return 0 if (ok_growth and ok_wall) else 1


if __name__ == '__main__':
    sys.exit(main())
