import { describe, it, expect } from 'vitest';
import { PipelineFactory } from '../core/pipelineFactory';
import { getAgentRegistry } from '../core/agentRegistry';

const ids = (slots: Array<{ id: string }>) => slots.map((s) => s.id);

describe('PipelineFactory', () => {
  it('builds the FDM pipeline with material-specific runtime weights', () => {
    const p = PipelineFactory.build('fdm');
    expect(ids(p.slots)).toEqual([
      'geometry_analyst',
      'printability_scorer',
      'failure_predictor',
      'optimization_advisor',
    ]);
    expect(p.debateRounds).toBe(2);
    expect(p.jevEnabled).toBe(true);
    expect(p.recalibrationEnabled).toBe(true);

    const weight = (id: string) => p.slots.find((s) => s.id === id)!.weight;
    expect(weight('geometry_analyst')).toBe(0.3);
    expect(weight('failure_predictor')).toBe(0.3);
    expect(weight('optimization_advisor')).toBe(0.2);
  });

  it('builds the SLA pipeline with its own weights', () => {
    const p = PipelineFactory.build('sla');
    const weight = (id: string) => p.slots.find((s) => s.id === id)!.weight;
    expect(weight('geometry_analyst')).toBe(0.35);
    expect(weight('printability_scorer')).toBe(0.35);
    expect(p.debateRounds).toBe(2);
  });

  it('uses the concrete preset: one debate round, no Jev, no recalibration', () => {
    const p = PipelineFactory.build('concrete');
    expect(p.debateRounds).toBe(1);
    expect(p.jevEnabled).toBe(false);
    expect(p.recalibrationEnabled).toBe(false);
    expect(p.slots.find((s) => s.id === 'geometry_analyst')!.weight).toBe(0.4);
  });

  it('applies material filters when instantiating slots', () => {
    const registry = getAgentRegistry();
    const original = registry.get('optimization_advisor')!;
    try {
      registry.register({ ...original, materialFilter: ['sla'] });
      expect(ids(PipelineFactory.build('fdm').slots)).not.toContain('optimization_advisor');
      expect(ids(PipelineFactory.build('sla').slots)).toContain('optimization_advisor');
    } finally {
      registry.register(original);
    }
  });

  it('does not persist material weight overrides into the registry', () => {
    const registry = getAgentRegistry();
    const before = registry.get('optimization_advisor')!.weight;
    PipelineFactory.build('fdm');
    expect(registry.get('optimization_advisor')!.weight).toBe(before);
  });
});
