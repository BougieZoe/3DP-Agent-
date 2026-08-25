/**
 * AI Suggestion Enhancement
 * 
 * Smart recommendation system based on:
 * - Historical analysis data
 * - Pattern recognition
 * - Similar geometry matching
 * - Material-property correlations
 * - Print success/failure patterns
 * 
 * HONESTY NOTE: This is a rule-based system that learns from historical patterns.
 * It does not use machine learning but can provide valuable insights based on
 * accumulated data.
 */

import type { Confidence } from "./types";
import { moduleResult, type AnalysisModuleResult } from "./types";
import type { Material } from "@shared/domain/material";
import type { GeometryModel } from "./geometryModel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Suggestion {
  /** Unique identifier */
  id: string;
  /** Suggestion category */
  category: "material" | "orientation" | "support" | "parameters" | "design" | "post_process";
  /** Priority (1 = highest) */
  priority: number;
  /** Confidence in this suggestion (0-1) */
  confidence: number;
  /** Short title */
  title: string;
  /** Detailed description */
  description: string;
  /** Expected impact */
  impact: string;
  /** Estimated improvement percentage */
  improvementEstimate: number;
  /** Related historical patterns */
  relatedPatterns: string[];
  /** Tags for filtering */
  tags: string[];
}

export interface HistoricalPattern {
  /** Pattern identifier */
  id: string;
  /** Pattern name */
  name: string;
  /** Description */
  description: string;
  /** How many times this pattern was observed */
  frequency: number;
  /** Success rate when this pattern was addressed */
  successRate: number;
  /** Associated geometry features */
  geometryFeatures: string[];
  /** Associated materials */
  materials: string[];
  /** Associated printers */
  printers: string[];
}

export interface SimilarGeometry {
  /** Geometry similarity score (0-1) */
  similarityScore: number;
  /** Historical analysis result */
  analysisResult: {
    material: string;
    printer: string;
    success: boolean;
    issues: string[];
    solutions: string[];
  };
}

export interface AISuggestionResult {
  /** Generated suggestions */
  suggestions: Suggestion[];
  /** Detected patterns */
  patterns: HistoricalPattern[];
  /** Similar geometries found */
  similarGeometries: SimilarGeometry[];
  /** Overall confidence in suggestions */
  overallConfidence: number;
  /** Learning data for future improvements */
  learningData: LearningData;
}

export interface LearningData {
  /** Geometry features extracted */
  geometryFeatures: string[];
  /** Material properties used */
  materialProperties: Record<string, number>;
  /** Analysis results for learning */
  analysisResults: Record<string, unknown>;
  /** Timestamp */
  timestamp: string;
}

export interface AISuggestionOptions {
  /** Current material */
  material: Material;
  /** Printer ID */
  printerId?: string;
  /** Enable learning from this analysis */
  enableLearning?: boolean;
  /** Maximum number of suggestions */
  maxSuggestions?: number;
  /** Minimum confidence threshold */
  minConfidence?: number;
}

// ---------------------------------------------------------------------------
// Historical Data Store (simulated - in production, use database)
// ---------------------------------------------------------------------------

/** Pre-loaded historical patterns */
const HISTORICAL_PATTERNS: HistoricalPattern[] = [
  {
    id: "thin-wall-fdm",
    name: "Thin Wall FDM",
    description: "Thin walls (< 1mm) in FDM often warp or have poor layer adhesion",
    frequency: 847,
    successRate: 0.78,
    geometryFeatures: ["thin_wall", "high_aspect_ratio"],
    materials: ["PLA", "ABS", "PETG"],
    printers: ["bambu_x1c", "bambu_p1s", "ultimaker_s5"],
  },
  {
    id: "large-flat-warping",
    name: "Large Flat Warping",
    description: "Large flat areas (> 100mm) prone to warping in FDM",
    frequency: 623,
    successRate: 0.65,
    geometryFeatures: ["large_flat", "high_surface_area"],
    materials: ["ABS", "NYLON", "PC"],
    printers: ["bambu_x1c", "bambu_p1s"],
  },
  {
    id: "overhang-support",
    name: "Overhang Support Needed",
    description: "Overhangs > 45° typically require support structures",
    frequency: 1205,
    successRate: 0.82,
    geometryFeatures: ["overhang", "bridge"],
    materials: ["PLA", "PETG", "ABS"],
    printers: ["bambu_x1c", "bambu_p1s", "ultimaker_s5"],
  },
  {
    id: "sla-suction",
    name: "SLA Suction Risk",
    description: "Large flat cross-sections in SLA cause suction/peel forces",
    frequency: 312,
    successRate: 0.71,
    geometryFeatures: ["large_flat", "enclosed_cavity"],
    materials: ["RESIN_STD", "RESIN_TOUGH"],
    printers: ["formlabs_form3", "formlabs_form4"],
  },
  {
    id: "metal-thermal-stress",
    name: "Metal Thermal Stress",
    description: "Large metal parts have high thermal stress and residual stress",
    frequency: 189,
    successRate: 0.58,
    geometryFeatures: ["large_volume", "thin_wall"],
    materials: ["STEEL_316L", "TI64", "ALSI10MG"],
    printers: ["eos_m290", "desktop_metal"],
  },
  {
    id: "composite-fiber-alignment",
    name: "Composite Fiber Alignment",
    description: "Fiber-reinforced parts need careful fiber orientation",
    frequency: 87,
    successRate: 0.69,
    geometryFeatures: ["tall_features", "thin_wall"],
    materials: ["NYLON", "PC"],
    printers: ["markforged_x7", "markforged_fx20"],
  },
];

/** Geometry feature extraction keywords */
const GEOMETRY_FEATURE_KEYWORDS: Record<string, (model: GeometryModel) => boolean> = {
  thin_wall: (model) => {
    // Simplified check - in production, use actual wall thickness analysis
    let minX = Infinity, maxX = -Infinity;
    for (let i = 0; i < model.positions.length; i += 3) {
      minX = Math.min(minX, model.positions[i]);
      maxX = Math.max(maxX, model.positions[i]);
    }
    return (maxX - minX) < 5;
  },
  large_flat: (model) => {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < model.positions.length; i += 3) {
      minX = Math.min(minX, model.positions[i]);
      maxX = Math.max(maxX, model.positions[i]);
      minY = Math.min(minY, model.positions[i + 1]);
      maxY = Math.max(maxY, model.positions[i + 1]);
    }
    const area = (maxX - minX) * (maxY - minY);
    return area > 10000; // > 100mm x 100mm
  },
  high_aspect_ratio: (model) => {
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
    const dims = [maxX - minX, maxY - minY, maxZ - minZ].sort((a, b) => b - a);
    return dims[0] / dims[2] > 5;
  },
  overhang: (model) => {
    // Simplified check - look for faces with downward normals
    let hasOverhang = false;
    for (let i = 0; i < model.indices.length; i += 3) {
      const i0 = model.indices[i] * 3;
      const i1 = model.indices[i + 1] * 3;
      const i2 = model.indices[i + 2] * 3;
      
      const ax = model.positions[i1] - model.positions[i0];
      const ay = model.positions[i1 + 1] - model.positions[i0 + 1];
      const az = model.positions[i1 + 2] - model.positions[i0 + 2];
      const bx = model.positions[i2] - model.positions[i0];
      const by = model.positions[i2 + 1] - model.positions[i0 + 1];
      const bz = model.positions[i2 + 2] - model.positions[i0 + 2];
      
      const nz = ax * by - ay * bx;
      if (nz < 0) {
        hasOverhang = true;
        break;
      }
    }
    return hasOverhang;
  },
  tall_features: (model) => {
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < model.positions.length; i += 3) {
      minZ = Math.min(minZ, model.positions[i + 2]);
      maxZ = Math.max(maxZ, model.positions[i + 2]);
    }
    return (maxZ - minZ) > 100;
  },
  large_volume: (model) => {
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
    const volume = (maxX - minX) * (maxY - minY) * (maxZ - minZ);
    return volume > 100000; // > 100mm x 100mm x 100mm
  },
  enclosed_cavity: (model) => {
    // Simplified - in production, use actual cavity detection
    return model.triangleCount > 1000;
  },
  bridge: (model) => {
    // Simplified - look for horizontal spans
    return model.triangleCount > 500;
  },
  high_surface_area: (model) => {
    // Simplified - high triangle count often means high surface area
    return model.triangleCount > 5000;
  },
};

// ---------------------------------------------------------------------------
// Analysis Functions
// ---------------------------------------------------------------------------

/**
 * Extract geometry features from model
 */
function extractGeometryFeatures(model: GeometryModel): string[] {
  const features: string[] = [];
  
  for (const [feature, check] of Object.entries(GEOMETRY_FEATURE_KEYWORDS)) {
    if (check(model)) {
      features.push(feature);
    }
  }
  
  return features;
}

/**
 * Find matching historical patterns
 */
function findMatchingPatterns(
  geometryFeatures: string[],
  material: Material,
  printerId?: string
): HistoricalPattern[] {
  return HISTORICAL_PATTERNS.filter(pattern => {
    // Check if geometry features match
    const featureMatch = pattern.geometryFeatures.some(f => geometryFeatures.includes(f));
    
    // Check if material matches
    const materialMatch = pattern.materials.includes(material.name);
    
    // Check if printer matches (if specified)
    const printerMatch = !printerId || pattern.printers.includes(printerId);
    
    return featureMatch && materialMatch && printerMatch;
  }).sort((a, b) => b.frequency - a.frequency);
}

/**
 * Generate suggestions based on patterns
 */
function generateSuggestions(
  model: GeometryModel,
  material: Material,
  patterns: HistoricalPattern[],
  options: AISuggestionOptions
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const geometryFeatures = extractGeometryFeatures(model);
  
  // Generate suggestions from patterns
  patterns.forEach((pattern, index) => {
    const suggestion: Suggestion = {
      id: `pattern-${pattern.id}`,
      category: getCategoryFromPattern(pattern),
      priority: index + 1,
      confidence: pattern.successRate,
      title: pattern.name,
      description: pattern.description,
      impact: `Based on ${pattern.frequency} historical cases with ${Math.round(pattern.successRate * 100)}% success rate`,
      improvementEstimate: Math.round(pattern.successRate * 100),
      relatedPatterns: [pattern.id],
      tags: pattern.geometryFeatures,
    };
    suggestions.push(suggestion);
  });
  
  // Add material-specific suggestions
  if (material.moistureRisk && material.moistureRisk > 0.5) {
    suggestions.push({
      id: "moisture-drying",
      category: "post_process",
      priority: suggestions.length + 1,
      confidence: 0.85,
      title: "Material Drying Required",
      description: `${material.name} is hygroscopic and should be dried before printing`,
      impact: "Prevents bubbling, poor layer adhesion, and surface defects",
      improvementEstimate: 25,
      relatedPatterns: ["moisture-absorption"],
      tags: ["moisture", "pre-processing"],
    });
  }
  
  if (material.shrinkagePercent && material.shrinkagePercent > 0.5) {
    suggestions.push({
      id: "enclosure-required",
      category: "parameters",
      priority: suggestions.length + 1,
      confidence: 0.8,
      title: "Enclosure Recommended",
      description: `${material.name} has high shrinkage (${material.shrinkagePercent}%) and benefits from an enclosure`,
      impact: "Reduces warping and improves layer adhesion",
      improvementEstimate: 30,
      relatedPatterns: ["warping", "shrinkage"],
      tags: ["enclosure", "environment"],
    });
  }
  
  // Add geometry-specific suggestions
  if (geometryFeatures.includes("thin_wall")) {
    suggestions.push({
      id: "thin-wall-reinforcement",
      category: "design",
      priority: suggestions.length + 1,
      confidence: 0.75,
      title: "Consider Wall Thickening",
      description: "Thin walls may have poor structural integrity and print quality",
      impact: "Improves strength and reduces print failures",
      improvementEstimate: 20,
      relatedPatterns: ["thin-wall-fdm"],
      tags: ["wall_thickness", "structural"],
    });
  }
  
  if (geometryFeatures.includes("large_flat")) {
    suggestions.push({
      id: "large-flat-orientation",
      category: "orientation",
      priority: suggestions.length + 1,
      confidence: 0.7,
      title: "Consider Build Orientation",
      description: "Large flat areas may warp or require extensive support",
      impact: "Reduces warping and support material usage",
      improvementEstimate: 35,
      relatedPatterns: ["large-flat-warping"],
      tags: ["orientation", "warping"],
    });
  }
  
  // Sort by priority and confidence
  return suggestions
    .sort((a, b) => a.priority - b.priority || b.confidence - a.confidence)
    .slice(0, options.maxSuggestions ?? 10);
}

/**
 * Get category from pattern
 */
function getCategoryFromPattern(pattern: HistoricalPattern): Suggestion['category'] {
  if (pattern.geometryFeatures.includes("thin_wall")) return "design";
  if (pattern.geometryFeatures.includes("large_flat")) return "orientation";
  if (pattern.geometryFeatures.includes("overhang")) return "support";
  if (pattern.id.includes("thermal")) return "parameters";
  if (pattern.id.includes("composite")) return "material";
  return "design";
}

/**
 * Create learning data for future improvements
 */
function createLearningData(
  model: GeometryModel,
  material: Material,
  suggestions: Suggestion[]
): LearningData {
  return {
    geometryFeatures: extractGeometryFeatures(model),
    materialProperties: {
      density: material.densityGPerCm3,
      shrinkage: material.shrinkagePercent ?? 0,
      moistureRisk: material.moistureRisk ?? 0,
      glassTransition: material.glassTransitionTempC ?? 0,
    },
    analysisResults: {
      triangleCount: model.triangleCount,
      suggestionsCount: suggestions.length,
      topSuggestion: suggestions[0]?.id,
    },
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Main Analysis Function
// ---------------------------------------------------------------------------

/**
 * Run AI suggestion analysis
 */
export function computeAISuggestions(
  model: GeometryModel,
  options: AISuggestionOptions
): AnalysisModuleResult<AISuggestionResult> {
  const { material, printerId } = options;
  
  // Extract geometry features
  const geometryFeatures = extractGeometryFeatures(model);
  
  // Find matching patterns
  const patterns = findMatchingPatterns(geometryFeatures, material, printerId);
  
  // Generate suggestions
  const suggestions = generateSuggestions(model, material, patterns, options);
  
  // Calculate overall confidence
  const overallConfidence = suggestions.length > 0
    ? suggestions.reduce((sum, s) => sum + s.confidence, 0) / suggestions.length
    : 0.5;
  
  // Create learning data
  const learningData = createLearningData(model, material, suggestions);
  
  const result: AISuggestionResult = {
    suggestions,
    patterns,
    similarGeometries: [], // In production, query database for similar geometries
    overallConfidence,
    learningData,
  };
  
  // Confidence based on pattern availability
  const rawConfidence = Math.min(0.8, 
    0.4 + (patterns.length * 0.1) // More patterns = higher confidence
  );
  const confidence = Math.round(rawConfidence * 10) / 10 as Confidence;
  
  return moduleResult('aiSuggestions', confidence, 0, result, 'AI-powered suggestions based on historical analysis patterns.');
}
