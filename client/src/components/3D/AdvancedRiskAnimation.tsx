/**
 * Advanced Risk Animation
 *
 * Enhanced with:
 * - Stress concentration detection
 * - Geometry-based risk scoring
 * - Animated pulse visualization
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { COLORS, ANIMATION, MATERIALS } from '@/lib/visualLanguage';

interface AdvancedRiskProps {
  geometry: THREE.BufferGeometry;
  visible: boolean;
  sensitivity?: number;
  minSeverity?: number;
}

interface RiskPoint {
  position: [number, number, number];
  severity: number;
  type: 'thin_wall' | 'stress' | 'overhang' | 'sharp_edge';
}

export function AdvancedRiskAnimation({
  geometry,
  visible,
  sensitivity = 1,
  minSeverity = 0.3,
}: AdvancedRiskProps) {
  const riskPoints = useMemo(() => {
    const positions = geometry.getAttribute('position');
    const normals = geometry.getAttribute('normal');
    const indices = geometry.getIndex();
    if (!positions || !normals || !indices) return [];

    const pos = positions.array as Float32Array;
    const norm = normals.array as Float32Array;
    const idx = indices.array as Uint32Array;
    const vertexCount = positions.count;
    const faceCount = idx.length / 3;

    const risks: RiskPoint[] = [];

    // 1. Find thin wall regions (high curvature + thin cross-section)
    const curvature = new Float32Array(vertexCount);
    for (let f = 0; f < faceCount; f++) {
      const i0 = idx[f * 3];
      const i1 = idx[f * 3 + 1];
      const i2 = idx[f * 3 + 2];

      const compareNormals = (a: number, b: number) => {
        const dot = norm[a * 3] * norm[b * 3]
          + norm[a * 3 + 1] * norm[b * 3 + 1]
          + norm[a * 3 + 2] * norm[b * 3 + 2];
        const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
        curvature[a] = Math.max(curvature[a], angle);
        curvature[b] = Math.max(curvature[b], angle);
      };

      compareNormals(i0, i1);
      compareNormals(i1, i2);
      compareNormals(i2, i0);
    }

    // 2. Find stress concentrations (sharp edges with high curvature)
    for (let i = 0; i < vertexCount; i++) {
      const sev = curvature[i] / Math.PI * sensitivity;
      if (sev > minSeverity && sev > 0.5) {
        risks.push({
          position: [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]],
          severity: Math.min(1, sev),
          type: 'sharp_edge',
        });
      }
    }

    // 3. Find overhang regions
    for (let f = 0; f < Math.min(faceCount, 50000); f++) {
      const i0 = idx[f * 3] * 3;
      const i1 = idx[f * 3 + 1] * 3;
      const i2 = idx[f * 3 + 2] * 3;

      const nz = (norm[i0 + 2] + norm[i1 + 2] + norm[i2 + 2]) / 3;
      const angle = Math.acos(Math.max(-1, Math.min(1, nz))) * (180 / Math.PI);

      if (angle > 50) {
        const cx = (pos[i0] + pos[i1] + pos[i2]) / 3;
        const cy = (pos[i0 + 1] + pos[i1 + 1] + pos[i2 + 1]) / 3;
        const cz = (pos[i0 + 2] + pos[i1 + 2] + pos[i2 + 2]) / 3;

        const sev = ((angle - 50) / 40) * sensitivity;
        if (sev > minSeverity) {
          risks.push({
            position: [cx, cy, cz],
            severity: Math.min(1, sev),
            type: 'overhang',
          });
        }
      }
    }

    // Sort by severity, take top N
    return risks
      .sort((a, b) => b.severity - a.severity)
      .slice(0, 25);
  }, [geometry, sensitivity, minSeverity]);

  if (!visible || riskPoints.length === 0) return null;

  return (
    <group>
      {riskPoints.map((point, i) => (
        <RiskSphere key={i} point={point} />
      ))}
    </group>
  );
}

function RiskSphere({ point }: { point: RiskPoint }) {
  const ref = useRef<THREE.Mesh>(null);
  const seed = useMemo(() => {
    return (point.position[0] * 127.1 + point.position[1] * 311.7 + point.position[2] * 74.3) % 100;
  }, [point.position]);

  const color = point.type === 'sharp_edge' ? COLORS.risk.sharpEdge
    : point.type === 'overhang' ? COLORS.risk.overhang
    : COLORS.risk.thinWall;

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime() + seed;

    const pulse = 1 + Math.sin(t * ANIMATION.breath.pulseFreq) * ANIMATION.breath.pulseAmp * point.severity;
    ref.current.scale.setScalar(ANIMATION.markerScale.base * pulse);

    ref.current.position.x = point.position[0] + Math.sin(t * ANIMATION.drift.speed) * ANIMATION.drift.ampFact;
    ref.current.position.y = point.position[1] + Math.sin(t * ANIMATION.drift.speed * 0.6 + 1) * ANIMATION.drift.ampFact * ANIMATION.drift.vertRat;
    ref.current.position.z = point.position[2] + Math.cos(t * ANIMATION.drift.speed * 0.8) * ANIMATION.drift.ampFact;
  });

  return (
    <mesh ref={ref} position={point.position}>
      <sphereGeometry args={[1, 12, 12]} />
      <meshBasicMaterial
        color={color}
        {...MATERIALS.additive}
        opacity={ANIMATION.markerScale.base + point.severity * ANIMATION.breath.pulseAmp}
      />
    </mesh>
  );
}
