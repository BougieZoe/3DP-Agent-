import { describe, it, expect, beforeEach } from 'vitest';
import { AgentStateManager, getAgentStateManager } from '../agentState';

describe('agentState', () => {
  let manager: AgentStateManager;

  beforeEach(() => {
    manager = new AgentStateManager();
  });

  describe('AgentStateManager', () => {
    it('should initialize with pending status', () => {
      const state = manager.getState();

      expect(state.status.geometry_analyst).toBe('pending');
      expect(state.status.failure_predictor).toBe('pending');
      expect(state.status.optimization_advisor).toBe('pending');
      expect(state.status.printability_scorer).toBe('pending');
    });

    it('should update agent status', () => {
      manager.setAgentStatus('geometry_analyst', 'running');
      const state = manager.getState();

      expect(state.status.geometry_analyst).toBe('running');
    });

    it('should set geometry result', () => {
      manager.setGeometry({
        wallThickness: [1.0, 2.0],
        overhangAngles: [],
        vertexCount: 100,
        triangleCount: 50,
      });

      const state = manager.getState();
      expect(state.geometry).not.toBeNull();
      expect(state.geometry?.vertexCount).toBe(100);
      expect(state.status.geometry_analyst).toBe('done');
    });

    it('should set failure result', () => {
      manager.setFailures({
        risks: [
          {
            type: 'overhang',
            position: [0, 0, 0],
            severity: 0.7,
            description: 'Test risk',
          },
        ],
      });

      const state = manager.getState();
      expect(state.failures).not.toBeNull();
      expect(state.failures?.risks.length).toBe(1);
      expect(state.status.failure_predictor).toBe('done');
    });

    it('should set score', () => {
      manager.setScore(85);

      const state = manager.getState();
      expect(state.score).toBe(85);
      expect(state.status.printability_scorer).toBe('done');
    });

    it('should reset state', () => {
      manager.setGeometry({ wallThickness: [], overhangAngles: [], vertexCount: 100, triangleCount: 50 });
      manager.reset();

      const state = manager.getState();
      expect(state.geometry).toBeNull();
      expect(state.status.geometry_analyst).toBe('pending');
    });

    it('should emit events', () => {
      const events: any[] = [];
      manager.on((event) => events.push(event));

      manager.setAgentStatus('geometry_analyst', 'running');

      expect(events.length).toBe(1);
      expect(events[0].type).toBe('state:change');
    });

    it('should check completion', () => {
      expect(manager.isComplete()).toBe(false);

      manager.setGeometry({ wallThickness: [], overhangAngles: [], vertexCount: 0, triangleCount: 0 });
      manager.setFailures({ risks: [] });
      manager.setOptimizations({ suggestions: [], materialRecommendation: 'PLA', orientationRecommendation: 'default' });
      manager.setScore(100);

      expect(manager.isComplete()).toBe(true);
    });
  });

  describe('getAgentStateManager', () => {
    it('should return singleton instance', () => {
      const instance1 = getAgentStateManager();
      const instance2 = getAgentStateManager();

      expect(instance1).toBe(instance2);
    });
  });
});
