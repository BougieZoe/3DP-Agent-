/**
 * Analysis Record tests — traceable manufacturing-intelligence loop (Phase 1).
 *
 * Covers the acceptance criteria:
 *  1. Valid records can be created and read.
 *  2. Missing manufacturing context is represented honestly (null, not defaults).
 *  3. Findings preserve evidence and are classified by epistemic kind.
 *  4. Before/after comparisons distinguish measured change from inferred benefit.
 *  5. Unknown/untested outcomes are never treated as success.
 *  6. Legacy/malformed records degrade safely; fingerprint identity is stable.
 *  7. The persistence path performs no network I/O.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { UnifiedAnalysis } from '@/analysis/types';
import {
  ANALYSIS_RECORD_SCHEMA_VERSION,
  buildAnalysisRecord,
  classifyFindingKind,
  compareAnalyses,
  detectModelFormat,
  isSuccessfulOutcome,
  normalizeAnalysisRecord,
  sameModel,
  summarizeOutcomes,
  type AnalysisRecord,
} from '../analysisRecord';
import {
  createMemoryStore,
  recordDecision,
  saveAnalysisRecordQuietly,
  updateOutcome,
} from '../analysisHistory';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function moduleResult<T>(moduleName: string, result: T, confidence = 0.9) {
  return { moduleName, confidence: confidence as never, durationMs: 1, result, explanation: '' };
}

interface AnalysisOverrides {
  watertight?: boolean;
  holeCount?: number;
  minWallMm?: number | null;
  p5WallMm?: number | null;
  thinWallRatio?: number;
  overhangRatio?: number;
  volumeMm3?: number;
  thermalRisk?: number | null;
}

function makeAnalysis(o: AnalysisOverrides = {}): UnifiedAnalysis {
  const watertight = o.watertight ?? true;
  const holeCount = o.holeCount ?? 0;
  const thermalRisk = o.thermalRisk ?? null;
  const analysis = {
    topology: moduleResult('topology', {
      triangleCount: 12,
      vertexCount: 8,
      edgeCount: 18,
      manifoldEdgeCount: 18,
      boundaryEdgeCount: watertight ? 0 : 4,
      nonManifoldEdgeCount: 0,
      shellCount: 1,
      problemEdges: [],
    }),
    validation: moduleResult('validation', {
      isWatertight: watertight,
      holeCount,
      boundaryEdgeCount: watertight ? 0 : holeCount * 4,
      flippedNormalFaceCount: 0,
      totalFaceCount: 12,
      flippedNormalRatio: 0,
      normalOrientation: 'outward',
      degenerateFaceCount: 0,
    }),
    metrics: moduleResult('metrics', {
      meshVolumeMm3: o.volumeMm3 ?? 8000,
      volumeReliable: watertight,
      surfaceAreaMm2: 2400,
      boundingBoxVolumeMm3: 8000,
      boundingBoxDimensionsMm: { x: 20, y: 20, z: 20 },
      minWallThicknessMm: o.minWallMm === undefined ? 2 : o.minWallMm,
      avgWallThicknessMm: 2.5,
      p1WallThicknessMm: 1.5,
      p5WallThicknessMm: o.p5WallMm === undefined ? 1.8 : o.p5WallMm,
      p10WallThicknessMm: 1.9,
      medianWallThicknessMm: 2.4,
      thinWallRatio: o.thinWallRatio ?? 0,
      thinWallCount: 0,
      averageConfidence: 0.9,
      overhang: { ratio: o.overhangRatio ?? 0, maxAngleDeg: 30, overhangAreaMm2: 0 },
    }),
    scaleGuard: null,
    bedFit: null,
    support: null,
    printTime: null,
    thermal:
      thermalRisk === null
        ? null
        : moduleResult('thermal', {
            warpingRiskScore: thermalRisk,
            warpingHotspots: [],
            maxThermalGradientCPerMm: 5,
          }),
    timestamp: '2026-10-16T00:00:00.000Z',
    modelFileName: 'fixture.stl',
    overallConfidence: 0.9,
  };
  return analysis as unknown as UnifiedAnalysis;
}

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function makeRecord(over: Parameters<typeof buildAnalysisRecord>[0] extends infer T
  ? Partial<Omit<T, 'analysis'>> & { analysis?: UnifiedAnalysis }
  : never = {}): AnalysisRecord {
  return buildAnalysisRecord({
    analysis: over.analysis ?? makeAnalysis(),
    fileName: over.fileName ?? 'part.stl',
    fileHash: over.fileHash ?? HASH_A,
    fileSizeBytes: over.fileSizeBytes ?? 1234,
    units: over.units ?? 'mm',
    context: over.context,
    language: over.language ?? 'zh',
    slicer: over.slicer,
    repair: over.repair,
    id: over.id,
    createdAt: over.createdAt,
  });
}

// ── 1. Create & read ─────────────────────────────────────────────────────────

describe('record creation and read-back', () => {
  it('builds a schema-current record and reads it back intact via the store', async () => {
    const store = createMemoryStore();
    const record = makeRecord({ id: 'rec-1' });
    await store.save(record);

    const read = await store.get('rec-1');
    expect(read).not.toBeNull();
    expect(read!.schemaVersion).toBe(ANALYSIS_RECORD_SCHEMA_VERSION);
    expect(read!.id).toBe('rec-1');
    expect(read!.model.fileHash).toBe(HASH_A);
    expect(read!.model.format).toBe('stl');
    expect(read!.geometry.volumeMm3).toBe(8000);
    expect(read!.geometry.isWatertight).toBe(true);
    expect(read!.analyzer.thresholdsHash).toMatch(/^[0-9a-f]{8}$/);
    expect(read!.analyzer.inputHash).toMatch(/^[0-9a-f]{8}$/);
    expect(read!.outcome.status).toBe('not_tested');
    expect(read!.decision).toBeNull();
  });

  it('getLatestByHash returns the newest record for a fingerprint', async () => {
    const store = createMemoryStore();
    await store.save(makeRecord({ id: 'old', createdAt: '2026-01-01T00:00:00.000Z' }));
    await store.save(makeRecord({ id: 'new', createdAt: '2026-02-01T00:00:00.000Z' }));
    await store.save(makeRecord({ id: 'other', fileHash: HASH_B, createdAt: '2026-03-01T00:00:00.000Z' }));

    expect((await store.getLatestByHash(HASH_A))!.id).toBe('new');
    expect((await store.getLatestByHash(HASH_B))!.id).toBe('other');
    expect(await store.getLatestByHash('c'.repeat(64))).toBeNull();
  });
});

// ── 2. Missing context honesty ───────────────────────────────────────────────

describe('missing manufacturing context', () => {
  it('leaves every context field null when none was provided', () => {
    const record = makeRecord();
    expect(record.context).toEqual({
      material: null,
      materialFamily: null,
      printerId: null,
      layerHeightMm: null,
      process: null,
    });
  });

  it('keeps provided context and nulls the rest — no substituted defaults', () => {
    const record = makeRecord({ context: { material: 'PETG' } });
    expect(record.context.material).toBe('PETG');
    expect(record.context.printerId).toBeNull();
    expect(record.context.layerHeightMm).toBeNull();
  });

  it('keeps slicer provenance null when no slicer ran', () => {
    expect(makeRecord().slicer).toBeNull();
  });
});

// ── 3. Finding evidence + epistemic kinds ────────────────────────────────────

describe('finding classification', () => {
  it('tags watertightness findings as rule_assessment with measured evidence', () => {
    const record = makeRecord({ analysis: makeAnalysis({ watertight: false, holeCount: 2 }) });
    const finding = record.findings.find((f) => f.id === 'geo-001');
    expect(finding).toBeDefined();
    expect(finding!.kind).toBe('rule_assessment');
    expect(finding!.moduleSource).toBe('validation');
    // measured evidence (hole count) survives into the record
    expect(finding!.evidence.some((e) => e.label === '孔洞数量' && e.value === 2)).toBe(true);
    expect(finding!.verification).toBeTruthy();
  });

  it('tags thermal warping findings as engineering_inference, never measured', () => {
    const record = makeRecord({ analysis: makeAnalysis({ thermalRisk: 0.9 }) });
    const finding = record.findings.find((f) => f.id === 'fail-001');
    expect(finding).toBeDefined();
    expect(finding!.kind).toBe('engineering_inference');
    expect(finding!.verification).toMatch(/physical print/);
  });

  it('tags LLM/agent findings as unverified_hypothesis', () => {
    expect(
      classifyFindingKind({
        id: 'x',
        category: 'failure',
        severity: 'warning',
        title: 'LLM says warping',
        description: '',
        evidence: [],
        impact: '',
        moduleSource: 'llm',
        confidence: 0.7,
      }),
    ).toBe('unverified_hypothesis');
  });
});

// ── 4. Before/after comparison ───────────────────────────────────────────────

describe('before/after comparison', () => {
  it('separates measured geometry change from inferred score change', () => {
    const before = makeAnalysis({ watertight: false, holeCount: 2 });
    const after = makeAnalysis({ watertight: true, holeCount: 0 });
    const cmp = compareAnalyses(before, after);

    // measured
    expect(cmp.measured.isWatertight).toEqual({ before: false, after: true });
    expect(cmp.measured.holeCount.delta).toBe(-2);
    expect(cmp.geometricChange).toBe('improved');

    // inferred — present, but quarantined from the measured facts
    expect(cmp.inferred.scoreAfter).toBeGreaterThan(cmp.inferred.scoreBefore);
    expect(cmp.inferred.findingsResolved).toContain('geo-001');

    // the claim boundary is explicit
    expect(cmp.claimBoundary).toMatch(/not evidence of manufacturing success/);
  });

  it('flags regressed geometry from measured facts only', () => {
    const before = makeAnalysis({ watertight: true });
    const after = makeAnalysis({ watertight: true, minWallMm: 0.5 });
    const cmp = compareAnalyses(before, { ...after });
    expect(cmp.measured.minWallThicknessMm.delta).toBeCloseTo(-1.5);
    expect(cmp.geometricChange).toBe('regressed');
  });

  it('records the repair link and comparison on the repaired record', () => {
    const before = makeAnalysis({ watertight: false, holeCount: 1 });
    const after = makeAnalysis({ watertight: true });
    const record = makeRecord({
      analysis: after,
      repair: { derivedFromRecordId: 'rec-before', note: 'pymeshfix repair', before },
    });
    expect(record.repair!.derivedFromRecordId).toBe('rec-before');
    expect(record.repair!.comparison.geometricChange).toBe('improved');
    // the repaired record still starts life untested
    expect(record.outcome.status).toBe('not_tested');
  });
});

// ── 5. Outcomes are never fabricated success ─────────────────────────────────

describe('outcome honesty', () => {
  it('treats only explicit success as success', () => {
    expect(isSuccessfulOutcome('success')).toBe(true);
    for (const s of ['not_tested', 'unknown', 'partial', 'failure'] as const) {
      expect(isSuccessfulOutcome(s)).toBe(false);
    }
  });

  it('excludes untested/unknown records from success rates', () => {
    const untested = makeRecord({ id: '1' });
    const succeeded = makeRecord({ id: '2' });
    succeeded.outcome = { ...succeeded.outcome, status: 'success' };
    const failed = makeRecord({ id: '3' });
    failed.outcome = { ...failed.outcome, status: 'failure' };

    const summary = summarizeOutcomes([untested, succeeded, failed]);
    expect(summary.total).toBe(3);
    expect(summary.tested).toBe(2);
    expect(summary.notTested).toBe(1);
    expect(summary.successRate).toBe(0.5);
  });

  it('reports null success rate when nothing has been tested', () => {
    expect(summarizeOutcomes([makeRecord({ id: '1' })]).successRate).toBeNull();
    expect(summarizeOutcomes([]).successRate).toBeNull();
  });

  it('updateOutcome writes only explicit statuses onto an existing record', async () => {
    const store = createMemoryStore();
    await store.save(makeRecord({ id: 'rec-9' }));

    const updated = await updateOutcome(store, 'rec-9', {
      status: 'failure',
      failureLayer: 12,
      failureType: 'warping',
      failureMode: 'warping at corner',
    });
    expect(updated!.outcome.status).toBe('failure');
    expect(updated!.outcome.failureLayer).toBe(12);
    expect(updated!.outcome.failureType).toBe('warping');
    expect(updated!.outcome.failureMode).toBe('warping at corner');
    expect(updated!.outcome.recordedAt).toBeTruthy();

    expect(await updateOutcome(store, 'missing-id', { status: 'success' })).toBeNull();
  });

  it('recordDecision attaches an engineer decision without touching outcome', async () => {
    const store = createMemoryStore();
    await store.save(makeRecord({ id: 'rec-10' }));
    const updated = await recordDecision(store, 'rec-10', 'print as-is', 'walls above threshold');
    expect(updated!.decision!.decision).toBe('print as-is');
    expect(updated!.outcome.status).toBe('not_tested');
  });
});

// ── 6. Legacy / malformed data + fingerprint stability ───────────────────────

describe('normalization and identity', () => {
  it('normalizes a legacy record missing new fields into honest nulls', () => {
    const legacy = {
      // no schemaVersion (pre-versioned)
      id: 'legacy-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      model: { fileName: 'old.stl', fileHash: HASH_A }, // no format/units/size
      // no context, geometry, findings, score, outcome
    };
    const record = normalizeAnalysisRecord(legacy);
    expect(record).not.toBeNull();
    expect(record!.schemaVersion).toBe(0);
    expect(record!.context.material).toBeNull();
    expect(record!.geometry.isWatertight).toBeNull();
    expect(record!.analyzer.thresholdsHash).toBeNull();
    expect(record!.analyzer.inputHash).toBeNull();
    expect(record!.outcome.status).toBe('not_tested');
    expect(record!.findings).toEqual([]);
  });

  it('drops invalid failure details to null without changing the status', () => {
    const raw = {
      id: 'x',
      model: { fileHash: HASH_A },
      outcome: { status: 'failure', failureLayer: 0, failureType: 'exploded' },
    };
    const outcome = normalizeAnalysisRecord(raw)!.outcome;
    expect(outcome.status).toBe('failure');
    expect(outcome.failureLayer).toBeNull();
    expect(outcome.failureType).toBeNull();
  });

  it('coerces an unrecognized stored outcome to not_tested, never success', () => {
    const raw = {
      id: 'x',
      model: { fileHash: HASH_A },
      outcome: { status: 'printed_great' }, // not a known status
    };
    expect(normalizeAnalysisRecord(raw)!.outcome.status).toBe('not_tested');
  });

  it('rejects unusable data instead of inventing a record', () => {
    expect(normalizeAnalysisRecord(null)).toBeNull();
    expect(normalizeAnalysisRecord('garbage')).toBeNull();
    expect(normalizeAnalysisRecord({ id: 'x' })).toBeNull(); // no model/fileHash
    expect(normalizeAnalysisRecord({ model: { fileHash: HASH_A } })).toBeNull(); // no id
  });

  it('preserves the fingerprint verbatim and uses it for model identity', () => {
    const a = makeRecord({ id: 'a1', fileHash: HASH_A });
    const b = makeRecord({ id: 'a2', fileHash: HASH_A, fileName: 'renamed.stl' });
    const c = makeRecord({ id: 'b1', fileHash: HASH_B });
    expect(a.model.fileHash).toBe(HASH_A);
    expect(sameModel(a, b)).toBe(true); // same bytes, different run/file name
    expect(sameModel(a, c)).toBe(false);
  });

  it('detects formats from file names, unknown otherwise', () => {
    expect(detectModelFormat('a.stl')).toBe('stl');
    expect(detectModelFormat('b.OBJ')).toBe('obj');
    expect(detectModelFormat('c.3mf')).toBe('3mf');
    expect(detectModelFormat('d.STP')).toBe('step');
    expect(detectModelFormat('e.gcode')).toBe('unknown');
  });
});

// ── 7. No external transmission ──────────────────────────────────────────────

describe('privacy boundary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('history operations never touch the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const store = createMemoryStore();
    await saveAnalysisRecordQuietly(makeRecord({ id: 'priv-1' }), store);
    await updateOutcome(store, 'priv-1', { status: 'success' });
    await store.list();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('record/history modules contain no network calls or uploads', () => {
    for (const file of ['analysisRecord.ts', 'analysisHistory.ts']) {
      const src = readFileSync(resolve(__dirname, '..', file), 'utf8');
      expect(src).not.toMatch(/\bfetch\s*\(/);
      expect(src).not.toMatch(/XMLHttpRequest/);
      expect(src).not.toMatch(/sendBeacon/);
      expect(src).not.toMatch(/https?:\/\//);
    }
  });
});
