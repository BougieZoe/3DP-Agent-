/**
 * Dynamic parameter extraction from authored build123d source.
 *
 * Best-effort heuristics, in priority order:
 *   1. `# PARAM` annotations (explicit min/max/step/unit).
 *   2. Auto-detected `name = number` assignments (≥2 found).
 *   3. The first `Box(w, d, h)` call.
 * The extracted surface is only as good as the source the generator wrote —
 * LLM-authored code without `# PARAM` annotations degrades to tier 2/3.
 */

export interface DynamicParam {
  name: string;
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  section: string;
}

export const SECTION_LABELS: Record<string, string> = {
  dimensions: 'DIMENSIONS', holes: 'HOLES', details: 'DETAILS', manufacturing: 'MANUFACTURING',
};

const _PL: Record<string, string> = {
  w:'Width',h:'Height',d:'Depth',l:'Length',r:'Radius',
  thick:'Thickness',outer:'Outer',inner:'Inner',bolt:'Bolt',
  hole:'Hole',holes:'Holes',num:'Count',count:'Count',
  corner:'Corner',fillet:'Fillet',spacing:'Spacing',
  seat:'Seat',leg:'Leg',back:'Back',tire:'Tire',
  body:'Body',window:'Window',door:'Door',wall:'Wall',
  width:'Width',height:'Height',depth:'Depth',length:'Length',
  radius:'Radius',diameter:'Diameter',angle:'Angle',
  wheelbase:'Wheelbase',roof:'Roof',spire:'Spire',
  tower:'Tower',cabin:'Cabin',plate:'Plate',
  head:'Head',arm:'Arm',house:'House',base:'Base',
  overall:'Overall',
};

function labelFromVar(name: string): string {
  return name.split('_').map(p => _PL[p.toLowerCase()]
    || (p.charAt(0).toUpperCase() + p.slice(1))).join(' ');
}

function sectionFromName(name: string): string {
  const l = name.toLowerCase();
  if (/^(?:w(?:idth)?|h(?:eight)?|d(?:epth)?|l(?:ength)?|thick|outer|inner|size|plate|house|base_|overall|seat_|leg_|body_)/.test(l)) return 'dimensions';
  if (/hole|bolt/.test(l)) return 'holes';
  if (/radius|fillet|corner|angle|spacing|back|roof|spire|tower|cabin|head|arm|tire|wheelbase|window|door|count|num/.test(l)) return 'details';
  if (/wall/.test(l)) return 'manufacturing';
  return 'dimensions';
}

function unitFromName(name: string): string {
  const l = name.toLowerCase();
  if (/angle/.test(l)) return '°';
  if (/count|num|holes$/.test(l)) return '';
  if (name.length <= 2 && /[whdlr]/.test(name)) return 'mm';
  return 'mm';
}

export function sliderBounds(name: string, current: string): { min: number; max: number; step: number } {
  const v = parseFloat(current) || 10;
  if (/hole/i.test(name) && /count|holes/i.test(name)) return { min: 0, max: 50, step: 1 };
  if (v <= 1) return { min: 0.1, max: 10, step: 0.1 };
  if (v <= 5) return { min: 0.5, max: 50, step: 0.5 };
  if (v <= 20) return { min: 1, max: 100, step: 1 };
  if (v <= 100) return { min: 1, max: 500, step: 1 };
  return { min: 1, max: 1000, step: 1 };
}

export function parseParamsFromSource(source: string): DynamicParam[] {
  const aRe = /#\s*PARAM\s+(\w+)\s+"([^"]*)"\s+(\w+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/g;
  let m; const annotated: DynamicParam[] = [];
  while ((m = aRe.exec(source)) !== null) {
    const vm = source.match(new RegExp(`\\b${m[1]}\\s*=\\s*(\\d+(?:\\.\\d+)?)`));
    if (vm) annotated.push({
      name: m[1], label: m[2], value: parseFloat(vm[1]),
      unit: m[3], min: parseFloat(m[4]), max: parseFloat(m[5]),
      step: parseFloat(m[6]), section: sectionFromName(m[1]),
    });
  }
  if (annotated.length > 0) return annotated;

  const vRe = /(?:^|;)\s*(\w+)\s*=\s*(\d+(?:\.\d+)?)/gm;
  const seen = new Set<string>(); const auto: DynamicParam[] = [];
  const SKIP = new Set(['from','import','def','return','gen_step',
    'body','ring','cabin','wheels','spoiler','base','tower','mid','spire',
    'windows','torso','head','arm1','arm2','leg1','leg2',
    'walls','roof_base','roof','door','window1','window2','chimney',
    'tmp','result','part1','part2','hole','h','i','j','k','x','y','z',
    'a','whe','cabin_h2','roof_h','arm','leg','door_h']);
  while ((m = vRe.exec(source)) !== null) {
    const name = m[1]; if (seen.has(name) || SKIP.has(name)) continue;
    seen.add(name); const val = parseFloat(m[2]);
    const b = sliderBounds(name, m[2]);
    auto.push({ name, label: labelFromVar(name), value: val,
      unit: unitFromName(name), section: sectionFromName(name), ...b });
  }
  if (auto.length >= 2) return auto;

  const bxRe = /Box\((\d+)\s*,\s*(\d+)(?:\s*,\s*(\d+))?/g;
  const bx = bxRe.exec(source);
  if (bx) {
    const r: DynamicParam[] = [];
    if (bx[1]) r.push({ name:'box_w', label:'Width', value:parseFloat(bx[1]), unit:'mm', min:1, max:1000, step:1, section:'dimensions' });
    if (bx[2]) r.push({ name:'box_d', label:'Depth', value:parseFloat(bx[2]), unit:'mm', min:1, max:1000, step:1, section:'dimensions' });
    if (bx[3]) r.push({ name:'box_h', label:'Height', value:parseFloat(bx[3]), unit:'mm', min:1, max:1000, step:1, section:'dimensions' });
    return r;
  }
  return [];
}
