import type { AgentId } from '@shared/domain/agent';

export type AgentMessageType = 'score' | 'review' | 'correction' | 'telemetry' | 'debate' | 'recalibration';

export interface AgentMessage {
  id: string;
  from: AgentId | 'orchestrator' | 'jev';
  to: AgentId | 'broadcast';
  type: AgentMessageType;
  payload: unknown;
  timestamp: number;
}

type MessageHandler = (msg: AgentMessage) => void;

const MAX_HISTORY = 200;

let _msgCounter = 0;

export class AgentBus {
  private subscribers: Map<string, Set<MessageHandler>> = new Map();
  private history: AgentMessage[] = [];

  publish(msg: Omit<AgentMessage, 'id' | 'timestamp'>): void {
    const full: AgentMessage = {
      ...msg,
      id: `msg_${++_msgCounter}`,
      timestamp: Date.now(),
    };

    this.history.push(full);
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }

    const handlers = this.subscribers.get(full.to);
    if (handlers) {
      for (const fn of handlers) fn(full);
    }

    if (full.to !== 'broadcast') {
      const broadcastHandlers = this.subscribers.get('broadcast');
      if (broadcastHandlers) {
        for (const fn of broadcastHandlers) fn(full);
      }
    }
  }

  subscribe(agentId: string, handler: MessageHandler): () => void {
    if (!this.subscribers.has(agentId)) {
      this.subscribers.set(agentId, new Set());
    }
    this.subscribers.get(agentId)!.add(handler);
    return () => {
      this.subscribers.get(agentId)?.delete(handler);
    };
  }

  getHistory(limit?: number): AgentMessage[] {
    if (limit) return this.history.slice(-limit);
    return [...this.history];
  }

  getHistoryForAgent(agentId: AgentId, limit?: number): AgentMessage[] {
    const filtered = this.history.filter(
      m => m.from === agentId || m.to === agentId || m.to === 'broadcast',
    );
    if (limit) return filtered.slice(-limit);
    return filtered;
  }

  clear(): void {
    this.history = [];
    this.subscribers.clear();
  }
}

let _instance: AgentBus | null = null;

export function getAgentBus(): AgentBus {
  if (!_instance) _instance = new AgentBus();
  return _instance;
}
