/**
 * Agent Graph Executor
 *
 * DAG-based execution engine for multi-agent orchestration:
 * - Topological sort of agent dependencies
 * - Parallel execution of independent agents
 * - Timeout + graceful degradation
 * - Real-time progress tracking
 */

import type { AgentId } from '@shared/domain/agent';
import type { GeometryModel } from '@/analysis/geometryModel';
import type { UnifiedAnalysis } from '@/analysis/types';
import {
  getAgentStateManager,
  type AgentState,
  type GeometryResult,
  type FailureResult,
  type OptimizationResult,
} from './agentState';

// ── Types ──────────────────────────────────────────────────────────────────

export interface WorkflowStep {
  agentId: AgentId;
  dependsOn: AgentId[];
  execute: (context: AgentContext) => Promise<void>;
  timeoutMs: number;
}

export interface AgentContext {
  model: GeometryModel;
  analysis: UnifiedAnalysis;
  state: AgentState;
  language: string;
}

export interface ExecutionResult {
  success: boolean;
  state: AgentState;
  durationMs: number;
  errors: Array<{ agentId: AgentId; error: string }>;
}

// ── Default Workflow ───────────────────────────────────────────────────────

/**
 * Build the default agent workflow DAG:
 * 
 * geometry_analyst ──┬── failure_predictor ──┬── printability_scorer
 *                    └── optimization_advisor ─┘
 */
export function buildDefaultWorkflow(): WorkflowStep[] {
  return [
    {
      agentId: 'geometry_analyst',
      dependsOn: [],
      timeoutMs: 15000,
      execute: async (ctx) => {
        // Geometry analysis is already in the UnifiedAnalysis
        // Extract and store the results
        const metrics = ctx.analysis.metrics?.result;

        const geometryResult: GeometryResult = {
          wallThickness: metrics?.thinWallRatio ? [metrics.thinWallRatio] : [],
          overhangAngles: [],
          vertexCount: ctx.model.vertexCount,
          triangleCount: ctx.model.triangleCount,
        };

        getAgentStateManager().setGeometry(geometryResult);
      },
    },
    {
      agentId: 'failure_predictor',
      dependsOn: ['geometry_analyst'],
      timeoutMs: 15000,
      execute: async (ctx) => {
        // Use existing validation results
        const validation = ctx.analysis.validation?.result;

        // Create failure results from validation data
        const failureResult: FailureResult = {
          risks: [],
        };

        // Add risks based on validation findings
        if (validation && !validation.isWatertight) {
          failureResult.risks.push({
            type: 'non_watertight',
            position: [0, 0, 0],
            severity: 0.6,
            description: 'Mesh is not watertight',
          });
        }
        if (validation && validation.holeCount > 0) {
          failureResult.risks.push({
            type: 'holes',
            position: [0, 0, 0],
            severity: 0.5,
            description: `${validation.holeCount} hole(s) detected`,
          });
        }

        getAgentStateManager().setFailures(failureResult);
      },
    },
    {
      agentId: 'optimization_advisor',
      dependsOn: ['geometry_analyst'],
      timeoutMs: 20000,
      execute: async (ctx) => {
        // Use existing suggestions
        const aiSuggestions = ctx.analysis.aiSuggestions?.result;
        const suggestions = aiSuggestions?.suggestions || [];

        const optimizationResult: OptimizationResult = {
          suggestions: suggestions.map((s: any) => ({
            type: s.type,
            description: s.description,
            impact: s.impact || 0,
          })),
          materialRecommendation: 'PLA',
          orientationRecommendation: 'default',
        };

        getAgentStateManager().setOptimizations(optimizationResult);
      },
    },
    {
      agentId: 'printability_scorer',
      dependsOn: ['failure_predictor', 'optimization_advisor'],
      timeoutMs: 10000,
      execute: async (ctx) => {
        // Compute score from existing analysis
        const validation = ctx.analysis.validation?.result;
        const metrics = ctx.analysis.metrics?.result;

        let score = 100;
        if (validation && !validation.isWatertight) score -= 20;
        if (metrics && metrics.thinWallRatio > 0.1) score -= 15;
        if (metrics && metrics.overhang?.ratio > 0.15) score -= 10;

        getAgentStateManager().setScore(Math.max(0, score));
      },
    },
  ];
}

// ── Graph Executor ─────────────────────────────────────────────────────────

export class AgentGraphExecutor {
  private workflow: WorkflowStep[];
  private stateManager = getAgentStateManager();

  constructor(workflow?: WorkflowStep[]) {
    this.workflow = workflow || buildDefaultWorkflow();
  }

  /**
   * Execute the full agent workflow
   */
  async execute(
    model: GeometryModel,
    analysis: UnifiedAnalysis,
    language: string = 'en'
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const errors: Array<{ agentId: AgentId; error: string }> = [];

    // Reset state
    this.stateManager.reset();

    const context: AgentContext = {
      model,
      analysis,
      state: this.stateManager.getState(),
      language,
    };

    // Get execution order via topological sort
    const executionOrder = this.topologicalSort();

    // Execute in waves (parallel within each wave)
    let waveIndex = 0;
    while (waveIndex < executionOrder.length) {
      const wave = executionOrder[waveIndex];

      // Mark all agents in wave as running
      for (const agentId of wave) {
        this.stateManager.setAgentStatus(agentId, 'running');
      }

      // Execute all agents in wave in parallel
      const results = await Promise.allSettled(
        wave.map(async (agentId) => {
          const step = this.workflow.find(s => s.agentId === agentId);
          if (!step) throw new Error(`No step found for ${agentId}`);

          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), step.timeoutMs)
          );

          await Promise.race([step.execute(context), timeoutPromise]);
        })
      );

      // Check results
      results.forEach((result, idx) => {
        const agentId = wave[idx];
        if (result.status === 'rejected') {
          const error = result.reason instanceof Error ? result.reason.message : 'Unknown error';
          this.stateManager.setAgentStatus(agentId, 'error');
          errors.push({ agentId, error });
        }
      });

      waveIndex++;
    }

    return {
      success: errors.length === 0,
      state: this.stateManager.getState(),
      durationMs: Date.now() - startTime,
      errors,
    };
  }

  /**
   * Topological sort of workflow steps
   * Returns waves of agents that can execute in parallel
   */
  private topologicalSort(): AgentId[][] {
    const agentMap = new Map<AgentId, WorkflowStep>();
    for (const step of this.workflow) {
      agentMap.set(step.agentId, step);
    }

    const visited = new Set<AgentId>();
    const waves: AgentId[][] = [];

    while (visited.size < this.workflow.length) {
      const wave: AgentId[] = [];

      for (const step of this.workflow) {
        if (visited.has(step.agentId)) continue;

        // Check if all dependencies are satisfied
        const depsSatisfied = step.dependsOn.every(dep => visited.has(dep));
        if (depsSatisfied) {
          wave.push(step.agentId);
        }
      }

      if (wave.length === 0) {
        // Circular dependency or missing step — break
        console.error('[AgentGraph] Circular dependency detected');
        break;
      }

      waves.push(wave);
      for (const agentId of wave) {
        visited.add(agentId);
      }
    }

    return waves;
  }

  /**
   * Get the current execution state
   */
  getState(): AgentState {
    return this.stateManager.getState();
  }
}

/**
 * Run the default agent workflow
 */
export async function runAgentWorkflow(
  model: GeometryModel,
  analysis: UnifiedAnalysis,
  language: string = 'en'
): Promise<ExecutionResult> {
  const executor = new AgentGraphExecutor();
  return executor.execute(model, analysis, language);
}
