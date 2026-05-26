import { MarkerInput, CausalityGraph, buildCausalityGraph } from './causalityEngine';
import { PatternMatch } from './topologyPatternEngine';

export type ModificationType =
  | 'thicken_wall'
  | 'reduce_overhang'
  | 'add_support'
  | 'split_bridge'
  | 'hollow_region';

export interface EventSeveritySnapshot {
  eventId: string;
  label: string;
  before: number;
  after: number;
}

export interface GeometrySuggestion {
  id: string;
  type: ModificationType;
  label: string;
  description: string;
  affectedPositions: Array<{ x: number; y: number; z: number }>;
  riskReduction: number;
  thermalImprovement: number;
  supportChange: number;
  patternImpact: string[];
  confidence: number;
  chainComparison: EventSeveritySnapshot[];
}

const MOD_META: Record<ModificationType, { label: string; description: string; factor: number }> = {
  thicken_wall: {
    label: 'Thicken Wall',
    description: 'Increase wall thickness to reduce fracture and vibration risk',
    factor: 0.35,
  },
  reduce_overhang: {
    label: 'Reduce Overhang',
    description: 'Decrease overhang angle or add chamfer supports',
    factor: 0.45,
  },
  add_support: {
    label: 'Add Support',
    description: 'Insert support columns beneath unstable overhangs',
    factor: 0.3,
  },
  split_bridge: {
    label: 'Split Bridge',
    description: 'Divide long unsupported span into shorter segments',
    factor: 0.5,
  },
  hollow_region: {
    label: 'Hollow Region',
    description: 'Remove internal mass from dense areas to reduce thermal mass',
    factor: 0.4,
  },
};

function pickAffectedMarkers(markers: MarkerInput[], type: ModificationType): number[] {
  const idx: number[] = [];
  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    switch (type) {
      case 'thicken_wall':
        if (m.type === 'thin_wall' && m.severity > 0.2) idx.push(i);
        break;
      case 'reduce_overhang':
        if (m.type === 'overhang' && m.severity > 0.2) idx.push(i);
        break;
      case 'add_support':
        if (m.type === 'support_needed' && m.severity > 0.2) idx.push(i);
        break;
      case 'split_bridge':
        if (m.type === 'overhang' || m.type === 'support_needed') idx.push(i);
        break;
      case 'hollow_region':
        if (m.severity > 0.3) idx.push(i);
        break;
    }
  }
  return idx;
}

function computeRiskReduction(before: CausalityGraph, after: CausalityGraph): number {
  const spikes = ['failure_spike', 'delamination_risk', 'overhang_sag'];
  let totalBefore = 0, totalAfter = 0, count = 0;
  for (const id of spikes) {
    const bEv = before.events.find(e => e.id === id);
    const aEv = after.events.find(e => e.id === id);
    if (bEv) { totalBefore += bEv.severity; count++; }
    if (aEv) { totalAfter += aEv.severity; }
  }
  if (totalBefore === 0) return 0;
  return Math.round((1 - totalAfter / totalBefore) * 100);
}

function computeThermalImprovement(before: CausalityGraph, after: CausalityGraph): number {
  const bEv = before.events.find(e => e.id === 'thermal_accumulation');
  const aEv = after.events.find(e => e.id === 'thermal_accumulation');
  if (!bEv || bEv.severity === 0) return 0;
  return Math.round((1 - (aEv?.severity ?? 0) / bEv.severity) * 100);
}

function computeSupportChange(before: CausalityGraph, after: CausalityGraph): number {
  const bEv = before.events.find(e => e.id === 'support_instability');
  const aEv = after.events.find(e => e.id === 'support_instability');
  if (!bEv || bEv.severity === 0) return 0;
  return Math.round((1 - (aEv?.severity ?? 0) / bEv.severity) * 100);
}

function buildChainComparison(before: CausalityGraph, after: CausalityGraph): EventSeveritySnapshot[] {
  const allIds = Array.from(new Set([...before.events.map(e => e.id), ...after.events.map(e => e.id)]));
  return allIds.map(id => ({
    eventId: id,
    label: before.events.find(e => e.id === id)?.label ?? after.events.find(e => e.id === id)?.label ?? id,
    before: Math.round((before.events.find(e => e.id === id)?.severity ?? 0) * 100),
    after: Math.round((after.events.find(e => e.id === id)?.severity ?? 0) * 100),
  }));
}

function findMatchingPatterns(affectedPositions: Array<{ x: number; y: number; z: number }>, patternMatches: PatternMatch[]): string[] {
  const matched: string[] = [];
  for (const pm of patternMatches) {
    const hasOverlap = pm.clusterPositions.some(cp =>
      affectedPositions.some(ap =>
        Math.abs(cp.x - ap.x) < 0.5 && Math.abs(cp.y - ap.y) < 0.5 && Math.abs(cp.z - ap.z) < 0.5,
      ),
    );
    if (hasOverlap) matched.push(pm.pattern.name);
  }
  return matched;
}

export function evaluateCounterfactuals(
  markers: MarkerInput[],
  patternMatches: PatternMatch[],
): GeometrySuggestion[] {
  const baseline = buildCausalityGraph(markers);
  const suggestions: GeometrySuggestion[] = [];
  let counter = 0;

  for (const [type, meta] of Object.entries(MOD_META)) {
    const modType = type as ModificationType;
    const affectedIdx = pickAffectedMarkers(markers, modType);
    if (affectedIdx.length === 0) continue;

    const modified = markers.map((m, i) =>
      affectedIdx.includes(i) ? { ...m, severity: Math.max(0.01, m.severity * meta.factor) } : m,
    );

    const counterfactual = buildCausalityGraph(modified);
    const affectedPositions = affectedIdx.map(i => markers[i].position);
    const riskReduction = computeRiskReduction(baseline, counterfactual);
    const thermalImprovement = computeThermalImprovement(baseline, counterfactual);
    const supportChange = computeSupportChange(baseline, counterfactual);
    const patternImpact = findMatchingPatterns(affectedPositions, patternMatches);
    const chainComparison = buildChainComparison(baseline, counterfactual);

    const confidence = Math.round(
      (riskReduction * 0.4 + thermalImprovement * 0.2 + supportChange * 0.2 +
        (patternImpact.length > 0 ? 20 : 0)),
    );

    if (riskReduction > 0 || thermalImprovement > 0 || supportChange > 0) {
      suggestions.push({
        id: `sug-${counter++}`,
        type: modType,
        label: meta.label,
        description: meta.description,
        affectedPositions,
        riskReduction,
        thermalImprovement,
        supportChange,
        patternImpact,
        confidence: Math.min(confidence, 100),
        chainComparison: chainComparison.filter(c => c.before > 0 || c.after > 0),
      });
    }
  }

  return suggestions.sort((a, b) => b.confidence - a.confidence);
}
