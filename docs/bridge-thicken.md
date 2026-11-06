# Bridge thicken — interface + validation protocol

Status: **worker and CLI validated; the Express route is not wired yet.**
This document is the contract to implement against.

## Why it lives on the server

A true wall thicken is a solid offset: Minkowski sum with a ball of radius
`delta`, which grows every wall by `2*delta`. Measured on the same 5,096-triangle
model:

| runtime | 8-seg sphere | 16-seg sphere |
|---|---|---|
| browser (WASM) | 9.7 s | 22.7 s |
| native (Python) | 1.6 s | 3.2 s |

Native is fast enough for a bridge; WASM is not (see
`scripts/verify-offset-feasibility.mjs` and the AGENTS.md record).

## Worker contract

`server/mesh_thicken.py` — same shape as `mesh_process.py`: files in/out, JSON
sidecar, never stdout.

```
python -I mesh_thicken.py in.stl out.stl delta_mm diag.json [segments]
```

| exit | `diag.status` | meaning |
|---|---|---|
| 0 | `ok` | `out.stl` written; watertight result |
| 2 | `not_closed` | input is not a closed solid — repair first, nothing written |
| 3 | `too_large` | input over the triangle budget, nothing written |
| 1 | `error` / `empty_result` | failure; `diag.error` has the reason |

Sidecar fields: `status, deltaMm, segments, inputTriangles, outputTriangles,
watertightBefore, watertightAfter, volumeBeforeMm3, volumeAfterMm3,
minWallBeforeMm, minWallAfterMm, growthMm, elapsedMs, error`.

Limits: `delta` 0.02–2.0 mm, input ≤ 80,000 triangles (~25 s at delta 0.15),
timeout 90 s.

## HTTP route (to implement)

```
POST /api/mesh/thicken
  auth:   BRIDGE_TOKEN, or loopback dev gate (server/loopbackGuard.ts)
  body:   { "stlBase64": string, "deltaMm": number, "segments"?: number }
  200:    { "status": "ok", "stlBase64": string, "diagnostics": { ...sidecar } }
  422:    { "status": "not_closed", "diagnostics": { ... } }
  413:    { "status": "too_large", "diagnostics": { ... } }
  400/500:{ "status": "error", "error": string }
```

Rationale for base64 rather than multipart: the client already sends STL bytes
as base64 to `/api/mesh/process`; keep one encoding across the bridge.

## Client-side validation protocol (mandatory)

The bridge returning `status: "ok"` is **not** sufficient to accept the change.
The client must:

1. re-run the local analysis on the returned mesh;
2. keep the result only if `p5WallThicknessMm` improved by > 0.01 mm
   (`isThickenImprovement`) **and** the mesh is watertight;
3. otherwise discard and record a version with `outcome: "discarded"`;
4. on success record a version with the bridge note (delta + triangle counts)
   so the change report can show it.

This is the same policy the local offset already follows — the bridge changes
where the geometry comes from, not what makes a change acceptable.

## Calibration (measured with `scripts/verify-bridge-thicken.py`)

| input tris | elapsed | wall before → after | bbox growth |
|---|---|---|---|
| 5,096 | 1.6 s | 0.490 → 0.800 mm | 0.300 mm (= 2δ) |
| 20,376 | 5.9 s | — | 0.300 mm |

Both properties hold exactly: growth is `2*delta`, and the measured minimum
wall gains the same amount. Open meshes are rejected before any work is done.

## Dependency

`manifold3d >= 3.5` in the mesh bridge venv (`.cad-bridge/mesh-venv`):

```
pip install "manifold3d>=3.5"
```

No other new dependency: STL parse/write is in the worker, and thickness is
measured with manifold's own `ray_cast`, so the number is comparable to the
client's ray-based measurement.
