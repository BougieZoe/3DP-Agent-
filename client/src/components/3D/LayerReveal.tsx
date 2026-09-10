import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { usePrintPlayback } from '@/components/playback/PrintPlaybackContext';
import { MATERIALS } from '@/lib/visualLanguage';
import { useThemeTokens } from '@/lib/ThemeContext';
import type { SliceLayerInfo } from '@/lib/sliceClient';

interface LayerRevealProps {
  geometry: THREE.BufferGeometry;
  /**
   * Real layer Z heights from the slicer. Absent → uniform estimate from the
   * geometry Z extent (count only, same convention as the layerCount estimate).
   * Rendered as position rulers, never as cross-section shapes.
   */
  layers?: SliceLayerInfo[];
  visible: boolean;
  opacity?: number;
}

/** Fallback layer height (mm) when no slicer ran — matches the estimate path. */
const FALLBACK_LAYER_HEIGHT_MM = 0.2;

export function LayerReveal({ geometry, layers: sliceLayers, visible, opacity: opacityProp }: LayerRevealProps) {
  const SEMANTIC = useThemeTokens();
  const opacity = opacityProp ?? SEMANTIC.layerReveal.line.opacity;
  const groupRef = useRef<THREE.Group>(null);
  const linesRef = useRef<THREE.LineSegments | null>(null);
  const { progressRef } = usePrintPlayback();

  const ruler = useMemo(() => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const minX = box.min.x;
    const maxX = box.max.x;
    const midY = (box.min.y + box.max.y) / 2;

    let zList: number[];
    if (sliceLayers && sliceLayers.length > 0) {
      zList = [...sliceLayers].map((l) => l.zMm).sort((a, b) => a - b);
    } else {
      const sizeZ = Math.max(1e-6, box.max.z - box.min.z);
      const count = Math.max(1, Math.round(sizeZ / FALLBACK_LAYER_HEIGHT_MM));
      zList = Array.from({ length: count }, (_, i) => box.min.z + ((i + 1) / count) * sizeZ);
    }

    const positions = new Float32Array(zList.length * 6);
    zList.forEach((z, i) => {
      positions[i * 6] = minX;
      positions[i * 6 + 1] = midY;
      positions[i * 6 + 2] = z;
      positions[i * 6 + 3] = maxX;
      positions[i * 6 + 4] = midY;
      positions[i * 6 + 5] = z;
    });
    return { positions, segCount: zList.length };
  }, [geometry, sliceLayers]);

  useEffect(() => {
    if (!groupRef.current) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(ruler.positions, 3));
    const mat = new THREE.LineBasicMaterial({
      ...MATERIALS.line,
      color: SEMANTIC.layerReveal.line.three,
      opacity,
      transparent: true,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    groupRef.current.add(lines);
    linesRef.current = lines;
    return () => {
      groupRef.current?.clear();
      geo.dispose();
      mat.dispose();
      linesRef.current = null;
    };
  }, [ruler, opacity]);

  useFrame(() => {
    if (!linesRef.current) return;
    const drawn = Math.floor(progressRef.current * ruler.segCount) * 2;
    linesRef.current.geometry.setDrawRange(0, Math.max(2, drawn));
  });

  if (!visible) return null;
  return <group ref={groupRef} />;
}
