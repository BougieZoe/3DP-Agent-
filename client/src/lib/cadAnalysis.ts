import * as THREE from 'three';
import { fromThreeBufferGeometry, runAnalysisInWorker, type UnifiedAnalysis } from '@/analysis';
import type { PrinterProfileId } from '@/analysis/types';
import {
  runConfidenceGate,
  type Issue as ConfidenceIssue,
  type CADConfidenceReport,
  type GenerationQuality,
} from '@/cad-confidence';
import type { Material } from '@shared/domain/material';
import type { Language } from '@/lib/i18n';

/**
 * Shared "analyze a BufferGeometry for printability" pipeline. Used by both
 * the CAD Studio (generated STEP/STL) and the Mesh Studio (AI meshes) so the
 * manufacturing report is identical regardless of generation path.
 */
export async function runCadAnalysis(
  geometry: THREE.BufferGeometry,
  opts: {
    fileName: string;
    prompt: string;
    material: Material;
    quality?: GenerationQuality;
    language: Language;
    printerId?: PrinterProfileId;
  },
): Promise<{ geometry: THREE.BufferGeometry; unified: UnifiedAnalysis; gate: CADConfidenceReport; issues: ConfidenceIssue[] }> {
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const model = fromThreeBufferGeometry(geometry);
  // Heavy analysis runs off the main thread so the CAD/Mesh UI stays responsive.
  const unified = await runAnalysisInWorker(model, {
    fileName: opts.fileName,
    material: opts.material,
    printerId: opts.printerId ?? 'bambu_x1c',
  });
  const gate = runConfidenceGate(unified, opts.prompt, opts.quality ?? 'SUCCESS', opts.language);
  return { geometry, unified, gate: gate.report, issues: gate.issues };
}
