/**
 * Re-export from analysis/verdict.ts for backward compatibility.
 *
 * The canonical location is now analysis/verdict.ts — this barrel exists
 * only so existing lib/ consumers (tests, ruleEngine) don't break.
 * New code should import from '@/analysis/verdict' directly.
 */
export { isWallConfidenceTrusted, MIN_TRUSTED_WALL_CONFIDENCE } from '@/analysis/verdict';
