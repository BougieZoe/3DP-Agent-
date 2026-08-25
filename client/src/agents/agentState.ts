/**
 * Agent State Management
 *
 * Shared state + event bus for multi-agent orchestration:
 * - Centralized state for all agent outputs
 * - Event emitter for progress/completion/error
 * - Dependency tracking between agents
 */

import type { AgentId, AgentOutput } from '@shared/domain/agent';
import type { GeometryModel } from '@/analysis/geometryModel';

// ── Types ──────────────────────────────────────────────────────────────────

export interface GeometryResult {
  wallThickness: number[];
  overhangAngles: number[];
  vertexCount: number;
  triangleCount: number;
}

export interface FailureResult {
  risks: Array<{
    type: string;
    position: [number, number, number];
    severity: number;
    description: string;
  }>;
}

export interface OptimizationResult {
  suggestions: Array<{
    type: string;
    description: string;
    impact: number;
  }>;
  materialRecommendation: string;
  orientationRecommendation: string;
}

export interface AgentState {
  geometry: GeometryResult | null;
  failures: FailureResult | null;
  optimizations: OptimizationResult | null;
  score: number | null;
  status: Record<AgentId, 'pending' | 'running' | 'done' | 'error'>;
  error: string | null;
}

export type AgentEventType =
  | 'agent:start'
  | 'agent:complete'
  | 'agent:error'
  | 'state:change';

export interface AgentEvent {
  type: AgentEventType;
  agentId?: AgentId;
  result?: unknown;
  error?: string;
  state?: Partial<AgentState>;
}

export type AgentEventListener = (event: AgentEvent) => void;

// ── State Manager ──────────────────────────────────────────────────────────

const INITIAL_STATE: AgentState = {
  geometry: null,
  failures: null,
  optimizations: null,
  score: null,
  status: {
    geometry_analyst: 'pending',
    failure_predictor: 'pending',
    optimization_advisor: 'pending',
    printability_scorer: 'pending',
  },
  error: null,
};

export class AgentStateManager {
  private state: AgentState = { ...INITIAL_STATE };
  private listeners: AgentEventListener[] = [];

  /**
   * Get current state (read-only snapshot)
   */
  getState(): Readonly<AgentState> {
    return { ...this.state };
  }

  /**
   * Reset state to initial values
   */
  reset(): void {
    this.state = {
      geometry: null,
      failures: null,
      optimizations: null,
      score: null,
      status: {
        geometry_analyst: 'pending',
        failure_predictor: 'pending',
        optimization_advisor: 'pending',
        printability_scorer: 'pending',
      },
      error: null,
    };
    this.emit({ type: 'state:change', state: this.state });
  }

  /**
   * Set agent status
   */
  setAgentStatus(agentId: AgentId, status: 'pending' | 'running' | 'done' | 'error'): void {
    this.state.status[agentId] = status;
    this.emit({ type: 'state:change', state: { status: { ...this.state.status } } });
  }

  /**
   * Set geometry result
   */
  setGeometry(result: GeometryResult): void {
    this.state.geometry = result;
    this.state.status.geometry_analyst = 'done';
    this.emit({ type: 'agent:complete', agentId: 'geometry_analyst', result });
  }

  /**
   * Set failure result
   */
  setFailures(result: FailureResult): void {
    this.state.failures = result;
    this.state.status.failure_predictor = 'done';
    this.emit({ type: 'agent:complete', agentId: 'failure_predictor', result });
  }

  /**
   * Set optimization result
   */
  setOptimizations(result: OptimizationResult): void {
    this.state.optimizations = result;
    this.state.status.optimization_advisor = 'done';
    this.emit({ type: 'agent:complete', agentId: 'optimization_advisor', result });
  }

  /**
   * Set printability score
   */
  setScore(score: number): void {
    this.state.score = score;
    this.state.status.printability_scorer = 'done';
    this.emit({ type: 'agent:complete', agentId: 'printability_scorer', result: score });
  }

  /**
   * Set error state
   */
  setError(error: string): void {
    this.state.error = error;
    this.emit({ type: 'agent:error', error });
  }

  /**
   * Subscribe to events
   */
  on(listener: AgentEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Emit event to all listeners
   */
  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[AgentState] Listener error:', err);
      }
    }
  }

  /**
   * Check if all agents are done
   */
  isComplete(): boolean {
    return Object.values(this.state.status).every(s => s === 'done');
  }

  /**
   * Check if any agent errored
   */
  hasError(): boolean {
    return Object.values(this.state.status).some(s => s === 'error') || this.state.error !== null;
  }
}

// Singleton
let _instance: AgentStateManager | null = null;

export function getAgentStateManager(): AgentStateManager {
  if (!_instance) {
    _instance = new AgentStateManager();
  }
  return _instance;
}
