/**
 * S3 — Validation Test Cases
 *
 * Synthetic test cases covering normal conditions, edge cases, and regression.
 * Each case includes input generation params and expected outputs.
 *
 * Field names match the actual UnifiedAnalysis structure:
 * - topology: isManifold, manifoldEdgeCount, nonManifoldEdgeCount, boundaryEdgeCount, shellCount
 * - validation: isWatertight, holeCount, flippedNormalFaceCount
 * - metrics: meshVolumeMm3, surfaceAreaMm2, boundingBoxDimensionsMm, triangleCount
 * - bedFit: fits, printerProfile
 * - support: totalSupportVolumeMm3, supportFaceCount, difficulty
 * - printTime: estimatedPrintTimeMinutes, materialWeightGrams, layerCount
 */

import type { S3TestCase } from "../s3-schema";

export const testCases: S3TestCase[] = [
  // ===========================================================================
  // Use Case 1: Normal Operation
  // ===========================================================================
  {
    id: "normal-watertight-cube",
    label: "Watertight Cube — PLA FDM",
    description: "Simple watertight cube on standard PLA FDM setup",
    input: {
      id: "cube-20mm",
      label: "20mm Cube",
      mesh: {
        type: "watertight-cube",
        params: { size: 20 },
        coordinateSystem: "z-up",
        expectedUnit: "mm",
      },
      material: {
        materialFamily: "fdm",
      },
    },
    expected: {
      modules: {
        topology: {
          moduleName: "topology",
          shouldExist: true,
          fields: {
            isManifold: { value: true },
            manifoldEdgeCount: { range: [0, 100] },
            nonManifoldEdgeCount: { value: 0 },
            boundaryEdgeCount: { value: 0 },
            shellCount: { range: [1, 12] },
            triangleCount: { range: [12, 100] },
          },
        },
        validation: {
          moduleName: "validation",
          shouldExist: true,
          fields: {
            isWatertight: { value: true },
            holeCount: { value: 0 },
            flippedNormalFaceCount: { value: 0 },
          },
        },
        metrics: {
          moduleName: "metrics",
          shouldExist: true,
          fields: {
            meshVolumeMm3: { range: [7500, 8500] },
            surfaceAreaMm2: { range: [2300, 2500] },
            boundingBoxDimensionsMm: {
              satisfies: "boundingBoxDimensions",
            },
            triangleCount: { range: [12, 100] },
          },
        },
        bedFit: {
          moduleName: "bedFit",
          shouldExist: true,
          fields: {
            fits: { value: true },
            printerProfile: { exists: true },
          },
          constraints: [{ field: "fits", op: "==", value: true }],
        },
        support: {
          moduleName: "support",
          shouldExist: true,
          fields: {
            totalSupportVolumeMm3: { range: [0, 10] },
            supportFaceCount: { value: 0 },
            difficulty: { value: "none" },
          },
        },
        printTime: {
          moduleName: "printTime",
          shouldExist: true,
          fields: {
            estimatedPrintTimeMinutes: { range: [5, 60] },
            materialWeightGrams: { range: [1, 50] },
            layerCount: { range: [50, 200] },
          },
          constraints: [
            { field: "estimatedPrintTimeMinutes", op: ">=", value: 1 },
          ],
        },
      },
      overallConfidence: { min: 0.3, max: 1.0 },
      stability: {
        deterministicFields: [
          "topology.isManifold",
          "topology.shellCount",
          "validation.isWatertight",
          "bedFit.fits",
        ],
      },
    },
    tags: ["regression"],
  },

  // Open cube (has boundary edges, not non-manifold)
  {
    id: "normal-open-cube",
    label: "Open Cube — Boundary Edge Detection",
    description:
      "Cube with top face removed — tests boundary edge detection",
    input: {
      id: "open-cube-20mm",
      label: "Open 20mm Cube",
      mesh: {
        type: "open-cube",
        params: { size: 20 },
        coordinateSystem: "z-up",
        expectedUnit: "mm",
      },
      material: {
        materialFamily: "fdm",
      },
    },
    expected: {
      modules: {
        topology: {
          moduleName: "topology",
          shouldExist: true,
          fields: {
            isManifold: { value: true },
            boundaryEdgeCount: { range: [4, 100] },
          },
        },
        validation: {
          moduleName: "validation",
          shouldExist: true,
          fields: {
            isWatertight: { value: false },
            holeCount: { range: [1, 10] },
          },
        },
      },
      overallConfidence: { min: 0.3, max: 1.0 },
    },
    tags: ["regression"],
  },

  // Thin wall
  {
    id: "normal-thin-wall",
    label: "Thin Wall — Support Detection",
    description: "Thin vertical wall testing support requirement detection",
    input: {
      id: "thin-wall-05mm",
      label: "0.5mm Thin Wall",
      mesh: {
        type: "thin-wall",
        params: { width: 0.5, height: 50, depth: 20 },
        coordinateSystem: "z-up",
        expectedUnit: "mm",
      },
      material: {
        materialFamily: "fdm",
      },
    },
    expected: {
      modules: {
        support: {
          moduleName: "support",
          shouldExist: true,
          fields: {
            totalSupportVolumeMm3: { range: [0, 100] },
            supportFaceCount: { range: [0, 100] },
          },
        },
        metrics: {
          moduleName: "metrics",
          shouldExist: true,
          fields: {
            meshVolumeMm3: { range: [400, 700] },
          },
        },
      },
      overallConfidence: { min: 0.2, max: 1.0 },
    },
    tags: ["regression"],
  },

  // Overhang plate
  {
    id: "normal-overhang",
    label: "Overhang Plate — Support Trigger",
    description: "Plate with 60° overhang testing support threshold",
    input: {
      id: "overhang-plate",
      label: "Overhang Plate",
      mesh: {
        type: "overhang-plate",
        params: { size: 30, angleDeg: 60 },
        coordinateSystem: "z-up",
        expectedUnit: "mm",
      },
      material: {
        materialFamily: "fdm",
      },
    },
    expected: {
      modules: {
        support: {
          moduleName: "support",
          shouldExist: true,
          fields: {
            supportFaceCount: { range: [1, 1000] },
            difficulty: { range: ["easy", "very_difficult"] },
          },
        },
      },
      overallConfidence: { min: 0.2, max: 1.0 },
    },
    tags: ["regression"],
  },

  // Large flat plate (200mm fits on 256mm bed)
  {
    id: "normal-large-flat",
    label: "Large Flat Plate — Bed Fit Check",
    description: "Large flat plate testing bed fit detection",
    input: {
      id: "large-plate",
      label: "Large Flat Plate",
      mesh: {
        type: "large-flat-plate",
        params: { size: 200 },
        coordinateSystem: "z-up",
        expectedUnit: "mm",
      },
      material: {
        materialFamily: "fdm",
      },
    },
    expected: {
      modules: {
        bedFit: {
          moduleName: "bedFit",
          shouldExist: true,
          fields: {
            fits: { value: true },
          },
          constraints: [{ field: "fits", op: "==", value: true }],
        },
        metrics: {
          moduleName: "metrics",
          shouldExist: true,
          fields: {
            meshVolumeMm3: { range: [19000, 21000] },
          },
        },
      },
      overallConfidence: { min: 0.2, max: 1.0 },
    },
    tags: ["regression"],
  },

  // Icosphere (non-indexed geometry, many shells)
  {
    id: "normal-icosphere",
    label: "Icosphere — Complex Geometry",
    description: "Smooth icosphere testing curved geometry handling",
    input: {
      id: "icosphere-10mm",
      label: "Icosphere",
      mesh: {
        type: "icosphere",
        params: { radius: 10, segments: 2 },
        coordinateSystem: "z-up",
        expectedUnit: "mm",
      },
      material: {
        materialFamily: "fdm",
      },
    },
    expected: {
      modules: {
        topology: {
          moduleName: "topology",
          shouldExist: true,
          fields: {
            isManifold: { value: true },
            shellCount: { range: [1, 200] },
          },
        },
        validation: {
          moduleName: "validation",
          shouldExist: true,
          fields: {
            isWatertight: { value: false },
          },
        },
        metrics: {
          moduleName: "metrics",
          shouldExist: true,
          fields: {
            triangleCount: { range: [100, 5000] },
          },
        },
      },
      overallConfidence: { min: 0.3, max: 1.0 },
    },
    tags: ["regression"],
  },

  // Noisy mesh
  {
    id: "normal-noisy",
    label: "Noisy Mesh — Degraded Geometry",
    description: "Cube with random noise testing robustness",
    input: {
      id: "noisy-cube",
      label: "Noisy Cube",
      mesh: {
        type: "noisy",
        params: { size: 10, noise: 0.2 },
        coordinateSystem: "z-up",
        expectedUnit: "mm",
      },
      material: {
        materialFamily: "fdm",
      },
    },
    expected: {
      modules: {
        topology: {
          moduleName: "topology",
          shouldExist: true,
          fields: {
            isManifold: { value: true },
          },
        },
        validation: {
          moduleName: "validation",
          shouldExist: true,
          fields: {
            isWatertight: { value: false },
          },
        },
      },
      overallConfidence: { min: 0.3, max: 1.0 },
    },
    tags: ["stress"],
  },

  // Disconnected shells
  {
    id: "normal-disconnected",
    label: "Disconnected Shells — Multi-Shell",
    description: "Two disconnected cubes testing multi-shell detection",
    input: {
      id: "disconnected-shells",
      label: "Disconnected Shells",
      mesh: {
        type: "disconnected-shells",
        params: { size: 10 },
        coordinateSystem: "z-up",
        expectedUnit: "mm",
      },
      material: {
        materialFamily: "fdm",
      },
    },
    expected: {
      modules: {
        topology: {
          moduleName: "topology",
          shouldExist: true,
          fields: {
            shellCount: { range: [2, 20] },
            isManifold: { value: true },
          },
        },
        validation: {
          moduleName: "validation",
          shouldExist: true,
          fields: {
            isWatertight: { value: true },
          },
        },
      },
      overallConfidence: { min: 0.3, max: 1.0 },
    },
    tags: ["regression"],
  },

  // ===========================================================================
  // Use Case 2: Edge Cases
  // ===========================================================================

  // Single triangle (has boundary edges, not non-manifold)
  {
    id: "edge-single-triangle",
    label: "Single Triangle — Minimal Geometry",
    description: "Single triangle testing minimal mesh handling",
    input: {
      id: "single-triangle",
      label: "Single Triangle",
      mesh: {
        type: "single-triangle",
        params: { size: 10 },
        coordinateSystem: "z-up",
        expectedUnit: "mm",
      },
      material: {
        materialFamily: "fdm",
      },
    },
    expected: {
      modules: {
        topology: {
          moduleName: "topology",
          shouldExist: true,
          fields: {
            isManifold: { value: true },
            boundaryEdgeCount: { range: [3, 3] },
          },
        },
        validation: {
          moduleName: "validation",
          shouldExist: true,
          fields: {
            isWatertight: { value: false },
          },
        },
      },
      overallConfidence: { min: 0, max: 0.5 },
    },
    tags: ["boundary"],
  },

  // Inverted normals (detection depends on implementation)
  {
    id: "edge-inverted-normals",
    label: "Inverted Normals — Normal Flip",
    description: "Cube with flipped normals testing normal detection",
    input: {
      id: "inverted-normals",
      label: "Inverted Normals",
      mesh: {
        type: "inverted-normals",
        params: { size: 20 },
        coordinateSystem: "z-up",
        expectedUnit: "mm",
      },
      material: {
        materialFamily: "fdm",
      },
    },
    expected: {
      modules: {
        validation: {
          moduleName: "validation",
          shouldExist: true,
          fields: {
            flippedNormalFaceCount: { range: [0, 100] },
          },
        },
      },
      overallConfidence: { min: 0, max: 0.5 },
    },
    tags: ["boundary"],
  },

  // Non-manifold edge (may not be detected as non-manifold depending on implementation)
  {
    id: "edge-non-manifold",
    label: "Non-Manifold Edge — Topology Error",
    description: "Mesh with non-manifold edge configuration",
    input: {
      id: "non-manifold-edge",
      label: "Non-Manifold Edge",
      mesh: {
        type: "non-manifold-edge",
        params: { size: 10 },
        coordinateSystem: "z-up",
        expectedUnit: "mm",
      },
      material: {
        materialFamily: "fdm",
      },
    },
    expected: {
      modules: {
        topology: {
          moduleName: "topology",
          shouldExist: true,
          fields: {
            nonManifoldEdgeCount: { range: [0, 100] },
          },
        },
        validation: {
          moduleName: "validation",
          shouldExist: true,
          fields: {
            isWatertight: { value: false },
          },
        },
      },
      overallConfidence: { min: 0, max: 0.5 },
    },
    tags: ["boundary"],
  },

  // Degenerate mesh
  {
    id: "edge-degenerate",
    label: "Degenerate Mesh — Zero-Area Triangles",
    description: "Mesh with degenerate triangles",
    input: {
      id: "degenerate",
      label: "Degenerate Mesh",
      mesh: {
        type: "degenerate",
        params: {},
        coordinateSystem: "z-up",
        expectedUnit: "mm",
      },
      material: {
        materialFamily: "fdm",
      },
    },
    expected: {
      modules: {
        topology: {
          moduleName: "topology",
          shouldExist: true,
          fields: {
            manifoldEdgeCount: { range: [0, 100] },
          },
        },
        validation: {
          moduleName: "validation",
          shouldExist: true,
          fields: {
            degenerateFaceCount: { range: [0, 10] },
          },
        },
      },
      overallConfidence: { min: 0, max: 0.5 },
    },
    tags: ["boundary", "stress"],
  },

  // Empty mesh
  {
    id: "edge-empty",
    label: "Empty Mesh — No Geometry",
    description: "Empty mesh with no vertices or faces",
    input: {
      id: "empty-mesh",
      label: "Empty Mesh",
      mesh: {
        type: "empty",
        params: {},
        coordinateSystem: "z-up",
        expectedUnit: "mm",
      },
      material: {
        materialFamily: "fdm",
      },
    },
    expected: {
      modules: {
        topology: {
          moduleName: "topology",
          shouldExist: true,
          fields: {
            triangleCount: { range: [0, 0] },
            vertexCount: { range: [0, 0] },
          },
        },
        validation: {
          moduleName: "validation",
          shouldExist: true,
          fields: {
            totalFaceCount: { range: [0, 0] },
          },
        },
      },
      overallConfidence: { min: 0, max: 0.5 },
    },
    tags: ["boundary"],
  },

  // Very thin plate
  {
    id: "edge-thin-plate",
    label: "Thin Plate — Minimal Thickness",
    description: "Very thin plate (0.2mm) testing thickness thresholds",
    input: {
      id: "thin-plate",
      label: "Thin Plate",
      mesh: {
        type: "thin-plate",
        params: { width: 20, height: 20, thickness: 0.2 },
        coordinateSystem: "z-up",
        expectedUnit: "mm",
      },
      material: {
        materialFamily: "fdm",
      },
    },
    expected: {
      modules: {
        metrics: {
          moduleName: "metrics",
          shouldExist: true,
          fields: {
            meshVolumeMm3: { range: [70, 90] },
          },
        },
      },
      overallConfidence: { min: 0.2, max: 1.0 },
    },
    tags: ["boundary"],
  },

  // Large icosphere (stress test)
  {
    id: "stress-large-sphere",
    label: "Large Icosphere — Performance Stress",
    description: "Large icosphere with many triangles testing performance",
    input: {
      id: "large-sphere",
      label: "Large Sphere",
      mesh: {
        type: "icosphere",
        params: { radius: 50, segments: 4 },
        coordinateSystem: "z-up",
        expectedUnit: "mm",
      },
      material: {
        materialFamily: "fdm",
      },
    },
    expected: {
      modules: {
        topology: {
          moduleName: "topology",
          shouldExist: true,
          fields: {
            isManifold: { value: true },
          },
        },
        metrics: {
          moduleName: "metrics",
          shouldExist: true,
          fields: {
            triangleCount: { range: [5000, 500000] },
          },
        },
      },
      overallConfidence: { min: 0.3, max: 1.0 },
      stability: {
        maxTotalDurationMs: 10000,
      },
    },
    tags: ["stress"],
  },

  // Welded box (regression)
  {
    id: "regression-welded-box",
    label: "Welded Box — Regression Baseline",
    description: "Simple welded box for regression testing",
    input: {
      id: "welded-box",
      label: "Welded Box",
      mesh: {
        type: "welded-box",
        params: { size: 10 },
        coordinateSystem: "z-up",
        expectedUnit: "mm",
      },
      material: {
        materialFamily: "fdm",
      },
    },
    expected: {
      modules: {
        topology: {
          moduleName: "topology",
          shouldExist: true,
          fields: {
            isManifold: { value: true },
            manifoldEdgeCount: { range: [0, 100] },
            shellCount: { range: [1, 10] },
          },
        },
        validation: {
          moduleName: "validation",
          shouldExist: true,
          fields: {
            isWatertight: { value: false },
            holeCount: { range: [0, 10] },
          },
        },
        metrics: {
          moduleName: "metrics",
          shouldExist: true,
          fields: {
            meshVolumeMm3: { range: [900, 1100] },
          },
        },
      },
      overallConfidence: { min: 0.3, max: 1.0 },
      stability: {
        deterministicFields: [
          "topology.isManifold",
          "topology.shellCount",
        ],
      },
    },
    tags: ["regression"],
  },
];
