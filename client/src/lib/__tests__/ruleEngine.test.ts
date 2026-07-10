import { describe, it, expect } from 'vitest';
import {
  generateQuickReport,
  classifyQuestion,
  answerLocally,
  ModelData,
} from '../ruleEngine';

describe('ruleEngine', () => {
  const baseWall = {
    p1Thickness: null, p5Thickness: null, p10Thickness: null,
    medianThickness: null, avgThickness: null,
    thinWallCount: 0, thinWallPercentage: 0, thinWallRatio: 0,
    averageConfidence: 0, lowConfidenceSampleCount: 0,
  };

  const validModel: ModelData = {
    fileName: 'test.stl',
    wallThickness: { ...baseWall, minThickness: 2.5, areas: 3, status: 'good' },
    overhang: { angle: 45, areas: 0, status: 'good' },
    volume: 50000,
    surfaceArea: 1200,
    dims: { x: 100, y: 50, z: 25 },
  };

  const criticalWallModel: ModelData = {
    fileName: 'thin_wall.stl',
    wallThickness: { ...baseWall, minThickness: 0.5, thinWallCount: 10, thinWallPercentage: 20, thinWallRatio: 0.2, areas: 10, status: 'critical' },
    overhang: { angle: 45, areas: 0, status: 'good' },
    volume: 10000,
    surfaceArea: 500,
    dims: { x: 20, y: 20, z: 25 },
  };

  const warningOverhangModel: ModelData = {
    fileName: 'overhang.stl',
    wallThickness: { ...baseWall, minThickness: 2.0, thinWallCount: 4, thinWallPercentage: 8, thinWallRatio: 0.08, areas: 2, status: 'warning' },
    overhang: { angle: 45, areas: 15, status: 'warning' },
    volume: 80000,
    surfaceArea: 2000,
    dims: { x: 80, y: 40, z: 25 },
  };

  const largeModel: ModelData = {
    fileName: 'large.stl',
    wallThickness: { ...baseWall, minThickness: 3.0, areas: 0, status: 'good' },
    overhang: { angle: 45, areas: 0, status: 'good' },
    volume: 600000,
    surfaceArea: 8000,
    dims: { x: 200, y: 100, z: 30 },
  };

  const smallModel: ModelData = {
    fileName: 'small.stl',
    wallThickness: { ...baseWall, minThickness: 1.5, areas: 1, status: 'warning' },
    overhang: { angle: 45, areas: 0, status: 'good' },
    volume: 10000,
    surfaceArea: 400,
    dims: { x: 20, y: 20, z: 25 },
  };

  describe('generateQuickReport', () => {
    it('should generate report with print-ready verdict for good model', () => {
      const report = generateQuickReport(validModel, 'en');
      expect(report).toContain('VERDICT:');
      expect(report).toContain('Print-ready');
      expect(report).toContain('Dims:');
    });

    it('should include material recommendations based on volume', () => {
      const reportEn = generateQuickReport(validModel, 'en');
      expect(reportEn).toContain('Recommended:');

      const reportZh = generateQuickReport(validModel, 'zh');
      expect(reportZh).toContain('推荐工艺:');

      const reportJa = generateQuickReport(largeModel, 'ja');
      expect(reportJa).toContain('FDM（大型）');
    });

    it('should include issues for critical wall thickness', () => {
      const report = generateQuickReport(criticalWallModel, 'en');
      expect(report).toContain('ISSUES:');
      expect(report).toContain('Widespread thin walls');
    });

    it('should include issues for warning overhang', () => {
      const report = generateQuickReport(warningOverhangModel, 'en');
      expect(report).toContain('ISSUES:');
      expect(report).toContain('support structures required');
    });

    it('should include issues for warning wall thickness', () => {
      const modelWithWarningWall: ModelData = {
        ...validModel,
        wallThickness: { ...validModel.wallThickness, minThickness: 1.5, thinWallCount: 3, thinWallPercentage: 6, thinWallRatio: 0.06, areas: 5, status: 'warning' },
      };
      const report = generateQuickReport(modelWithWarningWall, 'en');
      expect(report).toContain('ISSUES:');
      expect(report).toContain('thin');
    });

    it('should use Chinese translations', () => {
      const report = generateQuickReport(validModel, 'zh');
      expect(report).toContain('可直接打印');
      expect(report).toContain('尺寸:');
    });

    it('should use Japanese translations', () => {
      const report = generateQuickReport(validModel, 'ja');
      expect(report).toContain('印刷可能');
      expect(report).toContain('寸法:');
    });

    it('should calculate correct dimensions', () => {
      const report = generateQuickReport(validModel, 'en');
      expect(report).toContain('100.0 × 50.0 × 25.0 mm');
    });
  });

  describe('classifyQuestion', () => {
    it('should classify printability questions as local', () => {
      expect(classifyQuestion('Can this be printed?').needsAI).toBe(false);
      expect(classifyQuestion('Can I print this model?').needsAI).toBe(false);
      expect(classifyQuestion('Can you print this?').needsAI).toBe(false);
    });

    it('should classify material questions as local', () => {
      expect(classifyQuestion('What material should I use?').needsAI).toBe(false);
      expect(classifyQuestion('Which material is best?').needsAI).toBe(false);
      expect(classifyQuestion('材料推荐').needsAI).toBe(false);
      expect(classifyQuestion('素材は').needsAI).toBe(false);
    });

    it('should classify support questions as local', () => {
      expect(classifyQuestion('Do I need support?').needsAI).toBe(false);
      expect(classifyQuestion('Need support structures?').needsAI).toBe(false);
      expect(classifyQuestion('需要支撑吗').needsAI).toBe(false);
      expect(classifyQuestion('サポート必要').needsAI).toBe(false);
    });

    it('should classify layer/infill questions as local', () => {
      expect(classifyQuestion('What layer height?').needsAI).toBe(false);
      expect(classifyQuestion('What infill?').needsAI).toBe(false);
      expect(classifyQuestion('层高设置').needsAI).toBe(false);
      expect(classifyQuestion('積層ピッチ').needsAI).toBe(false);
    });

    it('should classify time estimation questions as local', () => {
      expect(classifyQuestion('How long to print?').needsAI).toBe(false);
      expect(classifyQuestion('Estimated time?').needsAI).toBe(false);
      expect(classifyQuestion('打印时间').needsAI).toBe(false);
      expect(classifyQuestion('印刷時間').needsAI).toBe(false);
    });

    it('should classify cost questions as local', () => {
      expect(classifyQuestion('How much does it cost?').needsAI).toBe(false);
      expect(classifyQuestion('What is the price?').needsAI).toBe(false);
      expect(classifyQuestion('费用多少').needsAI).toBe(false);
      expect(classifyQuestion('コスト').needsAI).toBe(false);
    });

    it('should classify geometry questions as local', () => {
      expect(classifyQuestion('What are the dimensions?').needsAI).toBe(false);
      expect(classifyQuestion('Wall thickness?').needsAI).toBe(false);
      expect(classifyQuestion('尺寸是多少').needsAI).toBe(false);
      expect(classifyQuestion('壁厚').needsAI).toBe(false);
    });

    it('should classify complex questions as AI', () => {
      expect(classifyQuestion('How can I optimize this design?').needsAI).toBe(true);
      expect(classifyQuestion('What is the best orientation?').needsAI).toBe(true);
      expect(classifyQuestion('Design recommendations?').needsAI).toBe(true);
    });

    it('should return correct categories', () => {
      const printResult = classifyQuestion('Can this be printed?');
      expect(printResult.category).toBe('printability');

      const materialResult = classifyQuestion('What material?');
      expect(materialResult.category).toBe('material');

      const supportResult = classifyQuestion('Need support?');
      expect(supportResult.category).toBe('support');
    });
  });

  describe('answerLocally', () => {
    it('should answer printability questions for good model', () => {
      const answer = answerLocally('printability', validModel, 'en');
      expect(answer).toContain('printable');
    });

    it('should answer printability questions for critical model', () => {
      const answer = answerLocally('printability', criticalWallModel, 'en');
      expect(answer).toContain('Print risk detected');
    });

    it('should recommend FDM for large models', () => {
      const answer = answerLocally('material', largeModel, 'en');
      expect(answer).toContain('FDM');
    });

    it('should recommend SLA for small models', () => {
      const answer = answerLocally('material', smallModel, 'en');
      expect(answer).toContain('SLA');
    });

    it('should answer support questions', () => {
      const answer = answerLocally('support', validModel, 'en');
      expect(answer).toContain('No support needed');

      const answerWithOverhang = answerLocally('support', warningOverhangModel, 'en');
      expect(answerWithOverhang).toContain('Support required');
    });

    it('should answer settings questions', () => {
      const answer = answerLocally('settings', validModel, 'en');
      expect(answer).toContain('Layer');
      expect(answer).toContain('Infill');
    });

    it('should answer time estimation', () => {
      const answer = answerLocally('time', validModel, 'en');
      expect(answer).toContain('Estimated print time');
      expect(answer).toContain('min');
    });

    it('should answer cost estimation', () => {
      const answer = answerLocally('cost', validModel, 'en');
      expect(answer).toContain('Material cost');
      expect(answer).toContain('$');
    });

    it('should answer geometry questions', () => {
      const answer = answerLocally('geometry', validModel, 'en');
      expect(answer).toContain('Dims:');
      expect(answer).toContain('Min wall');
      expect(answer).toContain('2.50');
    });

    it('should return Chinese translations', () => {
      const answer = answerLocally('printability', validModel, 'zh');
      expect(answer).toContain('可以打印');
    });

    it('should return Japanese translations', () => {
      const answer = answerLocally('printability', validModel, 'ja');
      expect(answer).toContain('印刷可能');
    });

    it('should return empty string for unknown category', () => {
      const answer = answerLocally('unknown', validModel, 'en');
      expect(answer).toBe('');
    });
  });
});