"""Mesh post-processing: diagnostics + best-effort repair + decimate.

Runs inside the sandboxed CAD venv (trimesh + fast-simplification). Called by
the /api/mesh/process endpoint.

Input : sys.argv[1] input STL path
        sys.argv[2] output STL path
        sys.argv[3] target triangle count (0 = no decimation)
Output: a JSON diagnostics object on stdout.
"""
import sys
import json

import trimesh


def main() -> None:
    in_path, out_path = sys.argv[1], sys.argv[2]
    decimate_to = int(sys.argv[3]) if len(sys.argv) > 3 else 0

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
            trimesh.repair.fill_holes(loaded)
            diag["repaired"] = bool(loaded.is_watertight)
            if not diag["repaired"]:
                diag["repairNote"] = (diag["repairNote"] + " | fill_holes did not close").strip()
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
    print(json.dumps(diag))


if __name__ == "__main__":
    main()
