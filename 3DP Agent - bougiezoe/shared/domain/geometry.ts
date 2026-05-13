// shared/domain/geometry.ts
// Pure data contracts — no React, no Three.js, no side effects

export interface BoundingBox {
    minX: number; maxX: number;
    minY: number; maxY: number;
    minZ: number; maxZ: number;
  }
  
  export interface GeometryMetrics {
    readonly triangleCount: number;
    readonly vertexCount: number;
    readonly volume: number;          // cm³
    readonly surfaceArea: number;     // cm²
    readonly boundingBox: BoundingBox;
    readonly dimensions: {
      readonly width: number;         // X span, mm
      readonly depth: number;         // Y span, mm
      readonly height: number;        // Z span, mm
    };
    readonly isManifold: boolean;
    readonly hasNormals: boolean;
  }
  
  export function emptyBoundingBox(): BoundingBox {
    return {
      minX: Infinity, maxX: -Infinity,
      minY: Infinity, maxY: -Infinity,
      minZ: Infinity, maxZ: -Infinity,
    };
  }
  
  export function boundingBoxDimensions(bb: BoundingBox) {
    return {
      width:  bb.maxX - bb.minX,
      depth:  bb.maxY - bb.minY,
      height: bb.maxZ - bb.minZ,
    };
  }