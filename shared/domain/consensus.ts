/**
 * Consensus grading thresholds — the single source both the agent orchestrator
 * and the analysis engine read.
 *
 * These live in their own module so the analysis pipeline can import two
 * integers without pulling shared/domain/agent.ts, which re-exports the zod
 * schemas (~120KB of validator) into the first-paint bundle. Behaviour is
 * unchanged; only the import edge moved.
 */
export const CONSENSUS_PASS_MIN_SCORE = 70;
export const CONSENSUS_WARNING_MIN_SCORE = 40;
