import type { DesignIntent } from './types';

const OBJECT_KEYWORDS: [RegExp, string][] = [
  [/flange|washer|ring|circular\s+gasket/, 'flange'],
  [/plate|panel|mounting\s+board|baseplate/, 'mounting plate'],
  [/bracket|corner\s+brace|angle\s+bracket/, 'bracket'],
  [/drone|quadcopter|frame\s*(?:arm)?/, 'drone frame'],
  [/box|enclosure|cabinet|housing|case/, 'enclosure'],
  [/spacer|standoff|spool/, 'spacer'],
  [/gear|cog|sprocket/, 'gear'],
  [/bottle|container|vase|pot|cup/, 'container'],
  [/tower|building|structure|column/, 'structure'],
  [/car|vehicle|body\s+panel|hood/, 'vehicle body'],
  [/human|figure|mannequin|sculpture|statue/, 'figure'],
  [/house|home|roof|wall/, 'building'],
  [/mount|adapter|holder|clip/, 'mount/adapter'],
  [/handle|grip|knob/, 'handle'],
  [/duct|nozzle|pipe|tube/, 'duct/pipe'],
  [/blade|propeller|impeller|fan/, 'blade'],
  [/joint|hinge|link|arm/, 'mechanical link'],
  [/toy|figurine|model/, 'toy/figurine'],
  [/jig|fixture|template|tool/, 'jig/fixture'],
  [/sensor|cover|cap/, 'cap/cover'],
];

const MATERIAL_KEYWORDS: [RegExp, string][] = [
  [/\bPLA\b/, 'PLA'],
  [/\bPETG\b/, 'PETG'],
  [/\bABS\b/, 'ABS'],
  [/polycarbonate|PC\b/, 'polycarbonate'],
  [/nylon|polyamide/, 'nylon'],
  [/carbon\s*fiber|CF/, 'carbon fiber'],
  [/aluminum|aluminium/, 'aluminum'],
  [/steel|stainless/, 'steel'],
  [/titanium/, 'titanium'],
  [/resin/, 'resin'],
  [/\bTPU\b/, 'TPU'],
  [/wood\s*filament/, 'wood filament'],
];

const PROCESS_KEYWORDS: [RegExp, string][] = [
  [/\bFDM\b|fused\s*deposition|FFF/, 'FDM'],
  [/\bSLA\b|resin\s*print/, 'SLA'],
  [/\bDLP\b/, 'DLP'],
  [/\bCNC\b|machin/, 'CNC'],
  [/laser\s*cut/, 'laser cutting'],
  [/injection\s*mold/, 'injection molding'],
  [/\bSLS\b|selective\s*laser\s*sinter/, 'SLS'],
  [/3d\s*print|additive\s*manufactur/, '3D printing'],
  [/vacuum\s*form/, 'vacuum forming'],
];

const CONSTRAINT_KEYWORDS: [RegExp, string][] = [
  [/lightweight|low\s*weight|minimal\s*material/, 'lightweight'],
  [/\brigid\b|stiff|high\s*stiffness/, 'rigid'],
  [/\bstrong\b|high\s*strength|durable/, 'strong'],
  [/flexible|bendab|elastic/, 'flexible'],
  [/heat\s*resist|high.?temp|therma/, 'heat resistant'],
  [/waterproof|water.?resist|hydrophobi/, 'waterproof'],
  [/food\s*safe|food.?grade/, 'food safe'],
  [/mounting\s*holes|screw\s*holes|bolt\s*holes/, 'mounting provisions'],
  [/thread|screw/, 'threaded connections'],
  [/snap.?fit|snap/, 'snap-fit assembly'],
  [/low.?profile|compact/, 'low profile'],
  [/aerodynami/, 'aerodynamic'],
  [/transparent|clear/, 'transparent/clear'],
  [/UV\s*resist|weatherproof|outdoor/, 'UV/weather resistant'],
];

export function parseDesignIntent(prompt: string): DesignIntent {
  const lower = prompt.toLowerCase();

  let objectType = 'custom part';
  for (const [re, label] of OBJECT_KEYWORDS) {
    if (re.test(lower)) { objectType = label; break; }
  }

  const dims: { x?: number; y?: number; z?: number } = {};
  const boxMatch = lower.match(/(\d+)\s*x\s*(\d+)\s*x\s*(\d+)\s*mm/);
  if (boxMatch) {
    dims.x = parseInt(boxMatch[1]);
    dims.y = parseInt(boxMatch[2]);
    dims.z = parseInt(boxMatch[3]);
  } else {
    for (const [re, axis] of [
      [/(\d+)\s*mm\s+(?:wide|width)\b/, 'x'],
      [/(\d+)\s*mm\s+(?:deep|depth)\b/, 'y'],
      [/(\d+)\s*mm\s+(?:tall|high|height)\b/, 'z'],
      [/(\d+)\s*mm\s+(?:long|length)\b/, 'x'],
    ] as [RegExp, string][]) {
      const match = lower.match(re);
      if (match) {
        const val = parseInt(match[1]);
        if (axis === 'x' && dims.x == null) dims.x = val;
        if (axis === 'y' && dims.y == null) dims.y = val;
        if (axis === 'z' && dims.z == null) dims.z = val;
      }
    }
  }

  let material: string | undefined;
  for (const [re, label] of MATERIAL_KEYWORDS) {
    if (re.test(lower)) { material = label; break; }
  }

  let process: string | undefined;
  for (const [re, label] of PROCESS_KEYWORDS) {
    if (re.test(lower)) { process = label; break; }
  }

  const requirements: string[] = [];
  for (const [re, label] of CONSTRAINT_KEYWORDS) {
    if (re.test(lower) && !requirements.includes(label)) {
      requirements.push(label);
    }
  }

  return {
    objectType,
    dimensions: Object.keys(dims).length > 0 ? dims : {},
    material,
    process,
    requirements,
  };
}
