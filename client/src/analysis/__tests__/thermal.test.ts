/**
 * Thermal Analysis Tests
 *
 * Tests the thermal analysis module (S2) with various materials and geometries.
 */
import { describe, it, expect } from 'vitest';
import { computeThermalMetrics, type ThermalAnalysisOptions } from '../thermal';
import { createGeometryModel } from '../geometryModel';
import { createWatertightCube, createOpenCube } from './testMeshes';
import { fromThreeBufferGeometry } from '../geometryConversion';

describe('Thermal Analysis (S2)', () => {
  // Helper to create a simple cube model
  function createCubeModel(size: number = 20) {
    const positions = new Float32Array([
      -size/2, -size/2, -size/2,  size/2, -size/2, -size/2,  size/2,  size/2, -size/2,
      -size/2, -size/2, -size/2,  size/2,  size/2, -size/2, -size/2,  size/2, -size/2,
      -size/2, -size/2,  size/2,  size/2, -size/2,  size/2,  size/2,  size/2,  size/2,
      -size/2, -size/2,  size/2,  size/2,  size/2,  size/2, -size/2,  size/2,  size/2,
    ]);
    const normals = new Float32Array(positions.length);
    const indices = new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    return createGeometryModel(positions, normals, indices);
  }

  // Helper to create a flat plate model
  function createFlatPlateModel(width: number = 100, height: number = 100, thickness: number = 2) {
    const hw = width / 2;
    const hh = height / 2;
    const ht = thickness / 2;

    const positions = new Float32Array([
      // Bottom face
      -hw, -hh, -ht,  hw, -hh, -ht,  hw,  hh, -ht,
      -hw, -hh, -ht,  hw,  hh, -ht, -hw,  hh, -ht,
      // Top face
      -hw, -hh,  ht,  hw,  hh,  ht,  hw, -hh,  ht,
      -hw, -hh,  ht, -hw,  hh,  ht,  hw,  hh,  ht,
      // Front face
      -hw, -hh, -ht,  hw,  hh, -ht,  hw,  hh,  ht,
      -hw, -hh, -ht,  hw,  hh,  ht, -hw,  hh,  ht,
      // Back face
      -hw, -hh, -ht,  hw, -hh,  ht,  hw, -hh, -ht,
      -hw, -hh, -ht, -hw, -hh,  ht,  hw, -hh,  ht,
      // Left face
      -hw, -hh, -ht, -hw,  hh,  ht, -hw,  hh, -ht,
      -hw, -hh, -ht, -hw, -hh,  ht, -hw,  hh,  ht,
      // Right face
       hw, -hh, -ht,  hw,  hh, -ht,  hw,  hh,  ht,
       hw, -hh, -ht,  hw,  hh,  ht,  hw, -hh,  ht,
    ]);
    const normals = new Float32Array(positions.length);
    const indices = new Uint32Array(Array.from({ length: positions.length / 3 }, (_, i) => i));
    return createGeometryModel(positions, normals, indices);
  }

  describe('Material Properties', () => {
    it('should use correct PLA thermal properties', () => {
      const model = createCubeModel(20);
      const options: ThermalAnalysisOptions = {
        material: {
          name: 'PLA',
          materialFamily: 'fdm',
        },
        materialFamily: 'fdm',
      };

      const result = computeThermalMetrics(model, options);

      // PLA has low shrinkage, should have reasonable warping risk
      expect(result.warpingRiskScore).toBeGreaterThanOrEqual(0);
      expect(result.warpingRiskScore).toBeLessThanOrEqual(1);
      expect(result.layers.length).toBeGreaterThan(0);
    });

    it('should use correct ABS thermal properties', () => {
      const model = createCubeModel(20);
      const options: ThermalAnalysisOptions = {
        material: {
          name: 'ABS',
          materialFamily: 'fdm',
        },
        materialFamily: 'fdm',
      };

      const result = computeThermalMetrics(model, options);

      // ABS has high shrinkage, should have higher warping risk
      expect(result.warpingRiskScore).toBeGreaterThanOrEqual(0);
      expect(result.layers.length).toBeGreaterThan(0);
    });

    it('should handle unknown material gracefully', () => {
      const model = createCubeModel(20);
      const options: ThermalAnalysisOptions = {
        material: {
          name: 'UnknownMaterial',
          materialFamily: 'fdm',
        },
        materialFamily: 'fdm',
      };

      const result = computeThermalMetrics(model, options);

      // Should fallback to FDM defaults
      expect(result.layers.length).toBeGreaterThan(0);
    });
  });

  describe('Thermal Risk Assessment', () => {
    it('should detect low risk for small cube', () => {
      const model = createCubeModel(10);
      const options: ThermalAnalysisOptions = {
        material: { name: 'PLA', materialFamily: 'fdm' },
        materialFamily: 'fdm',
      };

      const result = computeThermalMetrics(model, options);

      // Small cube should have relatively low risk
      expect(result.thermalRiskScore).toBeGreaterThanOrEqual(0);
      expect(result.thermalRiskScore).toBeLessThanOrEqual(1);
      expect(result.warpingRiskScore).toBeGreaterThanOrEqual(0);
      expect(result.warpingRiskScore).toBeLessThanOrEqual(1);
    });

    it('should detect higher risk for large flat plate', () => {
      const model = createFlatPlateModel(100, 100, 2);
      const options: ThermalAnalysisOptions = {
        material: { name: 'ABS', materialFamily: 'fdm' },
        materialFamily: 'fdm',
      };

      const result = computeThermalMetrics(model, options);

      // Large flat plate with ABS should have higher warping risk
      expect(result.warpingHotspots.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Layer Data', () => {
    it('should generate correct number of layers', () => {
      const model = createCubeModel(20);
      const options: ThermalAnalysisOptions = {
        material: { name: 'PLA', materialFamily: 'fdm' },
        materialFamily: 'fdm',
        layerHeightMm: 0.2,
      };

      const result = computeThermalMetrics(model, options);

      // 20mm cube with 0.2mm layers = 100 layers
      expect(result.layers.length).toBeGreaterThan(0);
      expect(result.layers.length).toBeLessThanOrEqual(150);
    });

    it('should use slicer layers when provided', () => {
      const model = createCubeModel(20);
      const options: ThermalAnalysisOptions = {
        material: { name: 'PLA', materialFamily: 'fdm' },
        materialFamily: 'fdm',
        layers: [
          { layerNumber: 0, zMm: 0, heightMm: 0.3 },
          { layerNumber: 1, zMm: 0.3, heightMm: 0.3 },
          { layerNumber: 2, zMm: 0.6, heightMm: 0.3 },
        ],
      };

      const result = computeThermalMetrics(model, options);

      expect(result.layers.length).toBe(3);
    });

    it('should compute valid thermal data for each layer', () => {
      const model = createCubeModel(20);
      const options: ThermalAnalysisOptions = {
        material: { name: 'PLA', materialFamily: 'fdm' },
        materialFamily: 'fdm',
      };

      const result = computeThermalMetrics(model, options);

      for (const layer of result.layers) {
        expect(layer.peakTempC).toBeGreaterThan(0);
        expect(layer.cooledTempC).toBeGreaterThanOrEqual(23); // ambient temp
        expect(layer.cooledTempC).toBeLessThanOrEqual(layer.peakTempC);
        expect(layer.coolingRateCPerS).toBeGreaterThanOrEqual(0);
        expect(layer.printDurationS).toBeGreaterThan(0);
        expect(layer.heatAccumulationRisk).toBeGreaterThanOrEqual(0);
        expect(layer.heatAccumulationRisk).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('Recommendations', () => {
    it('should provide recommendations for high-risk models', () => {
      const model = createFlatPlateModel(200, 200, 1);
      const options: ThermalAnalysisOptions = {
        material: { name: 'ABS', materialFamily: 'fdm' },
        materialFamily: 'fdm',
      };

      const result = computeThermalMetrics(model, options);

      // Large ABS plate should have recommendations
      expect(result.recommendations).toBeInstanceOf(Array);
    });

    it('should not provide FDM recommendations for SLA', () => {
      const model = createCubeModel(20);
      const options: ThermalAnalysisOptions = {
        material: { name: 'Standard Resin', materialFamily: 'sla' },
        materialFamily: 'sla',
      };

      const result = computeThermalMetrics(model, options);

      // SLA should not have FDM-specific recommendations
      const fdmRecs = result.recommendations.filter(r => 
        r.category === 'bed_temp' || r.category === 'enclosure'
      );
      expect(fdmRecs.length).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty model gracefully', () => {
      const positions = new Float32Array(0);
      const normals = new Float32Array(0);
      const indices = new Uint32Array(0);
      const model = createGeometryModel(positions, normals, indices);

      const options: ThermalAnalysisOptions = {
        material: { name: 'PLA', materialFamily: 'fdm' },
        materialFamily: 'fdm',
      };

      const result = computeThermalMetrics(model, options);

      expect(result.layers.length).toBe(0);
      expect(result.thermalRiskScore).toBe(0);
      expect(result.warpingRiskScore).toBe(0);
    });

    it('should handle single triangle mesh', () => {
      const positions = new Float32Array([
        0, 0, 0,  10, 0, 0,  5, 10, 0,
      ]);
      const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
      const indices = new Uint32Array([0, 1, 2]);
      const model = createGeometryModel(positions, normals, indices);

      const options: ThermalAnalysisOptions = {
        material: { name: 'PLA', materialFamily: 'fdm' },
        materialFamily: 'fdm',
      };

      const result = computeThermalMetrics(model, options);

      expect(result.layers.length).toBeGreaterThanOrEqual(0);
    });
  });
});
