export interface TelemetryEvent {
  triangleCount: number;
  totalAnalysisTime: number;
  wallThicknessTime: number;
  graphBuildTime: number;
  timestamp: string;
}

export interface TelemetryAggregation {
  p50TriangleCount: number;
  p95TriangleCount: number;
  p50AnalysisDuration: number;
  p95AnalysisDuration: number;
  eventCount: number;
}

const STORAGE_KEY = '3dp-agent-telemetry';

function loadEvents(): TelemetryEvent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e: unknown): e is TelemetryEvent =>
        typeof e === 'object' && e !== null &&
        typeof (e as TelemetryEvent).triangleCount === 'number' &&
        typeof (e as TelemetryEvent).timestamp === 'string'
    );
  } catch {
    return [];
  }
}

function saveEvents(evts: TelemetryEvent[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(evts));
  } catch {
    // storage full or unavailable — silently drop
  }
}

const events: TelemetryEvent[] = loadEvents();

const TOP_LEVEL_MODULES = new Set([
  'buildGeometryGraph', 'topology', 'validation', 'metrics',
  'bedFit', 'support', 'printTime',
]);

function sumProfiling(profiling: Record<string, number>): number {
  let total = 0;
  for (const [key, val] of Object.entries(profiling)) {
    if (TOP_LEVEL_MODULES.has(key)) {
      total += val;
    }
  }
  return total;
}

export function captureTelemetry(
  triangleCount: number,
  profiling?: Record<string, number>,
): TelemetryEvent | null {
  if (!profiling) return null;

  const event: TelemetryEvent = {
    triangleCount,
    totalAnalysisTime: sumProfiling(profiling),
    wallThicknessTime: profiling['sampleWallThickness'] ?? 0,
    graphBuildTime: profiling['buildGeometryGraph'] ?? 0,
    timestamp: new Date().toISOString(),
  };

  events.push(event);
  saveEvents(events);

  if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
    const pct = event.totalAnalysisTime > 0
      ? (event.wallThicknessTime / event.totalAnalysisTime * 100).toFixed(1)
      : '0.0';
    console.log(
      `[telemetry] ${event.triangleCount} tri | ` +
      `total=${event.totalAnalysisTime.toFixed(1)}ms | ` +
      `wall=${event.wallThicknessTime.toFixed(1)}ms (${pct}%) | ` +
      `graph=${event.graphBuildTime.toFixed(1)}ms`
    );
  }

  return event;
}

export function getTelemetryEvents(): TelemetryEvent[] {
  return [...events];
}

export function clearTelemetry(): void {
  events.length = 0;
  saveEvents(events);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const index = p * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const frac = index - lower;
  return sorted[lower] * (1 - frac) + sorted[upper] * frac;
}

export function getTelemetryAggregation(): TelemetryAggregation {
  if (events.length === 0) {
    return {
      p50TriangleCount: 0,
      p95TriangleCount: 0,
      p50AnalysisDuration: 0,
      p95AnalysisDuration: 0,
      eventCount: 0,
    };
  }

  const triCounts = events.map(e => e.triangleCount).sort((a, b) => a - b);
  const durations = events.map(e => e.totalAnalysisTime).sort((a, b) => a - b);

  return {
    p50TriangleCount: percentile(triCounts, 0.5),
    p95TriangleCount: percentile(triCounts, 0.95),
    p50AnalysisDuration: percentile(durations, 0.5),
    p95AnalysisDuration: percentile(durations, 0.95),
    eventCount: events.length,
  };
}

export interface TelemetryDashboard {
  totalRuns: number;
  averageTriangleCount: number;
  averageWallThicknessShare: number;
  slowestAnalyses: TelemetryEvent[];
}

export function getTelemetryDashboard(limit: number = 5): TelemetryDashboard {
  if (events.length === 0) {
    return {
      totalRuns: 0,
      averageTriangleCount: 0,
      averageWallThicknessShare: 0,
      slowestAnalyses: [],
    };
  }

  const avgTri = events.reduce((s, e) => s + e.triangleCount, 0) / events.length;
  const avgWtShare = events.reduce((s, e) => {
    return s + (e.totalAnalysisTime > 0
      ? (e.wallThicknessTime / e.totalAnalysisTime)
      : 0);
  }, 0) / events.length;

  const sorted = [...events].sort((a, b) => b.totalAnalysisTime - a.totalAnalysisTime);
  const slowest = sorted.slice(0, limit);

  return {
    totalRuns: events.length,
    averageTriangleCount: Math.round(avgTri),
    averageWallThicknessShare: Math.round(avgWtShare * 100),
    slowestAnalyses: slowest,
  };
}

export function getTelemetrySummary(): string {
  if (events.length === 0) return 'No telemetry data collected.';

  const dash = getTelemetryDashboard();
  const agg = getTelemetryAggregation();

  const lines = events.map((e, i) =>
    `  #${i + 1}: ${e.triangleCount} tri | ` +
    `total ${e.totalAnalysisTime.toFixed(1)}ms | ` +
    `wall ${e.wallThicknessTime.toFixed(1)}ms | ` +
    `graph ${e.graphBuildTime.toFixed(1)}ms`
  );

  return [
    `Telemetry: ${events.length} event(s)`,
    `Avg triangle count: ${dash.averageTriangleCount}`,
    `Avg wall thickness share: ${dash.averageWallThicknessShare}%`,
    `p50 triangle count: ${agg.p50TriangleCount}`,
    `p95 triangle count: ${agg.p95TriangleCount}`,
    `p50 analysis duration: ${agg.p50AnalysisDuration.toFixed(1)}ms`,
    `p95 analysis duration: ${agg.p95AnalysisDuration.toFixed(1)}ms`,
    '',
    'Slowest analyses:',
    ...dash.slowestAnalyses.map((e, i) =>
      `  #${i + 1}: ${e.triangleCount} tri in ${e.totalAnalysisTime.toFixed(1)}ms`
    ),
    '',
    ...lines,
  ].join('\n');
}
