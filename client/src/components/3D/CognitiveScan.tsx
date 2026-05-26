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

  const bounds = useMemo(() => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    return { minY: box.min.y - 0.5, maxY: box.max.y + 0.5 };
  }, [geometry]);

  useFrame(() => {
    if (!ref.current) return;
    const t = progressRef.current;
    ref.current.position.y = bounds.minY + t * (bounds.maxY - bounds.minY);
  });

  if (!visible) return null;

  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[SIZES.scanPlane, SIZES.scanPlane]} />
      <meshBasicMaterial {...MATERIALS.additiveDouble} color={SEMANTIC.scan.plane.three} opacity={SEMANTIC.scan.plane.opacity} />
    </mesh>
  );
}
