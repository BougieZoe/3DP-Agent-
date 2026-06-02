import * as THREE from 'three';

export type CADTemplate = 'cabinet' | 'flange' | 'plate' | 'router_shell' | 'pipe_rack';

export interface CADParams {
  width: number;
  depth: number;
  height: number;
  thickness: number;
  cornerRadius: number;
  holeDiameter: number;
  holeCount: number;
  boltCircleDiameter: number;
  innerDiameter: number;
  outerDiameter: number;
  drawerCount: number;
  legHeight: number;
  tubeDiameter: number;
  wallThickness: number;
  clearance: number;
}

export interface CADDesign {
  template: CADTemplate;
  title: string;
  prompt: string;
  summary: string;
  params: CADParams;
  checks: string[];
}

export const DEFAULT_CAD_PARAMS: CADParams = {
  width: 80,
  depth: 60,
  height: 8,
  thickness: 6,
  cornerRadius: 4,
  holeDiameter: 5,
  holeCount: 4,
  boltCircleDiameter: 70,
  innerDiameter: 40,
  outerDiameter: 90,
  drawerCount: 2,
  legHeight: 12,
  tubeDiameter: 18,
  wallThickness: 1.8,
  clearance: 0.4,
};

const TEMPLATE_LABELS: Record<CADTemplate, string> = {
  cabinet: 'Drawer Cabinet',
  flange: 'Bolt Flange',
  plate: 'Mounting Plate',
  router_shell: 'Router Sleeve',
  pipe_rack: 'Tube Rack',
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function extractMeasurements(text: string) {
  const values: number[] = [];
  const pattern = /(\d+(?:\.\d+)?)\s*(mm|毫米|cm|厘米|公分)?/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const raw = Number(match[1]);
    const unit = (match[2] || 'mm').toLowerCase();
    values.push(unit === 'cm' || unit === '厘米' || unit === '公分' ? raw * 10 : raw);
  }

  return values;
}

function inferTemplate(text: string): CADTemplate {
  const normalized = text.toLowerCase();
  if (/路由器|unifi|外壳|保护套|shell|case|sleeve/.test(normalized)) return 'router_shell';
  if (/法兰|齿轮|圆盘|bolt|flange|圆环/.test(normalized)) return 'flange';
  if (/管|线材|ams|支架|tube|pipe|rack|spool/.test(normalized)) return 'pipe_rack';
  if (/柜|抽屉|柜子|drawer|cabinet/.test(normalized)) return 'cabinet';
  return 'plate';
}

function numberAfter(text: string, keywords: string[]) {
  for (const keyword of keywords) {
    const match = text.match(new RegExp(`${keyword}\\s*(?:为|是|=|:)?\\s*(\\d+(?:\\.\\d+)?)\\s*(mm|毫米|cm|厘米|公分)?`, 'i'));
    if (match) {
      const value = Number(match[1]);
      const unit = (match[2] || 'mm').toLowerCase();
      return unit === 'cm' || unit === '厘米' || unit === '公分' ? value * 10 : value;
    }
  }
  return undefined;
}

function countAfter(text: string, keywords: string[]) {
  for (const keyword of keywords) {
    const match = text.match(new RegExp(`${keyword}\\s*(?:为|是|=|:)?\\s*(\\d+)`, 'i'));
    if (match) return Number(match[1]);
  }
  return undefined;
}

export function createCADDesign(prompt: string): CADDesign {
  const template = inferTemplate(prompt);
  const params = { ...DEFAULT_CAD_PARAMS };
  const values = extractMeasurements(prompt);

  if (template === 'cabinet') {
    params.width = values[0] ?? 500;
    params.depth = values[1] ?? 400;
    params.height = values[2] ?? 600;
    params.thickness = numberAfter(prompt, ['板厚', '面板厚度', 'thickness']) ?? 15;
    params.drawerCount = countAfter(prompt, ['抽屉数量', '抽屉', 'drawers']) ?? (prompt.includes('两个') ? 2 : 2);
    params.legHeight = numberAfter(prompt, ['支撑脚', '脚高', 'leg']) ?? 60;
  } else if (template === 'flange') {
    params.outerDiameter = values[0] ?? 100;
    params.thickness = values[1] ?? 8;
    params.innerDiameter = numberAfter(prompt, ['内径', 'inner']) ?? values[2] ?? 50;
    params.holeCount = countAfter(prompt, ['孔数', '螺栓孔', 'bolt count']) ?? 8;
    params.holeDiameter = numberAfter(prompt, ['孔径', 'bolt radius', 'bolt dia', 'hole']) ?? 7;
    params.boltCircleDiameter = numberAfter(prompt, ['孔距圆', '分布圆', 'bolt circle']) ?? params.outerDiameter * 0.78;
  } else if (template === 'router_shell') {
    params.width = values[0] ?? 117;
    params.depth = values[1] ?? 117;
    params.height = values[2] ?? 42.5;
    params.wallThickness = numberAfter(prompt, ['壁厚', 'wall']) ?? 1.8;
    params.clearance = numberAfter(prompt, ['间隙', 'clearance']) ?? 0.4;
    params.cornerRadius = numberAfter(prompt, ['圆角', 'corner']) ?? 5;
  } else if (template === 'pipe_rack') {
    params.width = values[0] ?? 180;
    params.depth = values[1] ?? 80;
    params.height = values[2] ?? 45;
    params.tubeDiameter = numberAfter(prompt, ['管径', '直径', 'tube']) ?? 20;
    params.holeCount = countAfter(prompt, ['孔数', '管数', 'channels']) ?? 6;
    params.thickness = numberAfter(prompt, ['厚度', 'thickness']) ?? 8;
  } else {
    params.width = values[0] ?? 60;
    params.depth = values[1] ?? 45;
    params.thickness = values[2] ?? 5;
    params.holeCount = countAfter(prompt, ['孔数', '孔', 'holes']) ?? (prompt.includes('四') ? 4 : 4);
    params.holeDiameter = numberAfter(prompt, ['孔径', '半径', 'hole']) ?? 5;
    params.cornerRadius = numberAfter(prompt, ['圆角', 'corner']) ?? 3;
  }

  params.width = clamp(params.width, 10, 800);
  params.depth = clamp(params.depth, 10, 800);
  params.height = clamp(params.height, 2, 800);
  params.thickness = clamp(params.thickness, 1, 80);
  params.wallThickness = clamp(params.wallThickness, 0.8, 10);
  params.clearance = clamp(params.clearance, 0, 3);
  params.holeDiameter = clamp(params.holeDiameter, 1, 50);
  params.holeCount = Math.round(clamp(params.holeCount, 1, 16));
  params.drawerCount = Math.round(clamp(params.drawerCount, 1, 6));

  return {
    template,
    title: TEMPLATE_LABELS[template],
    prompt,
    params,
    summary: buildSummary(template, params),
    checks: buildChecks(template, params),
  };
}

function buildSummary(template: CADTemplate, p: CADParams) {
  if (template === 'cabinet') {
    return `${p.width}×${p.depth}×${p.height}mm cabinet with ${p.drawerCount} drawer fronts, ${p.thickness}mm panels, and ${p.legHeight}mm support legs.`;
  }
  if (template === 'flange') {
    return `${p.outerDiameter}mm outer flange, ${p.innerDiameter}mm center bore, ${p.holeCount} bolt holes on ${p.boltCircleDiameter.toFixed(1)}mm circle.`;
  }
  if (template === 'router_shell') {
    return `${p.width}×${p.depth}×${p.height}mm open sleeve with ${p.wallThickness}mm walls and ${p.clearance}mm fit allowance.`;
  }
  if (template === 'pipe_rack') {
    return `${p.width}×${p.depth}×${p.height}mm tube rack with ${p.holeCount} channels for about ${p.tubeDiameter}mm tubes.`;
  }
  return `${p.width}×${p.depth}×${p.thickness}mm rounded mounting plate with ${p.holeCount} holes.`;
}

function buildChecks(template: CADTemplate, p: CADParams) {
  const checks = [
    p.thickness >= 1.5 || p.wallThickness >= 1.5 ? 'Wall thickness is in the printable range for a 0.4mm nozzle.' : 'Wall thickness may be too thin for FDM printing.',
    p.holeDiameter >= 3 ? 'Hole diameter is large enough for ordinary FDM tolerance.' : 'Small holes may need drilling after print.',
    p.width <= 256 && p.depth <= 256 ? 'Fits common desktop beds around 256×256mm.' : 'May exceed common printer bed size; split or scale before printing.',
  ];

  if (template === 'router_shell') checks.push('Sleeve is open-top in this MVP, so ports/vents should be finalized before real casing use.');
  if (template === 'cabinet') checks.push('Cabinet preview uses assembled panels; for printing, export/split panels separately later.');
  return checks;
}

function roundedRectShape(width: number, height: number, radius: number) {
  const x = -width / 2;
  const y = -height / 2;
  const r = Math.min(radius, width / 2 - 0.1, height / 2 - 0.1);
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

function createExtrudedShapeMesh(shape: THREE.Shape, depth: number, color: number) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: Math.min(depth * 0.08, 1),
    bevelThickness: Math.min(depth * 0.08, 1),
  });
  geometry.center();
  geometry.rotateX(-Math.PI / 2);
  return new THREE.Mesh(geometry, cadMaterial(color));
}

function cadMaterial(color: number) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: 0.1,
    roughness: 0.45,
    side: THREE.DoubleSide,
  });
}

function addBox(group: THREE.Group, size: [number, number, number], position: [number, number, number], color: number) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), cadMaterial(color));
  mesh.position.set(...position);
  group.add(mesh);
  return mesh;
}

function addCylinder(group: THREE.Group, radius: number, depth: number, position: [number, number, number], color: number, rotateX = true) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, depth, 48), cadMaterial(color));
  if (rotateX) mesh.rotation.x = Math.PI / 2;
  mesh.position.set(...position);
  group.add(mesh);
  return mesh;
}

export function buildCADGroup(design: CADDesign) {
  const group = new THREE.Group();
  const p = design.params;

  if (design.template === 'flange') {
    const shape = new THREE.Shape();
    shape.absarc(0, 0, p.outerDiameter / 2, 0, Math.PI * 2, false);
    const center = new THREE.Path();
    center.absarc(0, 0, p.innerDiameter / 2, 0, Math.PI * 2, true);
    shape.holes.push(center);
    for (let i = 0; i < p.holeCount; i += 1) {
      const angle = (i / p.holeCount) * Math.PI * 2;
      const hole = new THREE.Path();
      hole.absarc(
        Math.cos(angle) * p.boltCircleDiameter / 2,
        Math.sin(angle) * p.boltCircleDiameter / 2,
        p.holeDiameter / 2,
        0,
        Math.PI * 2,
        true
      );
      shape.holes.push(hole);
    }
    group.add(createExtrudedShapeMesh(shape, p.thickness, 0x4ab2ff));
  } else if (design.template === 'plate') {
    const shape = roundedRectShape(p.width, p.depth, p.cornerRadius);
    const insetX = p.width * 0.32;
    const insetY = p.depth * 0.32;
    const positions = p.holeCount === 4
      ? [[-insetX, -insetY], [insetX, -insetY], [insetX, insetY], [-insetX, insetY]]
      : Array.from({ length: p.holeCount }, (_, i) => {
        const angle = (i / p.holeCount) * Math.PI * 2;
        return [Math.cos(angle) * insetX, Math.sin(angle) * insetY];
      });
    positions.forEach(([x, y]) => {
      const hole = new THREE.Path();
      hole.absarc(x, y, p.holeDiameter / 2, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    });
    group.add(createExtrudedShapeMesh(shape, p.thickness, 0xf2a65a));
  } else if (design.template === 'cabinet') {
    const w = p.width;
    const d = p.depth;
    const h = p.height;
    const t = p.thickness;
    addBox(group, [w, t, h], [0, -d / 2, h / 2], 0xf4d5b5);
    addBox(group, [t, d, h], [-w / 2, 0, h / 2], 0xe8b98e);
    addBox(group, [t, d, h], [w / 2, 0, h / 2], 0xe8b98e);
    addBox(group, [w, d, t], [0, 0, t / 2], 0xf4d5b5);
    addBox(group, [w, d, t], [0, 0, h - t / 2], 0xf4d5b5);
    const drawerH = (h - p.legHeight - t * 3) / p.drawerCount;
    for (let i = 0; i < p.drawerCount; i += 1) {
      const y = d / 2 + 1;
      const z = p.legHeight + t + drawerH * i + drawerH / 2;
      addBox(group, [w - t * 2.2, 6, drawerH - 8], [0, y, z], 0xf23d36);
      addBox(group, [w * 0.18, 8, Math.max(4, drawerH * 0.08)], [0, y + 5, z], 0xf6c76f);
    }
    const lx = w / 2 - t * 1.5;
    const ly = d / 2 - t * 1.5;
    [[-lx, -ly], [lx, -ly], [-lx, ly], [lx, ly]].forEach(([x, y]) => {
      addBox(group, [t, t, p.legHeight], [x, y, -p.legHeight / 2], 0xd99b6a);
    });
  } else if (design.template === 'router_shell') {
    const w = p.width + p.clearance * 2;
    const d = p.depth + p.clearance * 2;
    const h = p.height;
    const t = p.wallThickness;
    addBox(group, [w, d, t], [0, 0, t / 2], 0x4ab2ff);
    addBox(group, [w, t, h], [0, -d / 2 + t / 2, h / 2], 0x318be6);
    addBox(group, [w, t, h], [0, d / 2 - t / 2, h / 2], 0x318be6);
    addBox(group, [t, d, h], [-w / 2 + t / 2, 0, h / 2], 0x2e7fd2);
    addBox(group, [t, d, h], [w / 2 - t / 2, 0, h / 2], 0x2e7fd2);
    for (let i = 0; i < 3; i += 1) {
      addBox(group, [16, 1.2, 8], [-28 + i * 28, d / 2 + 0.8, h * 0.48], 0x071018);
    }
    addCylinder(group, 3, 1.4, [0, d / 2 + 0.9, h * 0.72], 0x071018);
  } else if (design.template === 'pipe_rack') {
    addBox(group, [p.width, p.depth, p.thickness], [0, 0, p.thickness / 2], 0x2f95ff);
    const spacing = p.width / (p.holeCount + 1);
    for (let i = 0; i < p.holeCount; i += 1) {
      const x = -p.width / 2 + spacing * (i + 1);
      addCylinder(group, p.tubeDiameter / 2, p.depth * 0.9, [x, 0, p.thickness + p.tubeDiameter / 2], 0x57b8ff);
      addBox(group, [p.tubeDiameter * 0.35, p.depth * 0.9, p.height], [x, 0, p.height / 2], 0x2879c7);
    }
  }

  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      object.geometry.computeVertexNormals();
    }
  });

  return group;
}

export function generateOpenSCAD(design: CADDesign) {
  const p = design.params;
  const header = `// Generated by 3DP Agent CAD Studio\n// Template: ${design.title}\n// Prompt: ${design.prompt.replace(/\n/g, ' ')}\n$fn = 64;\n\n`;

  if (design.template === 'flange') {
    return `${header}outer_d = ${p.outerDiameter};\ninner_d = ${p.innerDiameter};\nthickness = ${p.thickness};\nhole_d = ${p.holeDiameter};\nhole_count = ${p.holeCount};\nbolt_circle_d = ${p.boltCircleDiameter.toFixed(2)};\n\ndifference() {\n  cylinder(d = outer_d, h = thickness);\n  translate([0, 0, -0.5]) cylinder(d = inner_d, h = thickness + 1);\n  for (i = [0 : hole_count - 1]) {\n    rotate([0, 0, i * 360 / hole_count])\n      translate([bolt_circle_d / 2, 0, -0.5])\n        cylinder(d = hole_d, h = thickness + 1);\n  }\n}\n`;
  }

  if (design.template === 'plate') {
    return `${header}width = ${p.width};\ndepth = ${p.depth};\nthickness = ${p.thickness};\nhole_d = ${p.holeDiameter};\nhole_count = ${p.holeCount};\ncorner_r = ${p.cornerRadius};\n\ndifference() {\n  linear_extrude(height = thickness)\n    offset(r = corner_r)\n      square([width - corner_r * 2, depth - corner_r * 2], center = true);\n  for (i = [0 : hole_count - 1]) {\n    rotate([0, 0, i * 360 / hole_count])\n      translate([width * 0.32, depth * 0.32, -0.5])\n        cylinder(d = hole_d, h = thickness + 1);\n  }\n}\n`;
  }

  if (design.template === 'router_shell') {
    return `${header}width = ${p.width};\ndepth = ${p.depth};\nheight = ${p.height};\nwall = ${p.wallThickness};\nclearance = ${p.clearance};\n\nouter_w = width + clearance * 2;\nouter_d = depth + clearance * 2;\n\nunion() {\n  cube([outer_w, outer_d, wall], center = true);\n  translate([0, -outer_d / 2 + wall / 2, height / 2]) cube([outer_w, wall, height], center = true);\n  translate([0, outer_d / 2 - wall / 2, height / 2]) cube([outer_w, wall, height], center = true);\n  translate([-outer_w / 2 + wall / 2, 0, height / 2]) cube([wall, outer_d, height], center = true);\n  translate([outer_w / 2 - wall / 2, 0, height / 2]) cube([wall, outer_d, height], center = true);\n}\n`;
  }

  if (design.template === 'cabinet') {
    return `${header}// Assembly preview. For production, split panels into separate printable files.\nwidth = ${p.width};\ndepth = ${p.depth};\nheight = ${p.height};\npanel = ${p.thickness};\ndrawers = ${p.drawerCount};\nleg_h = ${p.legHeight};\n\nmodule panel_box(size, pos) { translate(pos) cube(size, center = true); }\n\npanel_box([width, panel, height], [0, -depth/2, height/2]);\npanel_box([panel, depth, height], [-width/2, 0, height/2]);\npanel_box([panel, depth, height], [width/2, 0, height/2]);\npanel_box([width, depth, panel], [0, 0, panel/2]);\npanel_box([width, depth, panel], [0, 0, height - panel/2]);\n`;
  }

  return `${header}width = ${p.width};\ndepth = ${p.depth};\nheight = ${p.height};\ntube_d = ${p.tubeDiameter};\nchannels = ${p.holeCount};\nbase_t = ${p.thickness};\n\ncube([width, depth, base_t], center = true);\nfor (i = [1 : channels]) {\n  x = -width / 2 + i * width / (channels + 1);\n  translate([x, 0, base_t / 2 + tube_d / 2]) rotate([90, 0, 0]) cylinder(d = tube_d, h = depth * 0.9, center = true);\n}\n`;
}

export function downloadTextFile(fileName: string, content: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
