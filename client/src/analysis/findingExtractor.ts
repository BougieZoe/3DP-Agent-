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

/**
 * Extract all findings from a UnifiedAnalysis.
 */
export function extractFindings(analysis: UnifiedAnalysis): Finding[] {
  const findings: Finding[] = [];

  // Geometry findings
  extractGeometryFindings(analysis, findings);

  // Printability findings
  extractPrintabilityFindings(analysis, findings);

  // Failure risk findings
  extractFailureFindings(analysis, findings);

  // Thermal findings
  extractThermalFindings(analysis, findings);

  // Cost findings
  extractCostFindings(analysis, findings);

  return findings;
}

/**
 * Extract geometry-related findings.
 */
function extractGeometryFindings(analysis: UnifiedAnalysis, findings: Finding[]): void {
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
      title: '模型不防水',
      description: `发现 ${validation.holeCount} 个孔洞，模型无法正常打印`,
      evidence: [
        {
          type: 'metric',
          label: '孔洞数量',
          value: validation.holeCount,
          unit: '',
          status: 'fail',
        },
        {
          type: 'metric',
          label: '边界边数量',
          value: validation.boundaryEdgeCount,
          unit: '',
          status: 'fail',
        },
      ],
      impact: '打印会失败，需要修复孔洞',
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
      title: '法线方向错误',
      description: `${validation.flippedNormalFaceCount} 个面的法线方向朝内（${(validation.flippedNormalRatio * 100).toFixed(1)}%）`,
      evidence: [
        {
          type: 'metric',
          label: '错误法线面数',
          value: validation.flippedNormalFaceCount,
          unit: '',
          status: severity === 'critical' ? 'fail' : 'warning',
        },
        {
          type: 'metric',
          label: '错误比例',
          value: (validation.flippedNormalRatio * 100).toFixed(1),
          unit: '%',
          threshold: 10,
          status: severity === 'critical' ? 'fail' : 'warning',
        },
      ],
      impact: '可能导致打印方向错误或表面缺陷',
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
      title: '退化面',
      description: `发现 ${validation.degenerateFaceCount} 个退化面（面积接近零）`,
      evidence: [
        {
          type: 'metric',
          label: '退化面数量',
          value: validation.degenerateFaceCount,
          unit: '',
          status: 'warning',
        },
      ],
      impact: '可能影响打印质量和模型完整性',
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
      title: '非流形边',
      description: `发现 ${topology.nonManifoldEdgeCount} 条非流形边`,
      evidence: [
        {
          type: 'metric',
          label: '非流形边数量',
          value: topology.nonManifoldEdgeCount,
          unit: '',
          status: 'warning',
        },
      ],
      impact: '可能导致切片错误或打印失败',
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
        title: '壁厚过薄',
        description: `最小壁厚 ${metrics.minWallThicknessMm.toFixed(2)}mm 低于推荐值 ${THIN_WALL_THRESHOLD}mm`,
        evidence: [
          {
            type: 'threshold',
            label: '最小壁厚',
            value: metrics.minWallThicknessMm,
            unit: 'mm',
            threshold: THIN_WALL_THRESHOLD,
            status: severity === 'critical' ? 'fail' : 'warning',
          },
          {
            type: 'metric',
            label: '平均壁厚',
            value: metrics.avgWallThicknessMm?.toFixed(2) ?? 'N/A',
            unit: 'mm',
            status: 'pass',
          },
        ],
        impact: '可能导致打印失败或强度不足',
        moduleSource: 'metrics',
        confidence: analysis.metrics?.confidence ?? 0,
      });
    }
  }
}

/**
 * Extract printability-related findings.
 */
function extractPrintabilityFindings(analysis: UnifiedAnalysis, findings: Finding[]): void {
  const bedFit = analysis.bedFit?.result;
  const support = analysis.support?.result;

  // Bed fit check
  if (bedFit && !bedFit.fits) {
    findings.push({
      id: 'print-001',
      category: 'printability',
      severity: 'critical',
      title: '模型超出打印床',
      description: `模型尺寸 ${bedFit.modelDimensionsMm.x.toFixed(1)} × ${bedFit.modelDimensionsMm.y.toFixed(1)} × ${bedFit.modelDimensionsMm.z.toFixed(1)}mm 超出 ${bedFit.printerProfile.name} 的打印床`,
      evidence: [
        {
          type: 'metric',
          label: '模型宽度',
          value: bedFit.modelDimensionsMm.x,
          unit: 'mm',
          status: 'fail',
        },
        {
          type: 'metric',
          label: '打印床宽度',
          value: bedFit.printerProfile.widthMm,
          unit: 'mm',
          status: 'pass',
        },
      ],
      impact: '无法在选定打印机上打印',
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
        title: '支撑结构复杂',
        description: `支撑难度：${support.difficulty}，预计需要 ${support.estimatedSupportGrams.toFixed(1)}g 支撑材料`,
        evidence: [
          {
            type: 'metric',
            label: '支撑难度',
            value: support.difficulty,
            unit: '',
            status: 'warning',
          },
          {
            type: 'metric',
            label: '支撑材料重量',
            value: support.estimatedSupportGrams,
            unit: 'g',
            status: 'warning',
          },
        ],
        impact: '增加打印时间和后处理工作量',
        moduleSource: 'support',
        confidence: analysis.support?.confidence ?? 0,
      });
    }
  }
}

/**
 * Extract failure risk findings.
 */
function extractFailureFindings(analysis: UnifiedAnalysis, findings: Finding[]): void {
  const thermal = analysis.thermal?.result;
  const metal = analysis.metal?.result;

  // Thermal warping risk
  if (thermal) {
    if (thermal.warpingRiskScore > 0.7) {
      findings.push({
        id: 'fail-001',
        category: 'failure',
        severity: 'critical',
        title: '翘曲风险高',
        description: `翘曲风险评分 ${(thermal.warpingRiskScore * 100).toFixed(0)}%，存在 ${thermal.warpingHotspots.length} 个热点`,
        evidence: [
          {
            type: 'threshold',
            label: '翘曲风险',
            value: (thermal.warpingRiskScore * 100).toFixed(0),
            unit: '%',
            threshold: 70,
            status: 'fail',
          },
          {
            type: 'metric',
            label: '热点数量',
            value: thermal.warpingHotspots.length,
            unit: '',
            status: 'warning',
          },
        ],
        impact: '打印件可能翘曲变形',
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
        title: '金属打印风险高',
        description: `金属打印整体风险评分 ${(metal.overallRiskScore * 100).toFixed(0)}%`,
        evidence: [
          {
            type: 'threshold',
            label: '整体风险',
            value: (metal.overallRiskScore * 100).toFixed(0),
            unit: '%',
            threshold: 70,
            status: 'fail',
          },
        ],
        impact: '可能导致打印失败或零件失效',
        moduleSource: 'metal',
        confidence: analysis.metal?.confidence ?? 0,
      });
    }
  }
}

/**
 * Extract thermal-related findings.
 */
function extractThermalFindings(analysis: UnifiedAnalysis, findings: Finding[]): void {
  const thermal = analysis.thermal?.result;
  if (!thermal) return;

  // High thermal gradient
  if (thermal.maxThermalGradientCPerMm > 10) {
    findings.push({
      id: 'thermal-001',
      category: 'thermal',
      severity: 'warning',
      title: '温度梯度大',
      description: `最大温度梯度 ${thermal.maxThermalGradientCPerMm.toFixed(1)}°C/mm`,
      evidence: [
        {
          type: 'threshold',
          label: '温度梯度',
          value: thermal.maxThermalGradientCPerMm,
          unit: '°C/mm',
          threshold: 10,
          status: 'warning',
        },
      ],
      impact: '可能导致热应力和翘曲',
      moduleSource: 'thermal',
      confidence: analysis.thermal?.confidence ?? 0,
    });
  }
}

/**
 * Extract cost-related findings.
 */
function extractCostFindings(analysis: UnifiedAnalysis, findings: Finding[]): void {
  const printTime = analysis.printTime?.result;
  if (!printTime) return;

  // High cost
  if (printTime.totalCostUsd > 50) {
    findings.push({
      id: 'cost-001',
      category: 'cost',
      severity: 'info',
      title: '打印成本较高',
      description: `预计总成本 $${printTime.totalCostUsd.toFixed(2)}`,
      evidence: [
        {
          type: 'metric',
          label: '材料成本',
          value: printTime.materialCostUsd,
          unit: '$',
          status: 'pass',
        },
        {
          type: 'metric',
          label: '打印时间',
          value: printTime.estimatedPrintTimeHours.toFixed(1),
          unit: '小时',
          status: 'pass',
        },
      ],
      impact: '考虑优化设计以降低成本',
      moduleSource: 'printTime',
      confidence: analysis.printTime?.confidence ?? 0,
    });
  }
}
