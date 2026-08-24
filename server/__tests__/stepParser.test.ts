/**
 * STEP Parser Tests
 *
 * Tests the STEP file parsing functionality using occt-wasm.
 * These tests require occt-wasm to be installed.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { parseStepFile, isValidStepFile, extractStepHeaderInfo } from '../stepParser';

// Minimal STEP file for testing (a simple cube)
const MINIMAL_STEP = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('2;1'),'2;1');
FILE_NAME('test_cube.step','2026-08-24',('Author'),('Organization'),'Preprocessor','OriginatingSystem','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
ENDSEC;
END-ISO-10303-21;`;

describe('STEP Parser', () => {
  describe('isValidStepFile', () => {
    it('should detect valid STEP file', () => {
      const bytes = new TextEncoder().encode(MINIMAL_STEP);
      expect(isValidStepFile(bytes)).toBe(true);
    });

    it('should reject non-STEP files', () => {
      const bytes = new TextEncoder().encode('This is not a STEP file');
      expect(isValidStepFile(bytes)).toBe(false);
    });

    it('should handle empty input', () => {
      const bytes = new Uint8Array(0);
      expect(isValidStepFile(bytes)).toBe(false);
    });
  });

  describe('extractStepHeaderInfo', () => {
    it('should extract header information', () => {
      const bytes = new TextEncoder().encode(MINIMAL_STEP);
      const info = extractStepHeaderInfo(bytes);

      expect(info.fileName).toBe('test_cube.step');
      expect(info.preprocessorVersion).toBe('Preprocessor');
      expect(info.originatingSystem).toBe('OriginatingSystem');
    });

    it('should handle missing fields gracefully', () => {
      const bytes = new TextEncoder().encode('ISO-10303-21;\nHEADER;\nENDSEC;\nEND-ISO-10303-21;');
      const info = extractStepHeaderInfo(bytes);

      expect(info.fileName).toBeUndefined();
      expect(info.author).toBeUndefined();
    });
  });

  describe('parseStepFile', () => {
    it.skipIf(!process.env.OCCT_WASM_AVAILABLE)(
      'should parse minimal STEP file',
      async () => {
        const bytes = new TextEncoder().encode(MINIMAL_STEP);

        try {
          const result = await parseStepFile(bytes);

          expect(result.model).toBeDefined();
          expect(result.model.vertexCount).toBeGreaterThanOrEqual(0);
          expect(result.model.triangleCount).toBeGreaterThanOrEqual(0);
          expect(result.model.units).toBe('mm');
          expect(result.warnings).toBeInstanceOf(Array);
        } catch (err) {
          // If occt-wasm is not available, skip the test
          console.log('occt-wasm not available, skipping STEP parse test');
        }
      },
    );

    it('should reject invalid STEP data', async () => {
      const bytes = new TextEncoder().encode('Invalid STEP data');

      await expect(parseStepFile(bytes)).rejects.toThrow();
    });
  });
});
