import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { usePrintPlayback } from '@/components/playback/PrintPlaybackContext';
import { SIZES, MATERIALS } from '@/lib/visualLanguage';
import { useThemeTokens } from '@/lib/ThemeContext';

interface PrintPathPreviewProps {
  geometry: THREE.BufferGeometry;
  visible: boolean;
  opacity?: number;
}

export function PrintPathPreview({ geometry, visible, opacity: opacityProp }: PrintPathPreviewProps) {
  const SEMANTIC = useThemeTokens();
  const opacity = opacityProp ?? SEMANTIC.printPath.line.opacity;
  const groupRef = useRef<THREE.Group>(null);
  const lineRef = useRef<THREE.Line | null>(null);
  const headRef = useRef<THREE.Mesh | null>(null);
  const { progressRef } = usePrintPlayback();

  const path = useMemo(() => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const c = new THREE.Vector3();
    box.getCenter(c);
    const s = new THREE.Vector3();
    box.getSize(s);
    const minY = box.min.y;
    const maxY = box.max.y;
    const layers = 24;
    const pts = 36;
    const points: THREE.Vector3[] = [];

    for (let i = 0; i < layers; i++) {
      const t = i / (layers - 1);
      const y = minY + t * (maxY - minY);
      const profile = 0.25 + Math.sin(t * Math.PI) * 0.5;
      const hw = (s.x / 2) * profile;
      const hd = (s.z / 2) * profile;
      for (let j = 0; j < pts; j++) {
        const u = j / pts;
        const angle = u * Math.PI * 2;
        points.push(new THREE.Vector3(c.x + hw * Math.cos(angle), y, c.z + hd * Math.sin(angle)));
      }
    }
    return points;
  }, [geometry]);

  useEffect(() => {
    if (!groupRef.current) return;
    const positions = new Float32Array(path.flatMap(p => [p.x, p.y, p.z]));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      ...MATERIALS.line,
      color: SEMANTIC.printPath.line.three,
      opacity,
    });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    groupRef.current.add(line);
    lineRef.current = line;
    const headGeo = new THREE.SphereGeometry(SIZES.head, SIZES.sphereSegLow, SIZES.sphereSegLow);
    const headMat = new THREE.MeshBasicMaterial({
      ...MATERIALS.additive,
      color: SEMANTIC.printPath.head.three,
      opacity: opacity * 1.5,
    });
    const head = new THREE.Mesh(headGeo, headMat);
    groupRef.current.add(head);
    headRef.current = head;
    return () => { groupRef.current?.clear(); geo.dispose(); mat.dispose(); headGeo.dispose(); headMat.dispose(); };
  }, [path, opacity]);

  useFrame(() => {
    const total = path.length;
    const count = Math.floor(progressRef.current * total);
    if (lineRef.current) lineRef.current.geometry.setDrawRange(0, Math.max(1, count));
    const idx = Math.min(count, total - 1);
    if (headRef.current && idx >= 0 && idx < total) headRef.current.position.copy(path[idx]);
  });

  if (!visible) return null;
  return <group ref={groupRef} />;
}
