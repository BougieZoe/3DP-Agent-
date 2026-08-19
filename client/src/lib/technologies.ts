// Rigorous classification of 3D printing TECHNOLOGIES (per ASTM F42 process
// families) — these are PRINTER CATEGORIES, not materials. The analysis engine
// branches its metrics by technology; the UI shows the full classification so
// users know exactly what they're choosing.

export type PrintTechnology = 'fdm' | 'resin' | 'fgf' | 'sls' | 'metal';

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
    description: 'Melted plastic filament stacked in layers',
    examples: 'Everyday parts, enclosures, prototypes',
    implemented: true,
  },
  {
    id: 'resin', shortLabel: 'RESIN', label: 'SLA / DLP / LCD',
    processFamily: 'VAT Photopolymerization',
    description: 'UV light cures liquid resin, layer by layer',
    examples: 'High-detail miniatures, jewelry, dental',
    implemented: true,
  },
  {
    id: 'fgf', shortLabel: 'FGF', label: 'FGF',
    processFamily: 'Material Extrusion (large pellet)',
    description: 'Melted plastic pellets for very large parts',
    examples: 'Furniture, large structures, boats',
    implemented: true,
  },
  {
    id: 'sls', shortLabel: 'SLS', label: 'SLS',
    processFamily: 'Powder Bed Fusion (polymer)',
    description: 'Laser sinters nylon powder — no supports needed',
    examples: 'Functional small parts, batch production',
    implemented: false,
  },
  {
    id: 'metal', shortLabel: 'METAL', label: 'SLM / DMLS',
    processFamily: 'Powder Bed Fusion (metal)',
    description: 'Laser melts metal powder, fully dense parts',
    examples: 'Industrial, aerospace, liquid-cooling',
    implemented: false,
  },
];

export const PRINT_TECH_BY_ID: Record<PrintTechnology, PrintTechnologyInfo> =
  Object.fromEntries(PRINT_TECHNOLOGIES.map(t => [t.id, t])) as Record<PrintTechnology, PrintTechnologyInfo>;
