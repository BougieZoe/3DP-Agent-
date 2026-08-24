/**
 * S3 — Validation Test Cases
 *
 * Synthetic test cases covering normal conditions, edge cases, and regression.
 * Each case includes input generation params and expected outputs.
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
            closed: { value: true },
            manifoldEdges: { value: 0 },
            nonManifoldEdges: { value: 0 },
            intersectingFaces: { value: 0 },
            redundantFaces: { value: 0 },
            reversedNormalFaces: { value: 0 },
            openEdges: { value: 0 },
            duplicateFaces: { value: 0 },
            selfIntersections: { value: 0 },
            genus: { value: 0 },
            shellCount: { range: [1, 1] },
            isWatertight: { value: true },
          },
        },
        validation: {
          moduleName: "validation",
          shouldExist: true,
          fields: {
            status: { value: "manifold" },
            confidence: { range: [0.9, 1] },
            slicerReady: { value: true },
            printabilityScore: { range: [0.8, 1] },
          },
        },
        metrics: {
          moduleName: "metrics",
          shouldExist: true,
          fields: {
            volumeMm3: { range: [7500, 8500] },
            surfaceAreaMm2: { range: [2300, 2500] },
            boundingBox: {
              satisfies: "boundingBoxDimensions",
            },
            triangleCount: { range: [12, 1000] },
            dimensions: { satisfies: "dimensionsXYZ" },
          },
        },
        bedFit: {
          moduleName: "bedFit",
          shouldExist: true,
          fields: {
            fits: { value: true },
            printerModel: { exists: true },
            bedSize: { satisfies: "bedSizeObject" },
          },
          constraints: [{ field: "result.fits", op: "==", value: true }],
        },
        support: {
          moduleName: "support",
          shouldExist: true,
          fields: {
            needsSupport: { value: false },
            estimatedVolumeCm3: { range: [0, 0.1] },
            estimatedPrintTimeMinutes: { range: [0, 0.1] },
          },
          constraints: [
            { field: "result.needsSupport", op: "==", value: false },
          ],
        },
        printTime: {
          moduleName: "printTime",
          shouldExist: true,
          fields: {
            estimatedMinutes: { range: [5, 60] },
            filamentGrams: { range: [1, 50] },
            filamentMm: { range: [100, 5000] },
          },
          constraints: [
            { field: "result.estimatedMinutes", op: ">=", value: 1 },
          ],
        },
        thermal: {
          moduleName: "thermal",
          shouldExist: true,
          fields: {
            warpingRisk: { range: [0, 0.5] },
            bedAdhesionScore: { range: [0.5, 1] },
            recommendedBedTempC: { range: [20, 70] },
            recommendedPrintTempC: { range: [180, 260] },
            layerAdhesion: { range: [0.5, 1] },
          },
        },
      },
      overallConfidence: { min: 0.7, max: 1.0 },
      stability: {
        deterministicFields: [
          "topology.closed",
          "topology.manifoldEdges",
          "topology.shellCount",
          "validation.status",
          "bedFit.fits",
          "support.needsSupport",
        ],
      },
    },
    tags: ["regression"],
  },

  // Open cube (non-manifold)
  {
    id: "normal-open-cube",
    label: "Open Cube — Non-Manifold Detection",
    description:
      "Cube with top face removed — tests non-manifold edge detection",
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
            closed: { value: false },
            nonManifoldEdges: { range: [1, 100] },
            openEdges: { range: [4, 100] },
            isWatertight: { value: false },
          },
        },
        validation: {
          moduleName: "validation",
          shouldExist: true,
          fields: {
            status: { value: "non-manifold" },
            confidence: { range: [0.6, 1] },
            slicerReady: { value: false },
          },
        },
        thermal: {
          moduleName: "thermal",
          shouldExist: true,
          fields: {
            warpingRisk: { range: [0, 1] },
            bedAdhesionScore: { range: [0, 1] },
          },
        },
      },
      overallConfidence: { min: 0.5, max: 1.0 },
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
            needsSupport: { value: false },
          },
        },
        metrics: {
          moduleName: "metrics",
          shouldExist: true,
          fields: {
            volumeMm3: { range: [400, 700] },
          },
        },
        thermal: {
          moduleName: "thermal",
          shouldExist: true,
          fields: {
            warpingRisk: { range: [0, 0.3] },
          },
        },
      },
      overallConfidence: { min: 0.7, max: 1.0 },
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
            needsSupport: { value: true },
            estimatedVolumeCm3: { range: [0.01, 100] },
          },
          constraints: [
            { field: "result.needsSupport", op: "==", value: true },
          ],
        },
      },
      overallConfidence: { min: 0.6, max: 1.0 },
    },
    tags: ["regression"],
  },

  // Large flat plate
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
            fits: { value: false },
          },
          constraints: [{ field: "result.fits", op: "==", value: false }],
        },
        metrics: {
          moduleName: "metrics",
          shouldExist: true,
          fields: {
            volumeMm3: { range: [19000, 21000] },
          },
        },
      },
      overallConfidence: { min: 0.7, max: 1.0 },
    },
    tags: ["regression"],
  },

  // Icosphere
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
            closed: { value: true },
            isWatertight: { value: true },
            shellCount: { range: [1, 1] },
          },
        },
        validation: {
          moduleName: "validation",
          shouldExist: true,
          fields: {
            status: { value: "manifold" },
            confidence: { range: [0.8, 1] },
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
      overallConfidence: { min: 0.8, max: 1.0 },
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
            isWatertight: { value: true },
          },
        },
        validation: {
          moduleName: "validation",
          shouldExist: true,
          fields: {
            confidence: { range: [0.5, 1] },
          },
        },
      },
      overallConfidence: { min: 0.5, max: 1.0 },
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
            shellCount: { range: [2, 2] },
            closed: { value: true },
          },
        },
        validation: {
          moduleName: "validation",
          shouldExist: true,
          fields: {
            status: { value: "multi-shell" },
          },
        },
      },
      overallConfidence: { min: 0.6, max: 1.0 },
    },
    tags: ["regression"],
  },

  // ===========================================================================
  // Use Case 2: Edge Cases
  // ===========================================================================

  // Single triangle
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
            closed: { value: false },
            openEdges: { range: [3, 3] },
          },
        },
        validation: {
          moduleName: "validation",
          shouldExist: true,
          fields: {
            status: { value: "non-manifold" },
            confidence: { range: [0.3, 0.8] },
          },
        },
      },
      overallConfidence: { min: 0.3, max: 0.8 },
    },
    tags: ["boundary"],
  },

  // Inverted normals
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
        topology: {
          moduleName: "topology",
          shouldExist: true,
          fields: {
            reversedNormalFaces: { range: [1, 100] },
          },
        },
        validation: {
          moduleName: "validation",
          shouldExist: true,
          fields: {
            status: { value: "non-manifold" },
            confidence: { range: [0.5, 0.9] },
          },
        },
      },
      overallConfidence: { min: 0.5, max: 0.9 },
    },
    tags: ["boundary"],
  },

  // Non-manifold edge
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
            nonManifoldEdges: { range: [1, 100] },
          },
        },
        validation: {
          moduleName: "validation",
          shouldExist: true,
          fields: {
            status: { value: "non-manifold" },
            slicerReady: { value: false },
          },
        },
      },
      overallConfidence: { min: 0.5, max: 0.9 },
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
            manifoldEdges: { range: [0, 100] },
          },
        },
        validation: {
          moduleName: "validation",
          shouldExist: true,
          fields: {
            confidence: { range: [0, 0.5] },
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
            closed: { value: false },
          },
        },
        validation: {
          moduleName: "validation",
          shouldExist: true,
          fields: {
            status: { value: "error" },
            confidence: { range: [0, 0.1] },
          },
        },
      },
      overallConfidence: { min: 0, max: 0.1 },
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
            volumeMm3: { range: [70, 90] },
          },
        },
        thermal: {
          moduleName: "thermal",
          shouldExist: true,
          fields: {
            warpingRisk: { range: [0, 0.5] },
          },
        },
      },
      overallConfidence: { min: 0.7, max: 1.0 },
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
            closed: { value: true },
            isWatertight: { value: true },
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
      overallConfidence: { min: 0.8, max: 1.0 },
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
            closed: { value: true },
            manifoldEdges: { value: 0 },
            isWatertight: { value: true },
          },
        },
        validation: {
          moduleName: "validation",
          shouldExist: true,
          fields: {
            status: { value: "manifold" },
            confidence: { range: [0.9, 1] },
          },
        },
        metrics: {
          moduleName: "metrics",
          shouldExist: true,
          fields: {
            volumeMm3: { range: [900, 1100] },
          },
        },
      },
      overallConfidence: { min: 0.8, max: 1.0 },
      stability: {
        deterministicFields: [
          "topology.closed",
          "topology.manifoldEdges",
          "validation.status",
        ],
      },
    },
    tags: ["regression"],
  },
];
