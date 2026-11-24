/**
 * Finding Extractor
 *
 * Extracts structured findings from UnifiedAnalysis module results.
 * Each finding represents a specific issue or observation with evidence.
 */

import type {
  UnifiedAnalysis,
  Finding,
  FindingSeverity,
  FindingCategory,
  Evidence,
  Confidence,
} from './types';
import { CONTENT, translate, type ContentLang } from '@shared/i18n/content';

/**
 * Extract all findings from a UnifiedAnalysis.
 */
export function extractFindings(
  analysis: UnifiedAnalysis,
  language: ContentLang = 'en',
): Finding[] {
  const findings: Finding[] = [];

  // Geometry findings
  extractGeometryFindings(analysis, findings, language);

  // Printability findings
  extractPrintabilityFindings(analysis, findings, language);

  // Failure risk findings
  extractFailureFindings(analysis, findings, language);

  // Thermal findings
  extractThermalFindings(analysis, findings, language);

  // Cost findings
  extractCostFindings(analysis, findings, language);

  return findings;
}

/**
 * Extract geometry-related findings.
 */
function extractGeometryFindings(
  analysis: UnifiedAnalysis,
  findings: Finding[],
  language: ContentLang,
): void {
  const validation = analysis.validation?.result;
  const topology = analysis.topology?.result;
  const metrics = analysis.metrics?.result;

  if (!validation) return;

  // Watertight check
  if (!validation.isWatertight) {
    findings.push({
      id: 'geo-001',
      category: 'geometry',
      severity: 'critical',
      title: translate(CONTENT, 'finding.geo001.title', language),
      description: translate(CONTENT, 'finding.geo001.desc', language, { count: validation.holeCount }),
      evidence: [
        {
          type: 'metric',
          label: translate(CONTENT, 'finding.geo001.evHoles', language),
          value: validation.holeCount,
          unit: '',
          status: 'fail',
        },
        {
          type: 'metric',
          label: translate(CONTENT, 'finding.geo001.evBoundary', language),
          value: validation.boundaryEdgeCount,
          unit: '',
          status: 'fail',
        },
      ],
      impact: translate(CONTENT, 'finding.geo001.impact', language),
      moduleSource: 'validation',
      confidence: analysis.validation?.confidence ?? 0,
    });
  }

  // Flipped normals
  if (validation.flippedNormalFaceCount > 0) {
    const severity: FindingSeverity = validation.flippedNormalRatio > 0.1 ? 'critical' : 'warning';
    findings.push({
      id: 'geo-002',
      category: 'geometry',
      severity,
      title: translate(CONTENT, 'finding.geo002.title', language),
      description: translate(CONTENT, 'finding.geo002.desc', language, { count: validation.flippedNormalFaceCount, pct: (validation.flippedNormalRatio * 100).toFixed(1) }),
      evidence: [
        {
          type: 'metric',
          label: translate(CONTENT, 'finding.geo002.evFlipped', language),
          value: validation.flippedNormalFaceCount,
          unit: '',
          status: severity === 'critical' ? 'fail' : 'warning',
        },
        {
          type: 'metric',
          label: translate(CONTENT, 'finding.geo002.evRatio', language),
          value: (validation.flippedNormalRatio * 100).toFixed(1),
          unit: '%',
          threshold: 10,
          status: severity === 'critical' ? 'fail' : 'warning',
        },
      ],
      impact: translate(CONTENT, 'finding.geo002.impact', language),
      moduleSource: 'validation',
      confidence: analysis.validation?.confidence ?? 0,
    });
  }

  // Degenerate faces
  if (validation.degenerateFaceCount > 0) {
    findings.push({
      id: 'geo-003',
      category: 'geometry',
      severity: 'warning',
      title: translate(CONTENT, 'finding.geo003.title', language),
      description: translate(CONTENT, 'finding.geo003.desc', language, { count: validation.degenerateFaceCount }),
      evidence: [
        {
          type: 'metric',
          label: translate(CONTENT, 'finding.geo003.evDegenerate', language),
          value: validation.degenerateFaceCount,
          unit: '',
          status: 'warning',
        },
      ],
      impact: translate(CONTENT, 'finding.geo003.impact', language),
      moduleSource: 'validation',
      confidence: analysis.validation?.confidence ?? 0,
    });
  }

  // Non-manifold edges
  if (topology && topology.nonManifoldEdgeCount > 0) {
    findings.push({
      id: 'geo-004',
      category: 'geometry',
      severity: 'warning',
      title: translate(CONTENT, 'finding.geo004.title', language),
      description: translate(CONTENT, 'finding.geo004.desc', language, { count: topology.nonManifoldEdgeCount }),
      evidence: [
        {
          type: 'metric',
          label: translate(CONTENT, 'finding.geo004.evNonManifold', language),
          value: topology.nonManifoldEdgeCount,
          unit: '',
          status: 'warning',
        },
      ],
      impact: translate(CONTENT, 'finding.geo004.impact', language),
      moduleSource: 'topology',
      confidence: analysis.topology?.confidence ?? 0,
    });
  }

  // Thin walls
  if (metrics && metrics.minWallThicknessMm !== null) {
    const THIN_WALL_THRESHOLD = 0.8;
    if (metrics.minWallThicknessMm < THIN_WALL_THRESHOLD) {
      const severity: FindingSeverity = metrics.minWallThicknessMm < 0.4 ? 'critical' : 'warning';
      findings.push({
        id: 'geo-005',
        category: 'geometry',
        severity,
        title: translate(CONTENT, 'finding.geo005.title', language),
        description: translate(CONTENT, 'finding.geo005.desc', language, { wall: metrics.minWallThicknessMm.toFixed(2), threshold: THIN_WALL_THRESHOLD }),
        evidence: [
          {
            type: 'threshold',
            label: translate(CONTENT, 'finding.geo005.evMinWall', language),
            value: metrics.minWallThicknessMm,
            unit: 'mm',
            threshold: THIN_WALL_THRESHOLD,
            status: severity === 'critical' ? 'fail' : 'warning',
          },
          {
            type: 'metric',
            label: translate(CONTENT, 'finding.geo005.evAvgWall', language),
            value: metrics.avgWallThicknessMm?.toFixed(2) ?? 'N/A',
            unit: 'mm',
            status: 'pass',
          },
        ],
        impact: translate(CONTENT, 'finding.geo005.impact', language),
        moduleSource: 'metrics',
        confidence: analysis.metrics?.confidence ?? 0,
      });
    }
  }
}

/**
 * Extract printability-related findings.
 */
function extractPrintabilityFindings(
  analysis: UnifiedAnalysis,
  findings: Finding[],
  language: ContentLang,
): void {
  const bedFit = analysis.bedFit?.result;
  const support = analysis.support?.result;

  // Bed fit check
  if (bedFit && !bedFit.fits) {
    findings.push({
      id: 'print-001',
      category: 'printability',
      severity: 'critical',
      title: translate(CONTENT, 'finding.print001.title', language),
      description: translate(CONTENT, 'finding.print001.desc', language, { x: bedFit.modelDimensionsMm.x.toFixed(1), y: bedFit.modelDimensionsMm.y.toFixed(1), z: bedFit.modelDimensionsMm.z.toFixed(1), printer: bedFit.printerProfile.name }),
      evidence: [
        {
          type: 'metric',
          label: translate(CONTENT, 'finding.print001.evModelWidth', language),
          value: bedFit.modelDimensionsMm.x,
          unit: 'mm',
          status: 'fail',
        },
        {
          type: 'metric',
          label: translate(CONTENT, 'finding.print001.evBedWidth', language),
          value: bedFit.printerProfile.widthMm,
          unit: 'mm',
          status: 'pass',
        },
      ],
      impact: translate(CONTENT, 'finding.print001.impact', language),
      moduleSource: 'bedFit',
      confidence: analysis.bedFit?.confidence ?? 0,
    });
  }

  // Support difficulty
  if (support) {
    if (support.difficulty === 'very_difficult' || support.difficulty === 'difficult') {
      findings.push({
        id: 'print-002',
        category: 'printability',
        severity: 'warning',
        title: translate(CONTENT, 'finding.print002.title', language),
        description: translate(CONTENT, 'finding.print002.desc', language, { difficulty: support.difficulty, grams: support.estimatedSupportGrams.toFixed(1) }),
        evidence: [
          {
            type: 'metric',
            label: translate(CONTENT, 'finding.print002.evDifficulty', language),
            value: support.difficulty,
            unit: '',
            status: 'warning',
          },
          {
            type: 'metric',
            label: translate(CONTENT, 'finding.print002.evWeight', language),
            value: support.estimatedSupportGrams,
            unit: 'g',
            status: 'warning',
          },
        ],
        impact: translate(CONTENT, 'finding.print002.impact', language),
        moduleSource: 'support',
        confidence: analysis.support?.confidence ?? 0,
      });
    }
  }
}

/**
 * Extract failure risk findings.
 */
function extractFailureFindings(
  analysis: UnifiedAnalysis,
  findings: Finding[],
  language: ContentLang,
): void {
  const thermal = analysis.thermal?.result;
  const metal = analysis.metal?.result;

  // Thermal warping risk
  if (thermal) {
    if (thermal.warpingRiskScore > 0.7) {
      findings.push({
        id: 'fail-001',
        category: 'failure',
        severity: 'critical',
        title: translate(CONTENT, 'finding.fail001.title', language),
        description: translate(CONTENT, 'finding.fail001.desc', language, { score: (thermal.warpingRiskScore * 100).toFixed(0), count: thermal.warpingHotspots.length }),
        evidence: [
          {
            type: 'threshold',
            label: translate(CONTENT, 'finding.fail001.evRisk', language),
            value: (thermal.warpingRiskScore * 100).toFixed(0),
            unit: '%',
            threshold: 70,
            status: 'fail',
          },
          {
            type: 'metric',
            label: translate(CONTENT, 'finding.fail001.evHotspots', language),
            value: thermal.warpingHotspots.length,
            unit: '',
            status: 'warning',
          },
        ],
        impact: translate(CONTENT, 'finding.fail001.impact', language),
        moduleSource: 'thermal',
        confidence: analysis.thermal?.confidence ?? 0,
      });
    }
  }

  // Metal thermal stress
  if (metal) {
    if (metal.overallRiskScore > 0.7) {
      findings.push({
        id: 'fail-002',
        category: 'failure',
        severity: 'critical',
        title: translate(CONTENT, 'finding.fail002.title', language),
        description: translate(CONTENT, 'finding.fail002.desc', language, { score: (metal.overallRiskScore * 100).toFixed(0) }),
        evidence: [
          {
            type: 'threshold',
            label: translate(CONTENT, 'finding.fail002.evRisk', language),
            value: (metal.overallRiskScore * 100).toFixed(0),
            unit: '%',
            threshold: 70,
            status: 'fail',
          },
        ],
        impact: translate(CONTENT, 'finding.fail002.impact', language),
        moduleSource: 'metal',
        confidence: analysis.metal?.confidence ?? 0,
      });
    }
  }
}

/**
 * Extract thermal-related findings.
 */
function extractThermalFindings(
  analysis: UnifiedAnalysis,
  findings: Finding[],
  language: ContentLang,
): void {
  const thermal = analysis.thermal?.result;
  if (!thermal) return;

  // High thermal gradient
  if (thermal.maxThermalGradientCPerMm > 10) {
    findings.push({
      id: 'thermal-001',
      category: 'thermal',
      severity: 'warning',
      title: translate(CONTENT, 'finding.thermal001.title', language),
      description: translate(CONTENT, 'finding.thermal001.desc', language, { gradient: thermal.maxThermalGradientCPerMm.toFixed(1) }),
      evidence: [
        {
          type: 'threshold',
          label: translate(CONTENT, 'finding.thermal001.evGradient', language),
          value: thermal.maxThermalGradientCPerMm,
          unit: '°C/mm',
          threshold: 10,
          status: 'warning',
        },
      ],
      impact: translate(CONTENT, 'finding.thermal001.impact', language),
      moduleSource: 'thermal',
      confidence: analysis.thermal?.confidence ?? 0,
    });
  }
}

/**
 * Extract cost-related findings.
 */
function extractCostFindings(
  analysis: UnifiedAnalysis,
  findings: Finding[],
  language: ContentLang,
): void {
  const printTime = analysis.printTime?.result;
  if (!printTime) return;

  // High cost
  if (printTime.totalCostUsd > 50) {
    findings.push({
      id: 'cost-001',
      category: 'cost',
      severity: 'info',
      title: translate(CONTENT, 'finding.cost001.title', language),
      description: translate(CONTENT, 'finding.cost001.desc', language, { cost: printTime.totalCostUsd.toFixed(2) }),
      evidence: [
        {
          type: 'metric',
          label: translate(CONTENT, 'finding.cost001.evMaterial', language),
          value: printTime.materialCostUsd,
          unit: '$',
          status: 'pass',
        },
        {
          type: 'metric',
          label: translate(CONTENT, 'finding.cost001.evTime', language),
          value: printTime.estimatedPrintTimeHours.toFixed(1),
          unit: translate(CONTENT, 'unit.hours', language),
          status: 'pass',
        },
      ],
      impact: translate(CONTENT, 'finding.cost001.impact', language),
      moduleSource: 'printTime',
      confidence: analysis.printTime?.confidence ?? 0,
    });
  }
}
