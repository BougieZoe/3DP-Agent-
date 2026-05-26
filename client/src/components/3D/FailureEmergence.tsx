import { useEffect, useMemo, useRef } from 'react';
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

interface FailureEmergenceProps {
  markers: RiskMarkerData[];
  geometry: THREE.BufferGeometry;
  visible: boolean;
}

function useBounds(geometry: THREE.BufferGeometry) {
  return useMemo(() => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    return { minY: box.min.y - 0.5, maxY: box.max.y + 0.5 };
  }, [geometry]);
}

function useActivation(y: number, bounds: { minY: number; maxY: number }): React.RefObject<number> {
  const level = useRef(0);
  const { progressRef } = usePrintPlayback();

  useFrame(() => {
    const scanY = bounds.minY + progressRef.current * (bounds.maxY - bounds.minY);
    if (Math.abs(y - scanY) < ANIMATION.scan.scanNear) {
      level.current = Math.min(level.current + ANIMATION.reveal.activationRamp, 1);
    }
  });

  return level;
}

function SaggingBridge({ position, severity, bounds }: {
  position: [number, number, number]; severity: number; bounds: { minY: number; maxY: number };
}) {
  const groupRef = useRef<THREE.Group>(null);
  const lineRef = useRef<THREE.Line>(null);
  const activation = useActivation(position[1], bounds);
  const maxSag = severity * ANIMATION.sag.maxFactor;

  useEffect(() => {
    if (!groupRef.current) return;
    const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -SIZES.sagLineInit, 0)];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({
      ...MATERIALS.line,
      color: SEMANTIC.failure.sag.three,
      opacity: 0,
    });
    const line = new THREE.Line(geo, mat);
    groupRef.current.add(line);
    lineRef.current = line;
    return () => { groupRef.current?.clear(); geo.dispose(); mat.dispose(); };
  }, []);

  useFrame(() => {
    if (!lineRef.current) return;
    const reveal = Math.min(activation.current * ANIMATION.reveal.rate, 1);
    const sag = reveal * maxSag;
    const pos = lineRef.current.geometry.attributes.position.array as Float32Array;
    pos[1] = -sag; pos[4] = -sag;
    lineRef.current.geometry.attributes.position.needsUpdate = true;
    const mat = lineRef.current.material as THREE.LineBasicMaterial;
    mat.opacity = reveal * SEMANTIC.failure.overlay.sag;
  });

  return <group ref={groupRef} position={position} />;
}

function OscillatingRegion({ position, severity, bounds }: {
  position: [number, number, number]; severity: number; bounds: { minY: number; maxY: number };
}) {
  const ref = useRef<THREE.Mesh>(null);
  const activation = useActivation(position[1], bounds);
  const { progressRef } = usePrintPlayback();

  useFrame(() => {
    if (!ref.current) return;
    const { oscillate: osc, reveal } = ANIMATION;
    const revealVal = Math.min(activation.current * reveal.rate, 1);
    const t = progressRef.current * 10 * (1 + severity * osc.severityMult);
    const amp = revealVal * severity * osc.ampFact;
    ref.current.position.x = position[0] + Math.sin(t * osc.speed) * amp;
    ref.current.position.z = position[2] + Math.cos(t * osc.freqB) * amp;
    const mat = ref.current.material as THREE.MeshBasicMaterial;
    mat.opacity = revealVal * (SEMANTIC.failure.overlay.sag * 0.5 + severity * 0.06);
  });

  return (
    <mesh ref={ref} position={position}>
      <sphereGeometry args={[SIZES.oscRadius, SIZES.sphereSegMin, SIZES.sphereSegMin]} />
      <meshBasicMaterial {...MATERIALS.additive} color={SEMANTIC.failure.oscillate.three} opacity={0} />
    </mesh>
  );
}

function StressPulse({ position, severity, bounds }: {
  position: [number, number, number]; severity: number; bounds: { minY: number; maxY: number };
}) {
  const ref = useRef<THREE.Mesh>(null);
  const activation = useActivation(position[1], bounds);
  const { progressRef } = usePrintPlayback();

  useFrame(() => {
    if (!ref.current) return;
    const { stressPulse: sp, reveal } = ANIMATION;
    const revealVal = Math.min(activation.current * reveal.rate, 1);
    if (revealVal <= 0) return;
    const t = progressRef.current * 10 * sp.speed;
    const pulse = Math.sin(t + severity * sp.sevPhase) * 0.5 + 0.5;
    const scale = sp.scaleBase + pulse * severity * sp.scaleSev;
    ref.current.scale.setScalar(scale);
    const mat = ref.current.material as THREE.MeshBasicMaterial;
    mat.opacity = revealVal * pulse * SEMANTIC.failure.overlay.stress;
  });

  return (
    <mesh ref={ref} position={position} scale={[SIZES.initialScale, SIZES.initialScale, SIZES.initialScale]}>
      <sphereGeometry args={[SIZES.stressRadius, SIZES.sphereSegLow, SIZES.sphereSegLow]} />
      <meshBasicMaterial {...MATERIALS.additive} color={SEMANTIC.failure.stress.three} opacity={0} />
    </mesh>
  );
}

export function FailureEmergence({ markers, geometry, visible }: FailureEmergenceProps) {
  const SEMANTIC = useThemeTokens();
  const bounds = useBounds(geometry);

  const sagging = useMemo(() =>
    markers.filter(m => m.position && m.type === 'overhang').slice(0, 15).map(m => ({
      position: [m.position.x, m.position.y, m.position.z] as [number, number, number],
      severity: m.severity,
    })), [markers]);

  const oscillating = useMemo(() =>
    markers.filter(m => m.position && m.type === 'thin_wall').slice(0, 15).map(m => ({
      position: [m.position.x, m.position.y, m.position.z] as [number, number, number],
      severity: m.severity,
    })), [markers]);

  const stress = useMemo(() =>
    markers.filter(m => m.position && m.type === 'support_needed').slice(0, 15).map(m => ({
      position: [m.position.x, m.position.y, m.position.z] as [number, number, number],
      severity: m.severity,
    })), [markers]);

  if (!visible) return null;

  return (
    <group>
      {sagging.map((m, i) => <SaggingBridge key={`sag-${i}`} position={m.position} severity={m.severity} bounds={bounds} />)}
      {oscillating.map((m, i) => <OscillatingRegion key={`osc-${i}`} position={m.position} severity={m.severity} bounds={bounds} />)}
      {stress.map((m, i) => <StressPulse key={`str-${i}`} position={m.position} severity={m.severity} bounds={bounds} />)}
    </group>
  );
}
