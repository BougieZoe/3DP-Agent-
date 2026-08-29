# AGENTS.md — Session Context

## Project
3DP Agent — 3D printing STL analysis and manufacturing intelligence visualizer.  
React 19 + Three.js 0.184 + @react-three/fiber 9.6.1 + Vite 7.1.9 + TypeScript strict.

## Current Objective (2026-05-27)
**Visual Language Consolidation** — Unify all visual tokens, colors, opacities, animation speeds, panel styles into a single source of truth (`visualLanguage.ts`). Enforce "Apple + Industrial AI + Scientific Visualization" aesthetic across all 15 components.

## Architecture Decision Record

### Playback as Single Source of Truth
- **`PrintPlaybackContext.tsx`** provides `progressRef` (MutableRefObject for 3D) + reactive state (for DOM). 
- `useFrame` tick via `PlaybackUpdater` inside Canvas increments `progressRef.current`. No `clock.getElapsedTime()` loops.
- All 6 animated components (PrintPathPreview, LayerReveal, FailureEmergence, ThermalField, CognitiveScan, AttentionPulse) consume `progressRef` via `usePrintPlayback()`. Zero independent clock loops.

### Causality Engine
- `causalityEngine.ts`: Rule-based graph builder — 8 event types, 11 edge rules. `MarkerInput` type exported for reuse.
- `topologyPatternEngine.ts`: Spatial clustering (2.5-unit radius), 6 pattern templates, weighted cosine similarity, localStorage recurrence.
- `counterfactualEngine.ts`: 5 modification types with severity multipliers, re-runs causality engine with adjusted markers.

### Visual Language (`client/src/lib/visualLanguage.ts`)
- **Color system**: cyan #66ccff (AI accent), amber #cc8844 (thermal/warning), muted red #cc6666 (critical), blue-gray (atmospheric)
- **Opacity tiers**: overlay ≤0.35, atmospheric ≤0.2, pulse ≤0.45
- **Animation profile**: slow/cinematic/restrained — no high-frequency flicker, aggressive scaling, or chaotic motion
- **Panel system**: glassmorphism, low contrast, subtle borders, consistent font/radius/spacing tokens
- **All 3D overlays**: additive blending only, never modify base mesh material/color

### Animation Components
- **RiskAnimation.tsx**: Cinematic AI perception (breathing rhythm, orbital drift, ghost spheres). Uses visual tokens. Independent clock loop.
- **PrintPathPreview.tsx**: 24 elliptical layers × 36 points, `setDrawRange` reveal, nozzle ghost.
- **LayerReveal.tsx**: 20 closed ellipses, staggered fade-in.
- **FailureEmergence.tsx**: SaggingBridge (overhang — amber), OscillatingRegion (thin_wall — blue-gray), StressPulse (support_needed — muted red).
- **ThermalField.tsx**: Point sprites at marker positions, cool-blue → warm-amber by severity.
- **CognitiveScan.tsx**: Scan plane driven by progressRef, blue-gray additive plane.
- **AttentionPulse.tsx**: Expanding risk pulses triggered by scan proximity.
- **CausalityHighlight.tsx**: 3D PointsMaterial overlay at selected positions.

### UI Panels
- **ManufacturingTimeline.tsx**: Event chips + semantic phase labels + progress bar + play/pause/scrubber.
- **CausalityPanel.tsx**: Event chain with before/after severity.
- **PatternMemoryPanel.tsx**: Recognized pattern cards with recurrence + consequence chain.
- **GeometrySuggestionPanel.tsx**: Counterfactual suggestion cards with Risk/Thermal/Support deltas (cyan=improvement, red=regression).
- **VisualizationToolbar.tsx**: Toggle chips with consistent styling.

### Integration
- `Home.tsx` wraps everything in `PrintPlaybackProvider`, adds `PlaybackUpdater` + CognitiveScan + AttentionPulse inside Canvas.
- Causality tab shows 3 panels (CausalityPanel, PatternMemoryPanel, GeometrySuggestionPanel).
- All i18n strings for EN/JA/ZH (toolbar, timeline phases, panel labels, pattern names, suggestion metrics).

### Depth Hierarchy
1. STL mesh (base — never modified)
2. Analysis overlays (heatmap, supports)
3. Temporal playback (print path, layers)
4. Cognition effects (risk, failure, thermal, scan, pulses, causality)
5. UI (toolbar, timeline, panels)

### Rejected: LLM-driven dynamic causality reasoning (replacing rule-based causalityEngine)
Evaluated 2026-08-29, inspired by CMU LLM-3D-Print (info_reasoning_adapter pattern).
Reason: causalityEngine drives pre-print failure judgments that affect real material
and structural decisions. Deterministic, auditable rules (same input → same causal
chain every time) matter more here than reasoning sophistication. An LLM-generated
causal chain could vary between runs on identical input, which is a liability, not
an upgrade, for a tool users rely on to decide whether to trust a design.
Do not reintroduce this without re-evaluating why determinism was deprioritized.

### Deferred: Supervisor-Worker serial agent architecture (replacing parallel consensus)
Evaluated 2026-08-29, inspired by CMU's Supervisor → Worker routing chain.
Reason: our 4 agents solve "multi-perspective analysis of one static model" (parallel
fits), not "diagnose → plan → execute" (serial fits, which is CMU's actual problem —
real-time print monitoring). Revisit only if a future feature genuinely needs
step-dependent agent handoff (e.g. an agent's output must gate the next agent's input).

### Deferred: Tool-call interface layer for printer control
Evaluated 2026-08-29, inspired by CMU's LangChain tool wrappers (query_printer,
change_parameters, resume_print).
Reason: product scope is pre-print analysis, not live printer control. No current
feature needs this. Revisit only if the roadmap adds real-time print control.

## Bridge Routes & REPAIR & PROCESS
- **Positioning (deliberate, not debt):** `REPAIR & PROCESS` (the browser button that calls `/api/mesh/process`) is an **internal / dev-only debugging feature**. It is NOT a production browser path: a browser SPA cannot safely hold `BRIDGE_TOKEN` (it would ship the secret to end users), so production keeps the bridges unmounted unless `BRIDGE_TOKEN` is explicitly set, and browser clients never send an Authorization header.
- **Dev auth gate:** in dev, bridge routes (`/api/cad`, `/api/slice`, `/api/mesh`) skip `BRIDGE_TOKEN` ONLY for genuinely-loopback callers. The decision lives in `server/loopbackGuard.ts` and is made from the request-source chain (the real client IP in `x-forwarded-for`, trusted only when the direct socket peer is loopback) — **never from the Express bind host**, because the LAN-exposed Vite dev proxy (with `xfwd: true` on the bridge prefixes) forwards LAN peers with a loopback socket address. A dev server published on `0.0.0.0` keeps the bridges token-gated. Keep `vite.config.ts` `xfwd: true` and `server/loopbackGuard.ts` in sync if bridge proxies are added/removed.

## Important Conventions
- **Project root is `/Users/bougiezoe/3DP-Agent-/`** — always confirm the full path before any file edit. Never assume or guess the project location; Desktop or other paths are NOT project roots.
- `progressRef.current` ranges 0.0–1.0, ~8.7s full cycle at speed=1
- `delta * speed * 0.12` increment per frame
- No modifications to STL colors, lighting, fog, tints, layout, or base rendering
- All 3D overlays use `THREE.AdditiveBlending`, `depthWrite: false`, geometry-preserving
- All visual tokens in `visualLanguage.ts` — no hardcoded colors/opacities in components
- Panel styles use `PANEL.*` tokens from visualLanguage for consistent glassmorphism
- Phase colors from `PHASE_COLORS_CSS`, event colors from `EVENT_COLORS_CSS`, pattern colors from `PATTERN_COLORS_CSS`
- `useFrame` callbacks persist across frames; context captured at registration
- All 3D components in `client/src/components/3D/`, panels in `client/src/components/causality/`
- Shared types exported from individual files; no new dependencies added

## Known Issues
- RiskAnimation still uses independent `clock.getElapsedTime()` (not refactored)
- Vite dep-scan alias warnings (pre-existing — works at serve time)
- Type check: `pnpm run check` (passes clean)
- Build: `pnpm run build` (passes — the old missing-`sonner`-import failure was fixed; stale docs were removed)

## Verification Gate (run before every commit)
- `pnpm check` — tsc --noEmit, must be clean
- `pnpm test` — vitest run, must be all green
- `pnpm run build` — must succeed
- Enforced automatically by `.github/workflows/ci.yml` on every push/PR; no branch lands without it.

## Post-Verification Reflection

After a human confirms (via diff review or bidirectional stash/pop testing)
that a multi-step change is complete and correct, append a timestamped entry
to /docs/reflections.md before considering the task closed. If /docs/reflections.md
does not exist, create it.

Each entry must include:
- Task name/date
- What was claimed as "done" at each self-report checkpoint during the task
- What the diff actually showed at each checkpoint (call out any gap between
  the claim and the diff, even a small one)
- Root cause of any gap (e.g. "reported completion before checking the second
  requirement", "confused two similarly-named variables", "type check passing
  was treated as proof of correct logic")
- One sentence: what would prevent this specific gap from recurring

This log is a self-audit record, not a substitute for human diff review. It
exists to make recurring failure patterns visible over time. An entry that
claims zero gaps for a multi-step task should be treated with suspicion — if
none genuinely occurred, say so explicitly rather than omitting the section.

---

# Agent Architecture Contract

Adapted from Cursor's internal "Dune" framework philosophy (Lauren Tan).
This is not a copy of Dune's own vocabulary (Feature/Entrypoints/Transcript/
Client/Host are specific to Cursor's own desktop app and don't map onto this
codebase) — it's the underlying five rules, translated into concrete
guardrails for this project.

## Why this exists

A coding agent, left unconstrained, defaults to:
- copying the nearest working pattern instead of the correct one
- editing whatever file is already open instead of the right file
- choosing the shortest path that compiles instead of the shortest path that's correct
- avoiding deletion of code whose callers aren't visible in context
- following the literal request even when it conflicts with an existing invariant

These aren't agent failures to scold — they're predictable behavior given
narrow context. The fix isn't "try harder," it's making the correct path
structurally easier than the shortcut.

## The five rules, applied here

**1. The correct path should require fewer decisions than a shortcut.**
If following the right pattern means hunting through five files to find the
"real" source of truth, the agent will default to editing whatever's already
open instead. When adding a rule/threshold/config value, there should be one
obvious place it goes — not "wherever looks similar."

**2. Forbidden dependencies should fail mechanically, not rely on someone noticing.**
Don't rely on code review or a person remembering to say "don't touch that."
If a piece of UI (e.g. a demo/dev-only toggle) must never render alongside
real production data, that should be enforced by a type, a route guard, or a
build-time check — not a comment saying "dev only, be careful."

**3. Every durable value has exactly one writer.**
If a score, a status, or a piece of derived data can be computed in more than
one place (e.g. a printability score shown in two different components using
two different formulas), that's the bug waiting to happen — not a stylistic
choice. Concrete example already hit in this project: a printability score
showed 27 in one card's badge and 47 in the same card's body — two different
calculations feeding the same UI element. Rule: pick one source of truth,
have every display read from it.

**4. New work adds isolated files rather than editing shared roots.**
A change to one feature (e.g. a diagnosis panel) should not require touching
a shared component (e.g. the top navigation header) unless the task is
explicitly about that shared component. Concrete example already hit in this
project: an unrelated UI task modified the shared Header component as a side
effect, breaking the desktop nav layout. If a shared/root file needs to
change, that should be a deliberate, called-out part of the task — not
collateral damage from something else.

**5. Exceptions are narrow, explicit, and reviewed as architecture changes.**
If the agent needs to break one of the above rules (e.g. genuinely needs to
touch a shared file, or genuinely can't find one source of truth for a
value), it should say so explicitly and explain why — not do it silently and
report "all tests passing."

## Verification standard (already in use on this project)

For any bug fix or logic change: reproduce the broken behavior first, apply
the fix, confirm it's fixed, then git stash the fix and confirm the bug
reappears, then restore. "Tests passed" alone is not sufficient evidence —
tests that already existed before the change only prove nothing else broke,
not that the new logic is correct. State explicitly whether any new tests
were added to cover the new logic.

## Investigate-before-acting standard

When something looks like it might be intentional (a gating condition, a
naming choice, a data source) rather than a plain bug, investigate and
report back on why it exists before changing it. Don't assume a limitation
is accidental just because it's inconvenient.
