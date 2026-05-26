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

## Important Conventions
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
- Build error: missing `@/components/ui/sonner` import in App.tsx (pre-existing)
- Vite dep-scan alias warnings (pre-existing — works at serve time)
- Build command: `pnpm run build` (fails on pre-existing sonner issue)
- Type check: `pnpm run check` (passes clean)
