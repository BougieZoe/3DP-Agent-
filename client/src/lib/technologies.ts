// Rigorous classification of 3D printing TECHNOLOGIES (per ASTM F42 process
// families) — these are PRINTER CATEGORIES, not materials. The analysis engine
// branches its metrics by technology; the UI shows the full classification so
// users know exactly what they're choosing.

export type PrintTechnology = 'fdm' | 'sla' | 'fgf' | 'sls' | 'slm' | 'mjf' | 'concrete' | 'eco';

export interface PrintTechnologyInfo {
  id: PrintTechnology;
  /** Short header label (e.g. "FDM"). */
  shortLabel: string;
  /** Common alias / tech names (e.g. "FDM/FFF"). */
  label: string;
  /** ASTM process family. */
  processFamily: string;
  /** One-line: how it prints. */
  description: string;
  /** What it's good for. */
  examples: string;
  /** Whether the analysis module is implemented yet. */
  implemented: boolean;
}

export const PRINT_TECHNOLOGIES: readonly PrintTechnologyInfo[] = [
  {
    id: 'fdm', shortLabel: 'FDM', label: 'FDM / FFF',
    processFamily: 'Material Extrusion (filament)',
    description: 'A 3D printer melts plastic filament and stacks it in layers',
    examples: 'Everyday parts, enclosures, prototypes',
    implemented: true,
  },
  {
    id: 'sla', shortLabel: 'SLA/DLP', label: 'SLA / DLP / LCD',
    processFamily: 'VAT Photopolymerization',
    description: 'A 3D printer cures liquid resin (a material) with UV light, layer by layer',
    examples: 'High-detail miniatures, jewelry, dental',
    implemented: true,
  },
  {
    id: 'fgf', shortLabel: 'FGF', label: 'FGF',
    processFamily: 'Material Extrusion (large pellet)',
    description: 'A large-format 3D printer melts plastic pellets for very large parts',
    examples: 'Furniture, large structures, boats',
    implemented: true,
  },
  {
    id: 'sls', shortLabel: 'SLS', label: 'SLS',
    processFamily: 'Powder Bed Fusion (polymer)',
    description: 'A 3D printer sinters nylon powder with a laser — no supports needed',
    examples: 'Functional small parts, batch production',
    implemented: true,
  },
  {
    id: 'slm', shortLabel: 'SLM/DMLS', label: 'SLM / DMLS',
    processFamily: 'Powder Bed Fusion (metal)',
    description: 'A 3D printer melts metal powder with a laser into fully dense parts',
    examples: 'Industrial, aerospace, liquid-cooling',
    implemented: true,
  },
  {
    id: 'mjf', shortLabel: 'MJF', label: 'MJF',
    processFamily: 'Powder Bed Fusion (Multi Jet Fusion)',
    description: 'HP\'s 3D printer applies a fusing agent + infrared to sinter polymer parts fast',
    examples: 'Production polymer parts at volume',
    implemented: true,
  },
  {
    id: 'concrete', shortLabel: 'CONCRETE', label: 'Concrete',
    processFamily: 'Material Extrusion (construction-scale)',
    description: 'A large gantry printer extrudes wet concrete in thick layers to build houses and structures',
    examples: 'Walls, furniture, large structures',
    implemented: true,
  },
  {
    id: 'eco', shortLabel: 'ECO', label: 'Eco',
    processFamily: 'Material Extrusion (recycled / bio thermoplastics)',
    description: 'FDM printing with recycled or bio-sourced filaments — the same process, different material care',
    examples: 'Low-impact prototypes, everyday parts',
    implemented: true,
  },
];

export const PRINT_TECH_BY_ID: Record<PrintTechnology, PrintTechnologyInfo> =
  Object.fromEntries(PRINT_TECHNOLOGIES.map(t => [t.id, t])) as Record<PrintTechnology, PrintTechnologyInfo>;
