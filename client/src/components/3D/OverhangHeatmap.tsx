import { useMemo } from 'react';
import * as THREE from 'three';

interface OverhangHeatmapProps {
  geometry: THREE.BufferGeometry;
  visible: boolean;
  opacity?: number;
}

export function OverhangHeatmap({ geometry, visible, opacity = 0.7 }: OverhangHeatmapProps) {
  const heatmapGeo = useMemo(() => {
    const srcPos = geometry.getAttribute('position');
    const srcNorm = geometry.getAttribute('normal');
    if (!srcPos || !srcNorm) return null;

    const positions = srcPos.array as Float32Array;
    const normals = srcNorm.array as Float32Array;
    const vertexCount = srcPos.count;

    const colors = new Float32Array(vertexCount * 3);

    for (let i = 0; i < vertexCount; i++) {
      const nx = normals[i * 3];
      const ny = normals[i * 3 + 1];
      const nz = normals[i * 3 + 2];
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const normalizedY = len > 0 ? ny / len : ny;

      const angle = Math.acos(Math.max(-1, Math.min(1, normalizedY))) * (180 / Math.PI);

      let r: number, g: number, b: number;
      if (angle <= 30) {
        const t = angle / 30;
        r = t * 0.2;
        g = 1 - t * 0.3;
        b = 0.1 + t * 0.1;
      } else if (angle <= 45) {
        const t = (angle - 30) / 15;
        r = 0.2 + t * 0.8;
        g = 0.7 - t * 0.5;
        b = 0.2 - t * 0.2;
      } else if (angle <= 70) {
        const t = (angle - 45) / 25;
        r = 1;
        g = 0.2 - t * 0.15;
        b = 0;
      } else {
        r = 0.8;
        g = 0;
        b = 0.6;
      }

      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(geometry.getIndex());
    geo.computeVertexNormals();

    return geo;
  }, [geometry]);

  if (!visible || !heatmapGeo) return null;

  return (
    <mesh geometry={heatmapGeo} renderOrder={1}>
      <meshPhongMaterial
        vertexColors
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-1}
      />
    </mesh>
  );
}
