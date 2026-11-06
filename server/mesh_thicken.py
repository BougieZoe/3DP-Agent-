"""True wall thickening for the mesh bridge (server-side solid offset).

Why this lives on the server: a real offset is a Minkowski sum with a ball.
Measured (see scripts/verify-offset-feasibility.mjs), the WASM build needs
~10-23 s on a 5k-triangle model, which rules out the browser; the native
build does the same work in 1.5-3 s.

Contract (mirrors mesh_process.py — file in, file out, JSON sidecar):

    python -I mesh_thicken.py in.stl out.stl delta_mm diag.json [segments]

Exit codes:
    0  offset applied; out.stl written; diag.status == "ok"
    2  input is not a closed solid — nothing written (repair first)
    3  input exceeds the triangle budget — nothing written
    1  any other failure (message in diag.error)

The sidecar is the only machine-readable channel: manifold3d/trimesh print to
stdout and would corrupt a one-line JSON contract, same reasoning as
mesh_process.py.

Dependencies: numpy, manifold3d (>=3.5). Not installed by this file.
"""

import json
import struct
import sys
import time

import numpy as np
from manifold3d import Manifold, Mesh, Error

# A ball offset of delta per surface doubles that in wall thickness, so a 2mm
# delta is already a 4mm-per-side redesign. Cap it.
MAX_DELTA_MM = 2.0
MIN_DELTA_MM = 0.02
# Measured: ~0.29 ms per input triangle at delta 0.15 (8-segment sphere), so
# 80k keeps a 25-30 s budget. Raise only with a longer bridge timeout.
MAX_INPUT_TRIANGLES = 80_000
# Sphere resolution: 8 segments is a faceted ball (r=0.15 -> 0.002mm facet
# error at 8 segments is ~0.6%), enough for a thickening offset.
DEFAULT_SEGMENTS = 8


def parse_binary_stl(path):
    """Binary STL -> (vertices[N,3] float32, faces[M,3] uint32), deduplicated."""
    with open(path, "rb") as fh:
        data = fh.read()
    if len(data) < 84:
        raise ValueError("file too short to be a binary STL")
    n = struct.unpack_from("<I", data, 80)[0]
    if len(data) != 84 + n * 50:
        raise ValueError("not a binary STL (size does not match facet count)")
    raw = np.frombuffer(data, dtype=np.uint8, count=n * 50, offset=84).reshape(n, 50)
    tris = raw[:, 12:48].copy().view("<f4").reshape(n, 3, 3).astype(np.float64)
    flat = tris.reshape(-1, 3)
    # STL is a triangle soup; manifold needs shared vertices to find adjacency.
    uniq, inverse = np.unique(np.round(flat, 4), axis=0, return_inverse=True)
    faces = inverse.reshape(-1, 3).astype(np.uint32)
    return uniq.astype(np.float32), faces


def to_manifold(vertices, faces):
    return Manifold(Mesh(vert_properties=vertices, tri_verts=faces))


def _face_samples(man, limit=400):
    """Outward normals + centroids for a bounded, deterministic sample set."""
    mesh = man.to_mesh()
    verts = np.asarray(mesh.vert_properties, dtype=np.float64).reshape(-1, 3)
    tris = np.asarray(mesh.tri_verts, dtype=np.int64).reshape(-1, 3)
    if len(tris) == 0:
        return np.zeros((0, 3)), np.zeros((0, 3))
    # Deterministic stride, not random: the same model must report the same
    # number every run, or the before/after comparison is noise.
    step = max(1, len(tris) // limit)
    tris = tris[::step][:limit]
    a, b, c = verts[tris[:, 0]], verts[tris[:, 1]], verts[tris[:, 2]]
    normals = np.cross(b - a, c - a)
    lengths = np.linalg.norm(normals, axis=1)
    good = lengths > 1e-12
    normals = normals[good] / lengths[good][:, None]
    centroids = (a[good] + b[good] + c[good]) / 3.0
    return centroids, normals


def measure_min_wall_mm(man, max_probe_mm=50.0):
    """Approximate minimum wall thickness by casting inward from the surface.

    Same idea as the client's ray-based measurement, so the numbers are
    comparable rather than two different definitions of "wall".
    """
    centroids, normals = _face_samples(man)
    if len(centroids) == 0:
        return None
    thinnest = None
    for point, normal in zip(centroids, normals):
        origin = point - normal * 1e-4
        endpoint = point - normal * max_probe_mm
        hits = man.ray_cast(origin.tolist(), endpoint.tolist())
        if not hits:
            continue
        # distance is a fraction of the probe segment
        wall = float(hits[0].distance) * max_probe_mm
        if wall <= 1e-4:
            continue
        if thinnest is None or wall < thinnest:
            thinnest = wall
    return thinnest


def thicken(vertices, faces, delta_mm, segments=DEFAULT_SEGMENTS):
    """Ball-offset a closed mesh by delta_mm per surface (wall grows by 2*delta)."""
    solid = to_manifold(vertices, faces)
    if solid.status() != Error.NoError:
        raise ValueError(f"manifold rejected the input (status {solid.status()})")
    ball = Manifold.sphere(delta_mm, segments)
    return solid.minkowski_sum(ball)


def _bbox(man):
    # Python binding flattens to (xmin, ymin, zmin, xmax, ymax, zmax)
    box = np.asarray(man.bounding_box(), dtype=float).ravel()
    return [float(v) for v in box[:3]], [float(v) for v in box[3:6]]


def main() -> None:
    if len(sys.argv) < 5:
        print("usage: mesh_thicken.py in.stl out.stl delta_mm diag.json [segments]", file=sys.stderr)
        sys.exit(1)

    in_path, out_path, delta_raw, diag_path = sys.argv[1:5]
    segments = int(sys.argv[5]) if len(sys.argv) > 5 else DEFAULT_SEGMENTS
    started = time.time()

    diag = {
        "status": "error",
        "deltaMm": None,
        "segments": segments,
        "inputTriangles": None,
        "outputTriangles": None,
        "watertightBefore": None,
        "watertightAfter": None,
        "volumeBeforeMm3": None,
        "volumeAfterMm3": None,
        "minWallBeforeMm": None,
        "minWallAfterMm": None,
        "growthMm": None,
        "elapsedMs": None,
        "error": "",
    }

    def finish(code: int) -> None:
        diag["elapsedMs"] = int((time.time() - started) * 1000)
        with open(diag_path, "w", encoding="utf-8") as fh:
            json.dump(diag, fh)
        sys.exit(code)

    try:
        delta = float(delta_raw)
    except ValueError:
        diag["error"] = f"delta is not a number: {delta_raw!r}"
        finish(1)
    if not (MIN_DELTA_MM <= delta <= MAX_DELTA_MM):
        diag["error"] = f"delta {delta}mm outside [{MIN_DELTA_MM}, {MAX_DELTA_MM}]"
        finish(1)
    diag["deltaMm"] = delta

    try:
        vertices, faces = parse_binary_stl(in_path)
    except Exception as exc:  # noqa: BLE001 - reported, never raised to the router
        diag["error"] = f"parse failed: {exc}"
        finish(1)

    diag["inputTriangles"] = int(len(faces))
    if len(faces) > MAX_INPUT_TRIANGLES:
        diag["status"] = "too_large"
        diag["error"] = f"{len(faces)} triangles exceeds the {MAX_INPUT_TRIANGLES} budget"
        finish(3)

    try:
        solid = to_manifold(vertices, faces)
    except Exception as exc:  # noqa: BLE001
        diag["status"] = "not_closed"
        diag["watertightBefore"] = False
        diag["error"] = f"not a closed solid: {exc}"
        finish(2)

    if solid.status() != Error.NoError:
        diag["status"] = "not_closed"
        diag["watertightBefore"] = False
        diag["error"] = f"manifold status {solid.status()} — open or non-manifold"
        finish(2)

    diag["watertightBefore"] = True
    diag["volumeBeforeMm3"] = float(solid.volume())
    diag["minWallBeforeMm"] = measure_min_wall_mm(solid)
    before_lo, before_hi = _bbox(solid)

    try:
        result = solid.minkowski_sum(Manifold.sphere(delta, segments))
    except Exception as exc:  # noqa: BLE001
        diag["error"] = f"offset failed: {exc}"
        finish(1)

    if result.is_empty() or result.num_tri() == 0:
        diag["status"] = "empty_result"
        diag["error"] = "offset produced no geometry"
        finish(1)

    diag["status"] = "ok"
    diag["watertightAfter"] = result.status() == Error.NoError
    diag["outputTriangles"] = int(result.num_tri())
    diag["volumeAfterMm3"] = float(result.volume())
    diag["minWallAfterMm"] = measure_min_wall_mm(result)
    after_lo, after_hi = _bbox(result)
    # A ball offset grows every axis by exactly 2*delta; anything else means
    # the operator or the input was not what we think it is.
    growth = max(
        (after_hi[i] - after_lo[i]) - (before_hi[i] - before_lo[i]) for i in range(3)
    )
    diag["growthMm"] = float(growth)

    mesh = result.to_mesh()
    verts = np.asarray(mesh.vert_properties, dtype=np.float32).reshape(-1, 3)
    tris = np.asarray(mesh.tri_verts, dtype=np.uint32).reshape(-1, 3)
    write_binary_stl(out_path, verts, tris)

    finish(0)


def write_binary_stl(path, vertices, faces):
    """Write a binary STL with per-face normals (manifold does not ship an STL writer)."""
    a = vertices[faces[:, 0]]
    b = vertices[faces[:, 1]]
    c = vertices[faces[:, 2]]
    normals = np.cross(b - a, c - a)
    lengths = np.linalg.norm(normals, axis=1)
    lengths[lengths == 0] = 1.0
    normals = normals / lengths[:, None]

    header = b"3dp-agent thicken".ljust(80, b" ")
    with open(path, "wb") as fh:
        fh.write(header)
        fh.write(struct.pack("<I", len(faces)))
        packed = np.zeros((len(faces), 12), dtype=np.float32)
        packed[:, 0:3] = normals
        packed[:, 3:6] = a
        packed[:, 6:9] = b
        packed[:, 9:12] = c
        # 12 floats + uint16 attribute byte count
        for row in packed:
            fh.write(row.tobytes())
            fh.write(b"\x00\x00")


if __name__ == "__main__":
    main()
