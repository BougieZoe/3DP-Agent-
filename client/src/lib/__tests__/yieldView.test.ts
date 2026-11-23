/**
 * What the panel actually puts on screen about exclusions.
 *
 * The scoreboard side is tested in shared/; this file exists because the
 * sentence "另有 N 条属旧策略未计入" is the only part an operator ever reads,
 * and it was the part with no test at all — a blended count there hides a
 * stamping hole behind a migration fact.
 */

import { describe, expect, it } from 'vitest';

import { buildYieldView } from '../yieldView';
import type { PrintJob, Printer } from '../printFarm';
import { LEGACY_PYTHON_POLICY_VERSION, VERDICT_POLICY_VERSION } from '@shared/domain/verdictPolicy';

function job(id: string, policyVersion: string | undefined): PrintJob {
  return {
    id,
    printerId: 'printer-1',
    name: id,
    fileName: `${id}.gcode`,
    status: 'completed',
    progress: 100,
    startedAt: '2026-11-20T10:00:00Z',
    estimatedEndAt: '2026-11-20T12:00:00Z',
    actualEndAt: '2026-11-20T11:58:00Z',
    material: 'PLA',
    materialUsedGrams: 120,
    layers: { current: 200, total: 200 },
    temperatures: { nozzle: 210, bed: 60 },
    errors: [],
    verdict: { state: 'pass', policyVersion: policyVersion as string },
    quality: 'good',
    scrapCauses: [],
    attributionMethod: 'part-measurement',
  };
}

const PRINTERS: Printer[] = [
  {
    id: 'printer-1',
    name: 'P1',
    model: 'FGF-1000',
    modelId: 'large-format-fgf',
    manufacturer: 'Acme',
    status: 'idle',
    capabilities: {
      technologies: ['FGF'],
      materials: ['PLA'],
      maxBuildVolume: { x: 1000, y: 1000, z: 1000 },
      minLayerHeight: 0.2,
      maxLayerHeight: 4,
      heatedBed: true,
      enclosure: true,
      multiColor: false,
    },
    currentJob: null,
    stats: {
      totalPrints: 3,
      successRate: 1,
      totalPrintTimeHours: 6,
      totalMaterialUsedGrams: 360,
      errorCount: 0,
    },
    lastSeen: '2026-11-20T12:00:00Z',
  },
];

describe('floor yield view — the exclusion sentence', () => {
  it('says nothing when every record is on the current policy', () => {
    const view = buildYieldView([job('a', VERDICT_POLICY_VERSION), job('b', VERDICT_POLICY_VERSION)], PRINTERS);
    expect(view.excludedByVersionText).toBeNull();
  });

  it('names old policies by version', () => {
    const view = buildYieldView(
      [
        job('old-1', LEGACY_PYTHON_POLICY_VERSION),
        job('old-2', LEGACY_PYTHON_POLICY_VERSION),
        job('new-1', VERDICT_POLICY_VERSION),
      ],
      PRINTERS,
    );
    expect(view.excludedByVersionText).toBe(
      `另有 2 条属旧策略未计入（${LEGACY_PYTHON_POLICY_VERSION}）`,
    );
  });

  it('does not call an unstamped record "old policy"', () => {
    const view = buildYieldView([job('u1', undefined), job('u2', undefined), job('u3', undefined)], PRINTERS);
    expect(view.excludedByVersionText).toBe('另有 3 条未标注策略版本，未计入');
    expect(view.excludedByVersionText).not.toContain('旧策略');
  });

  it('keeps the two faults in separate clauses when both occur', () => {
    const view = buildYieldView(
      [
        job('old-1', LEGACY_PYTHON_POLICY_VERSION),
        job('old-2', LEGACY_PYTHON_POLICY_VERSION),
        job('u1', undefined),
        job('new-1', VERDICT_POLICY_VERSION),
      ],
      PRINTERS,
    );
    expect(view.excludedByVersionText).toBe(
      `另有 2 条属旧策略未计入（${LEGACY_PYTHON_POLICY_VERSION}）；另有 1 条未标注策略版本，未计入`,
    );
  });
});
