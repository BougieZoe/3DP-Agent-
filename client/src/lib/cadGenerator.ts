import { callAI, getActiveProvider, getKey } from './apiKeys';
import type { Material } from '@/lib/materialState';
import { DEFAULT_MATERIAL } from '@/lib/materialState';

export interface CADParams {
  width: number; depth: number; height: number; thickness: number;
  outerDiameter: number; innerDiameter: number; holeDiameter: number;
  holeCount: number; boltCircleDiameter: number;
  drawerCount: number; legHeight: number;
  wallThickness: number; clearance: number;
  cornerRadius: number; tubeDiameter: number;
}

export type CADTemplate = 'flange' | 'plate' | 'cabinet' | 'router_shell' | 'pipe_rack' | 'custom';

export interface CADDesign {
  template: CADTemplate;
  params: CADParams;
  scadCode: string;
  summary: string;
  checks: string[];
  color: string;
}

const DEFAULT_PARAMS: CADParams = {
  width: 100, depth: 80, height: 60, thickness: 15,
  outerDiameter: 100, innerDiameter: 50, holeDiameter: 8,
  holeCount: 6, boltCircleDiameter: 80,
  drawerCount: 2, legHeight: 40,
  wallThickness: 2, clearance: 0.2, cornerRadius: 5, tubeDiameter: 20,
};

export function generateOpenSCAD(design: CADDesign): string {
  return design.scadCode;
}

export async function createCADDesignAI(prompt: string): Promise<CADDesign> {
  const provider = getActiveProvider();
  const key = provider ? getKey(provider) : null;

  if (!provider || !key) {
    return createCADDesignLocal(prompt);
  }

  const system = `You are an OpenSCAD expert. Given a natural language description, output ONLY a JSON object with this exact shape:
{
  "template": "flange" | "plate" | "cabinet" | "router_shell" | "pipe_rack" | "custom",
  "summary": "one sentence description",
  "params": { "width": number, "depth": number, "height": number, "thickness": number, "outerDiameter": number, "innerDiameter": number, "holeDiameter": number, "holeCount": number, "boltCircleDiameter": number, "drawerCount": number, "legHeight": number, "wallThickness": number, "clearance": number },
  "color": "hex color like #ffcc00 that matches the described object",
  "scadCode": "complete valid OpenSCAD code as a single string"
}
Output ONLY the JSON, no markdown, no explanation.`;

  try {
    const response = await callAI(provider, key, system, prompt);
    const clean = response.replace(/\`\`\`json|\`\`\`/g, '').trim();
    const parsed = JSON.parse(clean);
    return {
      template: parsed.template ?? 'custom',
      summary: parsed.summary ?? prompt,
      params: { ...DEFAULT_PARAMS, ...parsed.params },
      scadCode: parsed.scadCode ?? '',
      checks: parsed.checks ?? ['AI-generated model.'],
      color: parsed.color ?? '#4488ff',
    };
  } catch {
    return createCADDesignLocal(prompt);
  }
}

const WORD_TO_NUM: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function inRange(v: number, min: number, max: number): boolean {
  return v >= min && v <= max;
}

function extractParamsFromPrompt(prompt: string): Partial<CADParams> {
  const t = prompt.toLowerCase();
  const out: Partial<CADParams> = {};

  const dims = t.match(/(\d+(?:\.\d+)?)\s*(?:mm)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:mm)?/);
  if (dims) {
    const w = parseFloat(dims[1]);
    const d = parseFloat(dims[2]);
    if (inRange(w, 1, 1000)) out.width = w;
    if (inRange(d, 1, 1000)) out.depth = d;
  }

  const h = t.match(/(?:height|高|h)\s*(\d+(?:\.\d+)?)\s*(?:mm)?/);
  if (h) { const v = parseFloat(h[1]); if (inRange(v, 1, 1000)) out.height = v; }

  const thick = t.match(/(?:thickness|thick|厚|壁厚)\s*(\d+(?:\.\d+)?)\s*(?:mm)?/);
  if (thick) { const v = parseFloat(thick[1]); if (inRange(v, 0.2, 100)) out.thickness = v; }

  const holeWord = t.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:\d+(?:\.\d+)?\s*mm\s*)?holes?\b/);
  if (holeWord) { out.holeCount = WORD_TO_NUM[holeWord[1]]; }

  const holeDigit = t.match(/(\d+)\s*(?:bolt\s*)?(?:holes?|个孔|個|孔)/);
  if (holeDigit && !out.holeCount) { const v = parseInt(holeDigit[1]); if (inRange(v, 1, 100)) out.holeCount = v; }

  const hDia = t.match(/(\d+(?:\.\d+)?)\s*mm\s*(?:holes?|dia|diameter|孔|直径)/);
  if (hDia) { const v = parseFloat(hDia[1]); if (inRange(v, 0.5, 50)) out.holeDiameter = v; }

  const od = t.match(/(?:outer\s*(?:diameter|dia)|外径|od)\s*(\d+(?:\.\d+)?)\s*(?:mm)?/);
  if (od) { const v = parseFloat(od[1]); if (inRange(v, 1, 1000)) out.outerDiameter = v; }

  const id = t.match(/(?:inner\s*(?:diameter|dia)|内径|id)\s*(\d+(?:\.\d+)?)\s*(?:mm)?/);
  if (id) { const v = parseFloat(id[1]); if (inRange(v, 1, 1000)) out.innerDiameter = v; }

  const corner = t.match(/(?:corner\s*(?:radius|rad)|圆角|角丸)\s*(?:r)?(\d+(?:\.\d+)?)\s*(?:mm)?/);
  if (corner) { const v = parseFloat(corner[1]); if (inRange(v, 0, 50)) out.cornerRadius = v; }

  return out;
}

export function computeChecks(params: CADParams, material: Material = DEFAULT_MATERIAL): string[] {
  const checks: string[] = [];
  const wt = params.thickness || params.wallThickness;
  if (wt >= 2) {
    checks.push(`Wall ${wt}mm — adequate for ${material.name} FDM.`);
  } else if (wt >= 0.8) {
    checks.push(`Wall ${wt}mm — printable${wt < 1.2 ? ', consider thickening for better strength' : ''} for ${material.name}.`);
  } else {
    checks.push(`Wall ${wt}mm — too thin for FDM. Increase to 0.8mm+.`);
  }
  const fits = params.width <= 256 && params.depth <= 256;
  checks.push(fits
    ? `Bed fit OK (${params.width}×${params.depth}mm).`
    : `May exceed print bed (${params.width}×${params.depth}mm) — split or rotate.`);
  checks.push(`${material.name}: overhang threshold ${material.overhangThreshold}°, density ${material.densityGPerCm3}g/cm³.`);
  return checks;
}

function createCADDesignLocal(prompt: string): CADDesign {
  const t = prompt.toLowerCase();
  const extracted = extractParamsFromPrompt(prompt);

  if (t.includes('flange') || t.includes('法兰')) {
    const params = { ...DEFAULT_PARAMS, outerDiameter: 100, innerDiameter: 50, holeCount: 8, holeDiameter: 8, boltCircleDiameter: 80, thickness: 12, ...extracted };
    return { template: 'flange', params, summary: 'Flange', scadCode: buildFlangeScad(params), checks: [], color: '#00ccaa' };
  }
  if (t.includes('cabinet') || t.includes('柜')) {
    const params = { ...DEFAULT_PARAMS, width: 500, depth: 400, height: 600, thickness: 15, drawerCount: 2, legHeight: 60, ...extracted };
    return { template: 'cabinet', params, summary: 'Cabinet', scadCode: buildCabinetScad(params), checks: [], color: '#c8a96e' };
  }
  const params = { ...DEFAULT_PARAMS, width: 80, depth: 60, thickness: 4, holeCount: 4, holeDiameter: 5, ...extracted };
  return { template: 'plate', params, summary: 'Plate', scadCode: buildPlateScad(params), checks: [], color: '#4488ff' };
}

function buildFlangeScad(p: CADParams): string {
  return `difference() {
  cylinder(h=${p.thickness}, r=${p.outerDiameter/2}, center=true, $fn=64);
  cylinder(h=${p.thickness+2}, r=${p.innerDiameter/2}, center=true, $fn=64);
  for(i=[0:${p.holeCount}-1]) {
    rotate([0,0,i*360/${p.holeCount}])
    translate([${p.boltCircleDiameter/2},0,0])
    cylinder(h=${p.thickness+2}, r=${p.holeDiameter/2}, center=true, $fn=32);
  }
}`;
}

function buildPlateScad(p: CADParams): string {
  return `difference() {
  cube([${p.width}, ${p.depth}, ${p.thickness}], center=true);
  for(x=[-1,1]) for(y=[-1,1])
    translate([x*${(p.width/2-10).toFixed(1)}, y*${(p.depth/2-10).toFixed(1)}, 0])
    cylinder(h=${p.thickness+2}, r=${p.holeDiameter/2}, center=true, $fn=32);
}`;
}

function buildCabinetScad(p: CADParams): string {
  return `union() {
  difference() {
    cube([${p.width}, ${p.depth}, ${p.height}]);
    translate([${p.thickness}, ${p.thickness}, ${p.thickness}])
    cube([${p.width - p.thickness*2}, ${p.depth - p.thickness}, ${p.height - p.thickness*2}]);
  }
}`;
}

// Legacy sync wrapper for components that haven't migrated yet
export function createCADDesign(prompt: string): CADDesign {
  return createCADDesignLocal(prompt);
}

export type { CADParams as default };

import * as THREE from 'three';
import { STLExporter } from 'three-stdlib';

export function buildCADGroup(design: CADDesign): THREE.Group {
  const group = new THREE.Group();
  const scale = 0.1;

  if (design.template === 'flange') {
    const p = design.params;
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(design.color || '#00ccaa'), metalness: 0.3, roughness: 0.5 });
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(p.outerDiameter/2*scale, p.outerDiameter/2*scale, p.thickness*scale, 64), mat);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(p.innerDiameter/2*scale, p.innerDiameter/2*scale, p.thickness*scale+0.1, 64), new THREE.MeshStandardMaterial({ color: 0x000000 }));
    group.add(outer); group.add(inner);
  } else if (design.template === 'cabinet') {
    const p = design.params;
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(design.color || '#c8a96e'), roughness: 0.8 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(p.width*scale, p.height*scale, p.depth*scale), mat);
    group.add(box);
  } else {
    const p = design.params;
    const isRound = p.outerDiameter > 0 && p.outerDiameter !== 100;
    const isTall = p.height > p.width * 1.5;
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(design.color || '#4488ff'), metalness: 0.2, roughness: 0.6 });
    if (isRound) {
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(p.outerDiameter/2*scale, p.outerDiameter/2*scale, p.height*scale || p.thickness*scale, 64), mat);
      group.add(cyl);
    } else if (isTall) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(p.width*scale, p.height*scale, p.depth*scale), mat);
      group.add(box);
    } else {
      const w = (p.width || 80) * scale;
      const h = (p.height || p.thickness || 10) * scale;
      const d = (p.depth || 60) * scale;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      group.add(plate);
    }
  }
  return group;
}

export function downloadTextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
