import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { usePrintPlayback } from '@/components/playback/PrintPlaybackContext';
import { ANIMATION, MATERIALS } from '@/lib/visualLanguage';
import { useThemeTokens } from '@/lib/ThemeContext';

interface LayerRevealProps {
  geometry: THREE.BufferGeometry;
  visible: boolean;
  opacity?: number;
}

export function LayerReveal({ geometry, visible, opacity: opacityProp }: LayerRevealProps) {
  const SEMANTIC = useThemeTokens();
  const opacity = opacityProp ?? SEMANTIC.layerReveal.line.opacity;
  const groupRef = useRef<THREE.Group>(null);
  const linesRef = useRef<THREE.Line[]>([]);
  const { progressRef } = usePrintPlayback();

  const layers = useMemo(() => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const c = new THREE.Vector3();
    box.getCenter(c);
    const s = new THREE.Vector3();
    box.getSize(s);
    const minY = box.min.y;
    const maxY = box.max.y;
    const count = 20;
    const result: { points: Float32Array; index: number }[] = [];

    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const y = minY + t * (maxY - minY);
      const profile = 0.2 + Math.sin(t * Math.PI) * 0.55;
      const hw = (s.x / 2) * profile;
      const hd = (s.z / 2) * profile;
      const pts = 32;
      const coords: number[] = [];
      for (let j = 0; j <= pts; j++) {
        const u = j / pts;
        const angle = u * Math.PI * 2;
        coords.push(c.x + hw * Math.cos(angle), y, c.z + hd * Math.sin(angle));
      }
      result.push({ points: new Float32Array(coords), index: i });
    }
    return result;
  }, [geometry]);

  useEffect(() => {
    if (!groupRef.current) return;
    linesRef.current = [];
    for (const layer of layers) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(layer.points, 3));
      const mat = new THREE.LineBasicMaterial({
        ...MATERIALS.line,
        color: SEMANTIC.layerReveal.line.three,
        opacity: 0,
      });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      groupRef.current!.add(line);
      linesRef.current.push(line);
    }
    return () => {
      groupRef.current?.clear();
      for (const line of linesRef.current) { line.geometry.dispose(); (line.material as THREE.Material).dispose(); }
      linesRef.current = [];
    };
  }, [layers]);

  useFrame(() => {
    const { reveal } = ANIMATION;
    const t = progressRef.current * reveal.progressScale;
    for (let i = 0; i < linesRef.current.length; i++) {
      const line = linesRef.current[i];
      if (!line) continue;
      const delay = i * reveal.layerStagger;
      const revealVal = Math.min(Math.max((t - delay) * reveal.rate, 0), 1);
      const mat = line.material as THREE.LineBasicMaterial;
      mat.opacity = revealVal * opacity;
    }
  });

  if (!visible) return null;
  return <group ref={groupRef} />;
}
