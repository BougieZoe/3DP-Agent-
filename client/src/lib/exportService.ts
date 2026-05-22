import * as THREE from 'three';

export function geometryToSTLString(geometry: THREE.BufferGeometry, name: string = 'model'): string {
  const pos = geometry.getAttribute('position');
  const norm = geometry.getAttribute('normal');
  if (!pos || !norm) throw new Error('Geometry requires position and normal attributes');

  const positions = pos.array as Float32Array;
  const normals = norm.array as Float32Array;
  const faceCount = Math.floor(positions.length / 9);

  let stl = `solid ${name}\n`;

  for (let i = 0; i < positions.length; i += 9) {
    const ni = Math.floor(i / 3);
    stl += `  facet normal ${normals[ni].toFixed(6)} ${normals[ni + 1].toFixed(6)} ${normals[ni + 2].toFixed(6)}\n`;
    stl += `    outer loop\n`;
    for (let j = 0; j < 3; j++) {
      const vi = i + j * 3;
      stl += `      vertex ${positions[vi].toFixed(6)} ${positions[vi + 1].toFixed(6)} ${positions[vi + 2].toFixed(6)}\n`;
    }
    stl += `    endloop\n`;
    stl += `  endfacet\n`;
  }

  stl += `endsolid ${name}\n`;
  return stl;
}

export function downloadSTL(geometry: THREE.BufferGeometry, fileName: string = 'optimized.stl'): void {
  const stlString = geometryToSTLString(geometry, fileName.replace('.stl', ''));
  const blob = new Blob([stlString], { type: 'application/sla' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function downloadText(text: string, fileName: string, mime: string = 'text/plain'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
