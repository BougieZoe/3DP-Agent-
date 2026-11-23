import { describe, it, expect } from 'vitest';
import {
  MACHINE_MODELS,
  MACHINE_UNITS,
  PROCESS_ENVELOPES,
  getMachineModel,
  requireBuildVolume,
  tryBuildVolume,
  schedulableUnits,
  unitsForModel,
} from '../machine';
import { PRINTER_PROFILES } from '../../../client/src/analysis/types';

/**
 * Contracts for the shopfloor single source of truth.
 * The point of these tests is honesty: a dimension triple that nobody verified
 * must never be representable as if it were known.
 */

describe('machine models', () => {
  it('never carries dimensions without provenance', () => {
    for (const model of Object.values(MACHINE_MODELS)) {
      expect(model.source.length).toBeGreaterThan(10);
      if (model.buildVolume === null) {
        expect(model.buildVolumeVerification).toBe('unverified');
      } else {
        expect(model.buildVolumeVerification).not.toBe('unverified');
        expect(model.buildVolume.x).toBeGreaterThan(0);
        expect(model.buildVolume.y).toBeGreaterThan(0);
        expect(model.buildVolume.z).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the unconfirmed generic FGF profile unquantified', () => {
    const generic = getMachineModel('hanevex-fgf');
    expect(generic).toBeDefined();
    expect(generic?.buildVolume).toBeNull();
    expect(generic?.buildVolumeVerification).toBe('unverified');
    // requireBuildVolume must fail loudly rather than fall back to a sibling machine.
    expect(() => requireBuildVolume('hanevex-fgf')).toThrow(/no confirmed build volume/);
    expect(tryBuildVolume('hanevex-fgf')).toBeNull();
  });

  it('rejects unknown ids instead of returning undefined dimensions', () => {
    expect(() => requireBuildVolume('nope')).toThrow(/unknown machine model/);
  });

  it('marks the single-sourced FGF 1200 as such', () => {
    const m = getMachineModel('fgf_1200');
    expect(m?.buildVolumeVerification).toBe('single-source');
    expect(m?.buildVolume).toEqual({ x: 1200, y: 800, z: 1000 });
  });

  it('corroborates the FGF 1800 Pro triple', () => {
    const m = getMachineModel('fgf_1800_pro');
    expect(m?.buildVolume).toEqual({ x: 1800, y: 1200, z: 1300 });
    expect(m?.buildVolumeVerification).toBe('verified');
    expect(m?.source).toMatch(/corroborated/);
  });
});

describe('machine units', () => {
  it('references only models that exist', () => {
    for (const unit of Object.values(MACHINE_UNITS)) {
      expect(getMachineModel(unit.modelId), `unit ${unit.id} → ${unit.modelId}`).toBeDefined();
    }
  });

  it('leaves unregistered shopfloor fields empty rather than inventing them', () => {
    for (const unit of Object.values(MACHINE_UNITS)) {
      // location/maintenance are schema fields awaiting human entry.
      expect(unit.location === null || typeof unit.location === 'string').toBe(true);
      expect(unit.lastMaintenanceAt === null || typeof unit.lastMaintenanceAt === 'string').toBe(true);
    }
  });

  it('groups units by model', () => {
    expect(unitsForModel('fgf_1800_pro').map((u) => u.id).sort()).toEqual([
      'kings3d-fgf1800pro-01',
      'kings3d-fgf1800pro-02',
    ]);
    expect(unitsForModel('fgf_1200')).toHaveLength(0);
  });

  it('never schedules work onto an unverified footprint', () => {
    // Only fgf1800pro-01 is available; 02 is booked and the Form 3 is in maintenance.
    expect(schedulableUnits({ x: 100, y: 100, z: 100 }).map((u) => u.id)).toEqual([
      'kings3d-fgf1800pro-01',
    ]);
    expect(schedulableUnits({ x: 1900, y: 100, z: 100 })).toHaveLength(0);
  });
});

describe('process envelopes', () => {
  it('derives FGF from the corroborated 1800 Pro model', () => {
    expect(PROCESS_ENVELOPES.FGF.buildVolume).toEqual(getMachineModel('fgf_1800_pro')?.buildVolume);
    expect(PROCESS_ENVELOPES.FGF.representativeModelId).toBe('fgf_1800_pro');
  });

  it('does not clamp the SLA envelope to the on-floor Form 3', () => {
    expect(PROCESS_ENVELOPES.SLA.buildVolume).toEqual({ x: 200, y: 200, z: 200 });
    expect(getMachineModel('formlabs_form3')?.buildVolume).toEqual({ x: 145, y: 145, z: 185 });
  });

  it('leaves envelopes without a repo reference unset', () => {
    expect(PROCESS_ENVELOPES.SLS.buildVolume).toBeNull();
    expect(PROCESS_ENVELOPES.PBF.buildVolume).toBeNull();
  });
});

describe('bed profile projection', () => {
  it('projects every printer profile from the source table', () => {
    for (const [id, profile] of Object.entries(PRINTER_PROFILES)) {
      const model = getMachineModel(id);
      expect(model, `profile ${id}`).toBeDefined();
      expect(model?.buildVolume).not.toBeNull();
      expect(profile.widthMm).toBe(model?.buildVolume?.x);
      expect(profile.depthMm).toBe(model?.buildVolume?.y);
      expect(profile.heightMm).toBe(model?.buildVolume?.z);
      expect(profile.name).toBe(model?.name);
    }
  });

  it('does not expose the unquantified profile as a selectable bed', () => {
    expect(Object.keys(PRINTER_PROFILES)).not.toContain('hanevex-fgf');
  });
});

describe('vendor capacity alignment', () => {
  it('uses the same machine ids as the capacity adapter feed', async () => {
    const raw = await import('../../../client/src/lib/vendorCapacity.json');
    const feed = (raw.default ?? raw) as { machines: Array<{ machineId: string; status: string }> };
    const sharedIds = new Set(Object.keys(MACHINE_UNITS));
    for (const row of feed.machines) {
      expect(sharedIds.has(row.machineId), `vendorCapacity machine ${row.machineId} missing from MACHINE_UNITS`).toBe(true);
    }
    // Ids must not diverge in either direction.
    for (const id of sharedIds) {
      expect(feed.machines.some((m) => m.machineId === id), `${id} not present in vendorCapacity feed`).toBe(true);
    }
  });
});
