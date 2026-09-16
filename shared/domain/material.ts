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

export type MaterialTechnology = 'fdm' | 'sla' | 'fgf' | 'sls' | 'slm' | 'mjf' | 'concrete' | 'eco';

/**
 * End-of-life profile for the LOOP analysis (reuse fate + natural end).
 * All time values are months for a ~3mm-wall reference part under the named
 * condition; geometry (thin walls, high surface/volume) shortens them via
 * the loop module's geometry factor. Values marked "class estimate" come
 * from public material-class data, not a specific vendor grade — verify per
 * grade before quoting to customers.
 */
export interface MaterialEol {
  /** Mechanical recycling viable (regrind / remelt). */
  recyclable: boolean;
  /** Industrial-compost biodegradable. */
  compostable: boolean;
  /** Marine-biodegradable (seawater, microbial action). */
  marineDegradable: boolean;
  /**
   * Shredded scrap feeds straight back into FGF production (no repelletizing).
   * Only meaningful for pellet-process materials; filament/resin entries leave it false.
   */
  fgfDirectReuse: boolean;
  /**
   * Baseline months [min, max] to full industrial-compost breakdown for a
   * ~3mm-wall reference part. A RANGE, deliberately — point estimates for
   * biodegradation are precision theater. Absent = unknown.
   */
  compostMonthsRange?: [number, number];
  /** Provenance of the numbers above (certification class, literature, estimate). */
  basis?: string;
}

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
  /** Eco-material advisory (0..1): absorbs moisture. */
  moistureRisk?: number;
  /** Eco-material advisory (0..1): degrades in heat/UV. */
  degradationRisk?: number;
  /** Eco-material advisory (0..1): brittle, cracks under load. */
  brittlenessRisk?: number;

  // ── End-of-life (LOOP tab) ───────────────────────────────────────────────
  /**
   * End-of-life profile. OPTIONAL: absent means "unknown" — consumers must
   * render "no EOL data", never assume landfill OR recyclable. Brand names
   * must never appear here (or in any material entry): describe the material
   * class with public class-level data only.
   */
  eol?: MaterialEol;

  // ── Thermal properties (S2 — heat field / warping analysis) ──────────────
  /** Glass transition temperature (°C) — critical for FDM warping. Above this, polymer softens. */
  glassTransitionTempC?: number;
  /** Thermal conductivity (W/m·K) — how fast heat spreads through the material. */
  thermalConductivityWPerMK?: number;
  /** Specific heat capacity (J/g·K) — energy needed to raise 1g by 1K. */
  specificHeatJPerGK?: number;
  /** Printing temperature range (°C) — nozzle temp for FDM, laser power proxy for SLM. */
  printTempC?: { min: number; max: number };
  /** Heated bed temperature (°C) — FDM only. Higher = more adhesion, less warping. */
  bedTempC?: number;
  /** Volumetric shrinkage on cooling (%) — direct driver of warping stress. */
  shrinkagePercent?: number;
  /** Linear thermal expansion coefficient (1/K) — ΔL/L per degree. */
  thermalExpansionCoeff?: number;
  /** Environment requirements for successful printing. */
  environment?: {
    enclosure: boolean;
    draftShield: boolean;
    chamberTempC?: number;
  };

  // ── Extended thermal properties ─────────────────────────────────────────────
  /** Thermal diffusivity (mm²/s) — how fast temperature changes propagate. */
  thermalDiffusivityMm2PerS?: number;
  /** Emissivity (0-1) — surface radiation efficiency for thermal analysis. */
  emisivity?: number;
  /** Melting point (°C) — for metals and semi-crystalline polymers. */
  meltingPointC?: number;

  // ── Mechanical properties ───────────────────────────────────────────────────
  /** Tensile strength at yield (MPa). */
  tensileStrengthMPa?: number;
  /** Flexural modulus (GPa). */
  flexuralModulusGPa?: number;
  /** Elastic modulus (GPa). */
  elasticModulusGPa?: number;
  /** Poisson's ratio. */
  PoissonRatio?: number;
  /** Hardness description (e.g., "Shore 85A", "Rockwell R120"). */
  hardness?: string;
}

export const MATERIALS: Record<string, Material> = {
  // ── FDM — filaments ───────────────────────────────────────────────────────
  PLA: {
    name: 'PLA', technology: 'fdm',
    category: 'Thermoplastic filament',
    description: 'Polylactic acid — a plant-based (corn-starch) thermoplastic that melts at the lowest nozzle temperature (~180–220 °C). The easiest filament to print: minimal warping, no enclosure needed, but it is stiff, brittle, and softens above ~60 °C.',
    useCase: 'Prototypes, decorative parts, enclosures, lithophanes',
    overhangThreshold: 50, densityGPerCm3: 1.24, pricePerKgUsd: 22,
    // Thermal properties — low warping material
    glassTransitionTempC: 60,
    thermalConductivityWPerMK: 0.13,
    specificHeatJPerGK: 1.8,
    printTempC: { min: 180, max: 220 },
    bedTempC: 50,
    shrinkagePercent: 0.3,
    thermalExpansionCoeff: 7e-5,
    environment: { enclosure: false, draftShield: false },
    // Extended thermal properties
    thermalDiffusivityMm2PerS: 0.12,
    emisivity: 0.92,
    meltingPointC: 180,
    // Mechanical properties
    tensileStrengthMPa: 50,
    flexuralModulusGPa: 3.5,
    elasticModulusGPa: 3.5,
    PoissonRatio: 0.36,
    hardness: 'Rockwell R80',
    eol: {
      recyclable: true, compostable: true, marineDegradable: false, fgfDirectReuse: false,
      compostMonthsRange: [2, 6],
      basis: 'Class data: PLA industrial-compost 60–180 days; not marine-degradable.',
    },
  },
  PETG: {
    name: 'PETG', technology: 'fdm',
    category: 'Thermoplastic filament',
    description: 'Polyethylene terephthalate glycol — a tough, water- and chemical-resistant filament with strong layer adhesion and a slight flexibility. Prints near ~230–250 °C with good bridging, but is stringy and needs a dry filament to avoid bubbles.',
    useCase: 'Functional parts, containers, parts that flex slightly',
    overhangThreshold: 40, densityGPerCm3: 1.27, pricePerKgUsd: 25,
    // Thermal properties — moderate warping
    glassTransitionTempC: 80,
    thermalConductivityWPerMK: 0.24,
    specificHeatJPerGK: 1.4,
    printTempC: { min: 230, max: 250 },
    bedTempC: 70,
    shrinkagePercent: 0.4,
    thermalExpansionCoeff: 6e-5,
    environment: { enclosure: false, draftShield: false },
    // Extended thermal properties
    thermalDiffusivityMm2PerS: 0.17,
    emisivity: 0.90,
    meltingPointC: 250,
    // Mechanical properties
    tensileStrengthMPa: 53,
    flexuralModulusGPa: 2.1,
    elasticModulusGPa: 2.1,
    PoissonRatio: 0.38,
    hardness: 'Rockwell R100',
    eol: {
      recyclable: true, compostable: false, marineDegradable: false, fgfDirectReuse: false,
      basis: 'Class data: PETG mechanically recyclable, not compostable.',
    },
  },
  ABS: {
    name: 'ABS', technology: 'fdm',
    category: 'Thermoplastic filament',
    description: 'Acrylonitrile butadiene styrene — a strong, impact- and heat-resistant thermoplastic (~105 °C glass transition). Requires a heated bed (~100 °C) and an enclosure; it shrinks as it cools, so large flat parts warp and layers can delaminate.',
    useCase: 'Mechanical parts, automotive, electronics housings',
    overhangThreshold: 45, densityGPerCm3: 1.04, pricePerKgUsd: 28,
    // Thermal properties — HIGH warping risk, needs enclosure
    glassTransitionTempC: 105,
    thermalConductivityWPerMK: 0.17,
    specificHeatJPerGK: 1.4,
    printTempC: { min: 230, max: 260 },
    bedTempC: 100,
    shrinkagePercent: 0.8,
    thermalExpansionCoeff: 7e-5,
    environment: { enclosure: true, draftShield: true, chamberTempC: 50 },
    // Extended thermal properties
    thermalDiffusivityMm2PerS: 0.12,
    emisivity: 0.90,
    meltingPointC: 230,
    // Mechanical properties
    tensileStrengthMPa: 44,
    flexuralModulusGPa: 2.3,
    elasticModulusGPa: 2.3,
    PoissonRatio: 0.40,
    hardness: 'Rockwell R105',
    eol: {
      recyclable: true, compostable: false, marineDegradable: false, fgfDirectReuse: false,
      basis: 'Class data: ABS mechanically recyclable, not compostable.',
    },
  },
  TPU: {
    name: 'TPU', technology: 'fdm',
    category: 'Thermoplastic elastomer filament',
    description: 'Thermoplastic polyurethane — a rubber-like elastomer (hardness ~80–95A). Bends, stretches and absorbs shocks instead of cracking. Hard to push through a Bowden tube; prints best with a direct-drive extruder at slow speed.',
    useCase: 'Gaskets, phone cases, shock absorbers, flexible hinges',
    overhangThreshold: 40, densityGPerCm3: 1.21, pricePerKgUsd: 45,
    // Thermal properties — low warping (flexible)
    glassTransitionTempC: -40, // Corrected: TPU is an elastomer with Tg well below room temperature
    thermalConductivityWPerMK: 0.25,
    specificHeatJPerGK: 1.5,
    printTempC: { min: 210, max: 240 },
    bedTempC: 50,
    shrinkagePercent: 0.2,
    thermalExpansionCoeff: 8e-5,
    environment: { enclosure: false, draftShield: false },
    // Extended thermal properties
    thermalDiffusivityMm2PerS: 0.17,
    emisivity: 0.90,
    // Mechanical properties
    tensileStrengthMPa: 35,
    flexuralModulusGPa: 0.06,
    elasticModulusGPa: 0.06,
    PoissonRatio: 0.45,
    hardness: 'Shore 85A',
  },
  ASA: {
    name: 'ASA', technology: 'fdm',
    category: 'Thermoplastic filament',
    description: 'Acrylonitrile styrene acrylate — ABS-class strength with a UV-resistant acrylate surface layer, so it withstands sunlight and weather far longer than ABS. Same warping/enclosure requirements as ABS.',
    useCase: 'Outdoor parts, automotive exterior, marine hardware',
    overhangThreshold: 45, densityGPerCm3: 1.07, pricePerKgUsd: 30,
    // Thermal properties — HIGH warping (similar to ABS)
    glassTransitionTempC: 105,
    thermalConductivityWPerMK: 0.17,
    specificHeatJPerGK: 1.4,
    printTempC: { min: 235, max: 260 },
    bedTempC: 100,
    shrinkagePercent: 0.7,
    thermalExpansionCoeff: 7e-5,
    environment: { enclosure: true, draftShield: true, chamberTempC: 50 },
    // Extended thermal properties
    thermalDiffusivityMm2PerS: 0.12,
    emisivity: 0.90,
    // Mechanical properties
    tensileStrengthMPa: 44,
    flexuralModulusGPa: 2.3,
    elasticModulusGPa: 2.3,
    PoissonRatio: 0.40,
    hardness: 'Rockwell R105',
  },
  PC: {
    name: 'PC', technology: 'fdm',
    category: 'Engineering thermoplastic filament',
    description: 'Polycarbonate — an amorphous engineering plastic with exceptional strength, impact resistance and heat tolerance (~147 °C glass transition). Demands very high nozzle temperature (~260–310 °C), a heated enclosure and bone-dry filament; warps aggressively.',
    useCase: 'Structural and load-bearing parts, high-temperature service',
    overhangThreshold: 35, densityGPerCm3: 1.20, pricePerKgUsd: 40,
    // Thermal properties — EXTREME warping, needs high-temp enclosure
    glassTransitionTempC: 147,
    thermalConductivityWPerMK: 0.20,
    specificHeatJPerGK: 1.3,
    printTempC: { min: 280, max: 310 },
    bedTempC: 110,
    shrinkagePercent: 1.0,
    thermalExpansionCoeff: 6.5e-5,
    environment: { enclosure: true, draftShield: true, chamberTempC: 70 },
    // Extended thermal properties
    thermalDiffusivityMm2PerS: 0.14,
    emisivity: 0.90,
    meltingPointC: 267,
    // Mechanical properties
    tensileStrengthMPa: 63,
    flexuralModulusGPa: 2.4,
    elasticModulusGPa: 2.4,
    PoissonRatio: 0.37,
    hardness: 'Rockwell R118',
  },
  NYLON: {
    name: 'Nylon', technology: 'fdm',
    category: 'Engineering thermoplastic filament',
    description: 'Polyamide — a tough, wear-resistant, low-friction engineering thermoplastic with excellent layer adhesion. Strongly hygroscopic: it absorbs atmospheric moisture and must be dried before and during printing or it turns brittle and steams.',
    useCase: 'Gears, bearings, hinges, wear parts',
    overhangThreshold: 40, densityGPerCm3: 1.14, pricePerKgUsd: 45,
    // Thermal properties — HIGH warping + hygroscopic
    glassTransitionTempC: 50,
    thermalConductivityWPerMK: 0.25,
    specificHeatJPerGK: 1.7,
    printTempC: { min: 240, max: 270 },
    bedTempC: 70,
    shrinkagePercent: 1.5,
    thermalExpansionCoeff: 8e-5,
    environment: { enclosure: true, draftShield: true, chamberTempC: 40 },
    // Extended thermal properties
    thermalDiffusivityMm2PerS: 0.14,
    emisivity: 0.90,
    meltingPointC: 260,
    // Mechanical properties
    tensileStrengthMPa: 85,
    flexuralModulusGPa: 2.8,
    elasticModulusGPa: 2.8,
    PoissonRatio: 0.40,
    hardness: 'Rockwell R120',
  },
  // ── SLA/DLP — resins (a material family for the SLA/DLP printer technology) ──
  RESIN_STD: {
    name: 'Standard Resin', technology: 'sla',
    category: 'UV-cured liquid photopolymer',
    description: 'The base SLA/DLP resin — a liquid photopolymer that UV light cures layer by layer into solid parts. Delivers the finest detail and smoothest surface of any 3D printing process, but is brittle with low impact and heat resistance.',
    useCase: 'Miniatures, jewelry, dental-adjacent display models',
    overhangThreshold: 40, densityGPerCm3: 1.15, pricePerKgUsd: 60,
    // Mechanical properties
    tensileStrengthMPa: 50,
    flexuralModulusGPa: 2.5,
    elasticModulusGPa: 2.5,
    PoissonRatio: 0.35,
    hardness: 'Shore D80',
  },
  RESIN_TOUGH: {
    name: 'Tough Resin', technology: 'sla',
    category: 'UV-cured liquid photopolymer',
    description: 'A photopolymer blended with impact modifiers so cured parts behave more like ABS than brittle standard resin — higher toughness and less cracking — while keeping resin-level detail.',
    useCase: 'Functional prototypes, snap-fit parts, consumer products',
    overhangThreshold: 40, densityGPerCm3: 1.17, pricePerKgUsd: 90,
    // Mechanical properties
    tensileStrengthMPa: 55,
    flexuralModulusGPa: 2.3,
    elasticModulusGPa: 2.3,
    PoissonRatio: 0.35,
    hardness: 'Shore D78',
  },
  RESIN_CLEAR: {
    name: 'Clear Resin', technology: 'sla',
    category: 'UV-cured liquid photopolymer',
    description: 'A transparent photopolymer with optical clarity that can be polished or clear-coated after curing. Keep out of sunlight — the same UV that cures it also yellows it over time.',
    useCase: 'Lenses, transparent housings, lighting, demonstration parts',
    overhangThreshold: 40, densityGPerCm3: 1.14, pricePerKgUsd: 75,
    // Mechanical properties
    tensileStrengthMPa: 50,
    flexuralModulusGPa: 2.5,
    elasticModulusGPa: 2.5,
    PoissonRatio: 0.35,
    hardness: 'Shore D80',
  },
  RESIN_ENG: {
    name: 'Engineering Resin', technology: 'sla',
    category: 'UV-cured liquid photopolymer',
    description: 'A high-performance photopolymer engineered for heat and chemical resistance beyond standard resins — cured parts hold up under functional loads and repeated handling, not just display.',
    useCase: 'Functional prototypes, jigs and fixtures, tooling',
    overhangThreshold: 40, densityGPerCm3: 1.18, pricePerKgUsd: 120,
    // Mechanical properties
    tensileStrengthMPa: 60,
    flexuralModulusGPa: 3.5,
    elasticModulusGPa: 3.5,
    PoissonRatio: 0.35,
    hardness: 'Shore D85',
  },
  RESIN_DENTAL: {
    name: 'Dental Resin', technology: 'sla',
    category: 'UV-cured liquid photopolymer',
    description: 'A biocompatibility-tested photopolymer for dental workflows — produces accurate models and guides with high precision and clean dimensional fidelity; verify the specific ISO class against your application.',
    useCase: 'Dental models, surgical guides, orthodontic appliances',
    overhangThreshold: 40, densityGPerCm3: 1.20, pricePerKgUsd: 200,
    // Mechanical properties
    tensileStrengthMPa: 45,
    flexuralModulusGPa: 3.0,
    elasticModulusGPa: 3.0,
    PoissonRatio: 0.35,
    hardness: 'Shore D82',
  },
  // ── FGF — pellet feedstocks ──────────────────────────────────────────────
  ABS_PELLET: {
    name: 'ABS Pellet', technology: 'fgf',
    category: 'Pellet feedstock',
    description: 'ABS delivered as raw pellets for large-format pellet-extrusion printers. Orders of magnitude cheaper per kilo than filament, still ABS-strong — with the same warping and shrinkage, now on a furniture scale.',
    useCase: 'Furniture, large structural parts, tooling and molds',
    overhangThreshold: 45, densityGPerCm3: 1.04, pricePerKgUsd: 8,
    // Extended thermal properties
    thermalDiffusivityMm2PerS: 0.12,
    emisivity: 0.90,
    // Mechanical properties
    tensileStrengthMPa: 44,
    flexuralModulusGPa: 2.3,
    elasticModulusGPa: 2.3,
    PoissonRatio: 0.40,
    eol: {
      recyclable: true, compostable: false, marineDegradable: false, fgfDirectReuse: true,
      basis: 'Pellet process: shredded scrap feeds straight back, no repelletizing.',
    },
  },
  PETG_PELLET: {
    name: 'PETG Pellet', technology: 'fgf',
    category: 'Pellet feedstock',
    description: 'PETG pellets for large-format extrusion — tough, water- and chemical-resistant, with low odor during printing. A forgiving large-format choice compared to ABS pellet.',
    useCase: 'Large containers, signage, outdoor-lite structural parts',
    overhangThreshold: 40, densityGPerCm3: 1.27, pricePerKgUsd: 9,
    // Extended thermal properties
    thermalDiffusivityMm2PerS: 0.17,
    emisivity: 0.90,
    // Mechanical properties
    tensileStrengthMPa: 53,
    flexuralModulusGPa: 2.1,
    elasticModulusGPa: 2.1,
    PoissonRatio: 0.38,
    eol: {
      recyclable: true, compostable: false, marineDegradable: false, fgfDirectReuse: true,
      basis: 'Pellet process: shredded scrap feeds straight back, no repelletizing.',
    },
  },
  PP_PELLET: {
    name: 'PP Pellet', technology: 'fgf',
    category: 'Pellet feedstock',
    description: 'Polypropylene pellets — the lightest material here (~0.91 g/cm³, floats on water), chemically inert, fatigue- and weld-resistant. Holds a living hinge like no other plastic; large-format PP parts are in demand for tanks and industrial hardware.',
    useCase: 'Chemical tanks, living-hinge parts, industrial large-scale hardware',
    overhangThreshold: 45, densityGPerCm3: 0.91, pricePerKgUsd: 10,
    // Extended thermal properties
    thermalDiffusivityMm2PerS: 0.13,
    emisivity: 0.90,
    // Mechanical properties
    tensileStrengthMPa: 35,
    flexuralModulusGPa: 1.5,
    elasticModulusGPa: 1.5,
    PoissonRatio: 0.40,
  },
  // ── SLS / MJF — polymer powder bed fusion (self-supporting powder) ───────
  PA12: {
    name: 'PA12 (Nylon 12)', technology: 'sls',
    category: 'Polymer powder (PBF)',
    description: 'Nylon 12 powder fused by laser (SLS) or fusing-agent + infrared (MJF). Tough, fatigue-resistant, chemically stable, low moisture uptake. The part grows inside a powder bed, so overhangs are self-supporting and never need printed supports — but enclosed cavities trap unsintered powder that needs escape holes.',
    useCase: 'Functional parts, snap-fit, batch production',
    overhangThreshold: 65, densityGPerCm3: 1.01, pricePerKgUsd: 45,
    // Extended thermal properties
    thermalDiffusivityMm2PerS: 0.12,
    emisivity: 0.90,
    meltingPointC: 178,
    // Mechanical properties
    tensileStrengthMPa: 50,
    flexuralModulusGPa: 1.8,
    elasticModulusGPa: 1.8,
    PoissonRatio: 0.40,
    hardness: 'Rockwell R110',
  },
  PA11: {
    name: 'PA11 (Nylon 11)', technology: 'sls',
    category: 'Polymer powder (PBF)',
    description: 'Nylon 11 powder — bio-derived (castor oil), noticeably more ductile and impact-resistant than PA12, keeping living hinges and parts in harsh environments intact. Same self-supporting powder-bed behavior as PA12.',
    useCase: 'Ductile functional parts, automotive, hinges',
    overhangThreshold: 65, densityGPerCm3: 1.04, pricePerKgUsd: 60,
    // Extended thermal properties
    thermalDiffusivityMm2PerS: 0.12,
    emisivity: 0.90,
    meltingPointC: 185,
    // Mechanical properties
    tensileStrengthMPa: 48,
    flexuralModulusGPa: 1.7,
    elasticModulusGPa: 1.7,
    PoissonRatio: 0.40,
    hardness: 'Rockwell R108',
  },
  TPU_POWDER: {
    name: 'TPU Powder', technology: 'sls',
    category: 'Elastomer powder (PBF)',
    description: 'Thermoplastic polyurethane powder — laser-sintered flexible, rubber-like parts with complex compliant geometry that FDM cannot make. Overhangs are powder-supported; open lattices keep powder easy to clear.',
    useCase: 'Cushions, seals, compliant structures, lattices',
    overhangThreshold: 65, densityGPerCm3: 1.20, pricePerKgUsd: 85,
    // Extended thermal properties
    thermalDiffusivityMm2PerS: 0.14,
    emisivity: 0.90,
    // Mechanical properties
    tensileStrengthMPa: 25,
    flexuralModulusGPa: 0.10,
    elasticModulusGPa: 0.10,
    PoissonRatio: 0.45,
    hardness: 'Shore 80A',
  },
  MJF_PA12: {
    name: 'PA12 (MJF)', technology: 'mjf',
    category: 'Polymer powder (Multi Jet Fusion)',
    description: 'HP Multi Jet Fusion PA12 — a fusing agent is jetted onto the powder and infrared sinters it, producing fast, consistent, finely-detailed nylon parts at production volume. Powder-supported overhangs; enclosed cavities need escape holes for the unfused powder.',
    useCase: 'Production parts at volume, end-use parts',
    overhangThreshold: 65, densityGPerCm3: 1.02, pricePerKgUsd: 55,
  },
  // ── SLM / DMLS — metal powder bed fusion (needs supports) ─────────────────
  STEEL_316L: {
    name: '316L Stainless', technology: 'slm',
    category: 'Metal powder (PBF)',
    description: '316L stainless steel powder melted by laser into fully dense metal parts — corrosion-resistant and weldable, the workhorse industrial metal. Unlike polymer PBF, overhangs beyond ~45° NEED support anchors, and trapped powder in cavities is expensive and hard to remove.',
    useCase: 'Industrial, tooling, corrosion-resistant parts',
    overhangThreshold: 45, densityGPerCm3: 7.98, pricePerKgUsd: 50,
    // Extended thermal properties
    meltingPointC: 1375,
    thermalConductivityWPerMK: 16.3,
    specificHeatJPerGK: 0.50,
    thermalDiffusivityMm2PerS: 4.1,
    emisivity: 0.35,
    printTempC: { min: 1300, max: 1400 },
    // Mechanical properties
    tensileStrengthMPa: 570,
    flexuralModulusGPa: 193,
    elasticModulusGPa: 193,
    PoissonRatio: 0.27,
    hardness: 'Rockwell C20',
  },
  TI64: {
    name: 'Ti-6Al-4V', technology: 'slm',
    category: 'Metal powder (PBF)',
    description: 'Ti-6Al-4V titanium alloy powder — aerospace-grade strength-to-weight and biocompatible, but the most demanding metal to print: high residual stress, steep unsupported faces distort, and it is expensive per kg.',
    useCase: 'Aerospace, medical implants, high-performance',
    overhangThreshold: 45, densityGPerCm3: 4.43, pricePerKgUsd: 320,
    // Extended thermal properties
    meltingPointC: 1660,
    thermalConductivityWPerMK: 6.7,
    specificHeatJPerGK: 0.526,
    thermalDiffusivityMm2PerS: 2.9,
    emisivity: 0.30,
    printTempC: { min: 1600, max: 1700 },
    // Mechanical properties
    tensileStrengthMPa: 1100,
    flexuralModulusGPa: 114,
    elasticModulusGPa: 114,
    PoissonRatio: 0.34,
    hardness: 'Rockwell C36',
  },
  ALSI10MG: {
    name: 'AlSi10Mg', technology: 'slm',
    category: 'Metal powder (PBF)',
    description: 'AlSi10Mg aluminum alloy powder — lightweight with good thermal conductivity, a cast-like alloy popular for automotive and heat-dissipation parts. Lower density than steel makes large parts lighter, but it still needs support anchors and powder-escape planning.',
    useCase: 'Automotive, heat sinks, lightweight structures',
    overhangThreshold: 45, densityGPerCm3: 2.67, pricePerKgUsd: 40,
    // Extended thermal properties
    meltingPointC: 575,
    thermalConductivityWPerMK: 112,
    specificHeatJPerGK: 0.89,
    thermalDiffusivityMm2PerS: 47,
    emisivity: 0.30,
    printTempC: { min: 550, max: 600 },
    // Mechanical properties
    tensileStrengthMPa: 350,
    flexuralModulusGPa: 70,
    elasticModulusGPa: 70,
    PoissonRatio: 0.33,
    hardness: 'Rockwell C40',
  },
  // ── Additional metals ──────────────────────────────────────────────────────
  INCONEL718: {
    name: 'Inconel 718', technology: 'slm',
    category: 'Superalloy powder (PBF)',
    description: 'Inconel 718 nickel-chromium superalloy — excellent strength and corrosion resistance at high temperatures (up to 700°C). Difficult to print: requires high laser power, slow scan speeds, and stress-relief heat treatment. Used in aerospace and gas turbine applications.',
    useCase: 'Aerospace, gas turbines, high-temperature engine components',
    overhangThreshold: 45, densityGPerCm3: 8.19, pricePerKgUsd: 120,
    meltingPointC: 1335,
    glassTransitionTempC: 720,
    thermalConductivityWPerMK: 11.4,
    specificHeatJPerGK: 0.435,
    printTempC: { min: 1250, max: 1350 },
    tensileStrengthMPa: 1035,
    elasticModulusGPa: 205,
    PoissonRatio: 0.30,
  },
  COPPER: {
    name: 'Copper (C18400)', technology: 'slm',
    category: 'Metal powder (PBF)',
    description: 'Copper alloy powder — excellent thermal and electrical conductivity. Challenging to print due to high reflectivity (requires green/blue laser or surface treatment). Used for heat exchangers, electrical contacts, and thermal management.',
    useCase: 'Heat exchangers, electrical contacts, thermal management',
    overhangThreshold: 45, densityGPerCm3: 8.96, pricePerKgUsd: 80,
    meltingPointC: 1085,
    thermalConductivityWPerMK: 398,
    specificHeatJPerGK: 0.385,
    printTempC: { min: 1050, max: 1150 },
    tensileStrengthMPa: 310,
    elasticModulusGPa: 130,
    PoissonRatio: 0.34,
  },
  // ── High-performance polymers ───────────────────────────────────────────────
  PEEK: {
    name: 'PEEK', technology: 'fdm',
    category: 'High-performance thermoplastic',
    description: 'Polyether ether ketone — a semi-crystalline thermoplastic with exceptional mechanical and chemical resistance at high temperatures. Prints at 360-420°C with a heated bed (120-160°C) and requires an enclosed chamber. Expensive but produces parts comparable to metal in many applications.',
    useCase: 'Aerospace, medical implants, oil & gas, semiconductor',
    overhangThreshold: 45, densityGPerCm3: 1.30, pricePerKgUsd: 400,
    glassTransitionTempC: 143,
    meltingPointC: 343,
    thermalConductivityWPerMK: 0.25,
    specificHeatJPerGK: 1.3,
    printTempC: { min: 360, max: 420 },
    bedTempC: 160,
    shrinkagePercent: 1.0,
    thermalExpansionCoeff: 4.7e-5,
    environment: { enclosure: true, draftShield: true, chamberTempC: 120 },
    tensileStrengthMPa: 100,
    flexuralModulusGPa: 4.1,
    elasticModulusGPa: 4.1,
    PoissonRatio: 0.40,
  },
  // ── Concrete — construction-scale extrusion (independent of FGF) ─────────
  CONCRETE_STD: {
    name: 'Standard Concrete Mix', technology: 'concrete',
    category: 'Construction extrusion',
    description: 'A standard cement-based mortar for large-format construction printers. Extruded wet in thick (~20mm) layers, so features finer than about twice the nozzle under-resolve, and unsupported overhangs sag under their own weight. Real structural design needs rebar and curing control — the STL cannot see those.',
    useCase: 'Walls, furniture, large structures, architectural elements',
    overhangThreshold: 35, densityGPerCm3: 2.40, pricePerKgUsd: 0.15,
  },
  CONCRETE_FIBER: {
    name: 'Fiber-Reinforced Concrete', technology: 'concrete',
    category: 'Construction extrusion',
    description: 'Cement-based mix with short reinforcing fibers — more crack-resistant and tolerant of thin sections than plain mix, at slightly higher cost. Same wet-extrusion limits as standard concrete.',
    useCase: 'Thin-shell structures, panels, elements with higher crack resistance',
    overhangThreshold: 35, densityGPerCm3: 2.40, pricePerKgUsd: 0.40,
  },
  CONCRETE_HP: {
    name: 'High-Performance Concrete', technology: 'concrete',
    category: 'Construction extrusion',
    description: 'High-strength, low-shrinkage concrete mix for demanding structural elements. Better finish and tighter tolerances, but the geometry rules (nozzle resolution, overhang sag) still apply.',
    useCase: 'Structural elements, demanding architectural pieces',
    overhangThreshold: 35, densityGPerCm3: 2.40, pricePerKgUsd: 0.80,
  },
  // ── Eco — recycled / bio-sourced thermoplastics ──────────────────────────
  ECO_RPLA: {
    name: 'Recycled PLA', technology: 'eco',
    category: 'Recycled thermoplastic',
    description: 'Reclaimed polylactic acid — prints like PLA but with more batch-to-batch variability and brittleness from reprocessing. Hygroscopic (dry before printing) and degrades in heat/UV, so it is a poor choice for warm or sunlit parts.',
    useCase: 'Low-impact prototypes, decorative parts, short-life items',
    overhangThreshold: 50, densityGPerCm3: 1.24, pricePerKgUsd: 15,
    moistureRisk: 0.5, degradationRisk: 0.6, brittlenessRisk: 0.7,
    // Extended thermal properties
    thermalDiffusivityMm2PerS: 0.12,
    emisivity: 0.92,
    // Mechanical properties
    tensileStrengthMPa: 45,
    flexuralModulusGPa: 3.2,
    elasticModulusGPa: 3.2,
    PoissonRatio: 0.36,
    eol: {
      recyclable: true, compostable: true, marineDegradable: false, fgfDirectReuse: false,
      compostMonthsRange: [2, 6],
      basis: 'Class data: recycled PLA keeps PLA industrial-compostability.',
    },
  },
  ECO_BIOPLA: {
    name: 'PLA+Bio Blend', technology: 'eco',
    category: 'Recycled thermoplastic',
    description: 'A bio-blended PLA with impact modifiers — more ductile than plain PLA, still hygroscopic and still degrades in sustained heat/UV. A reasonable everyday choice where the part is protected from the sun.',
    useCase: 'Everyday prototypes, enclosures, low-cost parts',
    overhangThreshold: 50, densityGPerCm3: 1.23, pricePerKgUsd: 18,
    moistureRisk: 0.5, degradationRisk: 0.6, brittlenessRisk: 0.6,
    // Extended thermal properties
    thermalDiffusivityMm2PerS: 0.12,
    emisivity: 0.92,
    // Mechanical properties
    tensileStrengthMPa: 48,
    flexuralModulusGPa: 3.0,
    elasticModulusGPa: 3.0,
    PoissonRatio: 0.36,
    eol: {
      recyclable: true, compostable: true, marineDegradable: false, fgfDirectReuse: false,
      compostMonthsRange: [2, 6],
      basis: 'Class data: bio-blended PLA keeps PLA industrial-compostability.',
    },
  },
  ECO_RPETG: {
    name: 'Recycled PETG', technology: 'eco',
    category: 'Recycled thermoplastic',
    description: 'Recycled PETG — tough and chemical-resistant like virgin PETG, with slightly more batch variability. Needs drying before printing; much less brittle than recycled PLA and far more UV-tolerant.',
    useCase: 'Functional parts, containers, outdoor-adjacent use',
    overhangThreshold: 40, densityGPerCm3: 1.27, pricePerKgUsd: 16,
    moistureRisk: 0.6, degradationRisk: 0.4, brittlenessRisk: 0.3,
    // Extended thermal properties
    thermalDiffusivityMm2PerS: 0.17,
    emisivity: 0.90,
    // Mechanical properties
    tensileStrengthMPa: 50,
    flexuralModulusGPa: 2.0,
    elasticModulusGPa: 2.0,
    PoissonRatio: 0.38,
    eol: {
      recyclable: true, compostable: false, marineDegradable: false, fgfDirectReuse: false,
      basis: 'Class data: recycled PETG stays mechanically recyclable, not compostable.',
    },
  },
  ECO_CELLULOSE_ACETATE: {
    name: 'Cellulose Acetate (Bio)', technology: 'eco',
    category: 'Bio-sourced thermoplastic',
    description: 'Wood/cotton cellulose acetate with biodegradable plasticizers — transparent, pleasant to touch, printable as filament and pellet. The material class behind marine-biodegradable grades: recyclable in production and compost/marine-degradable at end of life. Hygroscopic, so dry before printing.',
    useCase: 'Low-impact prototypes, transparent parts, short-life goods meant to return to nature',
    overhangThreshold: 45, densityGPerCm3: 1.30, pricePerKgUsd: 40,
    moistureRisk: 0.5, degradationRisk: 0.5, brittlenessRisk: 0.4,
    printTempC: { min: 200, max: 230 },
    // Extended thermal properties
    thermalDiffusivityMm2PerS: 0.12,
    emisivity: 0.90,
    // Mechanical properties
    tensileStrengthMPa: 40,
    flexuralModulusGPa: 2.0,
    elasticModulusGPa: 2.0,
    PoissonRatio: 0.35,
    eol: {
      recyclable: true, compostable: true, marineDegradable: true, fgfDirectReuse: true,
      compostMonthsRange: [2, 6],
      basis: 'Class estimate: cellulose-acetate OK-biodegradable-MARINE class; density is class midpoint 1.28–1.32; verify per grade.',
    },
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

/** Registry KEY of the first/default material for a technology — selects in the
 *  UI store the registry key (not the display name), so this is what a
 *  technology switch should call to land on a valid MATERIALS entry. */
export function defaultMaterialKeyFor(tech: MaterialTechnology): string {
  const found = Object.keys(MATERIALS).find(k => MATERIALS[k].technology === tech);
  return found ?? DEFAULT_MATERIAL.name;
}

export function getDensityGPerMm3(m: Material): number {
  return m.densityGPerCm3 / 1000;
}
