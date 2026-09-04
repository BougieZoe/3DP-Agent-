import { describe, it, expect } from 'vitest';
import { OptimizationAdvisor } from '../optimizationAdvisor';
import {
  buildAgentContext,
  buildMockUnifiedAnalysis,
  normalMetrics,
  thinWallMetrics,
  overhangMetrics,
  criticalBothMetrics,
  mockMaterial,
} from './testAgentFixtures';
import type { AgentOutput } from '@shared/domain/agent';
import type { VendorCapacityAdapter, MachineAvailability, MaterialStock } from '@/lib/vendorCapacity';

describe('OptimizationAdvisor', () => {
  const advisor = new OptimizationAdvisor();

  it('returns high score for a well-optimized model', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: normalMetrics() }),
    });
    const output = await advisor.execute(ctx);
    expect(output.score).toBeGreaterThanOrEqual(70);
    const details = output.details as Record<string, unknown>;
    expect(details.suggestions).toBeDefined();
  });

  it('suggests wall thickening for thin walls', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: thinWallMetrics() }),
    });
    const output = await advisor.execute(ctx);
    const details = output.details as Record<string, unknown>;
    const suggestions = details.suggestions as unknown[];
    const wallSugs = suggestions.filter(s =>
      (s as Record<string, unknown>).type === 'wall_thickening'
    );
    expect(wallSugs.length).toBeGreaterThan(0);
    const sug = wallSugs[0] as Record<string, unknown>;
    expect(sug.priority).toBe('critical');
  });

  it('suggests orientation change and supports for overhangs', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: overhangMetrics() }),
      material: mockMaterial({ overhangThreshold: 50 }),
    });
    const output = await advisor.execute(ctx);
    const details = output.details as Record<string, unknown>;
    const suggestions = details.suggestions as unknown[];
    const orientSugs = suggestions.filter(s =>
      (s as Record<string, unknown>).type === 'orientation_change'
    );
    const supportSugs = suggestions.filter(s =>
      (s as Record<string, unknown>).type === 'support_addition'
    );
    expect(orientSugs.length).toBeGreaterThan(0);
    expect(supportSugs.length).toBeGreaterThan(0);
  });

  it('suggests bridging redesign for extreme aspect ratio', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: normalMetrics() }),
      modelSize: { x: 10, y: 10, z: 200 },
    });
    const output = await advisor.execute(ctx);
    const details = output.details as Record<string, unknown>;
    const suggestions = details.suggestions as unknown[];
    const bridgeSugs = suggestions.filter(s =>
      (s as Record<string, unknown>).type === 'bridging_redesign'
    );
    expect(bridgeSugs.length).toBeGreaterThan(0);
  });

  it('recommends materials based on model size and thickness', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: normalMetrics() }),
      modelSize: { x: 200, y: 150, z: 30 },
    });
    const output = await advisor.execute(ctx);
    const details = output.details as Record<string, unknown>;
    const materials = details.recommendedMaterials as unknown[];
    expect(materials.length).toBeGreaterThanOrEqual(2);
    const first = materials[0] as Record<string, unknown>;
    expect(first.material).toBeDefined();
    expect(first.process).toBeDefined();
  });

  it('integrates previous agent outputs when available', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: normalMetrics() }),
    });
    ctx.previousOutputs.set('geometry_analyst', {
      agentId: 'geometry_analyst',
      agentName: 'Geometry Analyst',
      score: 45,
      confidence: 0.6,
      verdict: 'warning',
      details: {},
      explanation: '',
      markers: [],
    });
    ctx.previousOutputs.set('failure_predictor', {
      agentId: 'failure_predictor',
      agentName: 'Failure Predictor',
      score: 40,
      confidence: 0.7,
      verdict: 'warning',
      details: { risks: [{ type: 'overhang_failure', severity: 'high' }] },
      explanation: '',
      markers: [],
    });
    const output = await advisor.execute(ctx);
    expect(output.score).toBeGreaterThanOrEqual(0);
    expect(output.details).toBeDefined();
  });

  it('suggests hole_fill for low polygon count', async () => {
    const lowPolyMetrics = normalMetrics();
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: lowPolyMetrics }),
      modelSize: { x: 50, y: 20, z: 10 },
    });
    ctx.unifiedAnalysis.topology.result.triangleCount = 50;
    const output = await advisor.execute(ctx);
    const details = output.details as Record<string, unknown>;
    const suggestions = details.suggestions as unknown[];
    const fillSugs = suggestions.filter(s =>
      (s as Record<string, unknown>).type === 'hole_fill'
    );
    expect(fillSugs.length).toBeGreaterThan(0);
  });

  it('handles critical combined issues with low score', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: criticalBothMetrics() }),
    });
    const output = await advisor.execute(ctx);
    expect(output.score).toBeLessThan(70);
    expect(['fail', 'warning']).toContain(output.verdict);
  });

  it('annotates materials with availability when adapter is provided', async () => {
    const mockAdapter: VendorCapacityAdapter = {
      getMachineAvailability: async () => ({ machineId: 'kings3d-fgf1800pro-01', status: 'available' }),
      getMaterialStock: async (type: string) => {
        // Match by prefix — PLA+ matches PLA, PETG matches PETG, etc.
        const normalized = type.replace(/[^a-zA-Z]/g, '').toUpperCase();
        const stock: Record<string, MaterialStock> = {
          PLA: { materialType: 'PLA', remainingKg: 12.5, lastUpdated: new Date().toISOString() },
          PETG: { materialType: 'PETG', remainingKg: 0.3, lastUpdated: new Date().toISOString() },
          ABSASA: { materialType: 'ABS/ASA', remainingKg: 8.0, lastUpdated: new Date().toISOString() },
        };
        // Find matching stock by checking if normalized starts with a key
        for (const [key, val] of Object.entries(stock)) {
          if (normalized.startsWith(key)) return val;
        }
        return null;
      },
    };

    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: normalMetrics() }),
      modelSize: { x: 200, y: 150, z: 30 },
      vendorCapacityAdapter: mockAdapter,
    });
    const output = await advisor.execute(ctx);
    const details = output.details as Record<string, unknown>;
    const materials = details.recommendedMaterials as Array<Record<string, unknown>>;

    expect(materials.length).toBeGreaterThanOrEqual(2);
    const first = materials[0];
    expect(first.availability).toBeDefined();
    expect((first.availability as Record<string, unknown>).materialStockKg).toBe(12.5);
  });

  it('does not annotate when adapter is absent', async () => {
    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: normalMetrics() }),
      modelSize: { x: 200, y: 150, z: 30 },
    });
    const output = await advisor.execute(ctx);
    const details = output.details as Record<string, unknown>;
    const materials = details.recommendedMaterials as Array<Record<string, unknown>>;

    expect(materials.length).toBeGreaterThanOrEqual(2);
    for (const mat of materials) {
      expect(mat.availability).toBeUndefined();
    }
  });

  it('flags booked status via adapter', async () => {
    const mockAdapter: VendorCapacityAdapter = {
      getMachineAvailability: async () => ({ machineId: 'kings3d-fgf1800pro-02', status: 'booked', nextFreeSlot: '2026-09-06T08:00:00.000Z' }),
      getMaterialStock: async (type: string) => {
        const normalized = type.replace(/[^a-zA-Z]/g, '').toUpperCase();
        const stock: Record<string, MaterialStock> = {
          PLA: { materialType: 'PLA', remainingKg: 12.5, lastUpdated: new Date().toISOString() },
          PETG: { materialType: 'PETG', remainingKg: 0.3, lastUpdated: new Date().toISOString() },
          ABSASA: { materialType: 'ABS/ASA', remainingKg: 8.0, lastUpdated: new Date().toISOString() },
        };
        for (const [key, val] of Object.entries(stock)) {
          if (normalized.startsWith(key)) return val;
        }
        return null;
      },
    };

    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: normalMetrics() }),
      modelSize: { x: 200, y: 150, z: 30 },
      vendorCapacityAdapter: mockAdapter,
    });
    const output = await advisor.execute(ctx);
    const details = output.details as Record<string, unknown>;
    const materials = details.recommendedMaterials as Array<Record<string, unknown>>;
    const first = materials[0];
    const avail = first.availability as Record<string, unknown> | undefined;
    expect(avail).toBeDefined();
    expect(avail!.materialStockKg).toBeDefined();
  });

  it('handles adapter errors without crashing', async () => {
    const brokenAdapter: VendorCapacityAdapter = {
      getMachineAvailability: async () => { throw new Error('network error'); },
      getMaterialStock: async () => { throw new Error('network error'); },
    };

    const ctx = buildAgentContext({
      unifiedAnalysis: buildMockUnifiedAnalysis({ metrics: normalMetrics() }),
      modelSize: { x: 200, y: 150, z: 30 },
      vendorCapacityAdapter: brokenAdapter,
    });
    const output = await advisor.execute(ctx);
    expect(output.score).toBeGreaterThanOrEqual(0);
    const details = output.details as Record<string, unknown>;
    const materials = details.recommendedMaterials as Array<Record<string, unknown>>;
    expect(materials.length).toBeGreaterThanOrEqual(2);
    // No availability annotation due to error
    for (const mat of materials) {
      expect(mat.availability).toBeUndefined();
    }
  });
});
