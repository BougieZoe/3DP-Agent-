import { describe, it, expect } from 'vitest';
import { generateQuote } from '../autoQuote';
import type { VendorCapacityAdapter, MaterialStock, MachineAvailability } from '../vendorCapacity';
import type { UnifiedAnalysis } from '@/analysis/types';
import type { SupplierPriceList } from '@shared/domain/material';

function buildMockAnalysis(): UnifiedAnalysis {
  return {
    metrics: {
      result: {
        meshVolumeMm3: 12000,
        dimensions: { x: 100, y: 50, z: 25 },
        overhang: { ratio: 0.1, faceCount: 2 },
      },
    },
    printTime: {
      result: {
        estimatedPrintTimeHours: 3.5,
        materialWeightGrams: 45,
        source: 'estimation',
      },
    },
    topology: { result: { triangleCount: 5000 } },
    support: null,
    timestamp: '2026-09-04T00:00:00.000Z',
    modelFileName: 'test.stl',
    overallConfidence: 0.8,
  } as unknown as UnifiedAnalysis;
}

const mockMaterial = {
  name: 'PLA',
  technology: 'FDM',
} as any;

const mockSupplierPrices = [{
  supplierId: 'test-supplier',
  material: 'PLA',
  technology: 'FDM',
  pricePerKg: 25,
  machineRatePerHour: 15,
  minOrderQuantity: 1,
  leadTimeDays: 3,
  shippingRates: { DDP: 8, EXW: 5, FOB: 6, CIF: 10 },
}] as SupplierPriceList[];

function buildMockAdapter(overrides?: {
  machineStatus?: MachineAvailability['status'];
  materialStockKg?: number;
  materialLastUpdated?: string;
}): VendorCapacityAdapter {
  return {
    getMachineAvailability: async () => ({
      machineId: 'kings3d-fgf1800pro-01',
      status: overrides?.machineStatus ?? 'available',
    }),
    getMaterialStock: async () => ({
      materialType: 'PLA',
      remainingKg: overrides?.materialStockKg ?? 12.5,
      lastUpdated: overrides?.materialLastUpdated ?? new Date().toISOString(),
    }),
  };
}

describe('autoQuote — vendor capacity integration', () => {
  it('includes capacity info when adapter is provided', async () => {
    const quote = await generateQuote({
      analysis: buildMockAnalysis(),
      material: mockMaterial,
      quantity: 1,
      supplierPrices: mockSupplierPrices,
      vendorCapacityAdapter: buildMockAdapter(),
      machineId: 'kings3d-fgf1800pro-01',
    });

    expect(quote).not.toBeNull();
    expect(quote!.capacity).toBeDefined();
    expect(quote!.capacity!.machineStatus).toBe('available');
    expect(quote!.capacity!.materialStockKg).toBe(12.5);
    expect(quote!.capacity!.materialLastUpdated).toBeDefined();
  });

  it('omits capacity when no adapter provided', async () => {
    const quote = await generateQuote({
      analysis: buildMockAnalysis(),
      material: mockMaterial,
      quantity: 1,
      supplierPrices: mockSupplierPrices,
    });

    expect(quote).not.toBeNull();
    expect(quote!.capacity).toBeUndefined();
    expect(quote!.capacityDataStale).toBeUndefined();
  });

  it('flags stale data when lastUpdated exceeds threshold', async () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const quote = await generateQuote({
      analysis: buildMockAnalysis(),
      material: mockMaterial,
      quantity: 1,
      supplierPrices: mockSupplierPrices,
      vendorCapacityAdapter: buildMockAdapter({ materialLastUpdated: threeDaysAgo }),
    });

    expect(quote).not.toBeNull();
    expect(quote!.capacityDataStale).toBe(true);
    expect(quote!.notes).toContain('Capacity data may be outdated');
  });

  it('does NOT flag stale data when lastUpdated is recent', async () => {
    const quote = await generateQuote({
      analysis: buildMockAnalysis(),
      material: mockMaterial,
      quantity: 1,
      supplierPrices: mockSupplierPrices,
      vendorCapacityAdapter: buildMockAdapter({ materialLastUpdated: new Date().toISOString() }),
    });

    expect(quote).not.toBeNull();
    expect(quote!.capacityDataStale).toBe(false);
    expect(quote!.notes).not.toContain('Capacity data may be outdated');
  });

  it('handles adapter errors gracefully', async () => {
    const brokenAdapter: VendorCapacityAdapter = {
      getMachineAvailability: async () => { throw new Error('connection lost'); },
      getMaterialStock: async () => { throw new Error('connection lost'); },
    };

    const quote = await generateQuote({
      analysis: buildMockAnalysis(),
      material: mockMaterial,
      quantity: 1,
      supplierPrices: mockSupplierPrices,
      vendorCapacityAdapter: brokenAdapter,
    });

    expect(quote).not.toBeNull();
    expect(quote!.capacity).toBeUndefined();
    expect(quote!.capacityDataStale).toBeUndefined();
  });
});
