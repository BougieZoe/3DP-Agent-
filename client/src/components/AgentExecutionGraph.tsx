/**
 * Agent Execution Graph Component
 *
 * Visualizes multi-agent execution status:
 * - Real-time agent status
 * - Dependency graph
 * - Timing statistics
 */

import { useEffect, useState } from 'react';
import { getAgentStateManager, type AgentState, type AgentEvent } from '@/agents/agentState';
import type { AgentId } from '@shared/domain/agent';

interface AgentExecutionGraphProps {
  isVisible: boolean;
  onClose: () => void;
}

const AGENT_LABELS: Record<AgentId, string> = {
  geometry_analyst: 'Geometry',
  failure_predictor: 'Failure',
  optimization_advisor: 'Optimize',
  printability_scorer: 'Score',
};

const AGENT_COLORS: Record<AgentId, string> = {
  geometry_analyst: 'cyan',
  failure_predictor: 'amber',
  optimization_advisor: 'green',
  printability_scorer: 'purple',
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-muted/40 text-muted-foreground',
  running: 'bg-cyan-500/20 text-cyan-400 animate-pulse',
  done: 'bg-green-500/20 text-green-400',
  error: 'bg-red-500/20 text-red-400',
};

export function AgentExecutionGraph({ isVisible, onClose }: AgentExecutionGraphProps) {
  const [state, setState] = useState<AgentState | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);

  useEffect(() => {
    if (!isVisible) return;

    const sm = getAgentStateManager();
    setState(sm.getState());

    const unsub = sm.on((event) => {
      setState(sm.getState());
      setEvents(prev => [...prev.slice(-19), event]);
    });

    return unsub;
  }, [isVisible]);

  if (!isVisible || !state) return null;

  const agents: AgentId[] = ['geometry_analyst', 'failure_predictor', 'optimization_advisor', 'printability_scorer'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-background border border-border/40 rounded-lg p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-mono font-semibold">Agent Execution</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Agent Status Cards */}
        <div className="space-y-3 mb-4">
          {agents.map((agentId) => {
            const status = state.status[agentId];
            const color = AGENT_COLORS[agentId];

            return (
              <div
                key={agentId}
                className={`flex items-center justify-between p-3 rounded-lg border border-border/40 ${
                  status === 'done' ? 'bg-green-500/5' :
                  status === 'error' ? 'bg-red-500/5' :
                  status === 'running' ? 'bg-cyan-500/5' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full bg-${color}-400 ${
                    status === 'running' ? 'animate-pulse' : ''
                  }`} />
                  <span className="text-sm font-mono">{AGENT_LABELS[agentId]}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLES[status]}`}>
                  {status}
                </span>
              </div>
            );
          })}
        </div>

        {/* Dependency Arrows */}
        <div className="flex justify-center mb-4">
          <div className="text-xs text-muted-foreground font-mono">
            Geometry → Failure + Optimize → Score
          </div>
        </div>

        {/* Event Log */}
        <div className="border border-border/40 rounded-lg p-3 max-h-40 overflow-y-auto">
          <div className="text-xs text-muted-foreground mb-2">Event Log</div>
          {events.length === 0 ? (
            <div className="text-xs text-muted-foreground/50">No events yet</div>
          ) : (
            <div className="space-y-1">
              {events.map((event, idx) => (
                <div key={idx} className="text-xs font-mono flex items-center gap-2">
                  <span className="text-muted-foreground/50">
                    {new Date().toLocaleTimeString()}
                  </span>
                  <span className={
                    event.type === 'agent:complete' ? 'text-green-400' :
                    event.type === 'agent:error' ? 'text-red-400' :
                    'text-cyan-400'
                  }>
                    {event.type}
                  </span>
                  {event.agentId && (
                    <span className="text-foreground/80">{event.agentId}</span>
                  )}
                  {event.error && (
                    <span className="text-red-400 truncate">{event.error}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Summary */}
        <div className="mt-4 pt-4 border-t border-border/40 flex justify-between text-xs text-muted-foreground">
          <span>
            {Object.values(state.status).filter(s => s === 'done').length}/{agents.length} complete
          </span>
          <span>
            {state.error ? 'Error occurred' : 'All good'}
          </span>
        </div>
      </div>
    </div>
  );
}
