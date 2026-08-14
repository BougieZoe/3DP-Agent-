# CAD Studio v2

## Vision

CAD Studio is evolving from a "Text-to-CAD" prototype into an AI-native parametric CAD workspace. The long-term vision combines:

- **AI-assisted design** — natural language prompts generate parametric 3D models via LLM orchestration
- **Parametric editing** — all exposed design parameters are editable in real time with immediate visual feedback
- **Manufacturing analysis** — integrated printability, material, and confidence scoring for additive manufacturing
- **Interactive visualization** — real-time 3D preview with orbit controls, materials, and environment lighting
- **Design optimization** — automated geometry improvements, repair suggestions, and AI-driven design review

The goal is a single workspace where users describe what they want, see it instantly, tweak parameters until it's right, and get manufacturing-ready output — all without leaving the browser.

## Completed

### Persistent Camera During Parameter Editing

The 3D viewport camera no longer resets when parameters are modified. Mesh re-centering at origin is preserved, but camera position and target remain stable across regenerations. A "Fit View" button provides manual re-framing on demand.

**Implementation:** `PreviewMesh` in `CADWorkspace.tsx` — split mesh centering (runs on every `geometry` change) from camera fitting (runs only on initial load and explicit Fit View click).

### PreviewMesh Lifecycle Refactor

- Mesh centering extracted into its own `useEffect` with `[geometry]` dependency
- Camera auto-fit gated by `initialFitDone` ref — runs exactly once on first geometry load
- Manual Fit View bound to `fitKey` state, incremented by user click only
- No `.reset()` calls; no uncontrolled camera mutations

### Feature Tree Selection

- Click any feature node in the Feature Tree to select/highlight it
- Selected state: `bg-primary/10` background + `border-l-2 border-primary/50` left border
- Deselect on re-click
- Visual indicator (`◆`) next to selected feature name
- Color shift to `text-primary/90` for the selected label

### Parametric Template System

Six built-in templates with full `# PARAM` annotations:

| Template | Parameters |
|---|---|
| Flange | Outer Diameter, Inner Diameter, Thickness, Hole Count, Bolt Circle Radius, Bolt Diameter |
| Sports Car | Body Width/Height/Depth, Cabin Height, Tire Radius, Wheel Offset |
| Architectural Tower | Base Width/Height, Tower Width/Height, Spire Base Radius/Height, Mid Section Width, Window Width, Fillet Radius |
| Human Figure | Torso Width/Height/Depth, Head Radius, Arm Length/Width, Leg Length/Width |
| Japanese House | House Width/Depth, Wall Height, Roof Base Radius, Door Width/Height, Window Width/Height, Chimney Width/Height |
| Mounting Plate | Plate Width/Depth/Thickness, Hole Radius, Hole Spacing X/Y |

All templates are written in build123d Python and generated via a local CAD bridge server.

### Parameter Extraction Using `# PARAM`

Source code annotations drive the parameter panel:

```
# PARAM <varname> "<Label>" <unit> <min> <max> <step>
```

Three-phase extraction pipeline:

1. **`# PARAM` annotations** — explicit, labelled, with bounds
2. **Auto-detect variable assignments** — fallback for unannotated sources
3. **Box() dimension parsing** — last resort for generic sources

Parameters are grouped into collapsible sections: Dimensions, Holes, Details, Manufacturing.

### UI Improvements

- Electric Blue (#3B82F6) gradient slider fill proportional to current value
- White slider thumb with blue border + drop shadow
- 18px semibold value display, 11px uppercase labels
- Double-click to inline-edit numerical values
- +/- step buttons
- Min/max range labels on slider
- Undo/redo history (Ctrl+Z/Y) with visual diff display
- Feature tree with SVG grid icons
- Analysis tab with manufacturing confidence score, print check, structural analysis, material info

## Current Architecture

### CAD Generation

```
User Prompt → LLM / Template → build123d Python → CAD Bridge (Express) → STL bytes → parseSTL → BufferGeometry
```

- Local bridge server (`server/cadBridge.ts`) accepts build123d source code
- LLM integration (OpenAI, DeepSeek, Kimi, Fireworks) generates custom source from prompts
- Fallback templates match keywords in prompts for instant offline generation
- Full analysis pipeline runs on every generation and regeneration

### Feature Tree

Parses build123d source code for geometric primitives (Box, Cylinder, Cone, Sphere, extrude, fillet). Each detected primitive becomes a `CADFeatureNode` with:

- `id` — unique identifier
- `type` — primitive class (Box, Cylinder, etc.)
- `label` — variable name from source
- `params` — extracted dimensions

Displayed as an expandable/collapsible tree section in the right panel.

### Parameter Panel

Rendered dynamically from `parseParamsFromSource()` output. Each parameter card shows:

- Label (11px uppercase)
- Value (18px semibold, editable on double-click)
- Slider (#3B82F6 gradient fill, white thumb)
- Min/max labels
- +/- step buttons

Grouped by section (Dimensions, Holes, Details, Manufacturing) with expandable headers.

### Preview Mesh

React Three Fiber canvas with:

- OrbitControls (damping, free rotation/pan/zoom)
- Environment preset (studio lighting)
- Three-point light rig (ambient + directional + point)
- Grid helper
- CAD material system (presets for PLA, PETG, ABS, TPU, PC, Nylon, metal, transparent)
- Verdict overlay badge

### Analysis Panel

Tab alongside CAD panel showing:

- Manufacturing confidence score (0–100%) with color coding
- PASS/WARN/FAIL verdict with icon
- Print check (bed fit, material, support volume, print time, material weight)
- Structural analysis (max stress, displacement, safety factor)
- Geometry metrics (bounding box, volume, wall thickness)
- Material density and weight

### Manufacturing Pipeline

```
BufferGeometry → GeometryModel → runAnalysisPipeline → UnifiedAnalysis
                                                          ├── BedFitResult
                                                          ├── SupportPrediction
                                                          ├── PrintTimeEstimate
                                                          ├── GeometryMetrics
                                                          ├── StructuralAnalysis
                                                          └── WallThicknessAnalysis
                                    ↓
                              runConfidenceGate → CADConfidenceReport + Issues
```

## Roadmap

### Phase 1 — Analysis Panel v2

| Feature | Description |
|---|---|
| Hero verdict | Large, prominent score display with animated transition |
| AI Summary | Natural-language summary of analysis results |
| Repair Timeline | Chronological list of detected issues with severity |
| Risk Cards | Individual cards for each risk category with visual indicator |
| Manufacturing Cards | Per-process manufacturing recommendations |
| Advanced section | Detailed raw metrics in expandable area |

### Phase 2 — Feature Interaction

| Feature | Description |
|---|---|
| Feature ↔ Mesh Highlight | Clicking a Feature Tree node highlights corresponding mesh region |
| Hover highlight | Hovering a feature node previews the highlight |
| Selection outline | Wireframe outline around selected feature's bounding volume |
| Camera focus | Animated camera transition to frame selected feature |
| Parameter auto-focus | Selecting a feature scrolls the parameter panel to its relevant section |

### Phase 3 — Visualization

| Feature | Description |
|---|---|
| GLSL shaders | Custom fragment shaders for engineering visualization overlays |
| Wall thickness heatmap | Color-coded surface overlay showing thickness distribution |
| Support visualization | 3D display of auto-generated support structures |
| Thermal visualization | Temperature gradient overlay for cooling analysis |
| Layer animation | Animated layer-by-layer build simulation |
| Material preview | Realistic material surface rendering with PBR |

### Phase 4 — Immersive Experience

| Feature | Description |
|---|---|
| HDRI environments | Swappable high-dynamic-range lighting environments |
| Indoor scenes | Interior lighting setups (warm, studio, workshop) |
| Outdoor scenes | Daylight, overcast, sunset lighting presets |
| Product showcase | Turntable animation and presentation mode |
| Interactive walkthrough | First-person camera navigation around the model |
| Contextual placement | Show model in context (printer bed, assembly, room) |

### Phase 5 — Simulation

Simulation features span two fidelity tiers:

**Visual approximations** (qualitative, real-time):

- Temperature preview — color gradient indicating cooling patterns
- Environmental exposure — visual indication of overhangs, bridges, thin walls
- Wind visualization — particle flow around the model

**Engineering-grade simulations** (offline, solver-based):

- Load visualization — finite-element deformation overlay
- Physics preview — center-of-mass, stability, stress concentration
- These require integration with external solvers or WebAssembly-based FEA

### Phase 6 — AI Design Copilot

| Feature | Description |
|---|---|
| AI Design Review | Automated critique of design for manufacturability, strength, material usage |
| One-click improvements | Apply AI-suggested geometry changes with single click |
| Regeneration loop | "Make it lighter" / "Strengthen this area" iterative refinement |
| Design optimization suggestions | Topology optimization, wall thickness reduction, fillet recommendations |
| Multi-agent workflow (future) | Specialized agents for structural, thermal, manufacturing analysis |

## Technical Notes

The following technologies are potential candidates for future implementation. None are currently integrated.

- **React Three Fiber** — declarative Three.js for React; already powers the 3D viewport
- **Three.js** — core WebGL library; already in use for rendering, geometry processing, and line/points visualization
- **GLSL** — shader language for custom surface effects, heatmaps, and engineering overlays
- **WebGL** — browser graphics API underlying Three.js rendering
- **Postprocessing** — effect composer for bloom, depth-of-field, outline passes
- **HDRI** — high-dynamic-range environment maps for realistic lighting
- **Environment Maps** — cube/equirectangular maps for reflections and ambient lighting
- **GPU Instancing** — efficient rendering of repeated geometry (supports, bolts, patterns)
- **Animation System** — timeline-driven animation for print simulation, turntable, camera transitions

These are noted as building blocks for roadmap features, not as current capabilities.

## Development Rules

### Stability First

- Preserve stable UX — avoid unnecessary churn in working interaction patterns
- Keep camera state stable — never reset viewport on background operations
- Keep parameter editing responsive — no jank or lag during slider manipulation

### Incremental Development

- Prefer incremental improvements over large rewrites
- Each commit should represent a coherent, working increment
- Test parameter editing after every rendering-related change

### Modular Architecture

- Maintain modular architecture — UI, rendering, and CAD logic should remain separable
- Avoid large monolithic components — extract concerns into focused modules
- Shared types and utilities belong in `lib/` or dedicated module directories

### Performance

- Keep rendering performant — avoid unnecessary re-renders in the 3D viewport
- Use `memo`, `useMemo`, `useCallback` judiciously for render-critical paths
- Debounce parameter changes to avoid regeneration on every slider tick
- Profile before optimizing — measure, then act

### Separation of Concerns

- **UI layer** — React components, state, event handlers, layout
- **Rendering layer** — Three.js scene, materials, shaders, postprocessing
- **CAD logic** — template system, parameter extraction, source manipulation
- **Analysis pipeline** — metrics, confidence scoring, manufacturing checks

Each layer should be independently testable and replaceable.
