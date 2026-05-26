import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { usePrintPlayback } from '@/components/playback/PrintPlaybackContext';
import { ANIMATION, SIZES, MATERIALS } from '@/lib/visualLanguage';
import { useThemeTokens } from '@/lib/ThemeContext';

interface RiskMarkerData {
  position: { x: number; y: number; z: number };
  severity: number;
  type: string;
}

interface ThermalFieldProps {
  markers: RiskMarkerData[];
  geometry: THREE.BufferGeometry;
  visible: boolean;
  opacity?: number;
}

export function ThermalField({ markers, geometry, visible, opacity: opacityProp }: ThermalFieldProps) {
  const SEMANTIC = useThemeTokens();
  const opacity = opacityProp ?? SEMANTIC.thermal.opacity;
  const groupRef = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.PointsMaterial | null>(null);
  const activated = useRef<Map<number, number>>(new Map());
  const { progressRef } = usePrintPlayback();

  const bounds = useMemo(() => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    return { minY: box.min.y - 0.5, maxY: box.max.y + 0.5 };
  }, [geometry]);

  const points = useMemo(() => {
    const { severityMin, maxPoints } = ANIMATION.thermal;
    const valid = markers.filter(m => m.position && m.severity > severityMin).slice(0, maxPoints);
    const positions = new Float32Array(valid.length * 3);
    const colors = new Float32Array(valid.length * 3);
    const indices: number[] = [];
    const cool = new THREE.Color(SEMANTIC.thermal.cool.three);
    const warm = new THREE.Color(SEMANTIC.thermal.warm.three);

    for (let i = 0; i < valid.length; i++) {
      const m = valid[i];
      positions[i * 3] = m.position.x;
      positions[i * 3 + 1] = m.position.y;
      positions[i * 3 + 2] = m.position.z;
      const c = cool.clone().lerp(warm, m.severity * 0.55);
      colors[i * 3]     = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      indices.push(m.position.x + m.position.y + m.position.z);
    }

    return { positions, colors, count: valid.length, indices };
  }, [markers]);

  useEffect(() => {
    if (!groupRef.current || points.count === 0) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(points.positions.slice(), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(points.colors.slice(), 3));
    const mat = new THREE.PointsMaterial({
      ...MATERIALS.points,
      size: SIZES.point,
      vertexColors: true,
      opacity: 0,
    });
    const system = new THREE.Points(geo, mat);
    system.frustumCulled = false;
    groupRef.current.add(system);
    matRef.current = mat;
    return () => { groupRef.current?.clear(); geo.dispose(); mat.dispose(); };
  }, [points]);

  useFrame(() => {
    const { rampRate } = ANIMATION.thermal;
    const scanY = bounds.minY + progressRef.current * (bounds.maxY - bounds.minY);

    for (let i = 0; i < points.count; i++) {
      const key = points.indices[i];
      if (!activated.current.has(key)) activated.current.set(key, 0);
      const y = points.positions[i * 3 + 1];
      if (Math.abs(y - scanY) < ANIMATION.scan.proxThresh) {
        const current = activated.current.get(key)!;
        activated.current.set(key, Math.min(current + rampRate, 1));
      }
    }

    if (matRef.current) {
      const avgActive = points.count > 0
        ? points.indices.reduce((sum, idx) => sum + (activated.current.get(idx) ?? 0), 0) / points.count
        : 0;
      matRef.current.opacity = avgActive * opacity;
    }
  });

  if (!visible || points.count === 0) return null;
  return <group ref={groupRef} />;
}
