import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMachineModel, MACHINE_MODELS } from '../../shared/domain/machine';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'machines');

describe('machine profiles', () => {
  it('every profile has the fields the slicer wiring needs', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const p = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      expect(typeof p.id).toBe('string');
      expect(typeof p.vendor).toBe('string');
      expect(typeof p.process).toBe('string');
      expect(typeof p.status).toBe('string');
      // No invented precision: show-sighting profiles must say so.
      if (p.source?.includes('sighting')) {
        expect(p.status).toMatch(/candidate|verify/i);
      }
    }
  });

  /**
   * Vendor JSON files are provenance artifacts; shared/domain/machine.ts is the
   * runtime table. They must not disagree — a vendor file that stays unquantified
   * cannot be padded with dimensions in the shared table, and vice versa.
   */
  it('stays consistent with the shared machine source of truth', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const p = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      const model = getMachineModel(p.id);
      expect(model, `server/data/machines/${f} has no entry in MACHINE_MODELS`).toBeDefined();
      if (!model) continue;

      expect(model.vendor).toBe(p.vendor);
      expect(model.process).toBe(p.process);

      const jsonHasVolume = p.buildVolume != null || p.buildVolumeMm != null;
      if (!jsonHasVolume) {
        // The vendor file admits it does not know; the shared table must not invent.
        expect(model.buildVolume).toBeNull();
        expect(model.buildVolumeVerification).toBe('unverified');
      }
    }
  });

  it('has a shared entry for every model and no orphan ids', () => {
    expect(Object.keys(MACHINE_MODELS).length).toBeGreaterThan(0);
    for (const id of Object.keys(MACHINE_MODELS)) {
      expect(MACHINE_MODELS[id].id).toBe(id);
    }
  });
});
