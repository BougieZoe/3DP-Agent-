import type { AgentId } from '@shared/domain/agent';
import type { RiskMarker } from '@shared/domain/agent';

export type AgentStatus = 'idle' | 'running' | 'done' | 'error' | 'recalibrating' | 'debating';

export interface AgentTelemetry {
  agentId: AgentId;
  status: AgentStatus;
  currentPhase: string;
  progress: number;
  score?: number;
  confidence?: number;
  markers?: RiskMarker[];
  durationMs?: number;
  lastHeartbeat: number;
  workbenchState?: {
    model?: string;
    tool?: string;
    output?: string;
  };
}

type TelemetryListener = (all: AgentTelemetry[]) => void;

export class TelemetryHub {
  private agents: Map<AgentId, AgentTelemetry> = new Map();
  private listeners: Set<TelemetryListener> = new Set();

  update(agentId: AgentId, partial: Partial<AgentTelemetry>): void {
    const existing = this.agents.get(agentId) ?? {
      agentId,
      status: 'idle' as AgentStatus,
      currentPhase: '',
      progress: 0,
      lastHeartbeat: Date.now(),
    };

    this.agents.set(agentId, {
      ...existing,
      ...partial,
      agentId,
      lastHeartbeat: Date.now(),
    });

    this.notify();
  }

  get(agentId: AgentId): AgentTelemetry | undefined {
    return this.agents.get(agentId);
  }

  getAll(): AgentTelemetry[] {
    return Array.from(this.agents.values());
  }

  reset(): void {
    this.agents.clear();
    this.notify();
  }

  subscribe(callback: TelemetryListener): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notify(): void {
    const snapshot = this.getAll();
    for (const fn of this.listeners) fn(snapshot);
  }
}

let _instance: TelemetryHub | null = null;

export function getTelemetryHub(): TelemetryHub {
  if (!_instance) _instance = new TelemetryHub();
  return _instance;
}
