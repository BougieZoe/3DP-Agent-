// client/src/lib/toolpath.ts
//
// Real extrusion toolpath parser — turns slicer G-code into per-layer XYZ
// polylines for the Print Path overlay. This REPLACES the old synthetic
// preview (24 ellipses), which showed a plausible-looking but entirely
// invented path. If it is drawn here, a slicer really emitted it.
//
// Scope/limits (read before extending):
// - Absolute XYZ assumed (PrusaSlicer/Bambu emit G90); G91 blocks are skipped.
// - Extrusion = positive E delta on a G1 with X/Y present; G92 E resets sync.
// - Travel moves are dropped (no dimmed-travel rendering — yet).
// - Layer splits mirror server/slicerBridge.ts (;LAYER_CHANGE / ;LAYER:n / ;Z:).
// - Decimation is per-layer striding, so small features survive on every layer.

export interface ToolpathLayer {
  /** Z height of this layer (mm), from the ;Z: marker. */
  zMm: number;
  /** Flat XYZ extrusion vertices in print order. */
  points: Float32Array;
}

export interface Toolpath {
  layers: ToolpathLayer[];
  /** Total extrusion vertices across layers (post-decimation). */
  totalPoints: number;
  /** True when decimation kicked in (shape preserved, density reduced). */
  decimated: boolean;
}

const DEFAULT_MAX_POINTS = 200_000;

interface PendingLayer {
  zMm: number;
  xs: number[];
  ys: number[];
  zs: number[];
}

function numAfter(line: string, code: string): number | null {
  // PrusaSlicer omits the leading zero (Z.35, not Z0.35) — require the
  // integer part to be optional or first-layer heights never parse.
  const m = new RegExp(`${code}(-?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?)`).exec(line);
  return m ? parseFloat(m[1]) : null;
}

export function parseToolpath(gcode: string, maxPoints = DEFAULT_MAX_POINTS): Toolpath {
  const layers: PendingLayer[] = [];
  // Index of the open layer (-1 = none). Index-based (not a nullable object
  // reference) to keep control flow obvious to both readers and the checker.
  let currentIdx = -1;
  const openLayer = (z: number): PendingLayer => {
    const layer: PendingLayer = { zMm: z, xs: [], ys: [], zs: [] };
    layers.push(layer);
    currentIdx = layers.length - 1;
    return layer;
  };

  let x = 0;
  let y = 0;
  let z = 0;
  let e = 0;
  let relative = false;

  const pushExtrusion = (): void => {
    const layer = currentIdx < 0 ? openLayer(z) : layers[currentIdx];
    layer.xs.push(x);
    layer.ys.push(y);
    layer.zs.push(z);
  };

  for (const raw of gcode.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;

    if (line === ';LAYER_CHANGE' || line.startsWith(';LAYER:')) {
      currentIdx = -1; // next ;Z: opens the layer
      continue;
    }
    if (line.startsWith(';')) {
      const zm = /^;Z:([\d.]+)/.exec(line);
      if (zm) {
        const nz = parseFloat(zm[1]);
        const open = currentIdx >= 0 ? layers[currentIdx] : null;
        if (open === null || Math.abs(nz - open.zMm) > 1e-9) openLayer(nz);
      }
      continue;
    }

    const cmd = line.slice(0, 3);
    if (cmd === 'G90') { relative = false; continue; }
    if (cmd === 'G91') { relative = true; continue; }
    if (cmd === 'G92') {
      const ne = numAfter(line, 'E');
      if (ne !== null) e = ne;
      continue;
    }
    if ((cmd !== 'G0 ' && cmd !== 'G00' && cmd !== 'G1 ' && cmd !== 'G01' && line !== 'G0' && line !== 'G1') || relative) {
      continue;
    }
    const nx = numAfter(line, 'X');
    const ny = numAfter(line, 'Y');
    const nz = numAfter(line, 'Z');
    const ne = numAfter(line, 'E');
    if (nx !== null) x = nx;
    if (ny !== null) y = ny;
    if (nz !== null) z = nz;
    if (ne !== null) {
      if (ne > e + 1e-9 && nx !== null && ny !== null) pushExtrusion();
      e = ne;
    }
  }

  // Per-layer stride decimation keeps every layer represented.
  let total = 0;
  for (const l of layers) total += l.xs.length;
  const decimated = total > maxPoints && total > 0;
  const stride = decimated ? Math.ceil(total / maxPoints) : 1;

  const out: ToolpathLayer[] = [];
  let outTotal = 0;
  for (const l of layers) {
    const n = l.xs.length;
    if (n === 0) continue;
    const pts = new Float32Array(Math.ceil(n / stride) * 3);
    let k = 0;
    for (let i = 0; i < n; i += stride) {
      pts[k++] = l.xs[i];
      pts[k++] = l.ys[i];
      pts[k++] = l.zs[i];
    }
    out.push({ zMm: l.zMm, points: pts.subarray(0, k) });
    outTotal += k / 3;
  }
  return { layers: out, totalPoints: outTotal, decimated };
}
