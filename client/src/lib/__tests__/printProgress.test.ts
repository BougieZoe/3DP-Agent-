import { describe, it, expect } from 'vitest';
import { estimatePrintProgress, estimateProgressFromTime } from '../printProgress';

describe('printProgress', () => {
  describe('estimatePrintProgress', () => {
    it('should calculate percentage correctly', () => {
      const result = estimatePrintProgress(50, {
        totalHeightMm: 100,
        layerHeightMm: 0.2,
      });

      expect(result.percentage).toBe(50);
      expect(result.layersPrinted).toBe(250);
      expect(result.totalLayers).toBe(500);
    });

    it('should cap percentage at 100', () => {
      const result = estimatePrintProgress(150, {
        totalHeightMm: 100,
        layerHeightMm: 0.2,
      });

      expect(result.percentage).toBe(100);
    });

    it('should calculate remaining time', () => {
      const result = estimatePrintProgress(50, {
        totalHeightMm: 100,
        layerHeightMm: 0.2,
        printSpeedMmPerSec: 50,
      });

      // At 50% with 0.2mm layers, there should be remaining time
      expect(result.remainingMinutes).toBeGreaterThanOrEqual(0);
    });
  });

  describe('estimateProgressFromTime', () => {
    it('should calculate percentage from elapsed time', () => {
      const startTime = Date.now() - 30 * 60 * 1000; // 30 minutes ago
      const result = estimateProgressFromTime(startTime, 60);

      expect(result.percentage).toBeCloseTo(50, 0);
    });

    it('should cap at 100%', () => {
      const startTime = Date.now() - 120 * 60 * 1000; // 120 minutes ago
      const result = estimateProgressFromTime(startTime, 60);

      expect(result.percentage).toBe(100);
    });
  });
});
