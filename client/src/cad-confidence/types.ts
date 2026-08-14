export type Verdict = 'PASS' | 'WARN' | 'FAIL';
export type GenerationQuality = 'SUCCESS' | 'FALLBACK' | 'FAILED';
export type IssueSeverity = 'error' | 'warning' | 'info';
export type RepairCategory = 'geometry' | 'orientation' | 'support' | 'wall_thickness' | 'overhang' | 'scale';
export type Impact = 'high' | 'medium' | 'low';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Issue {
  severity: IssueSeverity;
  message: string;
  suggestion?: string;
}

export interface PromptMeta {
  prompt: string;
  targetDimensions?: { x?: number; y?: number; z?: number };
}

export interface ConfidenceCategory {
  id: string;
  label: string;
  score: number;
  weight: number;
  issues: string[];
}

export interface SemanticCheckResult {
  check: string;
  passed: boolean;
  detail: string;
  severity: IssueSeverity;
}

export interface RepairSuggestion {
  action: string;
  description: string;
  impact: Impact;
  category: RepairCategory;
}

export interface ConfidenceExplanation {
  failureProbability: number;
  topRisks: { reason: string; impact: Impact; category: string }[];
  recommendedAction: string;
}

export interface DesignIntent {
  objectType: string;
  dimensions: { x?: number; y?: number; z?: number };
  material?: string;
  process?: string;
  requirements: string[];
}

export interface IntentMatchResult {
  score: number;
  matches: { aspect: string; passed: boolean; detail: string }[];
}

export interface RepairAction {
  id: string;
  type: string;
  description: string;
  params: Record<string, unknown>;
}

export interface RepairProposal {
  id: string;
  actions: RepairAction[];
  expectedImprovement: number;
  impact: Impact;
}

export interface RegenerationRequest {
  originalPrompt: string;
  repairProposalId: string;
  modifications: string;
}

export interface RiskAssessment {
  score: number;
  level: RiskLevel;
  reasons: string[];
}

export interface CADRunRecord {
  id: string;
  prompt: string;
  timestamp: string;
  confidence: number;
  verdict: Verdict;
  issues: { severity: IssueSeverity; message: string }[];
  risks?: {
    structural: RiskAssessment;
    print: RiskAssessment;
    manufacturing: RiskAssessment;
  };
  improvement?: ImprovementResult;
}

export interface ImprovementResult {
  before: {
    confidence: number;
    verdict: Verdict;
    issues: number;
  };
  after: {
    confidence: number;
    verdict: Verdict;
    issues: number;
  };
  action: string;
  changed: boolean;
  message: string;
}

export interface CADConfidenceReport {
  overallScore: number;
  verdict: Verdict;
  categories: ConfidenceCategory[];
  semanticChecks: SemanticCheckResult[];
  repairSuggestions: RepairSuggestion[];
  timestamp: string;
  generationQuality: GenerationQuality;
  explanation?: ConfidenceExplanation;
  designIntent?: DesignIntent;
  intentMatch?: IntentMatchResult;
  risks?: {
    structural: RiskAssessment;
    print: RiskAssessment;
    manufacturing: RiskAssessment;
  };
}
