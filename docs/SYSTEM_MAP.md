# 3DP Agent System Map

This document maps the current repository as it exists before Phase 1
architecture extraction. It is intentionally operational: the goal is to
preserve the current speed of iteration while creating clear seams for workflow
orchestration, slicer integration, and future agentic behavior.

## 1. Current Architecture Graph

```txt
package root
  package.json
  vite.config.ts
  vitest.config.ts
  tsconfig.json

server/
  index.ts
    Static production server only.
    No app API, job system, storage, or workflow execution yet.

shared/
  const.ts
    Minimal shared constants, not currently a domain contract layer.

client/src/
  main.tsx
    React entrypoint.

  App.tsx
    ErrorBoundary
      TooltipProvider
        Toaster
        Router
          / -> Home
          fallback -> NotFound

  pages/
    Home.tsx
      Primary application shell.
      Owns language, uploaded model, selected tab, report state, API modal state.
      Builds model data for reports/chat.
      Contains main 3D viewport implementation inline.

  components/
    STLUploadHandler.tsx
      File selection/drop UI.
      Calls STL parsing, model analysis, and mesh creation.

    ChatPanel.tsx
      Intended chat/advisor UI.
      Currently broken in working tree and reduced to suggestions only.

    APIKeyModal.tsx
      API key entry UI.

    AnalysisResults.tsx
    ModelPreviewScene.tsx
    3D/*
      Secondary/legacy 3D and result presentation components.
      Some are not part of the current Home flow.

    ui/*
      Shadcn/Radix-style UI primitives.

  lib/
    stlLoader.ts
      STL file reading, ASCII/binary parsing, basic analysis, mesh creation.

    ruleEngine.ts
      Local printability report generation, question classification,
      canned deterministic answers.

    apiKeys.ts
      Browser localStorage key manager plus direct provider API calls.

    i18n.ts
      Translation dictionary for current UI strings.
```

Operational graph:

```txt
User
  -> Browser React app
    -> Home
      -> STLUploadHandler
        -> loadSTLFile
          -> parseSTL
            -> parseBinarySTL | parseASCIISTL
        -> analyzeModel
        -> createMeshFromGeometry
      -> Home state: uploadedModel
      -> Canvas viewport renders THREE.BufferGeometry
      -> geometry tab renders analysis
      -> report tab calls generateQuickReport
      -> chat tab calls ChatPanel
        -> intended: classifyQuestion | answerLocally | callAI

Production server
  -> Express static file server
  -> client-side routing fallback
```

## 2. Data Flow

The core data flow is currently file-driven and browser-local.

```txt
File object
  -> ArrayBuffer
  -> THREE.BufferGeometry
  -> AnalysisResult
  -> UploadedModel
       geometry: THREE.BufferGeometry
       mesh: THREE.Mesh
       analysis: AnalysisResult
       fileName: string
  -> ModelData
       fileName
       wallThickness
       overhang
       volume
       surfaceArea
       dims
  -> UI metrics | quick report | chat context
```

Important observations:

- `UploadedModel` is both a domain object and a rendering object.
- `ModelData` is built ad hoc inside `Home`.
- `AnalysisResult` is local to `stlLoader.ts` and is consumed through
  `ReturnType<typeof analyzeModel>`.
- No canonical `PrintJob`, `ModelArtifact`, `GeometryMetrics`, or
  `PrintabilityFinding` type exists.
- No persistence exists for uploaded files, analysis results, workflow runs, or
  reports.

## 3. STL Lifecycle

Current lifecycle:

```txt
1. User selects or drops a .stl file.
2. STLUploadHandler validates extension only.
3. FileReader reads the file as ArrayBuffer.
4. stlLoader detects ASCII vs binary using first 5 bytes equals "solid".
5. Parser creates THREE.BufferGeometry with position and normal attributes.
6. Geometry computes normals and bounding box.
7. analyzeModel computes:
   - bounds
   - bounding-box volume
   - triangle surface area
   - heuristic wall thickness
   - normal-based overhang count
8. createMeshFromGeometry creates a THREE.Mesh for display.
9. Home stores the UploadedModel in React state.
10. UI renders metrics, report, and 3D model.
```

Current technical limitations:

- Binary/ASCII detection is simplistic. Some binary STLs can begin with
  `solid`.
- File validation is extension-only.
- Volume is bounding-box volume, not closed-mesh volume.
- Wall thickness is a bounding-box heuristic, not geometric thickness.
- Watertightness is described in product copy but not implemented in the
  analysis result.
- Overhangs are counted from normals, not grouped as printable regions or
  measured by surface area.
- Mesh repair, unit normalization, orientation analysis, and connected-component
  analysis do not exist yet.
- Parsing and analysis run on the browser main thread.
- Parsed geometry is coupled directly to the UI and stored in page state.

Operational implication:

The current STL lifecycle is good enough for a fast local prototype, but it is
not yet a workflow pipeline. Phase 1 should make the lifecycle explicit without
trying to solve all geometric correctness at once.

## 4. AI/Chat Lifecycle

Intended lifecycle from the code history and current imports:

```txt
User opens chat tab
  -> ChatPanel receives ModelData
  -> ChatPanel builds an initial local assessment
  -> User sends question
  -> classifyQuestion(question)
    -> if local:
         answerLocally(category, model, language)
    -> if complex:
         getActiveProvider()
         getKey(provider)
         buildSystemPrompt(model, language)
         callAI(provider, key, systemPrompt, userMessage)
  -> assistant message rendered in chat
```

Current state:

- `ChatPanel.tsx` is incomplete in the current working tree and does not export
  `ChatPanel`.
- `apiKeys.ts` contains both credential storage and provider request logic.
- AI calls are made directly from the browser.
- Prompt construction is part of the chat UI rather than a reusable advisor
  service.
- The AI sees summarized metrics only, not structured findings, region data,
  slicer output, or workflow history.

Operational implications:

- There is no agent boundary yet.
- There is no tool boundary yet.
- There is no audit trail of what data the model saw.
- There is no provider capability abstraction.
- Direct browser calls preserve "bring your own key" speed, but make production
  workflows, provider routing, retries, secrets, and observability harder.

Near-term posture:

Keep BYO-key browser mode for speed, but isolate it behind an `aiClient` and
`advisor` boundary before adding more providers or agent behavior.

## 5. State Management Flow

Current state is mostly local React state in `Home`.

```txt
Home state:
  language
    -> i18n labels
    -> upload labels
    -> report language
    -> chat language

  uploadedModel
    -> viewport render
    -> geometry tab
    -> derived ModelData
    -> report generation
    -> chat context

  tab
    -> geometry | report | chat

  showAPIModal
    -> APIKeyModal visibility

  quickReport
    -> report tab output

  reportLoading
    -> report tab loading state
```

Secondary state:

```txt
STLUploadHandler:
  isLoading
  isDragging
  progress log

APIKeyModal:
  editable keys
  key visibility map

apiKeys.ts:
  localStorage persisted API keys
```

State risks:

- `Home` is the de facto workflow coordinator, but its state is UI-shaped, not
  workflow-shaped.
- There is no explicit status model for stages such as `parsing`, `analyzing`,
  `reporting`, `slicing`, or `failed`.
- There is no durable job/run identity.
- Derived data is recomputed ad hoc.
- A future batch workflow would require significant restructuring if this shape
  remains.

Recommended near-term direction:

Introduce a small workflow result model in Phase 1, but keep state local to the
client until there is a real need for a global store or backend queue.

## 6. Coupling and Problem Areas

High-impact coupling:

- `STLUploadHandler` couples upload UI to parsing, analysis, and mesh creation.
- `stlLoader.ts` couples file parsing, mesh analysis, and rendering helper code.
- `Home.tsx` couples page layout to workflow orchestration and model data
  shaping.
- `UploadedModel` couples domain state to `THREE.BufferGeometry` and
  `THREE.Mesh`.
- `apiKeys.ts` couples browser storage to provider execution.
- `ruleEngine.ts` couples rule classification, report copy, answer copy, and
  translation logic.
- 3D annotations are based on summary statuses, not actual geometric issue
  locations.

Current broken coupling surfaced by typecheck:

- Adding `deepseek` to provider types requires updates in UI label maps.
- `ChatPanel` breakage propagates directly into `Home`.
- Provider models and labels are hardcoded in multiple places.

Operational consequence:

Small feature additions currently require coordinated edits across UI, domain
logic, and provider code. This is the main risk to fast iteration as the product
becomes workflow-oriented.

## 7. Hidden Technical Debt

Hidden debt that matters for workflow evolution:

- Product claims are ahead of implementation in places such as watertightness
  and deep geometry understanding.
- Existing tests validate current heuristics, not physical correctness.
- Tests mock `three` heavily, so they do not protect parser/geometry behavior
  against real STL fixtures.
- Legacy or unused components create ambiguity about the intended product path.
- No domain-level naming standard exists for part, model, artifact, job, run,
  report, or finding.
- Provider model names are hardcoded and can become stale.
- Direct browser provider calls may hit CORS or provider compatibility issues.
- No error taxonomy exists. Parser failures, bad files, geometry warnings, and
  provider failures are all handled as UI strings.
- No performance envelope exists for file size, triangle count, or analysis
  duration.
- No security posture is documented beyond "keys stored locally".
- The build currently fails in the working tree even though unit tests pass.

Hidden operational debt:

- There is no concept of a customer workflow: quote review, manufacturability
  review, batch intake, print prep, supplier handoff, or print-job tracking.
- There is no handoff object that a slicer, agent, or report generator can all
  consume.
- There is no provenance chain from input file to recommendation.

## 8. Future Extension Points

Good existing extension points:

- `ruleEngine.ts` can evolve into deterministic manufacturing rules.
- `stlLoader.ts` can be split into mesh services.
- `ChatPanel` can become the first consumer of an advisor abstraction.
- `server/index.ts` can later host workflow APIs without disrupting the client
  app.
- `shared/` can become the domain contract home.

Needed extension points:

```txt
domain/
  PrintJob
  ModelArtifact
  GeometryMetrics
  PrintabilityFinding
  AnalysisReport
  AdvisorMessage
  WorkflowRun
  WorkflowStage

services/mesh/
  parseStl(file)
  computeMeshMetrics(geometry)
  evaluatePrintability(metrics, geometry)
  createRenderableMesh(geometry)

services/advisor/
  buildAdvisorContext(run)
  answerQuestion(context, question)

services/ai/
  AIProviderAdapter
  AIClient
  provider registry

services/slicer/
  SlicerProfile
  SlicerRequest
  SlicerResult
  SlicerAdapter

workflows/
  runPrintReviewWorkflow(input)
```

Important constraint:

Do not introduce all folders at once. Phase 1 should introduce only the domain
contracts and one or two service boundaries needed to reduce current coupling.

## 9. Recommended Abstraction Boundaries

Boundary 1: Domain contracts

Purpose:

- Give the app stable names for workflow concepts.
- Stop leaking implementation-specific return types across the app.

Initial contracts:

```txt
ModelSource
  id
  fileName
  fileSizeBytes
  mimeType?

GeometryBounds
  min
  max
  size

GeometryMetrics
  bounds
  volumeMm3
  surfaceAreaMm2
  triangleCount

PrintabilityFinding
  id
  severity
  category
  title
  message
  metrics

ModelAnalysis
  source
  metrics
  findings
  legacySummary?

PrintReviewRun
  id
  source
  status
  stages
  analysis?
```

Boundary 2: Mesh processing service

Purpose:

- Separate file parsing and analysis from upload UI.
- Prepare for Web Worker migration.

Initial functions:

```txt
parseSTLFile(file): Promise<ParsedMesh>
analyzeMesh(mesh): ModelAnalysis
createPreviewMesh(mesh): THREE.Mesh
```

Boundary 3: Workflow runner

Purpose:

- Make the STL lifecycle explicit.
- Avoid turning `Home` into a permanent orchestrator.

Initial function:

```txt
runLocalPrintReview(file, callbacks?): Promise<PrintReviewRun>
```

Boundary 4: Advisor service

Purpose:

- Keep agent prompt/context construction out of the chat UI.
- Keep local answers and AI answers behind one interface.

Initial function:

```txt
answerAdvisorQuestion(context, question): Promise<AdvisorResponse>
```

Boundary 5: Provider adapters

Purpose:

- Keep key storage separate from AI execution.
- Localize provider-specific request/response code.

Initial shape:

```txt
AIProviderAdapter
  id
  label
  call(request): Promise<AIResponse>
```

## 10. Migration Risks for Future Workflow Orchestration

Risk: Rewriting too much too early.

Mitigation:

- Keep current UI and current analysis behavior during Phase 1.
- Introduce contracts as adapters around existing behavior.
- Avoid changing visual components until the pipeline boundary is stable.

Risk: Creating abstract layers without operational pressure.

Mitigation:

- Add only abstractions that remove current coupling or prepare for near-term
  slicer/worker needs.
- Prefer plain TypeScript functions over framework-heavy orchestration.

Risk: Breaking current local-first UX.

Mitigation:

- Keep browser parsing and BYO-key mode.
- Move toward worker/server execution gradually.

Risk: Freezing bad geometry semantics into permanent contracts.

Mitigation:

- Name current values honestly.
- For example, distinguish `boundingBoxVolumeMm3` from future
  `meshVolumeMm3`.
- Represent findings with provenance so heuristics can be upgraded later.

Risk: Agent architecture becoming detached from real workflow state.

Mitigation:

- Agents should consume `PrintReviewRun` and `ModelAnalysis`, not raw UI state.
- Agents should call typed tools through services, not import React components.

Risk: Slicer integration forcing backend rewrite.

Mitigation:

- Define slicer request/result types before implementing slicer execution.
- Keep slicer integration as an adapter behind a workflow stage.

## Clean Phase 1 Execution Plan

Phase 1 goal:

Create stable architecture contracts and reduce immediate coupling without
changing product behavior.

Non-goals:

- No slicer integration.
- No real wall-thickness engine.
- No backend job queue.
- No multi-agent runtime.
- No UI redesign.
- No large file-processing rewrite.

Deliverables:

1. Add domain type contracts.
2. Export `AnalysisResult` or replace it with a named domain-compatible type.
3. Add mapper functions from current `analyzeModel` output to domain contracts.
4. Extract provider metadata so adding providers does not break `Home`.
5. Restore typecheck health.
6. Add tests around the new contract/mapping layer.

Suggested file additions:

```txt
client/src/domain/geometry.ts
client/src/domain/printability.ts
client/src/domain/workflow.ts
client/src/services/modelAnalysis.ts
client/src/services/aiProviders.ts
```

Keep these files small. The goal is naming and boundaries, not a framework.

## Smallest Safe Refactor Sequence

1. Stabilize build first.

   Fix the current `ChatPanel` export/import issue and provider label mismatch.
   This is not Phase 1 architecture work, but it is required before a safe
   migration.

2. Add domain contracts without changing call sites.

   Introduce types only. No behavior changes.

3. Export or rename the current analysis result type.

   Replace `ReturnType<typeof analyzeModel>` usage with a named type.

4. Add pure mapping helpers.

   Convert current `UploadedModel`/analysis data into domain-shaped
   `ModelAnalysis` and `ModelData`.

5. Move `Home.getModelData` into a service/helper.

   This is a small extraction that reduces `Home` responsibility without
   changing behavior.

6. Split provider metadata from provider execution.

   Add a provider registry used by `Home`, `APIKeyModal`, and chat. Do not yet
   redesign the AI client.

7. Add focused tests.

   Test domain mapping, provider registry completeness, and current rule-engine
   compatibility.

8. Stop.

   Re-run typecheck and tests. Do not continue into worker, slicer, or agent
   runtime work until this baseline is stable.

## Lowest-Risk Migration Path

The safest path is an adapter-first migration.

```txt
Current implementation
  -> named types
  -> mapping helpers
  -> small services
  -> workflow runner
  -> worker/backend adapters
```

Do not start with:

- replacing `Home`
- moving everything to `shared`
- creating a full workflow engine
- introducing global state
- adding a backend API before there is a server-side operation

Start with:

- make current data contracts explicit
- preserve current UI
- preserve current heuristics
- make current stages visible
- reduce direct imports between UI and low-level processing

The main Phase 1 success condition is simple:

The app should still behave the same, but future work should be able to target
domain/services/workflow files instead of editing `Home`, `STLUploadHandler`,
`stlLoader`, `ruleEngine`, and `apiKeys` together for every change.
