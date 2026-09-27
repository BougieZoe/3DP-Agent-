/**
 * GOLDEN SAMPLES — real STL bytes for the analysis pipeline.
 *
 * Why this exists
 * ---------------
 * The rest of the analysis suite builds meshes procedurally (`testMeshes.ts`),
 * which only ever yields *regular* solids. That is exactly what hid the
 * defects the Python-vs-frontend calibration surfaced: a min-wall read off the
 * bounding box, overhang counted on bed-contact faces, and volume reported for
 * non-watertight shells. Those all need irregular / broken geometry to show up.
 *
 * These 8 files are the same bytes that were fed to the Python engine during
 * the calibration runs, so a diff against `temp/calib` baselines stays
 * apples-to-apples.
 *
 * Provenance: generated with `trimesh` in the 2026-09-27 calibration session.
 * Layout: `__tests__/fixtures/stl/<name>.stl` (~124 KB total, text STL).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseSTL } from '@/lib/stlParser';
import { fromThreeBufferGeometry } from '../geometryConversion';
import { runAnalysisPipeline, type PipelineOptions } from '../pipeline';
import type { GeometryModel } from '../geometryModel';
import type { UnifiedAnalysis } from '../types';

// Anchored to this file rather than to `process.cwd()`, so the suite resolves
// the same bytes whether vitest is launched from the repo root or from client/.
const STL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/stl');

export const GOLDEN_SAMPLE_NAMES = [
  'test_cube',
  'test_model',
  't_cube20',
  't_big300',
  't_thinwall05',
  't_cone',
  't_sphere10',
  't_openbox',
] as const;

export type GoldenSampleName = (typeof GOLDEN_SAMPLE_NAMES)[number];

/** One-line description of what each file is meant to exercise. */
export const GOLDEN_SAMPLE_LABELS: Record<GoldenSampleName, string> = {
  test_cube: '1mm cube missing one face —非水密 + 疑似英寸',
  test_model: '10×6×2mm 多壳体件，37 处破洞 — 真实采样壁厚 vs bbox 最小边',
  t_cube20: '20mm 水密立方体 — 精确基线，体积/壁厚/悬垂全部可解析校验',
  t_big300: '300mm 立方体 — 超出桌面机幅面，必须被 bedFit 拦截',
  t_thinwall05: '20×20×0.5mm 薄板 — 薄壁告警与低置信度',
  t_cone: '⌀20×20mm 圆锥 — 曲面体积近似',
  t_sphere10: '⌀20mm 球 — 曲面近似 + 底部贴床悬垂',
  t_openbox: '20mm 立方体缺一面 — 非水密，体积计算被破坏',
};

/** Load a golden sample as a GeometryModel from its real STL bytes. */
export function loadGoldenModel(name: GoldenSampleName): GeometryModel {
  const buf = readFileSync(path.join(STL_DIR, `${name}.stl`));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return fromThreeBufferGeometry(parseSTL(ab));
}

/** Run the real analysis pipeline over a golden sample. */
export function analyzeGolden(
  name: GoldenSampleName,
  options: PipelineOptions = {},
): UnifiedAnalysis {
  return runAnalysisPipeline(loadGoldenModel(name), {
    fileName: `${name}.stl`,
    language: 'en',
    ...options,
  });
}
