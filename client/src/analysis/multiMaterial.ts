/**
 * Multi-Material Analysis
 * 
 * Analytical model for multi-material printing processes:
 * - Dual-color printing (FDM, SLS, MJF)
 * - Composite materials (continuous fiber, metal-plastic)
 * - Material interface analysis
 * - Print feasibility assessment
 * 
 * HONESTY NOTE: This is an analytical approximation based on geometric and material
 * properties. Confidence is capped at 0.6 — it captures the right direction of risk
 * but cannot predict exact material interface behavior.
 */

import type { Confidence } from "./types";
import { moduleResult, type AnalysisModuleResult } from "./types";
import type { Material } from "@shared/domain/material";
import type { GeometryModel } from "./geometryModel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MaterialInterface {
  /** Location of interface */
  location: string;
  /** Materials involved */
  materials: [string, string];
  /** Interface area (mm²) */
  areaMm2: number;
  /** Bond strength estimate (0-1) */
  bondStrength: number;
  /** Risk of delamination (0-1) */
  delaminationRisk: number;
  /** Recommendation for this interface */
  recommendation: string;
}

export interface DualColorResult {
  /** Whether dual-color printing is feasible */
  feasible: boolean;
  /** Feasibility score (0-1) */
  feasibilityScore: number;
  /** Material interfaces detected */
  interfaces: MaterialInterface[];
  /** Total interface area (mm²) */
  totalInterfaceAreaMm2: number;
  /** Estimated print time increase (%) */
  printTimeIncrease: number;
  /** Estimated material cost increase (%) */
  materialCostIncrease: number;
  /** Recommendations for dual-color printing */
  recommendations: DualColorRecommendation[];
}

export interface DualColorRecommendation {
  category: "interface" | "orientation" | "material" | "process";
  severity: "info" | "warning" | "critical";
  message: string;
  impactEstimate?: string;
}

export interface CompositeResult {
  /** Whether composite printing is feasible */
  feasible: boolean;
  /** Feasibility score (0-1) */
  feasibilityScore: number;
  /** Composite type */
  compositeType: "fiber_reinforced" | "metal_plastic" | "ceramic_plastic" | "multi_layer";
  /** Fiber/matrix interface analysis */
  fiberMatrixInterface: FiberMatrixInterface;
  /** Structural considerations */
  structuralConsiderations: StructuralConsideration[];
  /** Recommendations */
  recommendations: CompositeRecommendation[];
}

export interface FiberMatrixInterface {
  /** Fiber type */
  fiberType: "carbon" | "glass" | "aramid" | "basalt" | "none";
  /** Matrix material */
  matrixMaterial: string;
  /** Interface adhesion estimate (0-1) */
  adhesionEstimate: number;
  /** Thermal mismatch risk (0-1) */
  thermalMismatchRisk: number;
  /** Moisture absorption risk (0-1) */
  moistureAbsorptionRisk: number;
}

export interface StructuralConsideration {
  location: string;
  consideration: string;
  risk: number;
  recommendation: string;
}

export interface CompositeRecommendation {
  category: "fiber" | "matrix" | "interface" | "process" | "post_process";
  severity: "info" | "warning" | "critical";
  message: string;
  impactEstimate?: string;
}

export interface MultiMaterialAnalysisResult {
  dualColor: DualColorResult;
  composite: CompositeResult;
  overallFeasibility: number;
  recommendations: MultiMaterialRecommendation[];
}

export interface MultiMaterialRecommendation {
  category: "design" | "material" | "process" | "cost";
  severity: "info" | "warning" | "critical";
  message: string;
  impactEstimate?: string;
}

export interface MultiMaterialAnalysisOptions {
  /** Primary material */
  primaryMaterial: Material;
  /** Secondary material (for dual-color) */
  secondaryMaterial?: Material;
  /** Print technology */
  technology: "fdm" | "sla" | "sls" | "mjf" | "slm" | "fgf" | "concrete" | "eco";
  /** Layer height (mm) */
  layerHeightMm?: number;
  /** Whether continuous fiber reinforcement is used */
  fiberReinforced?: boolean;
  /** Fiber type */
  fiberType?: "carbon" | "glass" | "aramid" | "basalt";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Material compatibility matrix for dual-color printing */
const MATERIAL_COMPATIBILITY: Record<string, Record<string, number>> = {
  PLA: { PETG: 0.7, ABS: 0.6, TPU: 0.8, NYLON: 0.5 },
  PETG: { PLA: 0.7, ABS: 0.8, TPU: 0.7, NYLON: 0.6 },
  ABS: { PLA: 0.6, PETG: 0.8, TPU: 0.5, NYLON: 0.7 },
  TPU: { PLA: 0.8, PETG: 0.7, ABS: 0.5, NYLON: 0.6 },
  NYLON: { PLA: 0.5, PETG: 0.6, ABS: 0.7, TPU: 0.6, PC: 0.8 },
  PC: { NYLON: 0.8, ABS: 0.7, PETG: 0.6 },
};

/** Fiber-matrix compatibility */
const FIBER_MATRIX_COMPATIBILITY: Record<string, Record<string, number>> = {
  carbon: { PLA: 0.6, PETG: 0.7, NYLON: 0.9, PC: 0.8, PEEK: 0.95 },
  glass: { PLA: 0.7, PETG: 0.8, NYLON: 0.85, PC: 0.75 },
  aramid: { NYLON: 0.9, PC: 0.85, PEEK: 0.9 },
  basalt: { PLA: 0.65, PETG: 0.7, NYLON: 0.8 },
};

// ---------------------------------------------------------------------------
// Analysis Functions
// ---------------------------------------------------------------------------

/**
 * Analyze dual-color printing feasibility
 */
function analyzeDualColor(
  model: GeometryModel,
  options: MultiMaterialAnalysisOptions
): DualColorResult {
  const { primaryMaterial, secondaryMaterial, technology } = options;
  
  // Default result if no secondary material
  if (!secondaryMaterial) {
    return {
      feasible: false,
      feasibilityScore: 0,
      interfaces: [],
      totalInterfaceAreaMm2: 0,
      printTimeIncrease: 0,
      materialCostIncrease: 0,
      recommendations: [{
        category: "material",
        severity: "info",
        message: "No secondary material specified for dual-color printing",
      }],
    };
  }
  
  // Check material compatibility
  const compatibility = MATERIAL_COMPATIBILITY[primaryMaterial.name]?.[secondaryMaterial.name] ?? 0.5;
  
  // Calculate geometry metrics
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
  const volume = sizeX * sizeY * sizeZ;
  
  // Estimate interface area (simplified - assuming vertical split)
  const interfaceAreaMm2 = sizeX * sizeZ * 0.5; // 50% of side face
  
  // Estimate number of interfaces
  const interfaceCount = Math.max(1, Math.floor(sizeY / 10)); // One per 10mm
  
  // Create interface objects
  const interfaces: MaterialInterface[] = [];
  for (let i = 0; i < interfaceCount; i++) {
    const y = (i / interfaceCount) * sizeY;
    interfaces.push({
      location: `Y=${y.toFixed(1)}mm`,
      materials: [primaryMaterial.name, secondaryMaterial.name],
      areaMm2: interfaceAreaMm2 / interfaceCount,
      bondStrength: compatibility,
      delaminationRisk: 1 - compatibility,
      recommendation: compatibility < 0.6 
        ? "Consider using a material with better adhesion"
        : "Interface looks good",
    });
  }
  
  // Calculate feasibility score
  const feasibilityScore = Math.min(1,
    compatibility * 0.4 +
    (technology === 'fdm' ? 0.3 : 0.2) + // FDM is easier for dual-color
    (sizeZ < 100 ? 0.2 : 0.1) + // Shorter parts are easier
    (volume < 10000 ? 0.1 : 0) // Smaller parts are easier
  );
  
  // Estimate cost/time increases
  const printTimeIncrease = 20 + (interfaceCount * 5); // More interfaces = more time
  const materialCostIncrease = 10 + (100 - compatibility * 100); // Lower compatibility = higher cost
  
  // Generate recommendations
  const recommendations: DualColorRecommendation[] = [];
  
  if (compatibility < 0.5) {
    recommendations.push({
      category: "material",
      severity: "warning",
      message: `Low compatibility between ${primaryMaterial.name} and ${secondaryMaterial.name}`,
      impactEstimate: "Consider materials with better adhesion properties",
    });
  }
  
  if (sizeZ > 200) {
    recommendations.push({
      category: "orientation",
      severity: "info",
      message: "Tall parts may have alignment issues between color changes",
      impactEstimate: "Consider reorienting to reduce height",
    });
  }
  
  if (technology === 'fdm') {
    recommendations.push({
      category: "process",
      severity: "info",
      message: "FDM dual-color requires toolchange or dual extruder setup",
      impactEstimate: "Toolchange adds ~10s per layer",
    });
  }
  
  return {
    feasible: feasibilityScore > 0.5,
    feasibilityScore,
    interfaces,
    totalInterfaceAreaMm2: interfaceAreaMm2,
    printTimeIncrease,
    materialCostIncrease,
    recommendations,
  };
}

/**
 * Analyze composite material printing
 */
function analyzeComposite(
  model: GeometryModel,
  options: MultiMaterialAnalysisOptions
): CompositeResult {
  const { primaryMaterial, fiberReinforced, fiberType } = options;
  
  // Determine composite type
  let compositeType: CompositeResult['compositeType'] = 'multi_layer';
  if (fiberReinforced) {
    compositeType = 'fiber_reinforced';
  }
  
  // Calculate geometry metrics
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
  
  // Analyze fiber-matrix interface
  const fiberTypeValue = fiberType ?? 'none';
  const adhesion = FIBER_MATRIX_COMPATIBILITY[fiberTypeValue]?.[primaryMaterial.name] ?? 0.5;
  
  const fiberMatrixInterface: FiberMatrixInterface = {
    fiberType: fiberTypeValue,
    matrixMaterial: primaryMaterial.name,
    adhesionEstimate: adhesion,
    thermalMismatchRisk: Math.min(1, 
      Math.abs((primaryMaterial.thermalExpansionCoeff ?? 0) - 2e-5) / 2e-5
    ),
    moistureAbsorptionRisk: primaryMaterial.moistureRisk ?? 0.3,
  };
  
  // Structural considerations
  const structuralConsiderations: StructuralConsideration[] = [];
  
  if (sizeZ > 100) {
    structuralConsiderations.push({
      location: "Tall features",
      consideration: "Fiber alignment may be inconsistent in tall vertical features",
      risk: 0.6,
      recommendation: "Consider adding fiber orientation markers",
    });
  }
  
  if (sizeX > 50 || sizeY > 50) {
    structuralConsiderations.push({
      location: "Large flat areas",
      consideration: "Fiber bridging may occur in large horizontal spans",
      risk: 0.5,
      recommendation: "Add support structures or adjust fiber routing",
    });
  }
  
  // Check for thin walls
  if (sizeX < 3 || sizeY < 3) {
    structuralConsiderations.push({
      location: "Thin walls",
      consideration: "Fiber placement may be difficult in thin features",
      risk: 0.7,
      recommendation: "Increase wall thickness to accommodate fiber diameter",
    });
  }
  
  // Calculate feasibility
  const feasibilityScore = Math.min(1,
    adhesion * 0.4 +
    (fiberReinforced ? 0.3 : 0.5) + // Non-fiber reinforced is easier
    (structuralConsiderations.length < 2 ? 0.3 : 0.1)
  );
  
  // Generate recommendations
  const recommendations: CompositeRecommendation[] = [];
  
  if (fiberReinforced && adhesion < 0.6) {
    recommendations.push({
      category: "fiber",
      severity: "warning",
      message: `Low adhesion between ${fiberTypeValue} fiber and ${primaryMaterial.name} matrix`,
      impactEstimate: "Consider using a different fiber or matrix combination",
    });
  }
  
  if (fiberMatrixInterface.thermalMismatchRisk > 0.5) {
    recommendations.push({
      category: "interface",
      severity: "warning",
      message: "Thermal expansion mismatch may cause delamination",
      impactEstimate: "Consider materials with similar thermal expansion coefficients",
    });
  }
  
  if (primaryMaterial.moistureRisk && primaryMaterial.moistureRisk > 0.5) {
    recommendations.push({
      category: "matrix",
      severity: "info",
      message: "Matrix material is hygroscopic - dry before printing",
      impactEstimate: "Moisture can reduce interlayer adhesion by 20-30%",
    });
  }
  
  return {
    feasible: feasibilityScore > 0.5,
    feasibilityScore,
    compositeType,
    fiberMatrixInterface,
    structuralConsiderations,
    recommendations,
  };
}

/**
 * Generate overall multi-material recommendations
 */
function generateRecommendations(
  dualColor: DualColorResult,
  composite: CompositeResult,
  options: MultiMaterialAnalysisOptions
): MultiMaterialRecommendation[] {
  const recommendations: MultiMaterialRecommendation[] = [];
  
  // Dual-color recommendations
  if (dualColor.feasible && dualColor.feasibilityScore < 0.7) {
    recommendations.push({
      category: "design",
      severity: "info",
      message: `Dual-color feasibility is moderate (${(dualColor.feasibilityScore * 100).toFixed(0)}%)`,
      impactEstimate: "Consider simplifying color boundaries",
    });
  }
  
  if (dualColor.materialCostIncrease > 30) {
    recommendations.push({
      category: "cost",
      severity: "warning",
      message: `Material cost increase estimated at ${dualColor.materialCostIncrease.toFixed(0)}%`,
      impactEstimate: "Consider if dual-color is necessary for the application",
    });
  }
  
  // Composite recommendations
  if (composite.feasible && composite.feasibilityScore < 0.6) {
    recommendations.push({
      category: "material",
      severity: "warning",
      message: `Composite printing feasibility is low (${(composite.feasibilityScore * 100).toFixed(0)}%)`,
      impactEstimate: "Consider if composite reinforcement is necessary",
    });
  }
  
  if (composite.structuralConsiderations.length > 2) {
    recommendations.push({
      category: "design",
      severity: "info",
      message: "Multiple structural considerations detected",
      impactEstimate: "Review each consideration for potential issues",
    });
  }
  
  return recommendations;
}

// ---------------------------------------------------------------------------
// Main Analysis Function
// ---------------------------------------------------------------------------

/**
 * Run multi-material analysis
 */
export function computeMultiMaterialAnalysis(
  model: GeometryModel,
  options: MultiMaterialAnalysisOptions
): AnalysisModuleResult<MultiMaterialAnalysisResult> {
  // Run sub-analyses
  const dualColor = analyzeDualColor(model, options);
  const composite = analyzeComposite(model, options);
  
  // Calculate overall feasibility
  const overallFeasibility = Math.min(1,
    dualColor.feasibilityScore * 0.5 +
    composite.feasibilityScore * 0.5
  );
  
  // Generate recommendations
  const recommendations = generateRecommendations(dualColor, composite, options);
  
  const result: MultiMaterialAnalysisResult = {
    dualColor,
    composite,
    overallFeasibility,
    recommendations,
  };
  
  // Confidence capped at 0.6 (analytical approximation)
  const rawConfidence = Math.min(0.6, 
    0.6 - (model.triangleCount > 100000 ? 0.1 : 0)
  );
  const confidence = Math.round(rawConfidence * 10) / 10 as Confidence;
  
  return moduleResult('multiMaterial', confidence, 0, result, 'Multi-material printing analysis (dual-color, composite materials).');
}
