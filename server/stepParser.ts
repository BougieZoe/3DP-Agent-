/**
 * STEP File Parser
 *
 * Parses STEP files using occt-wasm (OpenCASCADE WebAssembly) to extract
 * geometry data for analysis pipeline integration.
 *
 * This module provides:
 * - STEP file import and tessellation
 * - Geometry extraction (positions, normals, indices)
 * - Integration with existing GeometryModel interface
 */
// Lazy import — occt-wasm has no CJS exports main, so a static import
// crashes the server at startup with ERR_PACKAGE_PATH_NOT_EXPORTED.
// Dynamic import defers the failure to actual STEP-parse calls where we
// can catch and surface it gracefully.
let _OcctKernel: typeof import('occt-wasm').OcctKernel | null = null;
async function getOcctKernel() {
  if (!_OcctKernel) {
    const mod = await import('occt-wasm');
    _OcctKernel = mod.OcctKernel;
  }
  return _OcctKernel;
}

export interface GeometryModel {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
  units: 'mm';
}

export interface StepParseResult {
  /** Parsed geometry model ready for analysis */
  model: GeometryModel;
  /** Number of solids found in STEP file */
  solidCount: number;
  /** Number of faces tessellated */
  faceCount: number;
  /** Bounding box in mm [minX, minY, minZ, maxX, maxY, maxZ] */
  boundingBox: [number, number, number, number, number, number];
  /** Volume in mm³ */
  volumeMm3: number;
  /** Surface area in mm² */
  surfaceAreaMm2: number;
  /** Warnings during parsing */
  warnings: string[];
}

export interface StepParseOptions {
  /** Linear deflection for tessellation (default: 0.1mm) */
  linearDeflection?: number;
  /** Angular deflection for tessellation in radians (default: 0.5) */
  angularDeflection?: number;
  /** Whether to merge coincident vertices (default: true) */
  mergeVertices?: boolean;
}

/**
 * Parse a STEP file and extract geometry for analysis.
 *
 * @param stepBytes - Raw STEP file bytes
 * @param options - Parsing options
 * @returns Parsed geometry and metadata
 */
export async function parseStepFile(
  stepBytes: Uint8Array,
  options: StepParseOptions = {},
): Promise<StepParseResult> {
  const {
    linearDeflection = 0.1,
    angularDeflection = 0.5,
    mergeVertices = true,
  } = options;

  const warnings: string[] = [];

  // Initialize OCCT kernel (lazy-loaded to avoid startup crash)
  const OcctKernel = await getOcctKernel();
  using kernel = await OcctKernel.init();

  // Import STEP file
  const stepString = new TextDecoder().decode(stepBytes);
  const shape = kernel.importStep(stepString);

  if (!shape) {
    throw new Error('Failed to import STEP file: invalid or corrupted data');
  }

  // Get solid count
  const solids = kernel.getSubShapes(shape, 'solid');
  const solidCount = solids.length;

  if (solidCount === 0) {
    warnings.push('No solids found in STEP file');
  }

  // Tessellate the shape
  const tessellation = kernel.tessellate(shape, {
    linearDeflection,
    angularDeflection,
  });

  // Extract geometry data
  let positions = tessellation.positions;
  let normals = tessellation.normals;
  let indices = tessellation.indices;

  // Merge coincident vertices if requested
  if (mergeVertices && indices.length > 0) {
    const merged = mergeCoincidentVertices(positions, normals, indices);
    positions = merged.positions;
    normals = merged.normals;
    indices = merged.indices;
  }

  // Create geometry model
  const model: GeometryModel = {
    positions,
    normals,
    indices,
    vertexCount: positions.length / 3,
    triangleCount: indices.length / 3,
    units: 'mm',
  };

  // Get metadata
  const bbox = kernel.getBoundingBox(shape);
  const volume = kernel.getVolume(shape);
  const surfaceArea = kernel.getSurfaceArea(shape);

  // Count faces
  const faces = kernel.getSubShapes(shape, 'face');
  const faceCount = faces.length;

  return {
    model,
    solidCount,
    faceCount,
    boundingBox: [
      bbox.xmin, bbox.ymin, bbox.zmin,
      bbox.xmax, bbox.ymax, bbox.zmax,
    ],
    volumeMm3: volume,
    surfaceAreaMm2: surfaceArea,
    warnings,
  };
}

/**
 * Merge coincident vertices to reduce geometry size.
 * Uses a spatial hash to identify duplicate vertices.
 */
function mergeCoincidentVertices(
  positions: Float32Array,
  normals: Float32Array,
  indices: Uint32Array,
): {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
} {
  const vertexMap = new Map<string, number>();
  const newPositions: number[] = [];
  const newNormals: number[] = [];
  const newIndices: number[] = [];

  const epsilon = 0.0001;

  for (let i = 0; i < indices.length; i++) {
    const oldIdx = indices[i];
    const x = positions[oldIdx * 3];
    const y = positions[oldIdx * 3 + 1];
    const z = positions[oldIdx * 3 + 2];

    // Create spatial hash key
    const key = `${Math.round(x / epsilon)}_${Math.round(y / epsilon)}_${Math.round(z / epsilon)}`;

    if (vertexMap.has(key)) {
      // Reuse existing vertex
      newIndices.push(vertexMap.get(key)!);
    } else {
      // Create new vertex
      const newIdx = newPositions.length / 3;
      vertexMap.set(key, newIdx);
      newPositions.push(x, y, z);
      newNormals.push(
        normals[oldIdx * 3],
        normals[oldIdx * 3 + 1],
        normals[oldIdx * 3 + 2],
      );
      newIndices.push(newIdx);
    }
  }

  return {
    positions: new Float32Array(newPositions),
    normals: new Float32Array(newNormals),
    indices: new Uint32Array(newIndices),
  };
}

/**
 * Validate STEP file header to check if it's a valid STEP file.
 *
 * @param bytes - Raw file bytes
 * @returns True if file appears to be a valid STEP file
 */
export function isValidStepFile(bytes: Uint8Array): boolean {
  const header = new TextDecoder().decode(bytes.slice(0, 100));
  // STEP files typically start with "ISO-10303-21;" or "HEADER;"
  return header.includes('ISO-10303-21') || header.includes('HEADER');
}

/**
 * Extract metadata from STEP file header without full parsing.
 *
 * @param stepBytes - Raw STEP file bytes
 * @returns Basic metadata from header
 */
export function extractStepHeaderInfo(stepBytes: Uint8Array): {
  fileName?: string;
  author?: string;
  organization?: string;
  preprocessorVersion?: string;
  originatingSystem?: string;
} {
  const content = new TextDecoder().decode(stepBytes);

  const extractField = (pattern: RegExp): string | undefined => {
    const match = content.match(pattern);
    return match?.[1];
  };

  return {
    fileName: extractField(/FILE_NAME\s*\(\s*'([^']+)'/),
    author: extractField(/AUTHOR\s*\(\s*\(\s*'([^']+)'/),
    organization: extractField(/ORGANIZATION\s*\(\s*\(\s*'([^']+)'/),
    preprocessorVersion: extractField(/FILE_NAME\s*\(\s*'[^']+'\s*,\s*'[^']+'\s*,\s*\([^)]*\)\s*,\s*\([^)]*\)\s*,\s*'([^']+)'/),
    originatingSystem: extractField(/FILE_NAME\s*\(\s*'[^']+'\s*,\s*'[^']+'\s*,\s*\([^)]*\)\s*,\s*\([^)]*\)\s*,\s*'[^']+'\s*,\s*'([^']+)'/),
  };
}
