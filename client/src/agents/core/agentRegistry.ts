import type { AgentId } from '@shared/domain/agent';
import type { MaterialTechnology } from '@shared/domain/material';
import type { BaseAgent } from '../baseAgent';
import { GeometryAnalyst } from '../geometryAnalyst';
import { PrintabilityScorer } from '../printabilityScorer';
import { FailurePredictor } from '../failurePredictor';
import { OptimizationAdvisor } from '../optimizationAdvisor';

export interface AgentSlot {
  id: AgentId;
  agentClass: new () => BaseAgent;
  enabled: boolean;
  weight: number;
  materialFilter?: MaterialTechnology[];
  timeoutMs: number;
  priority: number;
}

const STORAGE_KEY = '3dp_agent_registry';

const BUILTIN_SLOTS: AgentSlot[] = [
  { id: 'geometry_analyst', agentClass: GeometryAnalyst, enabled: true, weight: 0.30, timeoutMs: 15000, priority: 1 },
  { id: 'printability_scorer', agentClass: PrintabilityScorer, enabled: true, weight: 0.30, timeoutMs: 10000, priority: 2 },
  { id: 'failure_predictor', agentClass: FailurePredictor, enabled: true, weight: 0.25, timeoutMs: 15000, priority: 3 },
  { id: 'optimization_advisor', agentClass: OptimizationAdvisor, enabled: true, weight: 0.15, timeoutMs: 20000, priority: 4 },
];

export class AgentRegistry {
  private slots: Map<AgentId, AgentSlot> = new Map();
  private listeners: Set<() => void> = new Set();

  constructor() {
    for (const slot of BUILTIN_SLOTS) {
      this.slots.set(slot.id, { ...slot });
    }
    this.load();
  }

  register(slot: AgentSlot): void {
    this.slots.set(slot.id, slot);
    this.persist();
    this.notify();
  }

  unregister(id: AgentId): void {
    this.slots.delete(id);
    this.persist();
    this.notify();
  }

  enable(id: AgentId): void {
    const slot = this.slots.get(id);
    if (slot) {
      slot.enabled = true;
      this.persist();
      this.notify();
    }
  }

  disable(id: AgentId): void {
    const slot = this.slots.get(id);
    if (slot) {
      slot.enabled = false;
      this.persist();
      this.notify();
    }
  }

  updateWeight(id: AgentId, weight: number): void {
    const slot = this.slots.get(id);
    if (slot) {
      slot.weight = Math.max(0, Math.min(1, weight));
      this.persist();
      this.notify();
    }
  }

  get(id: AgentId): AgentSlot | undefined {
    return this.slots.get(id);
  }

  getAll(): AgentSlot[] {
    return Array.from(this.slots.values()).sort((a, b) => a.priority - b.priority);
  }

  getEnabled(material?: MaterialTechnology): AgentSlot[] {
    return this.getAll().filter(slot => {
      if (!slot.enabled) return false;
      if (material && slot.materialFilter && !slot.materialFilter.includes(material)) return false;
      return true;
    });
  }

  instantiate(material?: MaterialTechnology): BaseAgent[] {
    return this.getEnabled(material).map(slot => new slot.agentClass());
  }

  reconfigure(config: AgentSlot[]): void {
    this.slots.clear();
    for (const slot of config) {
      this.slots.set(slot.id, slot);
    }
    this.persist();
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private persist(): void {
    try {
      const data = this.getAll().map(s => ({
        id: s.id,
        enabled: s.enabled,
        weight: s.weight,
        priority: s.priority,
        timeoutMs: s.timeoutMs,
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch { /* ignore */ }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Array<{ id: AgentId; enabled?: boolean; weight?: number; priority?: number; timeoutMs?: number }>;
      for (const entry of data) {
        const slot = this.slots.get(entry.id);
        if (slot) {
          if (entry.enabled !== undefined) slot.enabled = entry.enabled;
          if (entry.weight !== undefined) slot.weight = entry.weight;
          if (entry.priority !== undefined) slot.priority = entry.priority;
          if (entry.timeoutMs !== undefined) slot.timeoutMs = entry.timeoutMs;
        }
      }
    } catch { /* ignore */ }
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

let _instance: AgentRegistry | null = null;

export function getAgentRegistry(): AgentRegistry {
  if (!_instance) _instance = new AgentRegistry();
  return _instance;
}
