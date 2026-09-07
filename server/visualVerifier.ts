import type { Vec3, RenderOptions, RenderResult } from './engineAdapter';
import type { BlenderAdapter } from './blenderAdapter';

export interface ViewAngle {
  name: string;
  position: Vec3;
  lookAt: Vec3;
}

export const STANDARD_8_VIEWS: ViewAngle[] = [
  { name: 'front',       position: { x: 0,   y: -10, z: 0   }, lookAt: { x: 0, y: 0, z: 0 } },
  { name: 'back',        position: { x: 0,   y: 10,  z: 0   }, lookAt: { x: 0, y: 0, z: 0 } },
  { name: 'left',        position: { x: -10, y: 0,   z: 0   }, lookAt: { x: 0, y: 0, z: 0 } },
  { name: 'right',       position: { x: 10,  y: 0,   z: 0   }, lookAt: { x: 0, y: 0, z: 0 } },
  { name: 'top',         position: { x: 0,   y: 0,   z: 10  }, lookAt: { x: 0, y: 0, z: 0 } },
  { name: 'bottom',      position: { x: 0,   y: 0,   z: -10 }, lookAt: { x: 0, y: 0, z: 0 } },
  { name: 'iso-front',   position: { x: 7,   y: -7,  z: 5   }, lookAt: { x: 0, y: 0, z: 0 } },
  { name: 'iso-back',    position: { x: -7,  y: 7,   z: 5   }, lookAt: { x: 0, y: 0, z: 0 } },
];

export interface MultiViewResult {
  views: (ViewAngle & { render: RenderResult })[];
  totalSizeBytes: number;
}

export async function renderMultiView(
  adapter: BlenderAdapter,
  options: {
    width?: number;
    height?: number;
    engine?: 'eevee' | 'cycles';
    views?: ViewAngle[];
  } = {}
): Promise<MultiViewResult> {
  const {
    width = 800,
    height = 600,
    engine = 'eevee',
    views = STANDARD_8_VIEWS,
  } = options;

  const results: MultiViewResult['views'] = [];
  let totalSize = 0;

  for (const view of views) {
    const render = await adapter.render({
      width,
      height,
      engine,
      camera: { position: view.position, lookAt: view.lookAt },
      outputFormat: 'png',
    });
    results.push({ ...view, render });
    totalSize += render.fileSizeBytes;
  }

  return { views: results, totalSizeBytes: totalSize };
}
