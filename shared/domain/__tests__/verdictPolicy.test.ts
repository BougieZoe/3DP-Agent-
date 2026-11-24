/**
 * One policy version, one literal.
 *
 * The bug this guards against is silent by construction: if the engine stamps
 * one spelling and a caller pins a second spelling of the same policy, nothing
 * throws — the pin simply matches no record, the board comes back empty, and an
 * empty board reads as "no defects". So the constant is not a style preference,
 * and the check is mechanical rather than a review checklist.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  LEGACY_PYTHON_POLICY_VERSION,
  VERDICT_POLICY_VERSION,
  isCurrentPolicy,
} from '../verdictPolicy';

const REPO = process.cwd();
// Code only. `docs/plans/shopfloor-model.md` keeps a human-readable version
// log on purpose — it is the register, not a consumer.
const ROOTS = ['shared', 'client/src', 'server'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage']);
/** The only file allowed to write a version literal. */
const ALLOWED = new Set(['shared/domain/verdictPolicy.ts']);
const SOURCE_EXT = /\.(ts|tsx|md)$/;

// Assembled from pieces so this file does not trip its own check.
const POLICY_LITERAL = new RegExp(String.raw`\b(?:py-)?wall-20\d\d-\d\d-\d\d[a-z]\b`, 'g');

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (SOURCE_EXT.test(name)) out.push(full);
  }
  return out;
}

describe('policy version — single source of truth', () => {
  it('is written in exactly one file across the repo', () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(join(REPO, root))) {
        const rel = file.slice(REPO.length + 1);
        if (ALLOWED.has(rel)) continue;
        const hits = readFileSync(file, 'utf8').match(POLICY_LITERAL);
        if (hits) offenders.push(`${rel} → ${[...new Set(hits)].join(', ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('distinguishes the current policy from the legacy one', () => {
    expect(VERDICT_POLICY_VERSION).not.toBe(LEGACY_PYTHON_POLICY_VERSION);
    expect(isCurrentPolicy(VERDICT_POLICY_VERSION)).toBe(true);
    expect(isCurrentPolicy(LEGACY_PYTHON_POLICY_VERSION)).toBe(false);
  });

  it('keeps both versions in the documented shape (prefix wall / py-wall, dated, lettered)', () => {
    const shape = /^(?:py-)?wall-\d{4}-\d{2}-\d{2}[a-z]$/;
    expect(VERDICT_POLICY_VERSION).toMatch(shape);
    expect(LEGACY_PYTHON_POLICY_VERSION).toMatch(shape);
  });
});
