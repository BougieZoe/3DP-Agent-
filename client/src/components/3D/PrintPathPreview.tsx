import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { usePrintPlayback } from '@/components/playback/PrintPlaybackContext';
import { SIZES, MATERIALS } from '@/lib/visualLanguage';
import { useThemeTokens } from '@/lib/ThemeContext';
import type { Toolpath } from '@/lib/toolpath';

interface PrintPathPreviewProps {
  /** Model geometry (only for centering: G-code lives in bed frame, the mesh in model frame). */
  geometry: THREE.BufferGeometry;
  /** Real extrusion toolpath from the slicer. Absent (no slice) → renders nothing: no invented paths. */
  toolpath?: Toolpath;
  visible: boolean;
  opacity?: number;
}

export function PrintPathPreview({ geometry, toolpath, visible, opacity: opacityProp }: PrintPathPreviewProps) {
  const SEMANTIC = useThemeTokens();
  const opacity = opacityProp ?? SEMANTIC.printPath.line.opacity;
  const groupRef = useRef<THREE.Group>(null);
  const segmentsRef = useRef<THREE.LineSegments | null>(null);
  const headRef = useRef<THREE.Mesh | null>(null);
  const { progressRef } = usePrintPlayback();

  // Consecutive extrusion pairs WITHIN each layer (inter-layer jumps dropped),
  // translated from bed frame into model frame via bbox-center alignment
  // (the slicer centers the part on the bed; the mesh is origin-centered).
  const data = useMemo(() => {
    if (!toolpath) return null;
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    let tMinX = Infinity;
    let tMaxX = -Infinity;
    let tMinY = Infinity;
    let tMaxY = -Infinity;
    for (const l of toolpath.layers) {
      const p = l.points;
      for (let i = 0; i < p.length; i += 3) {
        if (p[i] < tMinX) tMinX = p[i];
        if (p[i] > tMaxX) tMaxX = p[i];
        if (p[i + 1] < tMinY) tMinY = p[i + 1];
        if (p[i + 1] > tMaxY) tMaxY = p[i + 1];
      }
    }
    const dx = (box.min.x + box.max.x) / 2 - (tMinX + tMaxX) / 2;
    const dy = (box.min.y + box.max.y) / 2 - (tMinY + tMaxY) / 2;
    let segCount = 0;
    for (const l of toolpath.layers) segCount += Math.max(0, l.points.length / 3 - 1);
    const positions = new Float32Array(segCount * 6);
    // Flat ordered points for the head marker.
    const ordered: number[] = [];
    let v = 0;
    for (const l of toolpath.layers) {
      const n = l.points.length / 3;
      for (let i = 0; i + 1 < n; i++) {
        positions[v++] = l.points[i * 3] + dx;
        positions[v++] = l.points[i * 3 + 1] + dy;
        positions[v++] = l.points[i * 3 + 2];
        positions[v++] = l.points[i * 3 + 3] + dx;
        positions[v++] = l.points[i * 3 + 4] + dy;
        positions[v++] = l.points[i * 3 + 5];
      }
      for (let i = 0; i < n; i++) ordered.push(l.points[i * 3] + dx, l.points[i * 3 + 1] + dy, l.points[i * 3 + 2]);
    }
    return { positions, ordered: new Float32Array(ordered), segCount };
  }, [geometry, toolpath]);

  useEffect(() => {
    if (!groupRef.current || !data) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    const mat = new THREE.LineBasicMaterial({
      ...MATERIALS.line,
      color: SEMANTIC.printPath.line.three,
      opacity,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    groupRef.current.add(lines);
    segmentsRef.current = lines;
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
  }, [data, opacity]);

  useFrame(() => {
    if (!data || !segmentsRef.current) return;
    const drawn = Math.floor(progressRef.current * data.segCount) * 2;
    segmentsRef.current.geometry.setDrawRange(0, Math.max(2, drawn));
    const total = data.ordered.length / 3;
    const idx = Math.min(Math.floor(progressRef.current * total), total - 1);
    if (headRef.current && idx >= 0) {
      headRef.current.position.set(data.ordered[idx * 3], data.ordered[idx * 3 + 1], data.ordered[idx * 3 + 2]);
    }
  });

  if (!visible || !data) return null;
  return <group ref={groupRef} />;
}
