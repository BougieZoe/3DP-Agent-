#!/usr/bin/env python3
"""Convert an ASCII USDA mesh scene to a single binary STL.

Why: Objaverse (and Sand3D) ship .usda, which the app does not read. USDA is
plain text, so a self-contained converter is ~80 lines and needs no USD
runtime. Every `def Mesh` contributes its triangles; nested Xforms are ignored
because the scenes we import carry identity transforms on the meshes
(`xformOp:` count on meshes is 0 in the Sportbike asset).

Usage:
  python3 scripts/usda-to-stl.py in.usda out.stl [--scale 1000] [--report]

`--scale 1000` converts metres to millimetres (USDA metersPerUnit = 1).
"""
import argparse
import re
import struct
import sys


def parse_mesh_blocks(text):
    # Split on `def Mesh "name"` so each block owns its arrays.
    parts = re.split(r'def Mesh "([^"]+)"', text)
    # parts = [prologue, name1, body1, name2, body2, ...]
    for i in range(1, len(parts) - 1, 2):
        name, body = parts[i], parts[i + 1]
        yield name, body


def numbers(block, pattern):
    m = re.search(pattern, block, re.S)
    if not m:
        return None
    return [float(x) if ('.' in x or 'e' in x.lower()) else int(x)
            for x in re.findall(r'-?\d+(?:\.\d*)?(?:[eE][-+]?\d+)?', m.group(1))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('dst')
    ap.add_argument('--scale', type=float, default=1.0)
    ap.add_argument('--rotate-x', type=float, default=0.0,
                    help='degrees about X after scaling (Z-up scenes often need -90)')
    ap.add_argument('--rotate-y', type=float, default=0.0,
                    help='degrees about Y after scaling (use it to land a 3/4 view)')
    ap.add_argument('--report', action='store_true')
    args = ap.parse_args()

    text = open(args.src, encoding='utf-8', errors='replace').read()
    verts = []          # flat xyz
    faces = []          # flat triangle indices (global)
    tris = 0
    for name, body in parse_mesh_blocks(text):
        pts = numbers(body, r'point3f\[\] points = \[(.*?)\]\s*\n')
        idx = numbers(body, r'int\[\] faceVertexIndices = \[(.*?)\]\s*\n')
        if pts is None or idx is None:
            if args.report:
                print(f'  skip {name}: no points/indices', file=sys.stderr)
            continue
        if len(pts) % 3 or len(idx) % 3:
            raise SystemExit(f'{name}: non-xyz points or non-triangle indices')
        base = len(verts) // 3
        verts.extend(v * args.scale for v in pts)
        faces.extend(i + base for i in idx)
        tris += len(idx) // 3
        if args.report:
            print(f'  {name:24s} verts={len(pts)//3:6d} tris={len(idx)//3:6d}')

    if not faces:
        raise SystemExit('no triangles found')

    if args.rotate_x or args.rotate_y:
        import math
        if args.rotate_x:
            a = math.radians(args.rotate_x)
            ca, sa = math.cos(a), math.sin(a)
            for i in range(0, len(verts), 3):
                y, z = verts[i + 1], verts[i + 2]
                verts[i + 1] = y * ca - z * sa
                verts[i + 2] = y * sa + z * ca
        if args.rotate_y:
            a = math.radians(args.rotate_y)
            ca, sa = math.cos(a), math.sin(a)
            for i in range(0, len(verts), 3):
                x, z = verts[i], verts[i + 2]
                verts[i] = x * ca + z * sa
                verts[i + 2] = -x * sa + z * ca

    with open(args.dst, 'wb') as fh:
        fh.write(b'sand3d usda->stl'.ljust(80, b' '))
        fh.write(struct.pack('<I', tris))
        for t in range(tris):
            a, b, c = (faces[t * 3] * 3, faces[t * 3 + 1] * 3, faces[t * 3 + 2] * 3)
            ax, ay, az = verts[a:a + 3]
            bx, by, bz = verts[b:b + 3]
            cx, cy, cz = verts[c:c + 3]
            ux, uy, uz = bx - ax, by - ay, bz - az
            vx, vy, vz = cx - ax, cy - ay, cz - az
            nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
            ln = (nx * nx + ny * ny + nz * nz) ** 0.5 or 1.0
            fh.write(struct.pack('<12fH', nx / ln, ny / ln, nz / ln,
                                 ax, ay, az, bx, by, bz, cx, cy, cz, 0))

    print(f'{args.dst}: {tris} triangles, {len(verts)//3} vertices, scale={args.scale}')


if __name__ == '__main__':
    main()
