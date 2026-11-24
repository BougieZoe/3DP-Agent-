/**
 * Recommendation Aggregator
 *
 * Aggregates recommendations from all analysis modules and findings.
 * Produces a prioritized list of actionable recommendations.
 */

import { CONTENT, translate, type ContentLang } from '@shared/i18n/content';
import type {
  UnifiedAnalysis,
  Finding,
  Recommendation,
  RecommendationPriority,
  RecommendationCategory,
  EffortLevel,
} from './types';

/**
 * Aggregate all recommendations from findings and analysis modules.
 */
export function aggregateRecommendations(
  findings: Finding[],
  analysis: UnifiedAnalysis,
  lang: ContentLang = 'en',
): Recommendation[] {
  const recommendations: Recommendation[] = [];

  // Generate recommendations from findings
  recommendations.push(...generateFindingsRecommendations(findings, lang));

  // Generate recommendations from thermal analysis
  recommendations.push(...generateThermalRecommendations(analysis));

  // Generate recommendations from metal analysis
  recommendations.push(...generateMetalRecommendations(analysis));

  // Generate recommendations from AI suggestions
  recommendations.push(...generateAISuggestions(analysis));

  // Deduplicate and sort
  return deduplicateAndSort(recommendations);
}

/**
 * Generate recommendations from critical findings.
 */
function generateFindingsRecommendations(findings: Finding[], lang: ContentLang): Recommendation[] {
  const recommendations: Recommendation[] = [];

  for (const finding of findings) {
    if (finding.severity === 'critical') {
      const rec = findingToRecommendation(finding, lang);
      if (rec) recommendations.push(rec);
    }
  }

  return recommendations;
}

/**
 * Convert a finding to a recommendation.
 */
function findingToRecommendation(finding: Finding, lang: ContentLang): Recommendation | null {
  const categoryMap: Record<string, RecommendationCategory> = {
    geometry: 'design',
    printability: 'process',
    failure: 'design',
    thermal: 'process',
    cost: 'material',
    environmental: 'material',
  };

  const effortMap: Record<string, EffortLevel> = {
    'geo-001': 'moderate', // watertight
    'geo-002': 'easy',     // flipped normals
    'geo-003': 'easy',     // degenerate faces
    'geo-004': 'moderate', // non-manifold
    'geo-005': 'moderate', // thin walls
    'print-001': 'difficult', // bed fit
    'print-002': 'moderate',  // support
    'fail-001': 'moderate',   // warping
    'fail-002': 'difficult',  // metal risk
    'thermal-001': 'easy',    // thermal gradient
  };

  // Expected impact: per-finding copy when the catalogue has it, generic otherwise.
  const impactKey = `rec.impact.${finding.id}`;
  const impactText = translate(
    CONTENT,
    CONTENT[impactKey] ? impactKey : 'rec.impact.default',
    lang,
  );

  return {
    id: `rec-${finding.id}`,
    priority: finding.severity === 'critical' ? 'high' : 'medium',
    category: categoryMap[finding.category] ?? 'design',
    title: translate(CONTENT, 'rec.fixPrefix', lang, { title: finding.title }),
    description: finding.description,
    expectedImpact: impactText,
    effort: effortMap[finding.id] ?? 'moderate',
    relatedFindings: [finding.id],
  };
}

/**
 * Generate recommendations from thermal analysis.
 */
function generateThermalRecommendations(analysis: UnifiedAnalysis): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const thermal = analysis.thermal?.result;

  if (!thermal) return recommendations;

  // Add thermal recommendations
  for (const rec of thermal.recommendations) {
    const priority: RecommendationPriority = rec.severity === 'critical' ? 'high' : rec.severity === 'warning' ? 'medium' : 'low';
    recommendations.push({
      id: `rec-thermal-${rec.category}`,
      priority,
      category: 'process',
      title: rec.message,
      description: rec.message,
      expectedImpact: rec.impactEstimate ?? 'Reduce thermal stress',
      effort: 'easy',
      relatedFindings: [],
    });
  }

  return recommendations;
}

/**
 * Generate recommendations from metal analysis.
 */
function generateMetalRecommendations(analysis: UnifiedAnalysis): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const metal = analysis.metal?.result;

  if (!metal) return recommendations;

  // Add metal recommendations
  for (const rec of metal.recommendations) {
    const priority: RecommendationPriority = rec.severity === 'critical' ? 'high' : rec.severity === 'warning' ? 'medium' : 'low';
    recommendations.push({
      id: `rec-metal-${rec.category}`,
      priority,
      category: 'process',
      title: rec.message,
      description: rec.message,
      expectedImpact: rec.impactEstimate ?? 'Reduce metal printing risk',
      effort: 'moderate',
      relatedFindings: [],
    });
  }

  return recommendations;
}

/**
 * Generate recommendations from AI suggestions.
 */
function generateAISuggestions(analysis: UnifiedAnalysis): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const aiSuggestions = analysis.aiSuggestions?.result;

  if (!aiSuggestions) return recommendations;

  // Convert AI suggestions to recommendations
  for (const suggestion of aiSuggestions.suggestions) {
    const priority: RecommendationPriority = suggestion.priority <= 1 ? 'high' : suggestion.priority <= 2 ? 'medium' : 'low';
    const effortMap: Record<string, EffortLevel> = {
      material: 'easy',
      orientation: 'easy',
      support: 'moderate',
      parameters: 'easy',
      design: 'difficult',
      post_process: 'moderate',
    };
    recommendations.push({
      id: `rec-ai-${suggestion.id}`,
      priority,
      category: suggestion.category as RecommendationCategory,
      title: suggestion.title,
      description: suggestion.description,
      expectedImpact: suggestion.impact,
      effort: effortMap[suggestion.category] ?? 'moderate',
      relatedFindings: [],
    });
  }

  return recommendations;
}

/**
 * Deduplicate recommendations and sort by priority.
 */
function deduplicateAndSort(recommendations: Recommendation[]): Recommendation[] {
  // Deduplicate by title
  const seen = new Set<string>();
  const unique: Recommendation[] = [];

  for (const rec of recommendations) {
    if (!seen.has(rec.title)) {
      seen.add(rec.title);
      unique.push(rec);
    }
  }

  // Sort by priority
  const priorityOrder: Record<RecommendationPriority, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };

  return unique.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}
