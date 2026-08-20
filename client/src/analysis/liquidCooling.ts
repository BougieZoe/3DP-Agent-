// client/src/analysis/liquidCooling.ts
//
// Liquid-cooling application module — the application-layer check for parts
// designed to carry coolant (cold plates, water blocks, heat sinks). This is
// where SLM metal printing shines: complex internal channels impossible to
// machine. The module flags the three things that kill a 3D-printed cooling
// part:
//
//   1. Leak risk   — coolant pressure walls thinner than the seal threshold
//                    leak. Thin walls are the top failure for pressure parts.
//   2. Channel risk— an enclosed cavity with no inlet/outlet is a dead end
//                    (coolant can't flow), and in metal PBF it traps unsintered
//                    powder that clogs the channel.
//   3. Heat exchange — surface-area-per-volume is the honest geometric proxy
//                    for how much coolant the geometry can cool.
//
// Deterministic, honest — no CFD simulation. These are geometric proxies that
// flag the conditions a real leak/channel failure needs.

import type { UnifiedAnalysis } from './types';

/** Coolant-pressure wall threshold (mm). Conservative for any metal. */
export const PRESSURE_WALL_MM = 0.8;

export interface LiquidCoolingResult {
  /** 0..1 — thin pressure walls → coolant leak risk. */
  leakRisk: number;
  /** 0..1 — enclosed/dead-end channel or trapped powder → blockage risk. */
  channelRisk: number;
  /** 0..1 — heat-exchange efficiency proxy (higher = better cooling surface). */
  heatExchangeProxy: number;
  /** 0..1 — combined risk for liquid-cooling use (higher = worse). */
  overallRisk: number;
  /** Pressure-wall thickness facts, for the report. */
  pressureWall: {
    minThicknessMm: number | null;
    p5ThicknessMm: number | null;
    thresholdMm: number;
  };
  /** Human-readable top concerns. */
  concerns: string[];
}

export interface LiquidCoolingInput {
  minWallThicknessMm: number | null;
  p5WallThicknessMm: number | null;
  thinWallRatio: number;
  surfaceAreaMm2: number;
  volumeMm3: number;
  shellCount: number;
  enclosedCavity: boolean;
  /** From the PBF module — SLM metal channels trap unsintered powder. */
  powderTrap?: boolean;
}

export function computeLiquidCoolingMetrics(input: LiquidCoolingInput): LiquidCoolingResult {
  const { minWallThicknessMm, p5WallThicknessMm, thinWallRatio, surfaceAreaMm2, volumeMm3, shellCount, enclosedCavity, powderTrap } = input;

  // ── Leak risk: pressure walls below threshold + thin-wall extent ──────────
  let leakRisk: number;
  if (minWallThicknessMm != null) {
    // A wall at half the pressure threshold is already a serious leak risk —
    // the deficit contributes at full weight, with the thin-wall extent on top.
    const deficit = Math.min(1, Math.max(0, PRESSURE_WALL_MM - minWallThicknessMm) / PRESSURE_WALL_MM);
    leakRisk = Math.min(1, deficit + thinWallRatio * 0.5);
  } else {
    leakRisk = Math.min(1, thinWallRatio * 0.5);
  }

  // ── Channel risk: dead-end cavity + powder trap (metal clogs hard) ─────────
  let channelRisk = 0;
  if (enclosedCavity) channelRisk = 0.6;
  if (powderTrap) channelRisk = Math.max(channelRisk, 0.8);
  if (shellCount > 2) channelRisk = Math.min(1, channelRisk + 0.2);

  // ── Heat exchange: surface area per unit volume ───────────────────────────
  // ~0.5 mm²/mm³ is a decent cold-plate value; higher is better cooling.
  const saVol = volumeMm3 > 0 ? surfaceAreaMm2 / volumeMm3 : 0;
  const heatExchangeProxy = Math.min(1, saVol / 1.0);

  const overallRisk = Math.min(1, 0.45 * leakRisk + 0.4 * channelRisk + 0.15 * (1 - heatExchangeProxy));

  const concerns: string[] = [];
  if (leakRisk >= 0.5) concerns.push('⚠ coolant leak risk — pressure walls below ~0.8mm');
  if (channelRisk >= 0.5) {
    concerns.push(
      powderTrap
        ? '⚠ internal channel traps metal powder — needs escape holes or it clogs'
        : '⚠ enclosed cavity with no exit — coolant cannot flow through',
    );
  }
  if (heatExchangeProxy < 0.25) concerns.push('⚠ low surface-area-to-volume — poor heat exchange for a cooling part');
  if (concerns.length === 0) concerns.push('Channel geometry looks reasonable for liquid cooling.');

  return {
    leakRisk,
    channelRisk,
    heatExchangeProxy,
    overallRisk,
    pressureWall: { minThicknessMm: minWallThicknessMm, p5ThicknessMm: p5WallThicknessMm, thresholdMm: PRESSURE_WALL_MM },
    concerns,
  };
}

/** Build the liquid-cooling input straight from a UnifiedAnalysis. */
export function liquidCoolingFromUnified(unified: UnifiedAnalysis): LiquidCoolingResult | null {
  const metrics = unified.metrics?.result;
  if (!metrics || metrics.meshVolumeMm3 <= 0) return null;
  const topology = unified.topology?.result;
  const pbf = unified.pbf?.result;
  return computeLiquidCoolingMetrics({
    minWallThicknessMm: metrics.minWallThicknessMm,
    p5WallThicknessMm: metrics.p5WallThicknessMm,
    thinWallRatio: metrics.thinWallRatio,
    surfaceAreaMm2: metrics.surfaceAreaMm2,
    volumeMm3: metrics.meshVolumeMm3,
    shellCount: topology?.shellCount ?? 1,
    enclosedCavity: (topology?.shellCount ?? 1) > 1,
    powderTrap: pbf?.powderTrap,
  });
}
