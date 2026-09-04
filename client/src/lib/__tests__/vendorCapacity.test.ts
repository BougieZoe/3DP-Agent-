import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JsonVendorCapacityAdapter, isCapacityStale, CAPACITY_STALENESS_THRESHOLD_MS } from '../vendorCapacity';
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SEED_DATA = {
  machines: [
    { machineId: 'kings3d-fgf1800pro-01', status: 'available' },
    { machineId: 'kings3d-fgf1800pro-02', status: 'booked', nextFreeSlot: '2026-09-06T08:00:00.000Z' },
    { machineId: 'formlabs-form3-01', status: 'maintenance' },
  ],
  materials: [
    { materialType: 'PLA', remainingKg: 12.5, lastUpdated: new Date().toISOString() },
    { materialType: 'PETG', remainingKg: 0.3, lastUpdated: '2026-09-01T14:30:00.000Z' },
  ],
};

let tmpFile: string;

beforeEach(async () => {
  tmpFile = join(tmpdir(), `vendor-capacity-test-${Date.now()}.json`);
  await writeFile(tmpFile, JSON.stringify(SEED_DATA), 'utf-8');
});

afterEach(async () => {
  await rm(tmpFile, { force: true });
});

describe('JsonVendorCapacityAdapter', () => {
  it('returns machine availability for known machine', async () => {
    const adapter = new JsonVendorCapacityAdapter(tmpFile);
    const result = await adapter.getMachineAvailability('kings3d-fgf1800pro-01');
    expect(result).toEqual({ machineId: 'kings3d-fgf1800pro-01', status: 'available' });
  });

  it('returns booked machine with nextFreeSlot', async () => {
    const adapter = new JsonVendorCapacityAdapter(tmpFile);
    const result = await adapter.getMachineAvailability('kings3d-fgf1800pro-02');
    expect(result).toEqual({
      machineId: 'kings3d-fgf1800pro-02',
      status: 'booked',
      nextFreeSlot: '2026-09-06T08:00:00.000Z',
    });
  });

  it('returns null for unknown machine', async () => {
    const adapter = new JsonVendorCapacityAdapter(tmpFile);
    const result = await adapter.getMachineAvailability('nonexistent');
    expect(result).toBeNull();
  });

  it('returns material stock (case-insensitive match)', async () => {
    const adapter = new JsonVendorCapacityAdapter(tmpFile);
    const result = await adapter.getMaterialStock('pla');
    expect(result).toBeDefined();
    expect(result!.materialType).toBe('PLA');
    expect(result!.remainingKg).toBe(12.5);
  });

  it('returns null for unknown material', async () => {
    const adapter = new JsonVendorCapacityAdapter(tmpFile);
    const result = await adapter.getMaterialStock('Nylon');
    expect(result).toBeNull();
  });

  it('returns null when JSON file is missing', async () => {
    const adapter = new JsonVendorCapacityAdapter('/nonexistent/path.json');
    const result = await adapter.getMachineAvailability('kings3d-fgf1800pro-01');
    expect(result).toBeNull();
  });
});

describe('isCapacityStale', () => {
  it('returns false for recent data', () => {
    const recent = new Date().toISOString();
    expect(isCapacityStale(recent)).toBe(false);
  });

  it('returns true for data older than threshold', () => {
    const old = new Date(Date.now() - CAPACITY_STALENESS_THRESHOLD_MS - 1).toISOString();
    expect(isCapacityStale(old)).toBe(true);
  });

  it('returns false for data exactly at threshold', () => {
    const atThreshold = new Date(Date.now() - CAPACITY_STALENESS_THRESHOLD_MS).toISOString();
    expect(isCapacityStale(atThreshold)).toBe(false);
  });
});
