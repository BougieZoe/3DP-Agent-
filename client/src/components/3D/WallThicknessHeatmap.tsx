import { useMemo } from 'react';
import * as THREE from 'three';
import type { WallThicknessSample } from '@/analysis/types';
import { getThresholds } from '@/analysis/thresholds';

export interface WallThicknessHeatmapProps {
  geometry: THREE.BufferGeometry;
  samples: WallThicknessSample[] | null;
  visible: boolean;
  opacity?: number;
}

/**
 * Heat color for a wall-thickness sample. Thin walls (≤ thinWallMm) are hot
 * (red); thickness ramps to amber → green → cyan as it approaches maxMm.
 * Normalization domain: [thinWallMm, maxMm]; anything below thinWallMm clamps
 * to red, anything above maxMm clamps to cyan.
 */
export function wallThicknessColor(thickness: number, thinWallMm: number, maxMm: number): [number, number, number] {
  const stops: Array<[number, [number, number, number]]> = [
    [0, [1.0, 0.15, 0.10]],
    [1 / 3, [1.0, 0.65, 0.10]],
    [2 / 3, [0.25, 0.85, 0.45]],
    [1, [0.20, 0.90, 1.00]],
  ];

  const span = maxMm - thinWallMm;
  const u = span <= 0
    ? (thickness <= thinWallMm ? 0 : 1)
    : Math.max(0, Math.min(1, (thickness - thinWallMm) / span));

  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i - 1];
    const [t2, c2] = stops[i];
    if (u <= t2) {
      const k = t2 === t1 ? 0 : (u - t1) / (t2 - t1);
      return [
        c1[0] + (c2[0] - c1[0]) * k,
        c1[1] + (c2[1] - c1[1]) * k,
        c1[2] + (c2[2] - c1[2]) * k,
      ];
    }
  }
  return stops[stops.length - 1][1];
}

export function WallThicknessHeatmap({ geometry, samples, visible, opacity = 0.7 }: WallThicknessHeatmapProps) {
  const points = useMemo(() => {
    if (!samples || samples.length === 0) return null;

    const thinWallMm = getThresholds().wallThickness.thinWallMm;
    const maxMm = samples.reduce((m, s) => (s.thickness > m ? s.thickness : m), thinWallMm);

    const positions = new Float32Array(samples.length * 3);
    const colors = new Float32Array(samples.length * 3);

    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      positions[i * 3] = s.position.x;
      positions[i * 3 + 1] = s.position.y;
      positions[i * 3 + 2] = s.position.z;
      const [r, g, b] = wallThicknessColor(s.thickness, thinWallMm, maxMm);
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const bbox = new THREE.Box3().setFromBufferAttribute(geo.getAttribute('position') as THREE.BufferAttribute);
    const size = bbox.getSize(new THREE.Vector3()).length() / 160;
    return { geo, size };
  }, [samples, geometry]);

  if (!visible || !points) return null;

  return (
    <points geometry={points.geo} renderOrder={2}>
      <pointsMaterial
        size={points.size}
        vertexColors
        transparent
        opacity={opacity}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
