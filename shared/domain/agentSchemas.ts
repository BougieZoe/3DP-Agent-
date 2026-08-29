import { z } from 'zod/v4';

// ── Shared primitives ──

export const Vector3ValueSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

export const AgentIdSchema = z.enum([
  'geometry_analyst',
  'printability_scorer',
  'failure_predictor',
  'optimization_advisor',
]);

export const AgentVerdictSchema = z.enum(['pass', 'warning', 'fail', 'inconclusive']);

export const RiskMarkerSchema = z.object({
  position: Vector3ValueSchema,
  type: z.enum([
    'thin_wall',
    'overhang',
    'bridge',
    'sharp_edge',
    'delamination',
    'support_needed',
    'stress_concentration',
  ]),
  severity: z.number(),
  description: z.string(),
});

// ── Agent 1: GeometryAnalyst ──

export const GeometryAnalystDetailsSchema = z.object({
  triangleCount: z.number(),
  surfaceAreaMm2: z.number(),
  boundingBoxVolumeMm3: z.number(),
  dimensions: z.object({ x: z.number(), y: z.number(), z: z.number() }),
  wallThickness: z.object({
    minEstimated: z.number().nullable(),
    status: z.string(),
  }),
  overhang: z.object({
    faceCount: z.number(),
    totalFaces: z.number(),
    ratio: z.number(),
    status: z.string(),
  }),
  aspectRatio: z.number(),
  featureDetail: z.enum(['high', 'medium', 'low']),
  isManifold: z.boolean(),
});

// ── Agent 2: PrintabilityScorer ──

export const ScoringBreakdownSchema = z.object({
  wallThicknessScore: z.number(),
  overhangScore: z.number(),
  aspectRatioScore: z.number(),
  volumeScore: z.number(),
  featureDetailScore: z.number(),
  wallThicknessWeight: z.number(),
  overhangWeight: z.number(),
  aspectRatioWeight: z.number(),
  volumeWeight: z.number(),
  featureDetailWeight: z.number(),
  weightedTotal: z.number(),
  category: z.enum(['excellent', 'good', 'fair', 'poor', 'critical']),
});

// ── Agent 3: FailurePredictor ──

export const PredictedRiskSchema = z.object({
  type: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  confidence: z.number(),
  description: z.string(),
  affectedFaces: z.number(),
  recommendation: z.string(),
});

export const FailurePredictorDetailsSchema = z.object({
  risks: z.array(PredictedRiskSchema),
  overallRiskLevel: z.enum(['low', 'medium', 'high', 'critical']),
  riskCount: z.number(),
  criticalRiskCount: z.number(),
  predictedFailureRate: z.number(),
});

// ── Agent 4: OptimizationAdvisor ──

export const OptimizedGeometrySuggestionSchema = z.object({
  type: z.enum([
    'wall_thickening',
    'orientation_change',
    'support_addition',
    'fillet_add',
    'hole_fill',
    'bridging_redesign',
  ]),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  description: z.string(),
  implementation: z.string(),
  expectedImprovement: z.string(),
  difficulty: z.enum(['easy', 'moderate', 'hard']),
});

export const MaterialRecommendationSchema = z.object({
  material: z.string(),
  process: z.string(),
  reason: z.string(),
  confidence: z.number(),
  layerHeight: z.string(),
  infill: z.string(),
  supports: z.string(),
});

export const OptimizationAdvisorDetailsSchema = z.object({
  suggestions: z.array(OptimizedGeometrySuggestionSchema),
  recommendedMaterials: z.array(MaterialRecommendationSchema),
  optimalOrientation: z.string(),
  estimatedImprovement: z.number(),
});

// ── Inferred types (single source of truth) ──

export type Vector3Value = z.infer<typeof Vector3ValueSchema>;
export type AgentId = z.infer<typeof AgentIdSchema>;
export type AgentVerdict = z.infer<typeof AgentVerdictSchema>;
export type RiskMarker = z.infer<typeof RiskMarkerSchema>;

export type GeometryAnalystDetails = z.infer<typeof GeometryAnalystDetailsSchema>;
export type ScoringBreakdown = z.infer<typeof ScoringBreakdownSchema>;
export type PredictedRisk = z.infer<typeof PredictedRiskSchema>;
export type FailurePredictorDetails = z.infer<typeof FailurePredictorDetailsSchema>;
export type OptimizedGeometrySuggestion = z.infer<typeof OptimizedGeometrySuggestionSchema>;
export type MaterialRecommendation = z.infer<typeof MaterialRecommendationSchema>;
export type OptimizationAdvisorDetails = z.infer<typeof OptimizationAdvisorDetailsSchema>;
