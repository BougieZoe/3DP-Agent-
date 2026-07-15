import { describe, it, expect, beforeEach } from 'vitest';
import {
  captureTelemetry,
  getTelemetryEvents,
  clearTelemetry,
  getTelemetryAggregation,
  getTelemetryDashboard,
  getTelemetrySummary,
} from '@/lib/telemetry';

beforeEach(() => {
  localStorage.clear();
  clearTelemetry();
});

describe('captureTelemetry', () => {
  it('returns null when profiling is undefined', () => {
    expect(captureTelemetry(1000, undefined)).toBeNull();
  });

  it('captures an event with correct fields', () => {
    const event = captureTelemetry(1000, {
      buildGeometryGraph: 2.5,
      topology: 0.5,
      validation: 0.8,
      metrics: 15.0,
      sampleWallThickness: 12.0,
      computeMeshVolume: 0.2,
      bedFit: 0.1,
      support: 0.3,
      printTime: 0.2,
    });

    expect(event).not.toBeNull();
    expect(event!.triangleCount).toBe(1000);
    expect(event!.graphBuildTime).toBe(2.5);
    expect(event!.wallThicknessTime).toBe(12.0);
    expect(typeof event!.timestamp).toBe('string');
  });

  it('computes totalAnalysisTime from top-level modules only', () => {
    const event = captureTelemetry(500, {
      buildGeometryGraph: 1.0,
      topology: 0.5,
      validation: 0.3,
      metrics: 5.0,
      sampleWallThickness: 4.5,
      computeMeshVolume: 0.15,
      computeSurfaceArea: 0.02,
      analyzeOverhang: 0.1,
      computeWallConfidence: 0.01,
      bedFit: 0.05,
      support: 0.2,
      printTime: 0.1,
    });

    // Total should be sum of top-level only: 1.0+0.5+0.3+5.0+0.05+0.2+0.1 = 7.15
    expect(event!.totalAnalysisTime).toBeCloseTo(7.15, 2);
  });

  it('handles empty profiling gracefully', () => {
    const event = captureTelemetry(0, {});
    expect(event).not.toBeNull();
    expect(event!.totalAnalysisTime).toBe(0);
    expect(event!.wallThicknessTime).toBe(0);
    expect(event!.graphBuildTime).toBe(0);
  });
});

describe('getTelemetryAggregation', () => {
  it('returns zeros when no events', () => {
    const agg = getTelemetryAggregation();
    expect(agg.eventCount).toBe(0);
    expect(agg.p50TriangleCount).toBe(0);
    expect(agg.p95TriangleCount).toBe(0);
    expect(agg.p50AnalysisDuration).toBe(0);
    expect(agg.p95AnalysisDuration).toBe(0);
  });

  it('computes p50/p95 triangle count correctly', () => {
    const profiling = {
      buildGeometryGraph: 1, topology: 0.5, validation: 0.3,
      metrics: 5, bedFit: 0.05, support: 0.2, printTime: 0.1,
    };
    captureTelemetry(100, profiling);
    captureTelemetry(200, profiling);
    captureTelemetry(300, profiling);
    captureTelemetry(400, profiling);

    // sorted: [100, 200, 300, 400]
    // p50 at index 0.5*(4-1) = 1.5 => 200*0.5 + 300*0.5 = 250
    // p95 at index 0.95*(4-1) = 2.85 => 300*0.15 + 400*0.85 = 385
    const agg = getTelemetryAggregation();
    expect(agg.eventCount).toBe(4);
    expect(agg.p50TriangleCount).toBe(250);
    expect(agg.p95TriangleCount).toBe(385);
  });

  it('computes p50/p95 analysis duration correctly', () => {
    captureTelemetry(100, {
      buildGeometryGraph: 1, topology: 0.5, validation: 0.3,
      metrics: 2, bedFit: 0.05, support: 0.2, printTime: 0.1,
    });
    captureTelemetry(200, {
      buildGeometryGraph: 1, topology: 0.5, validation: 0.3,
      metrics: 4, bedFit: 0.05, support: 0.2, printTime: 0.1,
    });

    // durations: [4.15, 6.15]
    // p50 at index 0.5*1 = 0.5 => 4.15*0.5 + 6.15*0.5 = 5.15
    // p95 at index 0.95*1 = 0.95 => 4.15*0.05 + 6.15*0.95 = 6.05
    const agg = getTelemetryAggregation();
    expect(agg.p50AnalysisDuration).toBeCloseTo(5.15, 2);
    expect(agg.p95AnalysisDuration).toBeCloseTo(6.05, 2);
  });

  it('handles single event', () => {
    captureTelemetry(500, {
      buildGeometryGraph: 2, topology: 0.5, validation: 0.3,
      metrics: 10, bedFit: 0.05, support: 0.2, printTime: 0.1,
    });

    const agg = getTelemetryAggregation();
    expect(agg.p50TriangleCount).toBe(500);
    expect(agg.p95TriangleCount).toBe(500);
  });
});

describe('getTelemetryDashboard', () => {
  it('returns empty dashboard when no events', () => {
    const dash = getTelemetryDashboard();
    expect(dash.totalRuns).toBe(0);
    expect(dash.slowestAnalyses).toHaveLength(0);
  });

  it('shows correct averages', () => {
    const longProf = { buildGeometryGraph: 1, topology: 0.5, validation: 0.3, metrics: 10, bedFit: 0.05, support: 0.2, printTime: 0.1 };
    const shortProf = { buildGeometryGraph: 1, topology: 0.5, validation: 0.3, metrics: 2, bedFit: 0.05, support: 0.2, printTime: 0.1 };

    captureTelemetry(300, longProf);
    captureTelemetry(100, shortProf);
    captureTelemetry(500, longProf);

    const dash = getTelemetryDashboard();
    expect(dash.totalRuns).toBe(3);
    expect(dash.averageTriangleCount).toBe(300);
    expect(dash.averageWallThicknessShare).toBe(0);
    expect(dash.slowestAnalyses).toHaveLength(3);
    // Both 300-tri and 500-tri have equal duration; order among ties is insertion-stable
    const topTri = dash.slowestAnalyses[0].triangleCount;
    expect([300, 500]).toContain(topTri);
  });

  it('computes average wall thickness share', () => {
    captureTelemetry(100, {
      buildGeometryGraph: 1, topology: 0.5, validation: 0.3,
      metrics: 10, sampleWallThickness: 4, bedFit: 0.05,
      support: 0.2, printTime: 0.1,
    });

    // total = 1+0.5+0.3+10+0.05+0.2+0.1 = 12.15
    // share = 4/12.15 = 0.329...
    const dash = getTelemetryDashboard();
    expect(dash.averageWallThicknessShare).toBe(33);
  });
});

describe('getTelemetrySummary', () => {
  it('returns fallback when no events', () => {
    const summary = getTelemetrySummary();
    expect(summary).toBe('No telemetry data collected.');
  });

  it('includes aggregation and dashboard data', () => {
    const profiling = { buildGeometryGraph: 1, topology: 0.5, validation: 0.3, metrics: 5, sampleWallThickness: 2, bedFit: 0.05, support: 0.2, printTime: 0.1 };
    captureTelemetry(100, profiling);

    const summary = getTelemetrySummary();
    expect(summary).toContain('Telemetry: 1 event(s)');
    expect(summary).toContain('p50 triangle count');
    expect(summary).toContain('p95 analysis duration');
    expect(summary).toContain('Slowest analyses');
  });
});
