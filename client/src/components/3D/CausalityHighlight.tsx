import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ANIMATION, SIZES, MATERIALS } from '@/lib/visualLanguage';
import { useThemeTokens } from '@/lib/ThemeContext';

interface CausalityHighlightProps {
  positions: Array<{ x: number; y: number; z: number }>;
  visible: boolean;
}

export function CausalityHighlight({ positions, visible }: CausalityHighlightProps) {
  const SEMANTIC = useThemeTokens();
  const points = useMemo(() => {
    if (positions.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(positions.length * 3);
    for (let i = 0; i < positions.length; i++) {
      pos[i * 3] = positions[i].x;
      pos[i * 3 + 1] = positions[i].y;
      pos[i * 3 + 2] = positions[i].z;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return geo;
  }, [positions]);

  useFrame(({ clock }) => {
    if (!points) return;
    const t = clock.getElapsedTime();
    const posArr = points.attributes.position.array as Float32Array;
    for (let i = 0; i < posArr.length; i += 3) {
      const offset = Math.sin(t * ANIMATION.causalFloat.speed + i) * ANIMATION.causalFloat.amp;
      posArr[i + 1] += offset;
    }
    points.attributes.position.needsUpdate = true;
  });

  if (!visible || !points) return null;

  return (
    <points geometry={points} frustumCulled={false}>
      <pointsMaterial {...MATERIALS.points} color={SEMANTIC.causalHighlight.three} size={SIZES.point} opacity={SEMANTIC.causalHighlight.opacity} />
    </points>
  );
}
