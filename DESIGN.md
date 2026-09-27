# 3DP Agent — Architecture Design Document

> FPGA-inspired modular agent system + Marvis-style 3D factory visualization
> Version: 1.0 | Date: 2026-09-21

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Jev Targeted Re-calibration](#2-jev-targeted-recalibration)
3. [FPGA Modular Agent Architecture](#3-fpga-modular-agent-architecture)
4. [3D Factory Visualization](#4-3d-factory-visualization)
5. [Implementation Roadmap](#5-implementation-roadmap)

---

## 1. Design Principles

### FPGA Core Philosophy

Every component follows four rules:

| Principle | Meaning | Implementation |
|-----------|---------|----------------|
| **Modularity** | Each agent is an independent logic block | `BaseAgent` interface with `analyze()` + `review()` |
| **Reconfigurability** | Agents can be swapped/added/removed at runtime | `AgentRegistry` + config-driven instantiation |
| **Composability** | Output of one agent feeds others through standard ports | `AgentOutput` typed bus + `AgentContext.previousOutputs` |
| **Observability** | Every module exposes internal state for visualization | `AgentTelemetry` stream per agent |

### Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AgentOrchestrator                         │
│                                                             │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌────────┐ │
│  │ Geometry │    │Printabil.│    │ Failure  │    │ Optim. │ │
│  │ Analyst  │    │ Scorer   │    │Predictor │    │Advisor │ │
│  └────┬─────┘    └────┬─────┘    └────┬─────┘    └───┬────┘ │
│       │               │               │              │      │
│       └───────────────┼───────────────┼──────────────┘      │
│                       ▼               ▼                     │
│              ┌─────────────────────────────┐                │
│              │      AgentOutputBus         │                │
│              │  (standard typed channel)   │                │
│              └─────────────┬───────────────┘                │
│                            ▼                                │
│              ┌─────────────────────────────┐                │
│              │       DebatePhase           │                │
│              │  (agents review each other) │                │
│              └─────────────┬───────────────┘                │
│                            ▼                                │
│              ┌─────────────────────────────┐                │
│              │    Jev Consensus Engine     │                │
│              │  (calibrated probabilities) │                │
│              └─────────────┬───────────────┘                │
│                            ▼                                │
│              ┌─────────────────────────────┐                │
│              │  Jev Anomaly Detector       │◄── NEW        │
│              │  (flags outlier agents)     │                │
│              └─────────────┬───────────────┘                │
│                            ▼                                │
│              ┌─────────────────────────────┐                │
│              │  Targeted Recalibration     │◄── NEW        │
│              │  (re-runs only flagged)     │                │
│              └─────────────┬───────────────┘                │
│                            ▼                                │
│              ┌─────────────────────────────┐                │
│              │    Final Consensus          │                │
│              └─────────────────────────────┘                │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Jev Targeted Re-calibration

### Problem

Current flow: agents → debate → Jev consensus → done.

If one agent produces a wildly wrong score (e.g., Geometry Analyst gives 90 when the mesh has holes), Jev can override the final score, but the **underlying agent data is still wrong**. The user sees "Geometry Analyst: 90" in the UI, which is misleading.

### Solution: Anomaly Detection + Targeted Recalibration

After Jev consensus, compare Jev's `agentTrustAdjustments` against each agent's score. If Jev flags an agent as untrustworthy, **re-run only that agent** with Jev's corrective context.

### Flow

```
Phase 1: Normal Pipeline
  agents → debate → Jev consensus

Phase 2: Anomaly Detection (NEW)
  for each agent:
    trust = jevDecision.agentTrustAdjustments[agentId]
    if trust < 0.7:                          // Jev thinks this agent is unreliable
      flag agent for recalibration
      store: { agentId, reason, jevContext }

Phase 3: Targeted Recalibration (NEW, max 1 agent per cycle)
  if flaggedAgents.length > 0:
    worstAgent = flaggedAgents.sort(by trust ascending)[0]
    
    // Build corrective context from Jev's analysis
    correctiveContext = {
      ...originalCtx,
      jevCorrection: {
        jsvScore: jevDecision.jevScore,
        topRisk: jevDecision.topRisk,
        primaryAction: jevDecision.primaryAction,
        flaggedFinding: worstAgent.reason,
      }
    }
    
    // Re-run ONLY the flagged agent with corrective hint
    recalibratedResult = await worstAgent.execute(correctiveContext)
    
    // Blend: 60% original + 40% recalibrated (dampened to avoid overcorrection)
    blendedScore = originalScore * 0.6 + recalibratedResult.score * 0.4

Phase 4: Final Consensus
  recompute consensus with blended scores
```

### Cost Analysis

| Scenario | API Calls | Latency | Cost |
|----------|-----------|---------|------|
| No anomaly | 1 Jev call | ~40ms | $0.00003 |
| 1 agent flagged | 1 Jev + 1 agent re-run | ~40ms + ~100ms | ~$0.00005 |
| Worst case (all flagged) | 1 Jev + 1 agent (capped) | ~40ms + ~100ms | ~$0.00005 |

**Key**: We cap at 1 recalibration per cycle. If multiple agents are flagged, we only fix the worst one. Next analysis cycle will catch the others.

### Implementation Files

```
client/src/agents/
  jevAnomalyDetector.ts    ← NEW: detects outlier agents
  jevRecalibrator.ts       ← NEW: re-runs flagged agents
  orchestrator.ts          ← MODIFIED: insert Phase 2-3 after Jev consensus
```

---

## 3. FPGA Modular Agent Architecture

### Current State (Hardcoded)

```typescript
// orchestrator.ts — agents are hardcoded
const agentInstances: BaseAgent[] = [
  new GeometryAnalyst(),
  new PrintabilityScorer(),
  new FailurePredictor(),
  new OptimizationAdvisor(),
];
```

**Problems**:
- Can't add/remove agents without editing orchestrator
- Can't have user-defined agent pipelines
- Can't run different agent sets for different material types
- No runtime reconfiguration

### Target State (FPGA-style)

#### 3.1 Agent Registry (Configuration Memory)

```typescript
// agentRegistry.ts — like FPGA bitstream
export interface AgentSlot {
  id: string;
  agentClass: new () => BaseAgent;
  enabled: boolean;
  weight: number;
  materialFilter?: MaterialTechnology[];  // only run for these materials
  timeoutMs: number;
  priority: number;                       // execution order
}

export class AgentRegistry {
  private slots: Map<string, AgentSlot> = new Map();
  
  register(slot: AgentSlot): void;
  unregister(id: string): void;
  enable(id: string): void;
  disable(id: string): void;
  updateWeight(id: string, weight: number): void;
  getEnabled(material?: MaterialTechnology): AgentSlot[];
  
  // FPGA-style: reconfigure at runtime
  reconfigure(config: AgentSlot[]): void;
  
  // Persist to localStorage
  save(): void;
  load(): void;
}
```

#### 3.2 Agent Bus (Routing Fabric)

```typescript
// agentBus.ts — like FPGA routing switches
export interface AgentMessage {
  from: AgentId;
  to: AgentId | 'broadcast';
  type: 'score' | 'review' | 'correction' | 'telemetry';
  payload: unknown;
  timestamp: number;
}

export class AgentBus {
  private subscribers: Map<string, Set<(msg: AgentMessage) => void>>;
  
  // Publish agent output to bus
  publish(msg: AgentMessage): void;
  
  // Subscribe to specific agent or broadcast
  subscribe(agentId: string, handler: (msg: AgentMessage) => void): () => void;
  
  // Get message history for visualization
  getHistory(limit?: number): AgentMessage[];
  
  // Clear history
  clear(): void;
}
```

#### 3.3 Agent Telemetry (Observability)

```typescript
// agentTelemetry.ts — like FPGA probe points
export interface AgentTelemetry {
  agentId: AgentId;
  status: 'idle' | 'running' | 'done' | 'error' | 'recalibrating';
  currentPhase: string;
  progress: number;           // 0-1
  score?: number;
  confidence?: number;
  markers?: RiskMarker[];
  durationMs?: number;
  lastHeartbeat: number;
  
  // For factory visualization
  workbenchState?: {
    model?: string;           // what they're looking at
    tool?: string;            // what tool they're using
    output?: string;          // what they produced
  };
}

export class TelemetryHub {
  private agents: Map<AgentId, AgentTelemetry>;
  
  update(agentId: AgentId, partial: Partial<AgentTelemetry>): void;
  get(agentId: AgentId): AgentTelemetry;
  getAll(): AgentTelemetry[];
  
  // Observable stream for UI
  subscribe(callback: (telemetry: AgentTelemetry[]) => void): () => void;
}
```

#### 3.4 Material-Aware Pipeline

```typescript
// pipelineFactory.ts — like FPGA datapath configuration
export class PipelineFactory {
  // Build optimal agent pipeline for material type
  static build(material: MaterialTechnology, registry: AgentRegistry): AgentSlot[] {
    switch (material) {
      case 'sla':  // Resin printing
        return registry.getEnabled(['sla']).sort(byPriority);
      case 'fgf':  // FDM/FFF
        return registry.getEnabled(['fgf']).sort(byPriority);
      case 'pbf':  // SLS/SLM
        return registry.getEnabled(['pbf']).sort(byPriority);
      default:
        return registry.getEnabled().sort(byPriority);
    }
  }
}
```

### File Structure (Target)

```
client/src/agents/
  core/
    baseAgent.ts              ← existing, unchanged
    agentRegistry.ts          ← NEW: FPGA config memory
    agentBus.ts               ← NEW: routing fabric
    agentTelemetry.ts         ← NEW: probe points
    pipelineFactory.ts        ← NEW: material-aware pipelines
  
  agents/
    geometryAnalyst.ts        ← existing, implements BaseAgent
    printabilityScorer.ts     ← existing
    failurePredictor.ts       ← existing
    optimizationAdvisor.ts    ← existing
    meshIntegrityAgent.ts     ← NEW: example of adding new agent
  
  pipeline/
    orchestrator.ts           ← existing, refactored to use Registry
    debatePhase.ts            ← extracted from orchestrator
    jevConsensus.ts           ← extracted from orchestrator
    jevAnomalyDetector.ts     ← NEW
    jevRecalibrator.ts        ← NEW
  
  visualization/
    factoryScene.ts           ← NEW: Three.js 3D factory
    agentCharacter.ts         ← NEW: agent avatar system
    workbenchVis.ts           ← NEW: data visualization per workstation
    debateVis.ts              ← NEW: debate flow visualization
```

---

## 4. 3D Factory Visualization

### 4.1 Scene Overview

An isometric 3D factory floor where 4 agent characters work at their stations. When analysis is idle, they do idle animations. When analysis runs, they actively work with real data displayed on their workstations.

```
┌──────────────────────────────────────────────────────────┐
│                    3DP AGENT FACTORY                      │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │ Geometry │  │Printabil.│  │ Failure  │  │ Optim.  │ │
│  │ Analyst  │  │ Scorer   │  │Predictor │  │ Advisor │ │
│  │ ┌──────┐ │  │ ┌──────┐ │  │ ┌──────┐ │  │┌──────┐│ │
│  │ │ 3D   │ │  │ │Print │ │  │ │Risk  │ │  ││Design││ │
│  │ │Model │ │  │ │Cfg   │ │  │ │Chart │ │  ││Desk  ││ │
│  │ └──────┘ │  │ └──────┘ │  │ └──────┘ │  │└──────┘│ │
│  │ 📐      │  │ 🖨️      │  │ ⚠️      │  │ 💡     │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘ │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Consensus Table                        │ │
│  │         (Jev sits here, arbitrates)                 │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              Debate Arena                           │ │
│  │      (speech bubbles during debate phase)           │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 4.2 Agent Characters

Each agent has a distinct visual identity tied to their role:

| Agent | Character | Color | Workstation | Tool |
|-------|-----------|-------|-------------|------|
| Geometry Analyst | Measuring owl 🦉 | Cyan | Measurement台 + calipers | Ruler, protractor |
| Printability Scorer | Printing robot 🤖 | Green | 3D printer station | Nozzle, filament |
| Failure Predictor | Warning fox 🦊 | Orange | Monitoring wall (charts) | Magnifying glass |
| Optimization Advisor | Lightbulb deer 🦌 | Purple | Design desk + CAD | Pencil, compass |

### 4.3 Animation States

```
IDLE ──────► WORKING ──────► PRESENTING ──────► IDLE
  │              │                │
  │              ▼                │
  │         DEBATING ◄───────────┘
  │              │
  └──────────────┘
```

| State | Animation | Data Display |
|-------|-----------|--------------|
| **Idle** | Breathing, looking around, coffee break | Clock shows current time |
| **Working** | Analyzing (measuring, printing, monitoring, designing) | Real metrics from analysis |
| **Debating** | Turn toward center, speech bubbles | Agent scores + debate notes |
| **Presenting** | Pointing at consensus table | Final score + verdict |
| **Recalibrating** | Re-doing work with "correction" indicator | Jev correction context |

### 4.4 Data Visualization per Workstation

#### Geometry Analyst Station
```
┌─────────────────────────┐
│  ▌TRIANGLES   12,847    │
│  ▌VOLUME      2,340mm³  │
│  ▌SURFACE     1,892mm²  │
│  ▌WALL MIN    0.50mm ⚠️ │
│  ▌OVERHANG    12.3%  ✓  │
│  ▌MANIFOLD    ✓         │
│                         │
│  [3D model wireframe    │
│   with highlighted      │
│   problem areas]        │
└─────────────────────────┘
```

#### Printability Scorer Station
```
┌─────────────────────────┐
│  ▌LAYER H.    0.20mm    │
│  ▌NOZZLE      0.40mm    │
│  ▌INFILL      20%       │
│  ▌SUPPORT     AUTO      │
│  ▌SPEED       60mm/s    │
│                         │
│  [Print preview with    │
│   estimated time:       │
│   2h 34m]               │
└─────────────────────────┘
```

#### Failure Predictor Station
```
┌─────────────────────────┐
│  RISK MONITOR            │
│  ┌──────────────────┐   │
│  │ ████████░░  WARP │   │
│  │ ██████░░░░  DELAM│   │
│  │ ████░░░░░░  SPHT │   │
│  │ ██░░░░░░░░  CLOG │   │
│  └──────────────────┘   │
│  ▌OVERALL RISK  62%     │
│  ▌WORST AREA    Base    │
└─────────────────────────┘
```

#### Optimization Advisor Station
```
┌─────────────────────────┐
│  OPTIMIZATION            │
│  ▌CURRENT ORT  0°       │
│  ▌SUGGESTED    45°      │
│  ▌MATERIAL     PLA      │
│  ▌EST. SAVE    23%      │
│                         │
│  [Rotating model with   │
│   suggested orientation │
│   arrow]                │
└─────────────────���──────┘
```

### 4.5 Debate Visualization

When agents debate, they physically turn toward the center Consensus Table:

```
         ┌─────────┐
         │  JEV    │
         │  ⚖️     │
         └────┬────┘
              │
    ┌─────────┼─────────┐
    │         │         │
    ▼         ▼         ▼
 🦉 ──"Score should be 65"──► 🤖
    ◄──"I disagree, 72"──── 
    │
    ▼
🦊 ──"Risk is understated"──► 🦌
```

Speech bubbles show:
- Agent name
- Score adjustment (+5, -3, etc.)
- Key reasoning (1 sentence)

### 4.6 Technology Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **3D Engine** | Three.js (existing) | Already in project, shared with viewport |
| **Scene** | Custom isometric camera | Consistent view, no orbit confusion |
| **Characters** | SVG skeletal animation (DragonBones/Lottie) | Lightweight, 2D characters in 3D scene |
| **Data Panels** | CSS3DRenderer overlay | Real HTML/CSS on 3D positions |
| **State** | React context + TelemetryHub | Real-time updates from agent pipeline |
| **Transitions** | GSAP or Framer Motion 3D | Smooth state transitions |

### 4.7 Performance Budget

| Metric | Target | Notes |
|--------|--------|-------|
| Triangle count | < 10K | Simple factory geometry |
| Character sprites | < 100KB total | SVG or sprite sheets |
| FPS | 60fps | RequestAnimationFrame, no blocking |
| Memory | < 20MB | Geometry instancing, texture atlasing |
| Load time | < 500ms | Lazy-load on AGENTS tab first visit |

---

## 5. Implementation Roadmap

### Phase 1: Bug Fix + Jev Recalibration (1 week)

- [x] Fix `require()` crash in `getJevApiKey()`
- [ ] Add `jevAnomalyDetector.ts` — detect outlier agents
- [ ] Add `jevRecalibrator.ts` — targeted re-run
- [ ] Modify `orchestrator.ts` — insert Phase 2-3
- [ ] Add recalibration UI indicator in AGENTS tab
- [ ] Tests for anomaly detection edge cases

### Phase 2: FPGA Modular Architecture (2 weeks)

- [ ] Create `agentRegistry.ts` — config-driven agent management
- [ ] Create `agentBus.ts` — message passing between agents
- [ ] Create `agentTelemetry.ts` — observability layer
- [ ] Create `pipelineFactory.ts` — material-aware pipelines
- [ ] Refactor `orchestrator.ts` to use Registry + Bus
- [ ] Add runtime agent enable/disable UI
- [ ] Persist agent config to localStorage

### Phase 3: 3D Factory Scene (3-4 weeks)

- [ ] Design factory floor geometry (isometric)
- [ ] Create 4 agent character SVGs with skeleton rigs
- [ ] Implement animation state machine (idle/working/debating)
- [ ] Build workstation data panels (CSS3DRenderer)
- [ ] Wire TelemetryHub to character animations
- [ ] Implement debate visualization (speech bubbles, turn-to-center)
- [ ] Add recalibration visual indicator
- [ ] Performance optimization (instancing, LOD)

### Phase 4: Polish + Integration (1 week)

- [ ] Sound effects (subtle factory ambiance)
- [ ] Click agent → Chat tab opens with that agent selected
- [ ] Responsive design (mobile factory view)
- [ ] Accessibility (screen reader for agent states)
- [ ] E2E tests

---

## Appendix A: Adding a New Agent (FPGA-style)

With the new architecture, adding an agent is:

```typescript
// 1. Create the agent class
export class MeshIntegrityAgent extends BaseAgent {
  constructor() {
    super('mesh_integrity', { supportsVision: false, requiresVision: false, timeoutMs: 10000 });
  }
  
  protected async analyze(ctx: AgentContext): Promise<AgentOutput> {
    // Your analysis logic
    return this.makeOutput(score, confidence, verdict, explanation, details, markers);
  }
}

// 2. Register it (no orchestrator changes needed!)
agentRegistry.register({
  id: 'mesh_integrity',
  agentClass: MeshIntegrityAgent,
  enabled: true,
  weight: 0.20,
  materialFilter: undefined,  // all materials
  timeoutMs: 10000,
  priority: 5,
});

// 3. Optional: add to factory scene
factoryScene.addWorkstation({
  agentId: 'mesh_integrity',
  position: { x: 4, z: 2 },
  character: 'eagle',
  color: '#ff6b6b',
});
```

**Zero changes to orchestrator, debate phase, or consensus.**

---

## Appendix B: Jev Anomaly Detection Algorithm

```typescript
function detectAnomalies(
  results: AgentResultWithExplanation[],
  jevDecision: JevDecision,
  debateRounds: DebateRound[],
): AnomalyReport[] {
  const reports: AnomalyReport[] = [];
  
  for (const result of results) {
    const trust = jevDecision.agentTrustAdjustments[result.agentId] ?? 1.0;
    
    // Check 1: Jev flagged low trust
    if (trust < 0.7) {
      reports.push({
        agentId: result.agentId,
        reason: 'low_trust',
        severity: 1 - trust,
        jevContext: `Jev trust: ${(trust * 100).toFixed(0)}%`,
      });
      continue;
    }
    
    // Check 2: Score deviates significantly from Jev's assessment
    const scoreDelta = Math.abs(result.score - jevDecision.jevScore);
    if (scoreDelta > 30) {
      reports.push({
        agentId: result.agentId,
        reason: 'score_deviation',
        severity: scoreDelta / 100,
        jevContext: `Agent: ${result.score}, Jev: ${jevDecision.jevScore}, Δ: ${scoreDelta}`,
      });
      continue;
    }
    
    // Check 3: Agent confidence is low but score is high (overconfident)
    if (result.confidence < 0.4 && result.score > 70) {
      reports.push({
        agentId: result.agentId,
        reason: 'overconfident',
        severity: (1 - result.confidence) * (result.score / 100),
        jevContext: `Low confidence (${(result.confidence * 100).toFixed(0)}%) with high score (${result.score})`,
      });
    }
  }
  
  return reports.sort((a, b) => b.severity - a.severity);
}
```
