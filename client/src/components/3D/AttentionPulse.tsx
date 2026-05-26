import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { usePrintPlayback } from '@/components/playback/PrintPlaybackContext';
import { SEMANTIC, ANIMATION, SIZES, MATERIALS } from '@/lib/visualLanguage';
import { useThemeTokens } from '@/lib/ThemeContext';

interface RiskMarkerData {
  position: { x: number; y: number; z: number };
  severity: number;
  type: string;
}

interface AttentionPulseProps {
  markers: RiskMarkerData[];
  geometry: THREE.BufferGeometry;
  visible?: boolean;
}

interface Pulse {
  id: number;
  position: [number, number, number];
  severity: number;
  color: string;
  birth: number;
  delay: number;
}

function PulseRing({ pulse }: { pulse: Pulse }) {
  const ref = useRef<THREE.Mesh>(null);
  const { progressRef } = usePrintPlayback();
  const { scaleBase, scaleGrowth, scaleSev, opacityBase, opacitySev } = ANIMATION.attention;

  useFrame(() => {
    if (!ref.current) return;
    const age = progressRef.current * 10 - pulse.birth - pulse.delay;
    if (age < 0) { ref.current.visible = false; return; }
    ref.current.visible = true;
    const progress = Math.min(age / ANIMATION.attention.lifetime, 1);
    const scale = scaleBase + progress * (scaleGrowth + pulse.severity * scaleSev);
    ref.current.scale.setScalar(scale);
    const mat = ref.current.material as THREE.MeshBasicMaterial;
    mat.opacity = Math.max(0, (1 - progress) * SEMANTIC.scan.pulse.opacity * (opacityBase + pulse.severity * opacitySev));
  });

  return (
    <mesh ref={ref} position={pulse.position} scale={[SIZES.initialScale, SIZES.initialScale, SIZES.initialScale]}>
      <sphereGeometry args={[SIZES.pulseRadius, SIZES.sphereSegLow, SIZES.sphereSegLow]} />
      <meshBasicMaterial {...MATERIALS.additive} color={pulse.color} opacity={0} />
    </mesh>
  );
}

export function AttentionPulse({ markers, geometry, visible = true }: AttentionPulseProps) {
  const SEMANTIC = useThemeTokens();
  const { progressRef } = usePrintPlayback();
  const nextId = useRef(0);
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const lastTriggered = useRef<Map<string, number>>(new Map());
  const { lifetime, scanThresh, maxDelay, cooldown } = ANIMATION.attention;

  const bounds = useMemo(() => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    return { minY: box.min.y - 0.5, maxY: box.max.y + 0.5 };
  }, [geometry]);

  const colorForType = (type: string) =>
    type === 'thin_wall' ? SEMANTIC.attention.thinWall.css
      : type === 'delamination' ? SEMANTIC.attention.delamination.css
      : SEMANTIC.attention.default.css;

  useFrame(() => {
    const now = progressRef.current * 10;
    const scanY = bounds.minY + progressRef.current * (bounds.maxY - bounds.minY);

    const active: Pulse[] = [];
    for (const p of pulses) {
      if (now - p.birth < lifetime + ANIMATION.attention.lifetimePad) active.push(p);
    }

    for (const m of markers) {
      if (!m.position) continue;
      const dy = Math.abs(m.position.y - scanY);
      if (dy > scanThresh) continue;

      const key = `${m.position.x.toFixed(2)},${m.position.y.toFixed(2)},${m.position.z.toFixed(2)}`;
      const lastT = lastTriggered.current.get(key) ?? -Infinity;
      if (now - lastT < cooldown) continue;

      active.push({
        id: nextId.current++,
        position: [m.position.x, m.position.y, m.position.z] as [number, number, number],
        severity: m.severity,
        color: colorForType(m.type),
        birth: now,
        delay: Math.random() * maxDelay,
      });
      lastTriggered.current.set(key, now);
    }

    setPulses(active);
  });

  if (!visible) return null;

  return (
    <group>
      {pulses.map(p => <PulseRing key={p.id} pulse={p} />)}
    </group>
  );
}
