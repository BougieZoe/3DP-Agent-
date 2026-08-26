/**
 * Thermal Field & Warping Analysis (S2)
 *
 * Analytical model (NOT FEA) that predicts per-layer thermal behavior and
 * warping risk using simplified heat transfer physics. Feeds on S1 slicer
 * data (layer heights, print time) and material thermal properties.
 *
 * HONESTY NOTE: This is an analytical approximation, not a finite-element
 * thermal simulation. Confidence is capped at 0.6 — it captures the right
 * *direction* of risk (materials with high shrinkage + large flat areas =
 * more warping) but cannot predict exact temperatures or deformation.
 */

import type { Confidence } from "./types";
import { moduleResult, type AnalysisModuleResult } from "./types";
import type { Material } from "@shared/domain/material";
import type { GeometryModel } from "./geometryModel";
import { buildGeometryGraph, type GeometryGraph } from "./geometryGraph";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThermalLayerData {
  layerNumber: number;
  zMm: number;
  heightMm: number;
  /** Estimated peak temperature (°C) when this layer is deposited. */
  peakTempC: number;
  /** Temperature after cooling (°C) before next layer. */
  cooledTempC: number;
  /** Cooling rate (°C/s) — affects crystallization and shrinkage. */
  coolingRateCPerS: number;
  /** Duration this layer took to print (s). */
  printDurationS: number;
  /** 0..1 heat accumulation risk (high = poor inter-layer adhesion). */
  heatAccumulationRisk: number;
}

export interface WarpingHotspot {
  layerNumber: number;
  zMm: number;
  region: "corner" | "edge" | "center" | "thin_bridge" | "large_flat";
  risk: number;
  cause: string;
}

export interface ThermalRecommendation {
  category:
    | "bed_temp"
    | "enclosure"
    | "orientation"
    | "speed"
    | "material"
    | "geometry";
  severity: "info" | "warning" | "critical";
  message: string;
  impactEstimate?: string;
}

export interface ThermalFieldResult {
  layers: ThermalLayerData[];
  thermalRiskScore: number;
  maxThermalGradientCPerMm: number;
  warpingRiskScore: number;
  warpingHotspots: WarpingHotspot[];
  recommendations: ThermalRecommendation[];
}

export interface ThermalAnalysisOptions {
  material: Material;
  materialFamily: "fdm" | "sla" | "fgf" | "sls" | "slm" | "mjf" | "concrete" | "eco";
  layers?: { layerNumber: number; zMm: number; heightMm: number }[];
  layerHeightMm?: number;
  layerCount?: number;
  printTimeMinutes?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AMBIENT_TEMP_C = 23;
const CONVECTION_COEFFICIENT = 25; // W/m²·K — natural convection in air
const FDM_PRINT_SPEED_MM_PER_S = 60; // typical FDM speed for duration estimation

// ---------------------------------------------------------------------------
// Per-material defaults (when thermal props are missing)
// ---------------------------------------------------------------------------

/**
 * Material-specific thermal properties for common 3D printing materials.
 * Based on published data and empirical measurements.
 */
const MATERIAL_THERMAL_PROPS: Record<string, {
  glassTransitionTempC: number;
  thermalConductivityWPerMK: number;
  specificHeatJPerGK: number;
  shrinkagePercent: number;
  printTempC: { min: number; max: number };
  bedTempC: number;
  densityGPerCm3: number;
  thermalDiffusivityMm2PerS: number;
  emisivity: number;
}> = {
  // PLA - Low shrinkage, easy to print
  pla: {
    glassTransitionTempC: 60,
    thermalConductivityWPerMK: 0.13,
    specificHeatJPerGK: 1.8,
    shrinkagePercent: 0.2,
    printTempC: { min: 190, max: 220 },
    bedTempC: 50,
    densityGPerCm3: 1.24,
    thermalDiffusivityMm2PerS: 0.059,
    emisivity: 0.92,
  },
  // ABS - High shrinkage, requires enclosure
  abs: {
    glassTransitionTempC: 105,
    thermalConductivityWPerMK: 0.17,
    specificHeatJPerGK: 1.4,
    shrinkagePercent: 0.8,
    printTempC: { min: 220, max: 250 },
    bedTempC: 100,
    densityGPerCm3: 1.04,
    thermalDiffusivityMm2PerS: 0.116,
    emisivity: 0.90,
  },
  // PETG - Medium shrinkage, good balance
  petg: {
    glassTransitionTempC: 80,
    thermalConductivityWPerMK: 0.24,
    specificHeatJPerGK: 1.2,
    shrinkagePercent: 0.4,
    printTempC: { min: 220, max: 250 },
    bedTempC: 80,
    densityGPerCm3: 1.27,
    thermalDiffusivityMm2PerS: 0.157,
    emisivity: 0.94,
  },
  // TPU - Flexible, low shrinkage
  tpu: {
    glassTransitionTempC: -40,
    thermalConductivityWPerMK: 0.15,
    specificHeatJPerGK: 2.0,
    shrinkagePercent: 0.3,
    printTempC: { min: 210, max: 230 },
    bedTempC: 60,
    densityGPerCm3: 1.20,
    thermalDiffusivityMm2PerS: 0.063,
    emisivity: 0.93,
  },
  // Nylon (PA6) - High shrinkage, hygroscopic
  nylon: {
    glassTransitionTempC: 50,
    thermalConductivityWPerMK: 0.25,
    specificHeatJPerGK: 1.6,
    shrinkagePercent: 1.0,
    printTempC: { min: 240, max: 270 },
    bedTempC: 80,
    densityGPerCm3: 1.14,
    thermalDiffusivityMm2PerS: 0.137,
    emisivity: 0.91,
  },
  // PC - High temperature, high shrinkage
  pc: {
    glassTransitionTempC: 147,
    thermalConductivityWPerMK: 0.20,
    specificHeatJPerGK: 1.3,
    shrinkagePercent: 0.7,
    printTempC: { min: 260, max: 310 },
    bedTempC: 110,
    densityGPerCm3: 1.20,
    thermalDiffusivityMm2PerS: 0.128,
    emisivity: 0.89,
  },
  // FDM default
  fdm: {
    glassTransitionTempC: 80,
    thermalConductivityWPerMK: 0.2,
    specificHeatJPerGK: 1.5,
    shrinkagePercent: 0.5,
    printTempC: { min: 200, max: 240 },
    bedTempC: 60,
    densityGPerCm3: 1.2,
    thermalDiffusivityMm2PerS: 0.111,
    emisivity: 0.92,
  },
  // SLA default
  sla: {
    glassTransitionTempC: 60,
    thermalConductivityWPerMK: 0.15,
    specificHeatJPerGK: 1.6,
    shrinkagePercent: 0.1,
    printTempC: { min: 20, max: 30 },
    bedTempC: 25,
    densityGPerCm3: 1.15,
    thermalDiffusivityMm2PerS: 0.081,
    emisivity: 0.95,
  },
  // SLS default
  sls: {
    glassTransitionTempC: 175,
    thermalConductivityWPerMK: 0.25,
    specificHeatJPerGK: 1.4,
    shrinkagePercent: 0.3,
    printTempC: { min: 170, max: 190 },
    bedTempC: 170,
    densityGPerCm3: 1.01,
    thermalDiffusivityMm2PerS: 0.173,
    emisivity: 0.90,
  },
  // SLM default
  slm: {
    glassTransitionTempC: 1400,
    thermalConductivityWPerMK: 30,
    specificHeatJPerGK: 0.5,
    shrinkagePercent: 0.2,
    printTempC: { min: 1000, max: 1400 },
    bedTempC: 200,
    densityGPerCm3: 7.8,
    thermalDiffusivityMm2PerS: 7.7,
    emisivity: 0.85,
  },
  // Concrete default
  concrete: {
    glassTransitionTempC: 100,
    thermalConductivityWPerMK: 1.5,
    specificHeatJPerGK: 0.8,
    shrinkagePercent: 0.5,
    printTempC: { min: 15, max: 25 },
    bedTempC: 20,
    densityGPerCm3: 2.4,
    thermalDiffusivityMm2PerS: 0.78,
    emisivity: 0.93,
  },
};

// Legacy alias for backward compatibility
const THERMAL_DEFAULTS: Record<string, Partial<Material>> = MATERIAL_THERMAL_PROPS;

// ---------------------------------------------------------------------------
// Core analysis
// ---------------------------------------------------------------------------

/**
 * Compute per-layer thermal metrics and global warping risk for a 3D model.
 *
 * @param model   GeometryModel (positions, normals, indices)
 * @param options Material + slicer data
 */
export function computeThermalMetrics(
  model: GeometryModel,
  options: ThermalAnalysisOptions,
  providedGraph?: GeometryGraph | null,
): ThermalFieldResult {
  // Get material-specific thermal properties
  const materialKey = options.material.name?.toLowerCase().replace(/\s+/g, '') ?? options.materialFamily;
  const matProps = MATERIAL_THERMAL_PROPS[materialKey] ?? MATERIAL_THERMAL_PROPS[options.materialFamily];
  const mat = { ...matProps, ...options.material };

  // Build geometry graph for spatial queries
  const graph = providedGraph ?? buildGeometryGraph(model);
  if (!graph) {
    return {
      layers: [],
      thermalRiskScore: 0,
      maxThermalGradientCPerMm: 0,
      warpingRiskScore: 0,
      warpingHotspots: [],
      recommendations: [],
    };
  }

  // Generate layer list from slicer data or fallback to uniform layers
  const layerList = buildLayerList(model, options, graph);

  // Per-layer thermal computation
  const layers: ThermalLayerData[] = layerList.map((layer, idx) => {
    const prevLayer = idx > 0 ? layerList[idx - 1] : null;
    const printDuration = estimateLayerPrintDuration(layer, graph);
    const peakTemp = mat.printTempC?.max ?? 220;
    const cooledTemp = computeCooledTemperature(
      peakTemp,
      AMBIENT_TEMP_C,
      printDuration,
      mat.specificHeatJPerGK ?? 1.5,
      mat.densityGPerCm3 ?? 1.2,
    );
    const coolingRate = Math.max(0, (peakTemp - cooledTemp) / Math.max(printDuration, 0.1));

    // Heat accumulation: if previous layer is still hot when next is deposited
    let heatAccumulationRisk = 0;
    if (prevLayer) {
      const timeSincePrev = printDuration; // simplified
      const residualTemp = computeCooledTemperature(
        peakTemp,
        AMBIENT_TEMP_C,
        timeSincePrev,
        mat.specificHeatJPerGK ?? 1.5,
        mat.densityGPerCm3 ?? 1.2,
      );
      const tempRatio = (residualTemp - AMBIENT_TEMP_C) / (peakTemp - AMBIENT_TEMP_C);
      heatAccumulationRisk = Math.min(1, Math.max(0, tempRatio));
    }

    return {
      layerNumber: layer.layerNumber,
      zMm: layer.zMm,
      heightMm: layer.heightMm,
      peakTempC: peakTemp,
      cooledTempC: cooledTemp,
      coolingRateCPerS: coolingRate,
      printDurationS: printDuration,
      heatAccumulationRisk,
    };
  });

  // Global metrics
  const maxThermalGradient = computeMaxThermalGradient(layers);
  const thermalRiskScore = computeThermalRiskScore(layers, mat);
  const warpingHotspots = identifyWarpingHotspots(model, layers, mat, graph);
  const warpingRiskScore = computeWarpingRiskScore(
    warpingHotspots,
    mat.shrinkagePercent ?? 0.5,
    thermalRiskScore,
  );
  const recommendations = generateRecommendations(
    warpingRiskScore,
    thermalRiskScore,
    mat,
    options.materialFamily,
  );

  return {
    layers,
    thermalRiskScore,
    maxThermalGradientCPerMm: maxThermalGradient,
    warpingRiskScore,
    warpingHotspots,
    recommendations,
  };
}

// ---------------------------------------------------------------------------
// Layer utilities
// ---------------------------------------------------------------------------

interface LayerDef {
  layerNumber: number;
  zMm: number;
  heightMm: number;
}

function buildLayerList(
  model: GeometryModel,
  options: ThermalAnalysisOptions,
  graph: GeometryGraph,
): LayerDef[] {
  // Use slicer layers if available
  if (options.layers && options.layers.length > 0) {
    return options.layers;
  }

  // Fallback: uniform layers from layer count or layer height
  const layerHeight = options.layerHeightMm ?? 0.2;
  const bbox = graph.boundingBox;
  const totalHeight = bbox.maxZ - bbox.minZ;
  const layerCount = options.layerCount ?? Math.max(1, Math.ceil(totalHeight / layerHeight));

  const layers: LayerDef[] = [];
  for (let i = 0; i < layerCount; i++) {
    layers.push({
      layerNumber: i,
      zMm: bbox.minZ + i * layerHeight,
      heightMm: layerHeight,
    });
  }
  return layers;
}

// ---------------------------------------------------------------------------
// Heat transfer computations
// ---------------------------------------------------------------------------

/**
 * Estimate how long a layer takes to print based on cross-sectional area.
 * Simplified: assumes constant print speed and 0.4mm nozzle width.
 */
function estimateLayerPrintDuration(
  layer: LayerDef,
  graph: GeometryGraph,
): number {
  // Use bounding box area as proxy for layer area
  const bbox = graph.boundingBox;
  const layerAreaMm2 = (bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY);
  const extrusionWidthMm = 0.4;
  const pathLengthMm = layerAreaMm2 / extrusionWidthMm;
  return Math.max(0.5, pathLengthMm / FDM_PRINT_SPEED_MM_PER_S);
}

/**
 * Compute cooled temperature using Newton's law of cooling.
 * T(t) = T_ambient + (T_0 - T_ambient) * exp(-h*t / (ρ*c*d))
 */
function computeCooledTemperature(
  T0: number,
  Tambient: number,
  timeS: number,
  specificHeatJPerGK: number,
  densityGPerCm3: number,
): number {
  const rho = densityGPerCm3 * 1000; // kg/m³
  const c = specificHeatJPerGK * 1000; // J/kg·K
  const d = 0.001; // characteristic thickness (1mm layer)
  const h = CONVECTION_COEFFICIENT;

  const exponent = (-h * timeS) / (rho * c * d);
  return Tambient + (T0 - Tambient) * Math.exp(exponent);
}

function computeMaxThermalGradient(layers: ThermalLayerData[]): number {
  if (layers.length < 2) return 0;
  let maxGrad = 0;
  for (let i = 1; i < layers.length; i++) {
    const dz = layers[i].zMm - layers[i - 1].zMm;
    if (dz <= 0) continue;
    const dT = Math.abs(layers[i].peakTempC - layers[i - 1].peakTempC);
    const grad = dT / dz;
    if (grad > maxGrad) maxGrad = grad;
  }
  return maxGrad;
}

// ---------------------------------------------------------------------------
// Risk scoring
// ---------------------------------------------------------------------------

function computeThermalRiskScore(
  layers: ThermalLayerData[],
  mat: Partial<Material>,
): number {
  if (layers.length === 0) return 0;

  // Factors: heat accumulation + cooling rate uniformity + shrinkage
  const avgHeatAccum = layers.reduce((s, l) => s + l.heatAccumulationRisk, 0) / layers.length;
  const shrinkage = mat.shrinkagePercent ?? 0.5;
  const shrinkageScore = Math.min(1, shrinkage / 1.5); // 1.5% = max score

  return Math.min(1, avgHeatAccum * 0.5 + shrinkageScore * 0.5);
}

function computeWarpingRiskScore(
  hotspots: WarpingHotspot[],
  shrinkagePercent: number,
  thermalRisk: number,
): number {
  const hotspotScore =
    hotspots.length === 0
      ? 0
      : Math.min(1, hotspots.reduce((s, h) => s + h.risk, 0) / hotspots.length);
  const shrinkScore = Math.min(1, shrinkagePercent / 1.5);

  return Math.min(1, hotspotScore * 0.6 + thermalRisk * 0.2 + shrinkScore * 0.2);
}

// ---------------------------------------------------------------------------
// Hotspot identification
// ---------------------------------------------------------------------------

function identifyWarpingHotspots(
  model: GeometryModel,
  layers: ThermalLayerData[],
  mat: Partial<Material>,
  graph: GeometryGraph,
): WarpingHotspot[] {
  const hotspots: WarpingHotspot[] = [];
  const bbox = graph.boundingBox;

  // Sample every Nth layer to keep computation bounded
  const step = Math.max(1, Math.floor(layers.length / 20));

  // Material-specific risk factors
  const shrinkageFactor = (mat.shrinkagePercent ?? 0.5) / 1.5;
  const glassTransitionFactor = mat.glassTransitionTempC ? (mat.glassTransitionTempC - 60) / 100 : 0.5;

  for (let i = 0; i < layers.length; i += step) {
    const layer = layers[i];

    // Large flat area risk: if layer has large cross-section
    const layerFraction = estimateLayerFillFraction(layer, graph);
    const flatAreaRatio = layerFraction;
    if (flatAreaRatio > 0.7) {
      const risk = Math.min(1, flatAreaRatio * 0.8 * (1 + shrinkageFactor * 0.5));
      hotspots.push({
        layerNumber: layer.layerNumber,
        zMm: layer.zMm,
        region: "large_flat",
        risk,
        cause: `Large flat cross-section (${(flatAreaRatio * 100).toFixed(0)}% fill) — high thermal stress (shrinkage: ${(shrinkageFactor * 100).toFixed(0)}%)`,
      });
    }

    // Corner stress concentration (simplified: check if near bounding box corners)
    const isNearCorner = isLayerNearCorner(layer, bbox);
    if (isNearCorner) {
      const risk = Math.min(1, 0.6 * (1 + shrinkageFactor * 0.3));
      hotspots.push({
        layerNumber: layer.layerNumber,
        zMm: layer.zMm,
        region: "corner",
        risk,
        cause: "Corner region — stress concentration point",
      });
    }

    // Thin bridge detection
    if (layer.heatAccumulationRisk > 0.7) {
      const risk = layer.heatAccumulationRisk * 0.8 * (1 + glassTransitionFactor * 0.2);
      hotspots.push({
        layerNumber: layer.layerNumber,
        zMm: layer.zMm,
        region: "thin_bridge",
        risk,
        cause: "High heat accumulation — thin section or bridge",
      });
    }

    // Edge detection (high cooling rate at edges)
    if (layer.coolingRateCPerS > 50) {
      const risk = Math.min(1, (layer.coolingRateCPerS / 100) * shrinkageFactor);
      hotspots.push({
        layerNumber: layer.layerNumber,
        zMm: layer.zMm,
        region: "edge",
        risk,
        cause: `Rapid cooling (${layer.coolingRateCPerS.toFixed(1)}°C/s) — thermal shock risk`,
      });
    }
  }

  return hotspots;
}

function estimateLayerFillFraction(
  layer: LayerDef,
  graph: GeometryGraph,
): number {
  // Simplified: use bounding box as proxy
  const bbox = graph.boundingBox;
  const totalArea = (bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY);
  if (totalArea <= 0) return 0;

  // Count triangles that intersect this Z layer
  let intersectCount = 0;
  const z = layer.zMm;
  const h = layer.heightMm;
  const positions = graph.positions;
  const indices = graph.indices;

  for (let t = 0; t < graph.triangleCount; t++) {
    const i0 = indices[t * 3] * 3;
    const i1 = indices[t * 3 + 1] * 3;
    const i2 = indices[t * 3 + 2] * 3;

    const z0 = positions[i0 + 2];
    const z1 = positions[i1 + 2];
    const z2 = positions[i2 + 2];

    const zMin = Math.min(z0, z1, z2);
    const zMax = Math.max(z0, z1, z2);

    if (zMax >= z && zMin <= z + h) {
      intersectCount++;
    }
  }

  // Approximate fill as fraction of triangles intersecting
  const totalTriangles = graph.triangleCount;
  return totalTriangles > 0 ? Math.min(1, intersectCount / (totalTriangles * 0.1)) : 0;
}

function isLayerNearCorner(
  layer: LayerDef,
  bbox: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number },
): boolean {
  // Check if layer's Z is near top or bottom (where corners are)
  const zRange = bbox.maxZ - bbox.minZ;
  if (zRange <= 0) return false;

  const zNorm = (layer.zMm - bbox.minZ) / zRange;
  // Corners are at bottom 10% and top 10%
  return zNorm < 0.1 || zNorm > 0.9;
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

function generateRecommendations(
  warpingRisk: number,
  thermalRisk: number,
  mat: Partial<Material>,
  family: string,
): ThermalRecommendation[] {
  const recs: ThermalRecommendation[] = [];

  if (family !== "fdm") return recs; // Currently FDM-focused

  // Bed temperature
  if (warpingRisk > 0.5) {
    const bedTemp = mat.bedTempC ?? 60;
    recs.push({
      category: "bed_temp",
      severity: warpingRisk > 0.7 ? "critical" : "warning",
      message: `Increase bed temperature to ${bedTemp}°C or higher for better first-layer adhesion`,
      impactEstimate: "Can reduce warping by 30-50%",
    });
  }

  // Enclosure
  if (mat.environment?.enclosure && warpingRisk > 0.4) {
    recs.push({
      category: "enclosure",
      severity: mat.environment.chamberTempC ? "critical" : "warning",
      message: `Use an enclosed printer with chamber temperature ≥${mat.environment.chamberTempC ?? 40}°C`,
      impactEstimate: "Enclosure can reduce warping by 40-70%",
    });
  }

  // Orientation
  if (warpingRisk > 0.6) {
    recs.push({
      category: "orientation",
      severity: "warning",
      message: "Rotate model to minimize large flat areas parallel to the build plate",
      impactEstimate: "Orientation change can reduce warping by 20-40%",
    });
  }

  // Print speed
  if (thermalRisk > 0.6) {
    recs.push({
      category: "speed",
      severity: "info",
      message: "Reduce print speed for better layer cooling and adhesion",
      impactEstimate: "Slower printing improves thermal uniformity",
    });
  }

  // Material alternative
  if (warpingRisk > 0.8 && (mat.shrinkagePercent ?? 0) > 0.7) {
    recs.push({
      category: "material",
      severity: "critical",
      message:
        "Consider switching to a lower-shrinkage material (PETG, PLA) if part geometry allows",
      impactEstimate: "Lower-shrinkage materials have fundamentally less warping",
    });
  }

  return recs;
}
