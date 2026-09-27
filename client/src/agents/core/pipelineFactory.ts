import type { MaterialTechnology } from '@shared/domain/material';
import type { AgentSlot } from './agentRegistry';
import { getAgentRegistry } from './agentRegistry';

export interface PipelineConfig {
  material: MaterialTechnology;
  slots: AgentSlot[];
  debateRounds: number;
  jevEnabled: boolean;
  recalibrationEnabled: boolean;
}

const PIPELINE_PRESETS: Partial<Record<MaterialTechnology, Partial<PipelineConfig>>> = {
  sla: {
    debateRounds: 2,
    jevEnabled: true,
    recalibrationEnabled: true,
  },
  fgf: {
    debateRounds: 2,
    jevEnabled: true,
    recalibrationEnabled: true,
  },
  fdm: {
    debateRounds: 2,
    jevEnabled: true,
    recalibrationEnabled: true,
  },
  sls: {
    debateRounds: 3,
    jevEnabled: true,
    recalibrationEnabled: true,
  },
  slm: {
    debateRounds: 3,
    jevEnabled: true,
    recalibrationEnabled: true,
  },
  concrete: {
    debateRounds: 1,
    jevEnabled: false,
    recalibrationEnabled: false,
  },
  eco: {
    debateRounds: 1,
    jevEnabled: false,
    recalibrationEnabled: false,
  },
};

export class PipelineFactory {
  static build(material: MaterialTechnology): PipelineConfig {
    const registry = getAgentRegistry();
    const preset = PIPELINE_PRESETS[material] ?? {};

    return {
      material,
      slots: registry.getEnabled(material),
      debateRounds: preset.debateRounds ?? 2,
      jevEnabled: preset.jevEnabled ?? true,
      recalibrationEnabled: preset.recalibrationEnabled ?? true,
    };
  }

  static getMaterialWeightOverrides(material: MaterialTechnology): Partial<Record<string, number>> {
    switch (material) {
      case 'sla':
        return { geometry_analyst: 0.35, printability_scorer: 0.35 };
      case 'fgf':
        return { failure_predictor: 0.30, optimization_advisor: 0.20 };
      case 'fdm':
        return { failure_predictor: 0.30, optimization_advisor: 0.20 };
      case 'sls':
        return { geometry_analyst: 0.30, failure_predictor: 0.30 };
      case 'slm':
        return { geometry_analyst: 0.30, failure_predictor: 0.30 };
      case 'concrete':
        return { geometry_analyst: 0.40, printability_scorer: 0.40 };
      case 'eco':
        return { optimization_advisor: 0.40, printability_scorer: 0.30 };
      default:
        return {};
    }
  }
}
