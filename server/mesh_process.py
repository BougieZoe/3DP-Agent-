"""Mesh post-processing: diagnostics + best-effort repair + decimate.

Runs inside the sandboxed CAD venv (trimesh + fast-simplification). Called by
the /api/mesh/process endpoint.

Output: a JSON diagnostics object, written to a SIDECAR FILE (argv[4]) rather
than printed to stdout — trimesh/pymeshfix emit warnings on stdout that would
otherwise corrupt a one-line JSON contract.
"""
import sys
import json

import numpy as np
import trimesh
import pymeshfix


def main() -> None:
    in_path, out_path = sys.argv[1], sys.argv[2]
    decimate_to = int(sys.argv[3]) if len(sys.argv) > 3 else 0
    diag_path = sys.argv[4] if len(sys.argv) > 4 else ""

    loaded = trimesh.load(in_path, file_type="stl", force="mesh")
    if not isinstance(loaded, trimesh.Trimesh):
        loaded = trimesh.util.concatenate(list(loaded.dump()))

    # Place the model on the build plate: center X/Y, sit Z at 0.
    if loaded.bounds is not None:
        lo, hi = loaded.bounds
        loaded.apply_translation([-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]])

    diag: dict = {
        "triangleCount": int(len(loaded.faces)),
        "watertight": bool(loaded.is_watertight),
        "volumeMm3": float(loaded.volume) if loaded.is_watertight else None,
        "surfaceAreaMm2": float(loaded.area),
        "boundsMm": [float(x) for x in loaded.bounds.flatten()] if loaded.bounds is not None else None,
        "repaired": False,
        "repairNote": "",
    }
    try:
        diag["bodyCount"] = int(len(loaded.split(only_watertight=False)))
    except Exception as e:  # noqa: BLE001
        diag["bodyCount"] = None
        diag["repairNote"] = f"split: {str(e)[:120]}"

    if not loaded.is_watertight:
        try:
            # pymeshfix needs read-only, C-contiguous numpy arrays (numpy 1.x).
            verts = np.ascontiguousarray(loaded.vertices, dtype=np.float64)
            verts.setflags(write=False)
            tris = np.ascontiguousarray(loaded.faces, dtype=np.int32)
            tris.setflags(write=False)
            mfix = pymeshfix.MeshFix(verts, tris)
            mfix.repair()
            repaired = trimesh.Trimesh(
                vertices=np.asarray(mfix.points),
                faces=np.asarray(mfix.faces),
                process=False,
            )
            if repaired.is_watertight:
                loaded = repaired
                diag["repaired"] = True
            else:
                diag["repairNote"] = (diag["repairNote"] + " | pymeshfix did not close").strip()
        except Exception as e:  # noqa: BLE001
            diag["repairNote"] = (diag["repairNote"] + f" | repair: {str(e)[:160]}").strip()

    if decimate_to > 0 and len(loaded.faces) > decimate_to:
        try:
            loaded = loaded.simplify_quadric_decimation(face_count=decimate_to)
        except Exception as e:  # noqa: BLE001
            diag["repairNote"] = (diag["repairNote"] + f" | decimate: {str(e)[:120]}").strip()

    loaded.export(out_path, file_type="stl")
    diag["triangleCount"] = int(len(loaded.faces))
    diag["watertight"] = bool(loaded.is_watertight)
    diag["volumeMm3"] = float(loaded.volume) if loaded.is_watertight else None
    diag["surfaceAreaMm2"] = float(loaded.area)
    if diag_path:
        with open(diag_path, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(diag))


if __name__ == "__main__":
    main()
