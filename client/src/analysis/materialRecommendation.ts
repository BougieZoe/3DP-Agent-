/**
 * Material Recommendation Engine
 *
 * Recommends optimal materials based on:
 * - Printer technology (FDM, SLA, SLS, SLM, etc.)
 * - Part geometry (size, overhangs, thin walls)
 * - Application requirements (strength, flexibility, heat resistance)
 * - Cost constraints
 *
 * scoring = geometry_fit * 0.30 + application_match * 0.30 + cost_efficiency * 0.20 + print_success_rate * 0.20
 */

import type { Material, MaterialTechnology } from "@shared/domain/material";
import { MATERIALS } from "@shared/domain/material";
import type { GeometryModel } from "./geometryModel";
import { buildGeometryGraph, type GeometryGraph } from "./geometryGraph";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecommendationOptions {
  /** Printer technology filter */
  technology?: MaterialTechnology;
  /** Part geometry model */
  model?: GeometryModel;
  /** Application keywords (e.g., "outdoor", "food-safe", "flexible") */
  application?: string[];
  /** Maximum budget per kg (USD) */
  maxBudgetPerKg?: number;
  /** Require enclosure? */
  needsEnclosure?: boolean;
  /** Maximum number of recommendations */
  topN?: number;
}

export interface MaterialRecommendation {
  material: Material;
  score: number;           // 0-100
  reasons: string[];       // Why recommended
  warnings: string[];      // Potential risks
  alternatives: Material[]; // Backup options
}

export interface RecommendationResult {
  recommendations: MaterialRecommendation[];
  filters: {
    technology: string;
    excludedCount: number;
    excludedReasons: string[];
  };
}

// ---------------------------------------------------------------------------
// Geometry Analysis
// ---------------------------------------------------------------------------

interface GeometryMetrics {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
  maxDim: number;
  volumeMm3: number;
  surfaceAreaMm2: number;
  maxOverhangAngle: number;
  thinWallCount: number;
  flatBaseArea: number;
}

function analyzeGeometry(model: GeometryModel, graph?: GeometryGraph | null): GeometryMetrics {
  const { positions, indices } = model;
  
  // Bounding box
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }
  
  const sizeX = maxX - minX;
  const sizeY = maxY - minY;
  const sizeZ = maxZ - minZ;
  const maxDim = Math.max(sizeX, sizeY, sizeZ);
  
  // Volume estimate (bounding box * fill factor)
  const fillFactor = 0.6; // Typical 3D print fill
  const volumeMm3 = sizeX * sizeY * sizeZ * fillFactor;
  
  // Surface area estimate
  const surfaceAreaMm2 = 2 * (sizeX * sizeY + sizeY * sizeZ + sizeX * sizeZ);
  
  // Max overhang angle (simplified)
  let maxOverhangAngle = 0;
  const faceCount = indices.length / 3;
  
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3;
    const i1 = indices[i + 1] * 3;
    const i2 = indices[i + 2] * 3;
    
    // Compute face normal
    const ux = positions[i1] - positions[i0];
    const uy = positions[i1 + 1] - positions[i0 + 1];
    const uz = positions[i1 + 2] - positions[i0 + 2];
    const vx = positions[i2] - positions[i0];
    const vy = positions[i2 + 1] - positions[i0 + 1];
    const vz = positions[i2 + 2] - positions[i0 + 2];
    
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    
    if (len > 0) {
      // Angle from vertical (Z-axis)
      const cosAngle = Math.abs(nz / len);
      const angle = Math.acos(Math.min(1, cosAngle)) * (180 / Math.PI);
      maxOverhangAngle = Math.max(maxOverhangAngle, angle);
    }
  }
  
  // Thin wall detection (simplified)
  const thinWallThreshold = 2.0; // mm
  let thinWallCount = 0;
  
  // Check if any dimension is very small
  if (sizeX < thinWallThreshold) thinWallCount++;
  if (sizeY < thinWallThreshold) thinWallCount++;
  
  // Flat base area
  const flatBaseArea = sizeX * sizeY;
  
  return {
    sizeX, sizeY, sizeZ, maxDim,
    volumeMm3, surfaceAreaMm2,
    maxOverhangAngle, thinWallCount, flatBaseArea,
  };
}

// ---------------------------------------------------------------------------
// Scoring Functions
// ---------------------------------------------------------------------------

/**
 * Score geometry fit (0-1)
 */
function scoreGeometryFit(material: Material, geometry: GeometryMetrics): number {
  let score = 0.5; // Base score
  
  // Check shrinkage vs part size
  const shrinkage = material.shrinkagePercent ?? 0.5;
  const sizeFactor = Math.min(1, geometry.maxDim / 200); // Normalize to 200mm
  
  // High shrinkage + large part = bad
  if (shrinkage > 0.5 && sizeFactor > 0.5) {
    score -= 0.2;
  }
  
  // Check overhang support
  const overhangThreshold = material.overhangThreshold ?? 45;
  if (geometry.maxOverhangAngle > overhangThreshold) {
    // Material can't handle the overhangs
    score -= 0.15;
  }
  
  // Check thin walls
  if (geometry.thinWallCount > 0) {
    // Flexible materials handle thin walls better
    const isFlexible = (material.tensileStrengthMPa ?? 50) < 40;
    if (!isFlexible) {
      score -= 0.1;
    }
  }
  
  // Check enclosure requirement
  const needsEnclosure = material.environment?.enclosure ?? false;
  if (needsEnclosure && geometry.maxDim > 150) {
    // Large parts in enclosure = more warping risk
    score -= 0.1;
  }
  
  return Math.max(0, Math.min(1, score));
}

/**
 * Score application match (0-1)
 */
function scoreApplicationMatch(material: Material, applications: string[]): number {
  if (applications.length === 0) return 0.5; // No preference
  
  let matchCount = 0;
  const materialText = `${material.useCase} ${material.description} ${material.category}`.toLowerCase();
  
  for (const app of applications) {
    const appLower = app.toLowerCase();
    
    // Direct match
    if (materialText.includes(appLower)) {
      matchCount++;
      continue;
    }
    
    // Synonym matching
    const synonyms: Record<string, string[]> = {
      "outdoor": ["uv", "weather", "exterior", "sunlight"],
      "food": ["food", "edible", "safe"],
      "flexible": ["flex", "elastic", "rubber", "soft"],
      "strong": ["tough", "impact", "load", "structural"],
      "heat": ["thermal", "temperature", "high temp"],
      "medical": ["biocompat", "implant", "dental"],
      "prototype": ["display", "model", "visual"],
    };
    
    for (const [key, syns] of Object.entries(synonyms)) {
      if (appLower.includes(key) || syns.some(s => appLower.includes(s))) {
        if (materialText.includes(key) || syns.some(s => materialText.includes(s))) {
          matchCount++;
          break;
        }
      }
    }
  }
  
  return Math.min(1, matchCount / applications.length);
}

/**
 * Score cost efficiency (0-1)
 */
function scoreCostEfficiency(material: Material, maxBudget?: number): number {
  const price = material.pricePerKgUsd;
  
  if (maxBudget && price > maxBudget) {
    return 0; // Over budget
  }
  
  // Normalize to typical range ($10-$500)
  const normalized = 1 - (price / 500);
  return Math.max(0, Math.min(1, normalized));
}

/**
 * Score print success rate (0-1)
 */
function scorePrintSuccessRate(material: Material, geometry: GeometryMetrics): number {
  let score = 0.7; // Base score
  
  // Shrinkage factor
  const shrinkage = material.shrinkagePercent ?? 0.5;
  if (shrinkage > 1.0) {
    score -= 0.2;
  } else if (shrinkage > 0.5) {
    score -= 0.1;
  }
  
  // Warping risk (based on glass transition and bed temp)
  const tg = material.glassTransitionTempC ?? 60;
  const bedTemp = material.bedTempC ?? 50;
  if (tg > 100 && bedTemp > 80) {
    score -= 0.15; // High warping risk
  }
  
  // Enclosure requirement
  if (material.environment?.enclosure) {
    score -= 0.05; // Slightly harder to print
  }
  
  // Hygroscopic materials
  if (material.moistureRisk && material.moistureRisk > 0.5) {
    score -= 0.1;
  }
  
  return Math.max(0, Math.min(1, score));
}

// ---------------------------------------------------------------------------
// Main Recommendation Function
// ---------------------------------------------------------------------------

/**
 * Recommend materials based on options
 */
export function recommendMaterials(
  options: RecommendationOptions,
  providedGraph?: GeometryGraph | null,
): RecommendationResult {
  const {
    technology,
    model,
    application = [],
    maxBudgetPerKg,
    needsEnclosure,
    topN = 3,
  } = options;
  
  // Get all materials
  let candidates = Object.values(MATERIALS);
  
  // Filter by technology
  if (technology) {
    candidates = candidates.filter(m => m.technology === technology);
  }
  
  // Filter by budget
  if (maxBudgetPerKg) {
    candidates = candidates.filter(m => m.pricePerKgUsd <= maxBudgetPerKg);
  }
  
  // Analyze geometry if model provided
  let geometry: GeometryMetrics | null = null;
  if (model) {
    geometry = analyzeGeometry(model, providedGraph);
  }
  
  // Score each candidate
  const scored = candidates.map(material => {
    const geometryFit = geometry ? scoreGeometryFit(material, geometry) : 0.5;
    const applicationMatch = scoreApplicationMatch(material, application);
    const costEfficiency = scoreCostEfficiency(material, maxBudgetPerKg);
    const printSuccessRate = geometry ? scorePrintSuccessRate(material, geometry) : 0.7;
    
    const score = (
      geometryFit * 0.30 +
      applicationMatch * 0.30 +
      costEfficiency * 0.20 +
      printSuccessRate * 0.20
    ) * 100;
    
    // Generate reasons
    const reasons: string[] = [];
    if (geometryFit > 0.6) reasons.push("Good geometry fit");
    if (applicationMatch > 0.6) reasons.push("Matches application requirements");
    if (costEfficiency > 0.6) reasons.push("Cost-effective");
    if (printSuccessRate > 0.7) reasons.push("High print success rate");
    
    // Generate warnings
    const warnings: string[] = [];
    if (material.environment?.enclosure) warnings.push("Requires enclosure");
    if ((material.shrinkagePercent ?? 0) > 0.5) warnings.push("High shrinkage risk");
    if ((material.moistureRisk ?? 0) > 0.5) warnings.push("Hygroscopic - dry before printing");
    if (geometry && geometry.maxOverhangAngle > (material.overhangThreshold ?? 45)) {
      warnings.push("Overhangs may need support");
    }
    
    return {
      material,
      score,
      reasons,
      warnings,
      alternatives: [] as Material[],
    };
  });
  
  // Sort by score
  scored.sort((a, b) => b.score - a.score);
  
  // Take top N
  const recommendations = scored.slice(0, topN);
  
  // Add alternatives (next 2 after each recommendation)
  for (let i = 0; i < recommendations.length; i++) {
    const altStart = topN + i * 2;
    recommendations[i].alternatives = scored.slice(altStart, altStart + 2).map(r => r.material);
  }
  
  // Build exclusion info
  const excludedCount = candidates.length - recommendations.length;
  const excludedReasons: string[] = [];
  if (technology) excludedReasons.push(`Technology: ${technology}`);
  if (maxBudgetPerKg) excludedReasons.push(`Budget: $${maxBudgetPerKg}/kg`);
  
  return {
    recommendations,
    filters: {
      technology: technology ?? "any",
      excludedCount,
      excludedReasons,
    },
  };
}
