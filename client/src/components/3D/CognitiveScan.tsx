import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { usePrintPlayback } from '@/components/playback/PrintPlaybackContext';
import { SIZES, MATERIALS } from '@/lib/visualLanguage';
import { useThemeTokens } from '@/lib/ThemeContext';

interface CognitiveScanProps {
  geometry: THREE.BufferGeometry;
  visible?: boolean;
}

export function CognitiveScan({ geometry, visible = true }: CognitiveScanProps) {
  const SEMANTIC = useThemeTokens();
  const ref = useRef<THREE.Mesh>(null);
  const { progressRef } = usePrintPlayback();

  // Data frame is Z-up: the scan sheet spans X×Y and rides up Z.
  // (The old rotation + Y sweep belonged to a Y-up assumption.)
  const bounds = useMemo(() => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    return { minZ: box.min.z - 0.5, maxZ: box.max.z + 0.5 };
  }, [geometry]);

  useFrame(() => {
    if (!ref.current) return;
    const t = progressRef.current;
    ref.current.position.z = bounds.minZ + t * (bounds.maxZ - bounds.minZ);
  });

  if (!visible) return null;

  return (
    <mesh ref={ref}>
      <planeGeometry args={[SIZES.scanPlane, SIZES.scanPlane]} />
      <meshBasicMaterial {...MATERIALS.additiveDouble} color={SEMANTIC.scan.plane.three} opacity={SEMANTIC.scan.plane.opacity} />
    </mesh>
  );
}
