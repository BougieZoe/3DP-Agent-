/**
 * Shopfloor machine model — single source of truth.
 *
 * Before this module, machine/bed data was flattened across five mutually
 * unreferencing layers (see docs/plans/shopfloor-model.md):
 *   - client/src/analysis/types.ts              PRINTER_PROFILES      (6 models)
 *   - client/src/lib/manufacturingRecommendation.ts PROCESSES[].buildVol (process envelopes)
 *   - client/src/lib/printFarm.ts               PrinterCapabilities.maxBuildVolume (per instance)
 *   - client/src/lib/vendorCapacity.json        machineId + status (instance-shaped, no model link)
 *   - server/data/machines/*.json               vendor profiles (no dimensions, no runtime reader)
 *
 * The hierarchy introduced here is three-level and strictly one-directional:
 *
 *   MachineProcess (工艺包络)  →  MachineModel (机型规格)  →  MachineUnit (机台实例)
 *
 * Provenance rule — dimensions are never invented:
 * every model carries `buildVolumeVerification` + `source`. A model whose
 * dimensions are still unconfirmed MUST expose `buildVolume: null` together with
 * `verification: 'unverified'`, so that downstream code fails loudly instead of
 * quoting a fabricated number. `requireBuildVolume()` throws in that case.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** Build volume in millimetres, expressed as x (width) / y (depth) / z (height). */
export interface BuildVolumeMm {
  x: number;
  y: number;
  z: number;
}

/**
 * How much trust a dimension triple has earned.
 * - `verified`      — corroborated by two independent in-repo references, or a
 *                     vendor public spec that the repo profile agrees with.
 * - `single-source` — appears exactly once in the repo; usable but not quotable
 *                     to a customer before checking the vendor sheet.
 * - `unverified`    — no dimensions. `buildVolume` must be null.
 */
export type DimensionVerification = 'verified' | 'single-source' | 'unverified';

export type MachineProcessId = 'FDM' | 'FGF' | 'SLA' | 'SLS' | 'SLM' | 'PBF' | 'CONCRETE';

/** A printer model (机型) — the specification layer. */
export interface MachineModel {
  id: string;
  vendor: string;
  name: string;
  process: MachineProcessId;
  /** null when dimensions are still unconfirmed; never a guessed triple. */
  buildVolume: BuildVolumeMm | null;
  buildVolumeVerification: DimensionVerification;
  /** Where the numbers came from. Mandatory — an unsourced number is a bug. */
  source: string;
  status: string;
  notes?: string;
}

export type MachineUnitStatus =
  | 'available'
  | 'booked'
  | 'printing'
  | 'maintenance'
  | 'offline';

/** A physical machine on the shopfloor (机台实例) — the operational layer. */
export interface MachineUnit {
  id: string;
  /** FK → MachineModel.id */
  modelId: string;
  status: MachineUnitStatus;
  /**
   * Physical location on the shopfloor. null = not yet registered; the field is
   * part of the schema so the shop can fill it, but no plausible-looking value
   * is ever invented here.
   */
  location: string | null;
  /** ISO timestamp of the next free slot, when the unit is booked. */
  nextFreeSlot: string | null;
  /** ISO timestamp of the last maintenance, when known. */
  lastMaintenanceAt: string | null;
  note?: string;
}

/**
 * Process envelope (工艺包络): the reachable ceiling of a process, independent of
 * any single machine. Used when reasoning "can this process do it at all"
 * before a machine model is chosen.
 */
export interface ProcessEnvelope {
  process: MachineProcessId;
  /** null when the process ceiling itself is not established. */
  buildVolume: BuildVolumeMm | null;
  source: string;
  /** Model used as the representative machine for this process, when one exists. */
  representativeModelId: string | null;
}

// ─── Models (机型规格真源) ────────────────────────────────────────────────────

const VENDOR_SPEC = 'vendor public specification, agrees with the in-repo profile table';

export const MACHINE_MODELS: Record<string, MachineModel> = {
  bambu_x1c: {
    id: 'bambu_x1c',
    vendor: 'Bambu Lab',
    name: 'Bambu Lab X1C',
    process: 'FDM',
    buildVolume: { x: 256, y: 256, z: 256 },
    buildVolumeVerification: 'verified',
    source: VENDOR_SPEC,
    status: 'production',
  },
  prusa_mk4: {
    id: 'prusa_mk4',
    vendor: 'Prusa Research',
    name: 'Prusa MK4',
    process: 'FDM',
    buildVolume: { x: 250, y: 210, z: 220 },
    buildVolumeVerification: 'verified',
    source: VENDOR_SPEC,
    status: 'production',
  },
  creality_k1: {
    id: 'creality_k1',
    vendor: 'Creality',
    name: 'Creality K1',
    process: 'FDM',
    buildVolume: { x: 220, y: 220, z: 250 },
    buildVolumeVerification: 'verified',
    source: VENDOR_SPEC,
    status: 'production',
  },
  ender_3: {
    id: 'ender_3',
    vendor: 'Creality',
    name: 'Ender 3',
    process: 'FDM',
    buildVolume: { x: 220, y: 220, z: 250 },
    buildVolumeVerification: 'verified',
    source: VENDOR_SPEC,
    status: 'legacy',
  },
  fgf_1800_pro: {
    id: 'fgf_1800_pro',
    vendor: 'Kings 3D',
    name: 'Kings 3D FGF 1800 Pro',
    process: 'FGF',
    buildVolume: { x: 1800, y: 1200, z: 1300 },
    buildVolumeVerification: 'verified',
    source:
      'corroborated by two independent in-repo references: client/src/analysis/types.ts ' +
      '(PRINTER_PROFILES.fgf_1800_pro) and client/src/lib/manufacturingRecommendation.ts ' +
      '(PROCESSES.FGF.buildVol) — both state 1800 x 1200 x 1300 mm',
    status: 'production',
    notes: 'Largest unit on the floor. Continues to be the reference big-format machine.',
  },
  fgf_1200: {
    id: 'fgf_1200',
    vendor: 'unknown (anonymized)',
    name: 'FGF 1200 Large-Format',
    process: 'FGF',
    buildVolume: { x: 1200, y: 800, z: 1000 },
    buildVolumeVerification: 'single-source',
    source:
      'appears exactly once in the repo: client/src/analysis/types.ts PRINTER_PROFILES.fgf_1200. ' +
      'No second reference and no vendor file — confirm against the vendor data sheet before quoting.',
    status: 'candidate',
  },
  formlabs_form3: {
    id: 'formlabs_form3',
    vendor: 'Formlabs',
    name: 'Formlabs Form 3',
    process: 'SLA',
    buildVolume: { x: 145, y: 145, z: 185 },
    buildVolumeVerification: 'verified',
    source: 'vendor public specification (Form 3: 14.5 x 14.5 x 18.5 cm)',
    status: 'production',
  },
  'hanevex-fgf': {
    id: 'hanevex-fgf',
    vendor: 'Hanevex（青岛瀚海常青科技有限公司）',
    name: 'Hanevex FGF (candidate, unspecified size)',
    process: 'FGF',
    buildVolume: null,
    buildVolumeVerification: 'unverified',
    source:
      'server/data/machines/hanevex-fgf.json declares no build volume and its todo field says ' +
      '"once build volume is confirmed" — the dimensions were never established',
    status: 'generic profile — recalibrate per machine before production use',
    notes:
      'Deliberately null. Filling this in requires the supplier sheet; do not substitute the ' +
      'fgf_1800_pro triple, that is a different machine.',
  },
};

// ─── Units (机台实例真源) ─────────────────────────────────────────────────────

/**
 * Units are seeded from client/src/lib/vendorCapacity.json, which already carried
 * machineId + status without linking to any model. `location` and
 * `lastMaintenanceAt` are null because the shop has not registered them yet —
 * the schema provides the fields, the values stay empty until a human fills them.
 */
export const MACHINE_UNITS: Record<string, MachineUnit> = {
  'kings3d-fgf1800pro-01': {
    id: 'kings3d-fgf1800pro-01',
    modelId: 'fgf_1800_pro',
    status: 'available',
    location: null,
    nextFreeSlot: null,
    lastMaintenanceAt: null,
  },
  'kings3d-fgf1800pro-02': {
    id: 'kings3d-fgf1800pro-02',
    modelId: 'fgf_1800_pro',
    status: 'booked',
    location: null,
    nextFreeSlot: '2026-09-06T08:00:00.000Z',
    lastMaintenanceAt: null,
  },
  'formlabs-form3-01': {
    id: 'formlabs-form3-01',
    modelId: 'formlabs_form3',
    status: 'maintenance',
    location: null,
    nextFreeSlot: null,
    lastMaintenanceAt: null,
  },
};

// ─── Process envelopes (工艺层) ───────────────────────────────────────────────

/**
 * Envelopes answer "what can this process reach", not "what can one machine do".
 * FGF is pinned to the 1800 Pro because that is where its number came from;
 * SLA deliberately keeps the 200 mm generic envelope, which is *larger* than the
 * Form 3 on the floor — replacing it with the Form 3 triple would understate the
 * process. Both facts are recorded in `source` instead of being silently merged.
 */
export const PROCESS_ENVELOPES: Record<MachineProcessId, ProcessEnvelope> = {
  FDM: {
    process: 'FDM',
    buildVolume: { x: 256, y: 256, z: 256 },
    source: 'generic FDM envelope; equals the largest in-house FDM model (bambu_x1c)',
    representativeModelId: 'bambu_x1c',
  },
  FGF: {
    process: 'FGF',
    buildVolume: { x: 1800, y: 1200, z: 1300 },
    source: 'derived from MACHINE_MODELS.fgf_1800_pro (the only FGF model with corroborated dimensions)',
    representativeModelId: 'fgf_1800_pro',
  },
  SLA: {
    process: 'SLA',
    buildVolume: { x: 200, y: 200, z: 200 },
    source:
      'generic SLA envelope carried over from PROCESSES.SLA.buildVol; intentionally NOT clamped ' +
      'to the on-floor Form 3 (145 x 145 x 185)',
    representativeModelId: 'formlabs_form3',
  },
  SLS: {
    process: 'SLS',
    buildVolume: null,
    source: 'no dimension reference exists in the repo; left unset rather than guessed',
    representativeModelId: null,
  },
  SLM: {
    process: 'SLM',
    buildVolume: { x: 300, y: 300, z: 300 },
    source: 'generic SLM envelope carried over from PROCESSES.SLM.buildVol',
    representativeModelId: null,
  },
  PBF: {
    process: 'PBF',
    buildVolume: null,
    source: 'no dimension reference exists in the repo; left unset rather than guessed',
    representativeModelId: null,
  },
  CONCRETE: {
    process: 'CONCRETE',
    buildVolume: null,
    source: 'no dimension reference exists in the repo; left unset rather than guessed',
    representativeModelId: null,
  },
};

// ─── Lookups ──────────────────────────────────────────────────────────────────

export function getMachineModel(modelId: string): MachineModel | undefined {
  return MACHINE_MODELS[modelId];
}

export function getMachineUnit(unitId: string): MachineUnit | undefined {
  return MACHINE_UNITS[unitId];
}

export function unitsForModel(modelId: string): MachineUnit[] {
  return Object.values(MACHINE_UNITS).filter((u) => u.modelId === modelId);
}

export function modelsForProcess(process: MachineProcessId): MachineModel[] {
  return Object.values(MACHINE_MODELS).filter((m) => m.process === process);
}

/** Throws when a caller needs dimensions for a model that has none confirmed. */
export function requireBuildVolume(modelId: string): BuildVolumeMm {
  const model = MACHINE_MODELS[modelId];
  if (!model) throw new Error(`unknown machine model: ${modelId}`);
  if (!model.buildVolume) {
    throw new Error(
      `machine model "${modelId}" has no confirmed build volume (verification=${model.buildVolumeVerification}); ` +
        `source: ${model.source}`,
    );
  }
  return model.buildVolume;
}

/** Non-throwing variant for UI paths that must degrade instead of crashing. */
export function tryBuildVolume(modelId: string): BuildVolumeMm | null {
  return MACHINE_MODELS[modelId]?.buildVolume ?? null;
}

/**
 * Units that can actually take work right now, filtered by a required volume.
 * `buildVolume: null` models are excluded — an unverified footprint must never
 * be scheduled against.
 */
export function schedulableUnits(required: BuildVolumeMm): MachineUnit[] {
  return Object.values(MACHINE_UNITS).filter((unit) => {
    if (unit.status !== 'available') return false;
    const vol = tryBuildVolume(unit.modelId);
    if (!vol) return false;
    return vol.x >= required.x && vol.y >= required.y && vol.z >= required.z;
  });
}
