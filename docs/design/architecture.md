# 3DP Agent — Architecture & Roadmap

**Status:** living document. Covers the current CAD-native generation, the
planned mesh-generation mode, current-design blind spots, risks, and the
phased roadmap toward a commercial, globally deployable product.

---

## 1. Generation paradigms

The product supports (or will support) two generation paradigms that share one
analysis/export/print backend:

```
             ┌─ CAD mode (current) ──────────────────────────┐
user input ──┤  text → LLM → build123d → STEP + STL          │
             │  (local bridge skill: earthtojake/text-to-cad)│
             └───────────────────────────────────────────────┘
             ┌─ MESH mode (planned) ─────────────────────────┐
             │  text/image → hosted Mesh API (Meshy/Tripo/…) │
             │  → GLB/STL                                     │
             └───────────────────────────────────────────────┘
                        │
                        ▼
   mesh normalize → repair/watertight → decimate → runAnalysisPipeline
                        │
         ┌──────────────┼────────────────┬─────────────────┐
         ▼              ▼                ▼                 ▼
   printability    param panel      mesh ops panel     confidence gate
   report (shared) (CAD mode)      (repair/hollow/…)   (shared)
         │
         ▼
   export (STL/STEP/3MF) → slicing (local/cloud) → print
```

Key principle: **two generation paths, one manufacturing backend.** The
analysis pipeline (`runAnalysisPipeline`, `runConfidenceGate`) is shared and
input-agnostic over STL.

### CAD mode (shipped)

- text → LLM (`build123d` code) or exact-match template → bridge executes via
  the local `cad` skill (`scripts/step`) → STEP (primary) + STL (sidecar).
- Returns `GeneratedModel` including the authored `source` so the client can
  re-edit parameters without regenerating.
- Param editing: `parseParamsFromSource` → `DynamicParamsPanel` (sectioned
  sliders, +/- steppers, undo/redo).

### MESH mode (planned — see §4)

- text/image → hosted mesh-generation API → GLB/STL → repair/decimate →
  the same analysis pipeline.
- Because the mesh API is already cloud-hosted, mesh mode is **commercially
  deployable with no local skill dependency** — simpler than CAD hosting.

---

## 2. Transport layer

Generation execution is behind an interface so local-dev and hosted-prod
paths coexist:

```
CADGenerationTransport            (client/src/design/transport/types.ts)
├── local-bridge   → same-origin /api/cad/generate (vite proxy → Express :3001)
└── remote-proxy   → absolute URL + optional bearer auth; server owns LLM config
                    (never receives the client's keys)
```

Shared POST→validate→decode core in `fetchGeneration.ts` (`postGeneration`).
See also the planned `MeshGenerationProvider` (§4) which mirrors this pattern
with async job submit + poll (Mesh APIs are asynchronous).

---

## 3. Current-design blind spots

These must be addressed before a hosted/commercial deployment:

1. **Untrusted Python execution (critical).** The bridge runs LLM-authored
   `build123d` code with no sandbox. Fine for local dev; an RCE risk once
   hosted. → Phase 0 (§5) sandboxing.
2. **Prompt injection.** User prompt is embedded in the code-gen system
   prompt; adversarial prompts can ask for malicious code. Combined with #1.
3. **Analysis accuracy is unvalidated against real prints.** The confidence
   gate is rule-based with no "did the print actually work" telemetry. Meshy's
   97% slicer-pass claim comes from exactly that data; we have none.
4. **Mesh tolerance affects wall-thickness.** Analysis runs on tessellated
   STL, not exact STEP. Coarse meshes skew the core metric. Mesh tolerance is
   passed through but not validated against truth.
5. **Export is STL-only.** Production needs STEP (CNC), 3MF (multi-color /
   multi-material), GLB (preview/share).
6. **Print path is local single-machine.** Commercial needs cloud slicing,
   job queues, remote printer management.
7. **No tenancy / billing / usage metering.** BYO-key works for dev, not SaaS.
8. **Organic parts are out of scope.** The CAD path cannot produce figurines,
   lattices, or organic surfaces — the reason MESH mode exists.
9. **Offline/template story is weak.** Template fallback is exact-match only;
   design starters always go through the LLM.

---

## 4. Mesh-generation mode design

### `MeshGenerationProvider` (mirrors `CADGenerationTransport`)

```ts
interface MeshGenerationProvider {
  id: 'meshy' | 'tripo' | 'internal';
  generate(req: { prompt: string; refImage?: Blob; format?: 'stl' | 'glb' })
    : Promise<MeshJobHandle>;            // async: submit then poll
  poll(handle: MeshJobHandle): Promise<MeshJobState>;  // progress / result
  isAvailable(): Promise<boolean>;
}
```

- Registry + env selection (`VITE_MESH_PROVIDER`, provider keys).
- Async job + poll → natural fit for cloud generation, progress UI, cancel.
- Pluggable: Meshy/Tripo APIs first, open-source (TripoSR / Stable Fast 3D /
  TRELLIS) or self-hosted `internal` later.
- Result is STL → feeds the existing analysis pipeline unchanged.

### Mesh post-processing (the value layer — raw AI meshes aren't printable)

```
GLB/STL → normalize units (mm) → repair to watertight → decimate (<500k tris)
        → BufferGeometry → runAnalysisPipeline
```

Reusable via the cadpy skill or trimesh/pymeshfix. Mesh mode's right panel is a
**mesh ops panel** (repair / hollow / split / decimate) instead of the CAD
param sliders.

### Integration points

| Existing | Mesh-mode integration |
|---|---|
| `CADGenerationTransport` / `remoteProxy` | parallel `MeshGenerationProvider`; mode toggle at UI level |
| `runAnalysisPipeline` | shared, input-agnostic over STL |
| `runConfidenceGate` | shared; add AI-mesh calibration (risk #3) |
| `DynamicParamsPanel` | CAD mode only; mesh mode uses mesh-ops panel |
| `downloadSTL` | grow into multi-format exporter (STL/STEP/3MF/GLB) |

---

## 5. Phased roadmap

**Status (2026-08):** Phase 0 and Phase 1 are shipped. Remaining work is Phase 2
(deployment-dependent) and Phase 3 (long-term moat).

### Phase 0 — Foundation ✅
- **Sandbox untrusted build123d execution** ✅ — `server/cadSandbox.ts`:
  isolated interpreter (`-I`), sanitized env, ulimits, and a denylist that
  rejects dangerous imports/calls before execution. End-to-end verified.
- **Telemetry hook** ✅ (partial) — `client/src/lib/printFeedback.ts` records
  per-model print outcomes in localStorage (the confidence-gate calibration
  seed). A hosted analytics endpoint can replace localStorage later.

### Phase 1 — Mesh mode ✅
- `MeshGenerationProvider` (async submit + poll) + Tripo provider (mock-tested)
  + local mock provider (keyword → primitive, real STL). Factory picks Tripo
  when `VITE_TRIPO_API_KEY` is set, else the mock.
- **Mesh Studio** UI — examples, REGENERATE, STL/3MF export, printability
  report, print feedback.
- **Server mesh processing** — `POST /api/mesh/process` runs trimesh in a
  sandboxed interpreter: diagnostics, best-effort watertight repair, decimate,
  place-on-plate.
  - Caveat: watertight **repair is best-effort** — `trimesh.fill_holes` /
    `pymeshfix` are incompatible with the venv's numpy 2.x, so repair degrades
    to diagnostics + decimation. A controlled environment (or pinned numpy) in
    a hosted deployment enables full repair.

### Phase 2 — Commercialization ⬜
- Cloud slicing/print, tenancy, billing, usage metering. The `remoteProxy`
  transport already exists (`client/src/design/transport/remoteProxy.ts`) and
  is ready to target a hosted CAD/mesh backend.

### Phase 3 — Moat ⬜
- Print-outcome telemetry flywheel (Phase 0 seed → hosted analytics → confidence
  gate calibration); mesh→CAD reverse (fit AI meshes back to parametric CAD).

---

## 6. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Untrusted Python execution / RCE | high | Phase 0 sandbox (container + seccomp + no net + limits) |
| Prompt injection | high | input validation, prompt hardening, sandboxed execution |
| AI-mesh quality → analysis accuracy | medium | repair + decimate before analysis; validate pipeline on AI meshes; annotate tolerance |
| Provider dependency (Meshy/Tripo API) | medium | provider abstraction, multi-vendor, fallback; review ToS/licensing of generated assets |
| Generation cost | medium | caching, retry caps, usage metering, tiering |
| Analysis perf on large meshes | low | decimate to budget, worker thread, lazy analysis |
| Confidence gate uncalibrated | medium | print-outcome telemetry (§5 Phase 0) |
