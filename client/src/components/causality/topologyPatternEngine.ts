interface MarkerInput {
  position: { x: number; y: number; z: number };
  severity: number;
  type: string;
}

export interface PatternSignature {
  typeComposition: Record<string, number>;
  spatialDensity: number;
  avgSeverity: number;
  diagonal: number;
  aspectRatio: number;
  markerCount: number;
  avgHeight: number;
}

export interface TopologyPattern {
  id: string;
  name: string;
  description: string;
  signature: PatternSignature;
  recurrenceCount: number;
  firstSeen: number;
  lastSeen: number;
  confidence: number;
  consequenceChain: string[];
}

export interface PatternMatch {
  pattern: TopologyPattern;
  similarity: number;
  clusterPositions: Array<{ x: number; y: number; z: number }>;
  avgClusterSeverity: number;
}

const STORAGE_KEY = '3dp_known_patterns';

function clusterMarkers(markers: MarkerInput[], radius = 2.5): MarkerInput[][] {
  if (markers.length === 0) return [];
  const assigned = new Set<number>();
  const clusters: MarkerInput[][] = [];

  for (let i = 0; i < markers.length; i++) {
    if (assigned.has(i)) continue;
    const cluster: MarkerInput[] = [markers[i]];
    assigned.add(i);

    for (let j = i + 1; j < markers.length; j++) {
      if (assigned.has(j)) continue;
      const dx = markers[i].position.x - markers[j].position.x;
      const dy = markers[i].position.y - markers[j].position.y;
      const dz = markers[i].position.z - markers[j].position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < radius) {
        cluster.push(markers[j]);
        assigned.add(j);
      }
    }

    if (cluster.length >= 2) clusters.push(cluster);
  }

  return clusters;
}

function computeSignature(markers: MarkerInput[]): PatternSignature {
  const typeComposition: Record<string, number> = {};
  let totalSev = 0;

  for (const m of markers) {
    typeComposition[m.type] = (typeComposition[m.type] ?? 0) + 1;
    totalSev += m.severity;
  }

  for (const key of Object.keys(typeComposition)) {
    typeComposition[key] /= markers.length;
  }

  const xs = markers.map(m => m.position.x);
  const ys = markers.map(m => m.position.y);
  const zs = markers.map(m => m.position.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const w = maxX - minX || 0.01;
  const h = maxY - minY || 0.01;
  const d = maxZ - minZ || 0.01;
  const diagonal = Math.sqrt(w * w + h * h + d * d);
  const volume = w * h * d || 0.01;
  const midY = (minY + maxY) / 2;

  return {
    typeComposition,
    spatialDensity: markers.length / volume,
    avgSeverity: totalSev / markers.length,
    diagonal,
    aspectRatio: Math.max(w, d) / (h || 0.01),
    markerCount: markers.length,
    avgHeight: midY,
  };
}

function cosineSimilarity(a: Record<string, number>, b: Record<string, number>): number {
  const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
  let dot = 0, na = 0, nb = 0;
  for (const k of keys) {
    const va = a[k] ?? 0;
    const vb = b[k] ?? 0;
    dot += va * vb;
    na += va * va;
    nb += vb * vb;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function compareSignatures(a: PatternSignature, b: PatternSignature): number {
  const typeSim = cosineSimilarity(a.typeComposition, b.typeComposition);
  const densitySim = 1 - Math.abs(a.spatialDensity - b.spatialDensity) / Math.max(a.spatialDensity, b.spatialDensity, 0.01);
  const severitySim = 1 - Math.abs(a.avgSeverity - b.avgSeverity);
  const ratioSim = 1 - Math.abs(a.aspectRatio - b.aspectRatio) / Math.max(a.aspectRatio, b.aspectRatio, 0.01);
  const heightSim = 1 - Math.abs(a.avgHeight - b.avgHeight) / Math.max(Math.abs(a.avgHeight), Math.abs(b.avgHeight), 0.01);

  return typeSim * 0.35 + densitySim * 0.2 + severitySim * 0.2 + ratioSim * 0.15 + heightSim * 0.1;
}

function getKnownPatterns(): TopologyPattern[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch { /* fall through */ }
  }
  return getDefaultPatterns();
}

function getDefaultPatterns(): TopologyPattern[] {
  return [
    {
      id: 'unsupported_thin_bridge',
      name: 'Unsupported Thin Bridge',
      description: 'Narrow horizontal span with thin walls, at risk of sagging or fracture under load',
      signature: {
        typeComposition: { thin_wall: 0.7, overhang: 0.2, support_needed: 0.1 },
        spatialDensity: 0.8, avgSeverity: 0.65, diagonal: 3, aspectRatio: 4, markerCount: 4, avgHeight: 1.5,
      },
      recurrenceCount: 1, firstSeen: Date.now(), lastSeen: Date.now(), confidence: 0, consequenceChain: ['overhang_sag', 'bridge_oscillation'],
    },
    {
      id: 'dense_overhang_cluster',
      name: 'Dense Overhang Cluster',
      description: 'Concentrated region of steep overhangs requiring support or redesign',
      signature: {
        typeComposition: { overhang: 0.8, support_needed: 0.15, thin_wall: 0.05 },
        spatialDensity: 2.5, avgSeverity: 0.7, diagonal: 2, aspectRatio: 1.2, markerCount: 6, avgHeight: 2,
      },
      recurrenceCount: 1, firstSeen: Date.now(), lastSeen: Date.now(), confidence: 0, consequenceChain: ['overhang_sag', 'support_instability'],
    },
    {
      id: 'thermal_trap_cavity',
      name: 'Thermal Trap Cavity',
      description: 'Enclosed or concave region where heat accumulates, causing warping and layer adhesion issues',
      signature: {
        typeComposition: { thin_wall: 0.3, overhang: 0.3, support_needed: 0.4 },
        spatialDensity: 1.8, avgSeverity: 0.6, diagonal: 2.5, aspectRatio: 1, markerCount: 5, avgHeight: 1,
      },
      recurrenceCount: 1, firstSeen: Date.now(), lastSeen: Date.now(), confidence: 0, consequenceChain: ['thermal_accumulation', 'cooling_imbalance'],
    },
    {
      id: 'oscillating_vertical_wall',
      name: 'Oscillating Vertical Wall',
      description: 'Tall thin wall prone to vibration during printing, risking delamination',
      signature: {
        typeComposition: { thin_wall: 0.9, support_needed: 0.1, overhang: 0 },
        spatialDensity: 0.6, avgSeverity: 0.55, diagonal: 4, aspectRatio: 0.3, markerCount: 3, avgHeight: 3,
      },
      recurrenceCount: 1, firstSeen: Date.now(), lastSeen: Date.now(), confidence: 0, consequenceChain: ['wall_vibration', 'delamination_risk'],
    },
    {
      id: 'unstable_support_island',
      name: 'Unstable Support Island',
      description: 'Isolated region requiring dense supports, prone to tipping or layer shift',
      signature: {
        typeComposition: { support_needed: 0.85, overhang: 0.1, thin_wall: 0.05 },
        spatialDensity: 1.2, avgSeverity: 0.75, diagonal: 1.5, aspectRatio: 1.5, markerCount: 4, avgHeight: 2.5,
      },
      recurrenceCount: 1, firstSeen: Date.now(), lastSeen: Date.now(), confidence: 0, consequenceChain: ['support_instability', 'bridge_oscillation'],
    },
    {
      id: 'stress_concentration_void',
      name: 'Stress Concentration Void',
      description: 'Sharp internal corner or hole where stress concentrates, likely cracking point',
      signature: {
        typeComposition: { thin_wall: 0.4, overhang: 0.4, support_needed: 0.2 },
        spatialDensity: 0.9, avgSeverity: 0.8, diagonal: 1.8, aspectRatio: 0.8, markerCount: 3, avgHeight: 1.2,
      },
      recurrenceCount: 1, firstSeen: Date.now(), lastSeen: Date.now(), confidence: 0, consequenceChain: ['delamination_risk', 'failure_spike'],
    },
  ];
}

function persistPatterns(patterns: TopologyPattern[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(patterns));
  } catch { /* storage may be full */ }
}

export function detectPatterns(markers: MarkerInput[]): PatternMatch[] {
  const clusters = clusterMarkers(markers);
  const knownPatterns = getKnownPatterns();
  const matches: PatternMatch[] = [];

  for (const cluster of clusters) {
    const sig = computeSignature(cluster);
    let bestSim = 0;
    let bestPattern: TopologyPattern | null = null;

    for (const pattern of knownPatterns) {
      const sim = compareSignatures(sig, pattern.signature);
      if (sim > bestSim) {
        bestSim = sim;
        bestPattern = pattern;
      }
    }

    if (bestPattern && bestSim > 0.55) {
      const avgSev = cluster.reduce((s, m) => s + m.severity, 0) / cluster.length;
      matches.push({
        pattern: {
          ...bestPattern,
          confidence: Math.round(bestSim * 100),
          lastSeen: Date.now(),
          signature: sig,
        },
        similarity: Math.round(bestSim * 100),
        clusterPositions: cluster.map(m => m.position),
        avgClusterSeverity: avgSev,
      });
    }
  }

  // Recurrence means "seen in N analyses", so count each pattern once per
  // analysis even when several clusters matched it in the same run.
  const matchedPatternIds = new Set(matches.map(m => m.pattern.id));
  matchedPatternIds.forEach(patternId => {
    const existing = knownPatterns.find(p => p.id === patternId);
    if (existing) {
      existing.recurrenceCount++;
      existing.lastSeen = Date.now();
      const bestSimilarity = Math.max(
        ...matches.filter(m => m.pattern.id === patternId).map(m => m.similarity),
      );
      existing.confidence = Math.max(existing.confidence, bestSimilarity);
    }
  });
  persistPatterns(knownPatterns);

  return matches;
}

export function getStoredPatterns(): TopologyPattern[] {
  return getKnownPatterns();
}

export function clearPatternMemory(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function serializePatterns(): string {
  return JSON.stringify(getKnownPatterns(), null, 2);
}
