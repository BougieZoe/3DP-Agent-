# Post-Refactor Architecture Review

**Project:** 3DP-Agent  
**Reviewer:** Staff Engineer  
**Date:** 2026-07-15  

---

## P0 — Must Fix

### 1. `sampleWallThickness` runs O(n²) ray intersections on the main thread

**File:** `client/src/analysis/wallThickness.ts:116–158`  
**Risk:** For a 100K-triangle STL, the outer loop samples 200 faces and the inner loop iterates all triangles — **20 million ray-triangle intersection tests** per upload. Each test calls `rayTriangleIntersection` (Möller–Trumbore, multiple cross/dot products). The entire analysis pipeline (`computeMetrics` → `sampleWallThickness`) runs synchronously on the main thread, blocking the UI for seconds on large models.  
**Fix:** Move `runAnalysisPipeline` (or at least `computeMetrics`) into a Web Worker. The pipeline is pure-data (no DOM access). At minimum, use `Promise.all` to parallelize the four sub-computations (volume, surface area, overhang, wall thickness).

---

### 2. `printReviewWorkflow.ts:109` — type-unsafe `report as unknown as ModelAnalysis`

**File:** `client/src/lib/printReviewWorkflow.ts:109`  
**Risk:** `createAnalysisReport` returns an `AnalysisReport` (string document with `id`, `source`, `format`, `content`, `generatedAt`). This is cast via `as unknown as ModelAnalysis` — a completely unrelated type with `source`, `metrics`, `findings`, `legacy` fields. Any downstream access of `ModelAnalysis` fields on this value will produce `undefined` at runtime. This is either a bug or indicates that `createAnalysisReport` has the wrong return type.  
**Fix:** Determine the correct return type and eliminate the double-cast.

---

### 3. Zero test coverage on the agent system, pipeline orchestration, and all UI components

| Area | Files | Lines |
|------|-------|-------|
| Agent system | `client/src/agents/` (9 files) | ~1,600 |
| Pipeline orchestration | `client/src/analysis/pipeline.ts` | 93 |
| CAD generation | `client/src/lib/cadGenerator.ts` | 238 |
| Causality engine | `client/src/components/causality/` (7 files) | ~850 |
| All React components | `client/src/pages/`, `client/src/components/` | ~5,000+ |

**Root cause:** The test environment is `node` (not `jsdom`/`happy-dom`), and `@testing-library/react` is not installed. React component rendering is impossible.  
**Risk:** Race conditions in `reanalyzeWithMaterial` (material switching, `materialRequestSeq` guard), agent debate convergence logic, CAD parameter extraction regexes, and causality graph construction are entirely untested.  
**Fix:** Add `@testing-library/react` + `happy-dom`, add vitest jsdom environment, and write unit tests for the agent orchestration logic (pure functions), CAD parameter extraction, and critical UI state flows.

---

### 4. `three-stdlib` imported as a barrel — pulls in ~2MB+ for a single export

**Files:** `client/src/lib/cadGenerator.ts:193`, `client/src/components/CADWorkspace.tsx:12`  
**Risk:** `import { STLExporter } from 'three-stdlib'` barrel-imports the entire library. Vite cannot tree-shake named imports from barrel files effectively. Only `STLExporter` is used (~50KB standalone).  
**Fix:** Import directly from the sub-path: `import { STLExporter } from 'three/examples/jsm/exporters/STLExporter'`, or lazy-import the exporter in CAD workspace mode.

---

## P1 — Should Fix

### 5. Previous geometry not disposed on STL re-upload (memory leak)

**File:** `client/src/pages/Home.tsx:112–130`  
**Risk:** Each STL upload creates a new `THREE.BufferGeometry` + `Mesh`. The old objects are orphaned by the state setter with no `dispose()` call. GPU memory accumulates over successive uploads.  
**Fix:** Store the previous model in a ref and call `dispose()` before setting the new one.

### 6. MaterialContext value not memoized — cascading re-renders

**File:** `client/src/contexts/MaterialContext.tsx:14–21`  
**Risk:** The context value object `{ material, materialName, setMaterialName }` is recreated on every render of `MaterialProvider`. All 4+ consumers (`Home`, `ChatPanel`, `CADWorkspace`, via `useMaterial()`) re-render on any ancestor re-render, not just on material change.  
**Fix:** Wrap the `value` in `useMemo` keyed on `materialName`.

### 7. Agent files use `as unknown as Record<string, unknown>` — bypasses generic type parameter

**Files:** `client/src/agents/geometryAnalyst.ts:107`, `optimizationAdvisor.ts:81`, `failurePredictor.ts:105`, `printabilityScorer.ts:76`  
**Risk:** Each agent defines a strongly-typed `details` object (e.g., `OptimizationAdvisorDetails`), then double-casts it to `Record<string, unknown>` to pass to `BaseAgent.makeOutput()`. This bypasses the generic `THelpers` type parameter on `AgentOutput`, losing type safety on agent output shapes.  
**Fix:** Parameterize `BaseAgent.makeOutput<T>()` so the details type flows through generically instead of requiring casts.

### 8. `framer-motion` listed as a dependency but never imported

**File:** `package.json:49`  
**Risk:** `framer-motion@12.23.22` (~150KB minified) is bundled into the main chunk with zero usage anywhere in the source. This is dead weight on the critical path.  
**Fix:** Remove from `package.json`.

### 9. `reportTypes.ts` defines `Language` as `"en" | "ja"` — excludes `"zh"`

**File:** `client/src/components/reportTypes.ts:6`, diverging from `client/src/lib/i18n.ts:6` (which supports `"en" | "ja" | "zh"`).  
**Risk:** The report/PDF system (`pdfGenerators.ts`, `reportUtils.ts`) cannot produce Chinese reports. Any `zh` input to `ReportGenerator` will silently fall back or produce incorrect output.  
**Fix:** Sync the `Language` type to include `"zh"`.

### 10. `topologyPatternEngine.ts` has a dead local `MarkerInput` interface

**File:** `client/src/components/causality/topologyPatternEngine.ts:1–5`  
**Risk:** `interface MarkerInput` is defined locally but never exported. The same interface is already exported from `causalityEngine.ts:34`. The local definition shadows it and can drift independently. `detectPatterns` uses the local unexported version, so callers passing the exported type from `causalityEngine.ts` are not type-checked against it.  
**Fix:** Remove the local definition and import from `causalityEngine.ts`.

### 11. `reportUtils.ts` imports `useCallback` from React but never uses it

**File:** `client/src/components/reportUtils.ts`  
**Risk:** Dead import — does not cause runtime issues but clutters the dependency graph.  
**Fix:** Remove unused import.

---

## P2 — Worth Tracking

### 12. Home.tsx is a god component with 21 `useState` hooks

**File:** `client/src/pages/Home.tsx`  
**Risk:** The component manages model data, 7 overlay toggles, 3 selection IDs, agent runs, and UI mode in a single scope. Every state change re-renders the full component including all 3D scene children. The monolith imports from 15+ modules and directly orchestrates analysis, agents, causality, i18n, and rendering.  
**Mitigation:** The recent extraction of 9 sub-components (`SceneContent`, `AnalysisHeader`, `GeometryTab`, etc.) helped, but the remaining 560-line shell still carries too much responsibility. Consider extracting the analysis orchestration into a custom hook and splitting the right panel into lazy-loaded tab components.

### 13. `unifiedToAnalysisSummary` duplicates `unifiedToModelData` transformation logic

**File:** `client/src/pages/Home.tsx:47–79` vs `client/src/lib/ruleEngine.ts:35–74`  
**Risk:** Two functions traverse the same `UnifiedAnalysis` object to produce similar summary structures. They will drift over time as new fields are added.  
**Fix:** Consolidate into a single transformation function, or have the Home version call the ruleEngine version and adapt the result.

### 14. 8+ `useFrame` callbacks run simultaneously (up to ~90 in worst case)

**Files:** Multiple 3D components (PrintPathPreview, LayerReveal, FailureEmergence, ThermalField, CognitiveScan, AttentionPulse, FloatingParticles, ModelDisplay, RiskAnimation)  
**Risk:** Each callback independently runs trig math per frame. RiskAnimation's 25 `PulsingSphere` instances and FailureEmergence's 45 sub-components multiply this.  
**Mitigation:** Use `InstancedMesh` for repeated geometries. Consolidate frame logic into a single orchestrator where feasible.

### 15. `RiskAnimation` still uses `clock.getElapsedTime()` — clock drift from `progressRef`

**File:** `client/src/components/3D/RiskAnimation.tsx:32`  
**Risk:** Acknowledged in AGENTS.md as a known issue. The risk spheres animate independently from the playback system, creating visual desync when playback is paused.  
**Fix:** Refactor to use `usePrintPlayback().progressRef`.

### 16. `OverhangHeatmap` and `SupportGhosts` geometries are never disposed

**Files:** `client/src/components/3D/OverhangHeatmap.tsx:58–64`, `client/src/components/3D/SupportGhosts.tsx:10–30`  
**Risk:** Derived `BufferGeometry` objects created in `useMemo` accumulate in GPU memory when props change or the component unmounts.  
**Fix:** Add `useEffect` cleanup that calls `dispose()`.

### 17. `AttentionPulse.lastTriggered` Map grows unboundedly

**File:** `client/src/components/3D/AttentionPulse.tsx:59`  
**Risk:** The `Map<string, number>` accumulates entries as new markers are scanned. No eviction strategy exists.  
**Fix:** Evict entries older than a threshold (e.g., 30s) or limit map size.

### 18. `!` non-null assertion on potentially empty geometry in `geometryEditor.ts:70`

**File:** `client/src/lib/geometryEditor.ts:70`  
**Risk:** `computeBoundingBox()` returns `null` for empty geometries. The `!` assertion will crash at runtime on degenerate input.  
**Fix:** Guard with an early return or optional chaining.

### 19. `orchestrator.ts` uses empty `Record<AgentId, number>` casts — silent undefined access

**File:** `client/src/agents/orchestrator.ts:148–149, 205–206, 210–212`  
**Risk:** `{} as Record<AgentId, number>` makes the type checker believe all keys exist. Accessing a missing key silently returns `undefined` while the type says `number`.  
**Fix:** Use `Partial<Record<AgentId, number>>` or initialize with all keys present.

### 20. Benchmark timing tests are inherently flaky on different hardware

**File:** `client/src/analysis/__tests__/benchmarks.test.ts`  
**Risk:** Timing assertions like `expect(t).toBeLessThan(500)` for 20K-triangle operations depend on CPU speed. A CI runner or M-series Mac vs Intel will produce different timings.  
**Fix:** Use relative comparisons (e.g., 20K < 2* 2K) rather than absolute wall-clock thresholds.

### 21. `stlLoader.test.ts` mocks Three.js entirely — tests the mock, not the real code

**File:** `client/src/lib/__tests__/stlLoader.test.ts`  
**Risk:** 14 `vi.mock` calls for Three.js modules. The actual STL loading and mesh creation code is never exercised. This test provides near-zero confidence.  
**Fix:** Use a real small STL fixture file and test against real Three.js types. Or remove the test if component-level rendering tests will cover this path.

### 22. `client/src/lib/cadGenerator.ts` — `createCADDesignAI` and `extractParamsFromPrompt` have zero tests despite complex regex logic

**File:** `client/src/lib/cadGenerator.ts` (238 lines)  
**Risk:** 10+ regex patterns for parameter extraction from natural language prompts. No tests for edge cases (missing params, out-of-range values, non-English prompts, ambiguous dimensions).  
**Fix:** Add parameterized unit tests covering all regex extraction paths and boundary conditions.

### 23. No `@testing-library/react` — all UI render logic is untestable

**Dependencies:** Nowhere in `package.json`  
**Risk:** All React component logic (state management, event handlers, conditional rendering) can only be verified manually. Critical paths like the `reanalyzeWithMaterial` race guard, tab switching, and report generation are invisible to CI.  
**Fix:** Add `@testing-library/react` + `happy-dom` to devDependencies and configure vitest with a `jsdom` environment for component tests.

---

## Module Dependency Health

| Check | Result |
|-------|--------|
| Circular dependencies | **0 found** — graph is acyclic |
| `components/` → `pages/` imports | **0** (correct) |
| `lib/` → `components/` imports | **0** (correct) |
| `analysis/` → `lib/` or `components/` imports | **0** (correct — analysis is pure) |
| `// @ts-ignore` / `@ts-expect-error` in app code | **0** |
| `strict: true` in tsconfig | ✅ Enabled |
| `as const` misuse | **0** — all 13 usages are appropriate for config objects |

---

## Summary by Severity

| Priority | Count | Key Areas |
|----------|-------|-----------|
| **P0** | 4 | Main-thread O(n²) analysis, type-unsafe cast in printReviewWorkflow, zero test coverage on agents/pipeline/UI, three-stdlib barrel bundle bloat |
| **P1** | 7 | Memory leaks (geometry disposal), MaterialContext re-render cascade, agent `as unknown as Record` pattern, framer-motion dead dep, Language type divergence, dead MarkerInput interface, unused import |
| **P2** | 12 | God component Home.tsx, duplicated transformation logic, useFrame callback count, RiskAnimation clock drift, undisposed 3D geometries, unbounded Map growth, unsafe `!` assertions, silent undefined in Record casts, flaky benchmarks, mock-only test, untested regex extraction, missing component test infra |
