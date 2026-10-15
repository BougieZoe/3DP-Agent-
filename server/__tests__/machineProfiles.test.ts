import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
});
