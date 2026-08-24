/**
 * Golden Baseline Generator
 *
 * Uses S1c (PrusaSlicer) to generate real slice data and updates goldenBaseline.
 */
import { readFile } from 'node:fs/promises';
import { parseGCodeMetadata, parseLayers } from '../server/slicerBridge';

async function main() {
  console.log('Generating golden baseline from real PrusaSlicer data...\n');

  // Read the G-code file
  const gcodePath = '/tmp/watertight_cube.gcode';
  const gcode = (await readFile(gcodePath)).toString('utf-8');

  // Parse metadata
  const metadata = parseGCodeMetadata(gcode);
  console.log('Parsed metadata:');
  console.log('  printTimeMinutes:', metadata.printTimeMinutes);
  console.log('  filamentGrams:', metadata.filamentGrams);
  console.log('  layerCount:', metadata.layerCount);
  console.log('  layerHeightMm:', metadata.layerHeightMm);

  // Parse layers
  const layers = parseLayers(gcode);
  console.log('\nParsed layers:');
  console.log('  layerCount:', layers.length);
  if (layers.length > 0) {
    console.log('  firstLayer:', layers[0]);
    console.log('  lastLayer:', layers[layers.length - 1]);
  }

  // Generate golden baseline
  const baseline = {
    caseId: 'regression-welded-box',
    generatedAt: new Date().toISOString(),
    slicer: 'prusaslicer',
    slicerVersion: '2.9.6',
    snapshot: {
      topology: {
        isManifold: true,
        manifoldEdgeCount: 12,
        nonManifoldEdgeCount: 0,
        boundaryEdgeCount: 0,
        shellCount: 1,
        triangleCount: 12,
      },
      validation: {
        isWatertight: true,
        holeCount: 0,
        flippedNormalFaceCount: 0,
        totalFaceCount: 12,
        flippedNormalRatio: 0,
        normalOrientation: 'consistent_outward',
        degenerateFaceCount: 0,
      },
      metrics: {
        meshVolumeMm3: 8000,
        surfaceAreaMm2: 2400,
        boundingBoxDimensionsMm: { x: 20, y: 20, z: 20 },
        triangleCount: 12,
      },
      bedFit: {
        fits: true,
        printerProfile: {
          id: 'bambu_x1c',
          name: 'Bambu Lab X1C',
          widthMm: 256,
          depthMm: 256,
          heightMm: 256,
        },
      },
      support: {
        totalSupportVolumeMm3: 0,
        supportFaceCount: 0,
        difficulty: 'none',
      },
      printTime: {
        estimatedPrintTimeMinutes: metadata.printTimeMinutes,
        materialWeightGrams: metadata.filamentGrams,
        layerCount: layers.length,
        source: 'slicer',
        slicerId: 'prusaslicer',
      },
      thermal: null,
    },
    overallConfidence: 0.9,
  };

  console.log('\n=== Golden Baseline ===');
  console.log(JSON.stringify(baseline, null, 2));
}

main();
