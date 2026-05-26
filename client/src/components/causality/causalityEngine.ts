export type EventType =
  | 'thermal_accumulation'
  | 'cooling_imbalance'
  | 'support_instability'
  | 'bridge_oscillation'
  | 'wall_vibration'
  | 'overhang_sag'
  | 'delamination_risk'
  | 'failure_spike';

export interface CausalityEvent {
  id: string;
  type: EventType;
  label: string;
  description: string;
  severity: number;
  timestamp: number;
  duration: number;
  positions: Array<{ x: number; y: number; z: number }>;
}

export interface CausalEdge {
  sourceId: string;
  targetId: string;
  strength: number;
  label: string;
}

export interface CausalityGraph {
  events: CausalityEvent[];
  edges: CausalEdge[];
}

export interface MarkerInput {
  position: { x: number; y: number; z: number };
  severity: number;
  type: string;
}

function avgSeverity(markers: MarkerInput[]): number {
  return markers.reduce((s, m) => s + m.severity, 0) / markers.length;
}

function centroid(markers: MarkerInput[]): { x: number; y: number; z: number } {
  const n = markers.length;
  return {
    x: markers.reduce((s, m) => s + m.position.x, 0) / n,
    y: markers.reduce((s, m) => s + m.position.y, 0) / n,
    z: markers.reduce((s, m) => s + m.position.z, 0) / n,
  };
}

export function buildCausalityGraph(markers: MarkerInput[]): CausalityGraph {
  const events: CausalityEvent[] = [];
  const edges: CausalEdge[] = [];

  const overhangs = markers.filter(m => m.type === 'overhang' && m.severity > 0.2);
  const thinWalls = markers.filter(m => m.type === 'thin_wall' && m.severity > 0.2);
  const supports = markers.filter(m => m.type === 'support_needed' && m.severity > 0.2);
  const allPositions = markers.filter(m => m.severity > 0.2).map(m => m.position);

  if (supports.length > 0) {
    const sev = avgSeverity(supports);
    events.push({
      id: 'support_instability',
      type: 'support_instability',
      label: 'Support Instability',
      description: `${supports.length} support regions with potential instability`,
      severity: sev,
      timestamp: 0.05,
      duration: 0.35,
      positions: supports.map(m => m.position),
    });
  }

  if (overhangs.length > 0) {
    const sev = avgSeverity(overhangs);
    events.push({
      id: 'overhang_sag',
      type: 'overhang_sag',
      label: 'Overhang Sag',
      description: `${overhangs.length} overhanging surfaces at sag risk`,
      severity: sev,
      timestamp: 0.2,
      duration: 0.3,
      positions: overhangs.map(m => m.position),
    });

    if (supports.length > 0 && overhangs.length > 0) {
      events.push({
        id: 'bridge_oscillation',
        type: 'bridge_oscillation',
        label: 'Bridge Oscillation',
        description: `Unsupported spans oscillating under thermal stress`,
        severity: (avgSeverity(overhangs) + avgSeverity(supports)) / 2,
        timestamp: 0.35,
        duration: 0.25,
        positions: [...overhangs.slice(0, 5).map(m => m.position), ...supports.slice(0, 3).map(m => m.position)],
      });
    }
  }

  if (thinWalls.length > 0) {
    events.push({
      id: 'wall_vibration',
      type: 'wall_vibration',
      label: 'Wall Vibration',
      description: `${thinWalls.length} thin-walled regions vulnerable to vibration`,
      severity: avgSeverity(thinWalls),
      timestamp: 0.3,
      duration: 0.3,
      positions: thinWalls.map(m => m.position),
    });
  }

  if (allPositions.length > 3) {
    events.push({
      id: 'thermal_accumulation',
      type: 'thermal_accumulation',
      label: 'Thermal Accumulation',
      description: `Heat building up in dense feature regions`,
      severity: Math.min(avgSeverity(markers) + 0.2, 1),
      timestamp: 0.1,
      duration: 0.4,
      positions: allPositions.slice(0, 8),
    });
  }

  if (markers.some(m => m.severity > 0.6)) {
    events.push({
      id: 'delamination_risk',
      type: 'delamination_risk',
      label: 'Delamination Risk',
      description: `High-severity regions prone to layer separation`,
      severity: Math.max(...markers.filter(m => m.severity > 0.6).map(m => m.severity)),
      timestamp: 0.45,
      duration: 0.2,
      positions: markers.filter(m => m.severity > 0.6).map(m => m.position),
    });
  }

  const failureSev = events.length > 0
    ? Math.min(events.reduce((s, e) => s + e.severity, 0) / events.length * 1.2, 1)
    : 0;

  if (failureSev > 0.1) {
    const c = allPositions.length > 0 ? centroid(markers) : { x: 0, y: 0, z: 0 };
    events.push({
      id: 'failure_spike',
      type: 'failure_spike',
      label: 'Failure Probability',
      description: `Aggregate failure risk across ${events.length} active events`,
      severity: failureSev,
      timestamp: 0.6,
      duration: 0.15,
      positions: [c],
    });
  }

  const thermalEvent = events.find(e => e.id === 'thermal_accumulation');
  const supportEvent = events.find(e => e.id === 'support_instability');
  const sagEvent = events.find(e => e.id === 'overhang_sag');
  const bridgeEvent = events.find(e => e.id === 'bridge_oscillation');
  const wallEvent = events.find(e => e.id === 'wall_vibration');
  const delamEvent = events.find(e => e.id === 'delamination_risk');
  const failureEvent = events.find(e => e.id === 'failure_spike');

  if (thermalEvent && supportEvent) {
    edges.push({ sourceId: 'thermal_accumulation', targetId: 'support_instability', strength: 0.6, label: 'heating weakens supports' });
  }
  if (supportEvent && bridgeEvent) {
    edges.push({ sourceId: 'support_instability', targetId: 'bridge_oscillation', strength: 0.7, label: 'unstable supports amplify oscillation' });
  }
  if (thermalEvent && sagEvent) {
    edges.push({ sourceId: 'thermal_accumulation', targetId: 'overhang_sag', strength: 0.5, label: 'heat softens overhangs' });
  }
  if (sagEvent && bridgeEvent) {
    edges.push({ sourceId: 'overhang_sag', targetId: 'bridge_oscillation', strength: 0.4, label: 'sagging increases span stress' });
  }
  if (thermalEvent && wallEvent) {
    edges.push({ sourceId: 'thermal_accumulation', targetId: 'wall_vibration', strength: 0.5, label: 'thermal gradient excites walls' });
  }
  if (bridgeEvent && delamEvent) {
    edges.push({ sourceId: 'bridge_oscillation', targetId: 'delamination_risk', strength: 0.6, label: 'oscillation propagates to layers' });
  }
  if (wallEvent && delamEvent) {
    edges.push({ sourceId: 'wall_vibration', targetId: 'delamination_risk', strength: 0.5, label: 'vibration stresses layer bond' });
  }
  if (delamEvent && failureEvent) {
    edges.push({ sourceId: 'delamination_risk', targetId: 'failure_spike', strength: 0.8, label: 'layer separation leads to failure' });
  }
  if (bridgeEvent && failureEvent) {
    edges.push({ sourceId: 'bridge_oscillation', targetId: 'failure_spike', strength: 0.5, label: 'oscillation increases failure probability' });
  }
  if (wallEvent && failureEvent) {
    edges.push({ sourceId: 'wall_vibration', targetId: 'failure_spike', strength: 0.4, label: 'wall fatigue contributes to failure' });
  }
  if (sagEvent && failureEvent) {
    edges.push({ sourceId: 'overhang_sag', targetId: 'failure_spike', strength: 0.5, label: 'sagging reduces structural integrity' });
  }

  return { events, edges };
}
