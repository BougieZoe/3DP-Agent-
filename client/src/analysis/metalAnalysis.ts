/**
 * Metal Printing Analysis (SLM/DMLS)
 * 
 * Analytical model for metal powder bed fusion processes:
 * - Thermal stress analysis
 * - Residual stress prediction
 * - Distortion risk assessment
 * - Support structure requirements
 * - Build orientation optimization
 * 
 * HONESTY NOTE: This is an analytical approximation, not a full FEA simulation.
 * Confidence is capped at 0.5 — it captures the right direction of risk but
 * cannot predict exact distortion values.
 */

import type { Confidence } from "./types";
import { moduleResult, type AnalysisModuleResult } from "./types";
import type { Material } from "@shared/domain/material";
import { MATERIALS } from "@shared/domain/material";
import type { GeometryModel } from "./geometryModel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThermalStressResult {
  /** Maximum thermal gradient (°C/mm) */
  maxThermalGradientCPerMm: number;
  /** Thermal stress risk score (0-1) */
  thermalStressRisk: number;
  /** Locations of high thermal stress */
  hotspots: ThermalStressHotspot[];
}

export interface ThermalStressHotspot {
  region: "corner" | "edge" | "thin_wall" | "large_flat" | "overhang";
  risk: number;
  cause: string;
  recommendation: string;
}

export interface ResidualStressResult {
  /** Predicted residual stress level (0-1) */
  residualStressLevel: number;
  /** Risk of cracking due to residual stress */
  crackingRisk: number;
  /** Areas prone to delamination */
  delaminationRisk: number;
  /** Stress concentration factors */
  stressConcentrationFactor: number;
}

export interface DistortionResult {
  /** Overall distortion risk (0-1) */
  distortionRisk: number;
  /** Predicted warping direction */
  warpingDirection: "up" | "down" | "twist" | "none";
  /** Magnitude of expected distortion */
  magnitudeMm: number;
  /** Critical zones for distortion */
  criticalZones: DistortionZone[];
}

export interface DistortionZone {
  location: string;
  risk: number;
  cause: string;
}

export interface SupportRequirement {
  /** Total support volume needed (mm³) */
  supportVolumeMm3: number;
  /** Number of support structures */
  supportCount: number;
  /** Support density recommendation (0-1) */
  supportDensity: number;
  /** Areas requiring support */
  areas: SupportArea[];
}

export interface SupportArea {
  type: "overhang" | "island" | "bridge" | "thin_feature";
  risk: number;
  recommendation: string;
}

export interface BuildOrientation {
  /** Recommended rotation around X axis (degrees) */
  rotateX: number;
  /** Recommended rotation around Y axis (degrees) */
  rotateY: number;
  /** Expected support volume reduction (%) */
  supportReduction: number;
  /** Expected distortion reduction (%) */
  distortionReduction: number;
  /** Reason for recommendation */
  reason: string;
}

export interface MetalAnalysisResult {
  thermalStress: ThermalStressResult;
  residualStress: ResidualStressResult;
  distortion: DistortionResult;
  support: SupportRequirement;
  buildOrientation: BuildOrientation;
  overallRiskScore: number;
  recommendations: MetalRecommendation[];
}

export interface MetalRecommendation {
  category: "orientation" | "support" | "parameters" | "material" | "post_process";
  severity: "info" | "warning" | "critical";
  message: string;
  impactEstimate?: string;
}

export interface MetalAnalysisOptions {
  material: Material;
  layerHeightMm?: number;
  laserPowerW?: number;
  scanSpeedMmPerS?: number;
  hatchSpacingMm?: number;
}

// ---------------------------------------------------------------------------
// Constants for metal printing
// ---------------------------------------------------------------------------

// Material-specific properties are now sourced from MATERIALS registry
// See shared/domain/material.ts for the unified material database

// ---------------------------------------------------------------------------
// Analysis Functions
// ---------------------------------------------------------------------------

/**
 * Analyze thermal stress in metal printing
 */
function analyzeThermalStress(
  model: GeometryModel,
  material: Material,
  options: MetalAnalysisOptions
): ThermalStressResult {
  const { positions, indices, triangleCount } = model;
  
  // Get material properties from MATERIALS registry
  const materialKey = material.name?.toUpperCase().replace(/\s+/g, '') ?? '';
  const registryMaterial = MATERIALS[materialKey];
  const mat = registryMaterial ?? material;
  
  // Use melting point from material properties, with fallback
  const meltingPointC = mat.meltingPointC ?? 1400;
  
  // Calculate geometry properties
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
  
  // Estimate thermal gradient based on geometry
  // Larger parts → higher thermal gradient → more stress
  const sizeFactor = Math.min(1, maxDim / 200); // Normalize to 200mm
  
  // Thin walls → faster cooling → higher stress
  const thinWallFactor = sizeX < 5 || sizeY < 5 ? 1.5 : 1;
  
  // Large flat areas → more uniform cooling → less stress
  const flatnessFactor = (sizeX * sizeY) / (maxDim * maxDim);
  
  // Calculate thermal gradient estimate
  const maxThermalGradientCPerMm = meltingPointC / Math.max(1, sizeZ) * sizeFactor * thinWallFactor;
  
  // Calculate thermal stress risk
  const thermalStressRisk = Math.min(1, 
    (sizeFactor * 0.4) +
    (thinWallFactor * 0.3) +
    ((1 - flatnessFactor) * 0.3)
  );
  
  // Identify hotspots
  const hotspots: ThermalStressHotspot[] = [];
  
  if (sizeX < 3 || sizeY < 3) {
    hotspots.push({
      region: "thin_wall",
      risk: 0.8,
      cause: "Thin walls cool rapidly, creating high thermal gradients",
      recommendation: "Consider increasing wall thickness or adjusting scan strategy",
    });
  }
  
  if (maxDim > 100) {
    hotspots.push({
      region: "large_flat",
      risk: 0.6,
      cause: "Large flat areas accumulate thermal stress",
      recommendation: "Consider building at an angle to reduce flat cross-sections",
    });
  }
  
  if (sizeX / sizeZ > 10 || sizeY / sizeZ > 10) {
    hotspots.push({
      region: "overhang",
      risk: 0.7,
      cause: "Large overhangs require significant support structures",
      recommendation: "Reorient part to minimize overhangs",
    });
  }
  
  return {
    maxThermalGradientCPerMm,
    thermalStressRisk,
    hotspots,
  };
}

/**
 * Analyze residual stress
 */
function analyzeResidualStress(
  model: GeometryModel,
  material: Material,
  thermalStress: ThermalStressResult
): ResidualStressResult {
  // Get material properties from MATERIALS registry
  const materialKey = material.name?.toUpperCase().replace(/\s+/g, '') ?? '';
  const registryMaterial = MATERIALS[materialKey];
  const mat = registryMaterial ?? material;
  
  // Use material properties with fallbacks
  const yieldStrengthMPa = mat.tensileStrengthMPa ?? 205;
  const poissonRatio = mat.PoissonRatio ?? 0.27;
  
  // Residual stress correlates with thermal stress and material properties
  const residualStressLevel = Math.min(1, 
    thermalStress.thermalStressRisk * 0.6 +
    (yieldStrengthMPa / 1000) * 0.4 // Higher yield strength → more residual stress
  );
  
  // Cracking risk increases with residual stress and decreases with ductility
  const crackingRisk = Math.min(1,
    residualStressLevel * 0.7 +
    (1 - poissonRatio) * 0.3 // Lower Poisson ratio → more brittle
  );
  
  // Delamination risk correlates with layer adhesion
  const delaminationRisk = Math.min(1,
    thermalStress.thermalStressRisk * 0.5 +
    (thermalStress.maxThermalGradientCPerMm / 100) * 0.5
  );
  
  // Stress concentration factor based on geometry complexity
  const stressConcentrationFactor = 1 + thermalStress.hotspots.length * 0.2;
  
  return {
    residualStressLevel,
    crackingRisk,
    delaminationRisk,
    stressConcentrationFactor,
  };
}

/**
 * Analyze distortion risk
 */
function analyzeDistortion(
  model: GeometryModel,
  material: Material,
  thermalStress: ThermalStressResult
): DistortionResult {
  // Get material properties from MATERIALS registry
  const materialKey = material.name?.toUpperCase().replace(/\s+/g, '') ?? '';
  const registryMaterial = MATERIALS[materialKey];
  const mat = registryMaterial ?? material;
  
  // Use thermal expansion coefficient with fallback
  const thermalExpansionCoeff = mat.thermalExpansionCoeff ?? 16e-6;
  
  // Calculate size metrics
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  
  for (let i = 0; i < model.positions.length; i += 3) {
    minX = Math.min(minX, model.positions[i]);
    maxX = Math.max(maxX, model.positions[i]);
    minY = Math.min(minY, model.positions[i + 1]);
    maxY = Math.max(maxY, model.positions[i + 1]);
    minZ = Math.min(minZ, model.positions[i + 2]);
    maxZ = Math.max(maxZ, model.positions[i + 2]);
  }
  
  const sizeX = maxX - minX;
  const sizeY = maxY - minY;
  const sizeZ = maxZ - minZ;
  
  // Distortion risk increases with:
  // 1. Part size (larger → more distortion)
  // 2. Thermal expansion coefficient
  // 3. Thermal stress
  const sizeFactor = Math.min(1, (sizeX + sizeY + sizeZ) / 300);
  const expansionFactor = thermalExpansionCoeff / 25e-6; // Normalize to aluminum
  
  const distortionRisk = Math.min(1,
    sizeFactor * 0.4 +
    expansionFactor * 0.3 +
    thermalStress.thermalStressRisk * 0.3
  );
  
  // Determine warping direction
  let warpingDirection: "up" | "down" | "twist" | "none" = "none";
  if (distortionRisk > 0.3) {
    if (sizeX / sizeZ > 5) warpingDirection = "up";
    else if (sizeY / sizeZ > 5) warpingDirection = "twist";
    else warpingDirection = "down";
  }
  
  // Estimate magnitude (simplified)
  const magnitudeMm = distortionRisk * sizeFactor * thermalExpansionCoeff * 1000;
  
  // Identify critical zones
  const criticalZones: DistortionZone[] = [];
  
  if (sizeX > 100 || sizeY > 100) {
    criticalZones.push({
      location: "Large flat base",
      risk: 0.7,
      cause: "Large flat areas are prone to cupping and curling",
    });
  }
  
  if (sizeZ > 100) {
    criticalZones.push({
      location: "Tall features",
      risk: 0.6,
      cause: "Tall thin features can bend under thermal stress",
    });
  }
  
  return {
    distortionRisk,
    warpingDirection,
    magnitudeMm,
    criticalZones,
  };
}

/**
 * Calculate support requirements
 */
function analyzeSupportRequirements(
  model: GeometryModel,
  material: Material
): SupportRequirement {
  const { positions, indices, triangleCount } = model;
  
  // Calculate bounding box
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
  const volume = sizeX * sizeY * sizeZ;
  
  // Estimate overhang area (simplified)
  let overhangArea = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 3;
    const i1 = indices[i + 1] * 3;
    const i2 = indices[i + 2] * 3;
    
    // Calculate face normal Z component
    const ax = positions[i1] - positions[i0];
    const ay = positions[i1 + 1] - positions[i0 + 1];
    const az = positions[i1 + 2] - positions[i0 + 2];
    const bx = positions[i2] - positions[i0];
    const by = positions[i2 + 1] - positions[i0 + 1];
    const bz = positions[i2 + 2] - positions[i0 + 2];
    
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    
    // If normal points down (nz < 0), it's an overhang
    if (nz < 0) {
      const faceArea = Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
      overhangArea += faceArea;
    }
  }
  
  // Support volume estimate (simplified)
  const supportVolumeMm3 = overhangArea * sizeZ * 0.1; // 10% density
  
  // Support count estimate
  const supportCount = Math.ceil(overhangArea / 100); // One support per 100mm²
  
  // Support density based on overhang angle
  const supportDensity = Math.min(1, overhangArea / (sizeX * sizeY));
  
  // Identify support areas
  const areas: SupportArea[] = [];
  
  if (overhangArea > 0) {
    areas.push({
      type: "overhang",
      risk: Math.min(1, overhangArea / (sizeX * sizeY)),
      recommendation: "Add support structures for overhanging features",
    });
  }
  
  return {
    supportVolumeMm3,
    supportCount,
    supportDensity,
    areas,
  };
}

/**
 * Recommend build orientation
 */
function recommendBuildOrientation(
  model: GeometryModel,
  material: Material
): BuildOrientation {
  // Calculate current bounding box
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  
  for (let i = 0; i < model.positions.length; i += 3) {
    minX = Math.min(minX, model.positions[i]);
    maxX = Math.max(maxX, model.positions[i]);
    minY = Math.min(minY, model.positions[i + 1]);
    maxY = Math.max(maxY, model.positions[i + 1]);
    minZ = Math.min(minZ, model.positions[i + 2]);
    maxZ = Math.max(maxZ, model.positions[i + 2]);
  }
  
  const sizeX = maxX - minX;
  const sizeY = maxY - minY;
  const sizeZ = maxZ - minZ;
  
  // Default recommendation: keep current orientation
  let rotateX = 0;
  let rotateY = 0;
  let supportReduction = 0;
  let distortionReduction = 0;
  let reason = "Current orientation is acceptable";
  
  // If part is tall and thin, rotating can reduce support
  if (sizeZ > sizeX * 2 && sizeZ > sizeY * 2) {
    rotateX = 45;
    supportReduction = 30;
    distortionReduction = 20;
    reason = "Tall thin parts benefit from 45° rotation to reduce support volume";
  }
  
  // If part has large flat base, rotating can reduce distortion
  if (sizeX > 100 && sizeY > 100 && sizeZ < 50) {
    rotateX = 30;
    supportReduction = 10;
    distortionReduction = 40;
    reason = "Large flat parts benefit from angle to reduce thermal distortion";
  }
  
  return {
    rotateX,
    rotateY,
    supportReduction,
    distortionReduction,
    reason,
  };
}

/**
 * Generate recommendations
 */
function generateRecommendations(
  thermalStress: ThermalStressResult,
  residualStress: ResidualStressResult,
  distortion: DistortionResult,
  support: SupportRequirement,
  buildOrientation: BuildOrientation,
  material: Material
): MetalRecommendation[] {
  const recommendations: MetalRecommendation[] = [];
  
  // Thermal stress recommendations
  if (thermalStress.thermalStressRisk > 0.7) {
    recommendations.push({
      category: "parameters",
      severity: "critical",
      message: "High thermal stress risk. Consider reducing laser power or increasing scan speed.",
      impactEstimate: "May reduce thermal stress by 30-50%",
    });
  }
  
  // Residual stress recommendations
  if (residualStress.residualStressLevel > 0.6) {
    recommendations.push({
      category: "post_process",
      severity: "warning",
      message: "High residual stress detected. Consider stress relief heat treatment.",
      impactEstimate: "Stress relief can reduce residual stress by 60-80%",
    });
  }
  
  if (residualStress.crackingRisk > 0.5) {
    recommendations.push({
      category: "material",
      severity: "warning",
      message: "Cracking risk is elevated. Consider using a more ductile alloy.",
      impactEstimate: "May reduce cracking risk by 40-60%",
    });
  }
  
  // Distortion recommendations
  if (distortion.distortionRisk > 0.6) {
    recommendations.push({
      category: "orientation",
      severity: "warning",
      message: `Distortion risk is ${distortion.distortionRisk > 0.8 ? 'high' : 'moderate'}. Consider reorienting the part.`,
      impactEstimate: "Optimal orientation can reduce distortion by 20-40%",
    });
  }
  
  // Support recommendations
  if (support.supportVolumeMm3 > 1000) {
    recommendations.push({
      category: "support",
      severity: "info",
      message: `Estimated support volume: ${support.supportVolumeMm3.toFixed(0)} mm³. Consider optimizing geometry to reduce supports.`,
      impactEstimate: "Reducing supports saves material and post-processing time",
    });
  }
  
  // Build orientation recommendations
  if (buildOrientation.supportReduction > 20) {
    recommendations.push({
      category: "orientation",
      severity: "info",
      message: `Recommended rotation: ${buildOrientation.rotateX}° around X-axis.`,
      impactEstimate: `May reduce support by ${buildOrientation.supportReduction}%`,
    });
  }
  
  return recommendations;
}

// ---------------------------------------------------------------------------
// Main Analysis Function
// ---------------------------------------------------------------------------

/**
 * Run metal printing analysis
 */
export function computeMetalAnalysis(
  model: GeometryModel,
  options: MetalAnalysisOptions
): AnalysisModuleResult<MetalAnalysisResult> {
  const { material } = options;
  
  // Run sub-analyses
  const thermalStress = analyzeThermalStress(model, material, options);
  const residualStress = analyzeResidualStress(model, material, thermalStress);
  const distortion = analyzeDistortion(model, material, thermalStress);
  const support = analyzeSupportRequirements(model, material);
  const buildOrientation = recommendBuildOrientation(model, material);
  
  // Calculate overall risk score
  const overallRiskScore = Math.min(1,
    thermalStress.thermalStressRisk * 0.3 +
    residualStress.residualStressLevel * 0.3 +
    distortion.distortionRisk * 0.2 +
    (support.supportDensity) * 0.2
  );
  
  // Generate recommendations
  const recommendations = generateRecommendations(
    thermalStress,
    residualStress,
    distortion,
    support,
    buildOrientation,
    material
  );
  
  const result: MetalAnalysisResult = {
    thermalStress,
    residualStress,
    distortion,
    support,
    buildOrientation,
    overallRiskScore,
    recommendations,
  };
  
  // Confidence capped at 0.5 (analytical approximation)
  const rawConfidence = Math.min(0.5, 
    0.5 - (model.triangleCount > 100000 ? 0.1 : 0) // Lower confidence for complex meshes
  );
  // Round to nearest valid Confidence value
  const confidence = Math.round(rawConfidence * 10) / 10 as Confidence;
  
  return moduleResult('metalAnalysis', confidence, 0, result, 'Metal printing analysis (thermal stress, residual stress, distortion).');
}
