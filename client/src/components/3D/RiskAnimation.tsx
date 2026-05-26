import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SEMANTIC, ANIMATION, SIZES, OPACITIES, MATERIALS } from '@/lib/visualLanguage';
import { useThemeTokens } from '@/lib/ThemeContext';

interface RiskMarkerData {
  position: { x: number; y: number; z: number };
  severity: number;
  type: string;
}

interface RiskAnimationProps {
  markers: RiskMarkerData[];
  visible: boolean;
}

function PulsingSphere({ position, severity, type }: { position: [number, number, number]; severity: number; type: string }) {
  const ref = useRef<THREE.Mesh>(null);
  const ghostRef = useRef<THREE.Mesh>(null);
  const seed = useMemo(() => {
    return (position[0] * 127.1 + position[1] * 311.7 + position[2] * 74.3) % 100;
  }, [position]);

  const risk = type === 'thin_wall' ? SEMANTIC.risk.critical
    : type === 'delamination' ? SEMANTIC.risk.warning
    : SEMANTIC.risk.attention;

  const baseScale = ANIMATION.markerScale.base + severity * ANIMATION.markerScale.sevF;
  const showGhost = severity > 0.7;

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() + seed;
    if (!ref.current) return;

    const { breath, drift, orbit, ghostDrift, markerDrift, markerScale } = ANIMATION;
    const b = breath;

    const breathVal = Math.sin(t * b.speed) * b.normRange + b.normCenter;
    const flutter = Math.sin(t * b.flutterFreq + drift.yPhase) * b.flutterAmp;
    const rhythm = Math.max(b.minRhythm, breathVal + flutter);

    const pulse = 1 + Math.sin(t * orbit.speed + severity * 4) * orbit.factor;
    ref.current.scale.setScalar(baseScale * pulse);

    const instability = severity * markerDrift.amp;
    ref.current.position.x = position[0] + Math.sin(t * drift.speed) * instability;
    ref.current.position.y = position[1] + Math.sin(t * drift.speed * 0.5 + drift.yPhase) * instability * drift.vertRat;
    ref.current.position.z = position[2] + Math.cos(t * drift.speed * 0.5) * instability;

    const mat = ref.current.material as THREE.MeshBasicMaterial;
    mat.opacity = Math.min(risk.opacity * (1 + rhythm), OPACITIES.overlayMax);

    if (ghostRef.current && showGhost) {
      const { ghostDrift: gd } = ANIMATION;
      const ghostT = t * gd.speed;
      const driftAmp = gd.baseAmp + severity * gd.sevAmp;
      ghostRef.current.position.x = position[0] + Math.sin(ghostT * gd.xFreq + gd.xPhase) * driftAmp;
      ghostRef.current.position.y = position[1] + Math.sin(ghostT * gd.yFreq + gd.yPhase) * driftAmp * 0.5 * drift.vertRat;
      ghostRef.current.position.z = position[2] + Math.cos(ghostT * gd.zFreq + gd.zPhase) * driftAmp;
      const gMat = ghostRef.current.material as THREE.MeshBasicMaterial;
      const ghostPulse = Math.sin(t * b.ghostPulseF) * b.normRange + b.normCenter;
      gMat.opacity = ghostPulse * SEMANTIC.risk.ghost.opacity * severity;
    }
  });

  return (
    <>
      <mesh ref={ref} position={position}>
        <sphereGeometry args={[SIZES.markerSphere, SIZES.sphereSeg, SIZES.sphereSeg]} />
        <meshBasicMaterial {...MATERIALS.additive} color={risk.three} opacity={risk.opacity} />
      </mesh>
      {showGhost && (
        <mesh ref={ghostRef} position={position}>
          <sphereGeometry args={[SIZES.ghostSphere, SIZES.sphereSeg, SIZES.sphereSeg]} />
          <meshBasicMaterial {...MATERIALS.additive} color={risk.three} opacity={0} />
        </mesh>
      )}
    </>
  );
}

export function RiskAnimation({ markers, visible }: RiskAnimationProps) {
  const SEMANTIC = useThemeTokens();
  const riskPoints = useMemo(() => {
    return markers
      .filter(m => m.position && ['thin_wall', 'delamination', 'stress_concentration'].includes(m.type))
      .slice(0, 25)
      .map(m => ({
        position: [m.position.x, m.position.y, m.position.z] as [number, number, number],
        severity: m.severity,
        type: m.type,
      }));
  }, [markers]);

  if (!visible || riskPoints.length === 0) return null;

  return (
    <group>
      {riskPoints.map((point, i) => (
        <PulsingSphere key={i} position={point.position} severity={point.severity} type={point.type} />
      ))}
    </group>
  );
}
