/**
 * Material — printability domain concept.
 *
 * Lives in shared/domain (not client/src/lib) because it is consumed by the
 * analysis layer, the agent system, and the UI alike. Keeping it in lib/
 * forced analysis→lib and agents→lib edges, violating the layer boundary:
 * domain code must not depend on UI-adjacent code. Moved here per the
 * architecture review (P1-3: "Move Material + materialState into
 * shared/domain; delete the analysis→lib and agents→lib edges").
 */

export type MaterialTechnology = 'fdm' | 'sla' | 'fgf';

export interface Material {
  name: string;
  /** Which printer technology this material feeds (FDM filament, SLA resin, FGF pellet). */
  technology: MaterialTechnology;
  /** Material class — the analog of a technology's ASTM process family (e.g. "Thermoplastic filament"). */
  category: string;
  /** What this material IS — rigorous one-liner in the style of the technology descriptions. */
  description: string;
  /** What it's good for. */
  useCase: string;
  overhangThreshold: number;
  densityGPerCm3: number;
  pricePerKgUsd: number;
}

export const MATERIALS: Record<string, Material> = {
  // ── FDM — filaments ───────────────────────────────────────────────────────
  PLA: {
    name: 'PLA', technology: 'fdm',
    category: 'Thermoplastic filament',
    description: 'Polylactic acid — a plant-based (corn-starch) thermoplastic that melts at the lowest nozzle temperature (~180–220 °C). The easiest filament to print: minimal warping, no enclosure needed, but it is stiff, brittle, and softens above ~60 °C.',
    useCase: 'Prototypes, decorative parts, enclosures, lithophanes',
    overhangThreshold: 50, densityGPerCm3: 1.24, pricePerKgUsd: 22,
  },
  PETG: {
    name: 'PETG', technology: 'fdm',
    category: 'Thermoplastic filament',
    description: 'Polyethylene terephthalate glycol — a tough, water- and chemical-resistant filament with strong layer adhesion and a slight flexibility. Prints near ~230–250 °C with good bridging, but is stringy and needs a dry filament to avoid bubbles.',
    useCase: 'Functional parts, containers, parts that flex slightly',
    overhangThreshold: 40, densityGPerCm3: 1.27, pricePerKgUsd: 25,
  },
  ABS: {
    name: 'ABS', technology: 'fdm',
    category: 'Thermoplastic filament',
    description: 'Acrylonitrile butadiene styrene — a strong, impact- and heat-resistant thermoplastic (~105 °C glass transition). Requires a heated bed (~100 °C) and an enclosure; it shrinks as it cools, so large flat parts warp and layers can delaminate.',
    useCase: 'Mechanical parts, automotive, electronics housings',
    overhangThreshold: 45, densityGPerCm3: 1.04, pricePerKgUsd: 28,
  },
  TPU: {
    name: 'TPU', technology: 'fdm',
    category: 'Thermoplastic elastomer filament',
    description: 'Thermoplastic polyurethane — a rubber-like elastomer (hardness ~80–95A). Bends, stretches and absorbs shocks instead of cracking. Hard to push through a Bowden tube; prints best with a direct-drive extruder at slow speed.',
    useCase: 'Gaskets, phone cases, shock absorbers, flexible hinges',
    overhangThreshold: 40, densityGPerCm3: 1.21, pricePerKgUsd: 45,
  },
  ASA: {
    name: 'ASA', technology: 'fdm',
    category: 'Thermoplastic filament',
    description: 'Acrylonitrile styrene acrylate — ABS-class strength with a UV-resistant acrylate surface layer, so it withstands sunlight and weather far longer than ABS. Same warping/enclosure requirements as ABS.',
    useCase: 'Outdoor parts, automotive exterior, marine hardware',
    overhangThreshold: 45, densityGPerCm3: 1.07, pricePerKgUsd: 30,
  },
  PC: {
    name: 'PC', technology: 'fdm',
    category: 'Engineering thermoplastic filament',
    description: 'Polycarbonate — an amorphous engineering plastic with exceptional strength, impact resistance and heat tolerance (~147 °C glass transition). Demands very high nozzle temperature (~260–310 °C), a heated enclosure and bone-dry filament; warps aggressively.',
    useCase: 'Structural and load-bearing parts, high-temperature service',
    overhangThreshold: 35, densityGPerCm3: 1.20, pricePerKgUsd: 40,
  },
  NYLON: {
    name: 'Nylon', technology: 'fdm',
    category: 'Engineering thermoplastic filament',
    description: 'Polyamide — a tough, wear-resistant, low-friction engineering thermoplastic with excellent layer adhesion. Strongly hygroscopic: it absorbs atmospheric moisture and must be dried before and during printing or it turns brittle and steams.',
    useCase: 'Gears, bearings, hinges, wear parts',
    overhangThreshold: 40, densityGPerCm3: 1.14, pricePerKgUsd: 45,
  },
  // ── SLA/DLP — resins (a material family for the SLA/DLP printer technology) ──
  RESIN_STD: {
    name: 'Standard Resin', technology: 'sla',
    category: 'UV-cured liquid photopolymer',
    description: 'The base SLA/DLP resin — a liquid photopolymer that UV light cures layer by layer into solid parts. Delivers the finest detail and smoothest surface of any 3D printing process, but is brittle with low impact and heat resistance.',
    useCase: 'Miniatures, jewelry, dental-adjacent display models',
    overhangThreshold: 40, densityGPerCm3: 1.15, pricePerKgUsd: 60,
  },
  RESIN_TOUGH: {
    name: 'Tough Resin', technology: 'sla',
    category: 'UV-cured liquid photopolymer',
    description: 'A photopolymer blended with impact modifiers so cured parts behave more like ABS than brittle standard resin — higher toughness and less cracking — while keeping resin-level detail.',
    useCase: 'Functional prototypes, snap-fit parts, consumer products',
    overhangThreshold: 40, densityGPerCm3: 1.17, pricePerKgUsd: 90,
  },
  RESIN_CLEAR: {
    name: 'Clear Resin', technology: 'sla',
    category: 'UV-cured liquid photopolymer',
    description: 'A transparent photopolymer with optical clarity that can be polished or clear-coated after curing. Keep out of sunlight — the same UV that cures it also yellows it over time.',
    useCase: 'Lenses, transparent housings, lighting, demonstration parts',
    overhangThreshold: 40, densityGPerCm3: 1.14, pricePerKgUsd: 75,
  },
  RESIN_ENG: {
    name: 'Engineering Resin', technology: 'sla',
    category: 'UV-cured liquid photopolymer',
    description: 'A high-performance photopolymer engineered for heat and chemical resistance beyond standard resins — cured parts hold up under functional loads and repeated handling, not just display.',
    useCase: 'Functional prototypes, jigs and fixtures, tooling',
    overhangThreshold: 40, densityGPerCm3: 1.18, pricePerKgUsd: 120,
  },
  RESIN_DENTAL: {
    name: 'Dental Resin', technology: 'sla',
    category: 'UV-cured liquid photopolymer',
    description: 'A biocompatibility-tested photopolymer for dental workflows — produces accurate models and guides with high precision and clean dimensional fidelity; verify the specific ISO class against your application.',
    useCase: 'Dental models, surgical guides, orthodontic appliances',
    overhangThreshold: 40, densityGPerCm3: 1.20, pricePerKgUsd: 200,
  },
  // ── FGF — pellet feedstocks ──────────────────────────────────────────────
  ABS_PELLET: {
    name: 'ABS Pellet', technology: 'fgf',
    category: 'Pellet feedstock',
    description: 'ABS delivered as raw pellets for large-format pellet-extrusion printers. Orders of magnitude cheaper per kilo than filament, still ABS-strong — with the same warping and shrinkage, now on a furniture scale.',
    useCase: 'Furniture, large structural parts, tooling and molds',
    overhangThreshold: 45, densityGPerCm3: 1.04, pricePerKgUsd: 8,
  },
  PETG_PELLET: {
    name: 'PETG Pellet', technology: 'fgf',
    category: 'Pellet feedstock',
    description: 'PETG pellets for large-format extrusion — tough, water- and chemical-resistant, with low odor during printing. A forgiving large-format choice compared to ABS pellet.',
    useCase: 'Large containers, signage, outdoor-lite structural parts',
    overhangThreshold: 40, densityGPerCm3: 1.27, pricePerKgUsd: 9,
  },
  PP_PELLET: {
    name: 'PP Pellet', technology: 'fgf',
    category: 'Pellet feedstock',
    description: 'Polypropylene pellets — the lightest material here (~0.91 g/cm³, floats on water), chemically inert, fatigue- and weld-resistant. Holds a living hinge like no other plastic; large-format PP parts are in demand for tanks and industrial hardware.',
    useCase: 'Chemical tanks, living-hinge parts, industrial large-scale hardware',
    overhangThreshold: 45, densityGPerCm3: 0.91, pricePerKgUsd: 10,
  },
};

export const DEFAULT_MATERIAL = MATERIALS.PLA;

/** Materials available for a given printer technology (FDM → filaments, SLA → resins, FGF → pellets). */
export function materialsForTechnology(tech: MaterialTechnology): Material[] {
  return Object.values(MATERIALS).filter(m => m.technology === tech);
}

/** First/default material for a technology (used when switching printer types). */
export function defaultMaterialFor(tech: MaterialTechnology): Material {
  const list = materialsForTechnology(tech);
  return list[0] ?? DEFAULT_MATERIAL;
}

export function getDensityGPerMm3(m: Material): number {
  return m.densityGPerCm3 / 1000;
}
