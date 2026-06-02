import { callAI, getActiveProvider, getKey } from './apiKeys';

export interface CADParams {
  width: number; depth: number; height: number; thickness: number;
  outerDiameter: number; innerDiameter: number; holeDiameter: number;
  holeCount: number; boltCircleDiameter: number;
  drawerCount: number; legHeight: number;
  wallThickness: number; clearance: number;
}

export type CADTemplate = 'flange' | 'plate' | 'cabinet' | 'router_shell' | 'pipe_rack' | 'custom';

export interface CADDesign {
  template: CADTemplate;
  params: CADParams;
  scadCode: string;
  summary: string;
}

const DEFAULT_PARAMS: CADParams = {
  width: 100, depth: 80, height: 60, thickness: 15,
  outerDiameter: 100, innerDiameter: 50, holeDiameter: 8,
  holeCount: 6, boltCircleDiameter: 80,
  drawerCount: 2, legHeight: 40,
  wallThickness: 2, clearance: 0.2,
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
  "template": "custom",
  "summary": "one sentence description",
  "params": { "width": number, "depth": number, "height": number, "thickness": number, "outerDiameter": number, "innerDiameter": number, "holeDiameter": number, "holeCount": number, "boltCircleDiameter": number, "drawerCount": number, "legHeight": number, "wallThickness": number, "clearance": number },
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
    };
  } catch {
    return createCADDesignLocal(prompt);
  }
}

function createCADDesignLocal(prompt: string): CADDesign {
  const t = prompt.toLowerCase();
  if (t.includes('flange') || t.includes('法兰')) {
    const params = { ...DEFAULT_PARAMS, outerDiameter: 100, innerDiameter: 50, holeCount: 8, holeDiameter: 8, boltCircleDiameter: 80, thickness: 12 };
    return { template: 'flange', params, summary: 'Flange 100mm OD, 50mm ID, 8 holes', scadCode: buildFlangeScad(params) };
  }
  if (t.includes('cabinet') || t.includes('柜')) {
    const params = { ...DEFAULT_PARAMS, width: 500, depth: 400, height: 600, thickness: 15, drawerCount: 2, legHeight: 60 };
    return { template: 'cabinet', params, summary: 'Cabinet 500x400x600mm, 2 drawers', scadCode: buildCabinetScad(params) };
  }
  const params = { ...DEFAULT_PARAMS, width: 80, depth: 60, thickness: 4, holeCount: 4, holeDiameter: 5 };
  return { template: 'plate', params, summary: 'Mounting plate 80x60mm, 4 holes', scadCode: buildPlateScad(params) };
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
    const mat = new THREE.MeshStandardMaterial({ color: 0x00ccaa, metalness: 0.3, roughness: 0.5 });
    const outer = new THREE.Mesh(new THREE.CylinderGeometry(p.outerDiameter/2*scale, p.outerDiameter/2*scale, p.thickness*scale, 64), mat);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(p.innerDiameter/2*scale, p.innerDiameter/2*scale, p.thickness*scale+0.1, 64), new THREE.MeshStandardMaterial({ color: 0x000000 }));
    group.add(outer); group.add(inner);
  } else if (design.template === 'cabinet') {
    const p = design.params;
    const mat = new THREE.MeshStandardMaterial({ color: 0xc8a96e, roughness: 0.8 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(p.width*scale, p.height*scale, p.depth*scale), mat);
    group.add(box);
  } else {
    const p = design.params;
    const mat = new THREE.MeshStandardMaterial({ color: 0x4488ff, metalness: 0.2, roughness: 0.6 });
    const plate = new THREE.Mesh(new THREE.BoxGeometry(p.width*scale, p.thickness*scale, p.depth*scale), mat);
    group.add(plate);
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
