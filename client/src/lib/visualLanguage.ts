/// <reference types="vite/client" />
import * as THREE from 'three';

// ============================================================
// Theme palette interface
// ============================================================
export interface ThemeColors {
  accent: { cyan: number; cyanCSS: string; cyanDim: string; cyanGlow: number };
  warn:   { amber: number; amberCSS: string; amberDim: string };
  critical: { base: number; css: string; dim: string };
  scan:   { line: number; lineCSS: string; plane: number; planeCSS: string };
  highlight: { base: number; css: string };
  thermal: { cool: number; warmCore: number };
  neutral: { mute: number; muteCSS: string; pulse: number };
}

const dark: ThemeColors = {
  accent:   { cyan: 0x66ccff, cyanCSS: '#66ccff', cyanDim: '#4488aa', cyanGlow: 0x88ddff },
  warn:     { amber: 0xcc8844, amberCSS: '#cc8844', amberDim: '#a07030' },
  critical: { base: 0xcc6666, css: '#cc6666', dim: '#994444' },
  scan:     { line: 0x66ccff, lineCSS: '#66ccff', plane: 0x5599cc, planeCSS: '#5599cc' },
  highlight:{ base: 0x88ccff, css: '#88ccff' },
  thermal:  { cool: 0x4477aa, warmCore: 0xcc8844 },
  neutral:  { mute: 0x8899aa, muteCSS: '#8899aa', pulse: 0x66aacc },
} as const;

const light: ThemeColors = {
  accent:   { cyan: 0x5a7a6a, cyanCSS: '#5a7a6a', cyanDim: '#7a9a8a', cyanGlow: 0x6a8a7a },
  warn:     { amber: 0xb09068, amberCSS: '#b09068', amberDim: '#c8b088' },
  critical: { base: 0xba8888, css: '#ba8888', dim: '#cca8a8' },
  scan:     { line: 0x759888, lineCSS: '#759888', plane: 0x8a9ea5, planeCSS: '#8a9ea5' },
  highlight:{ base: 0x7aa5b5, css: '#7aa5b5' },
  thermal:  { cool: 0x7088a5, warmCore: 0xb09068 },
  neutral:  { mute: 0x88837e, muteCSS: '#88837e', pulse: 0x7aa898 },
} as const;

export const THEMES = { dark, light } as const;
export type ThemeKey = keyof typeof THEMES;

/** Static default palette (dark). For reactive access use useThemeTokens(). */
export const COLORS: ThemeColors = THEMES.dark;

// ============================================================
// Opacity tiers (theme‑independent)
// ============================================================
export const OPACITIES = {
  overlay:        0.30,
  overlayMax:     0.35,
  atmospheric:    0.15,
  atmosphericMax: 0.20,
  pulsePeak:      0.40,
  pulsePeakMax:   0.45,
  ghost:          0.12,
  scanPlane:      0.12,
  line:           0.25,
  dimLine:        0.15,
  highlightPt:    0.35,
  failureOverlay: 0.22,
  stressOverlay:  0.18,
  thermalShows:   0.20,
  marker:         0.25,
  ghostMarker:    0.08,
  printHeadLine:  0.375,
} as const;

// ============================================================
// Geometry / size constants (theme‑independent)
// ============================================================
export const SIZES = {
  sphereSeg:     16,
  sphereSegLow:  8,
  sphereSegMin:  6,
  point:         0.08,
  pointSmall:    0.04,
  head:          0.06,
  ghostSphere:   0.4,
  pulseRadius:   0.5,
  stressRadius:  0.08,
  oscRadius:     0.04,
  scanPlane:     10,
  markerSphere:  0.3,
  sagLineInit:   0.01,
  initialScale:  0.01,
} as const;

// ============================================================
// Shared Three.js material presets
// ============================================================
export const MATERIALS = {
  additive: {
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  },
  additiveDouble: {
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  },
  line: {
    transparent: true,
    depthWrite: false,
  },
  points: {
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  },
} as const;

// ============================================================
// Glow intensity (reserved for future PhongMaterial use)
// ============================================================
export const GLOW = { low: 0.08, mid: 0.18, high: 0.35 } as const;

// ============================================================
// ANIMATION — every numeric constant in one place
// ============================================================
export const ANIMATION = {
  cycleDuration: 8.7,

  breath: {
    speed:       0.5,
    flutterFreq: 1.6,
    flutterAmp:  0.08,
    pulseFreq:   1.0,
    pulseAmp:    0.18,
    ghostPulseF: 0.4,
    normCenter:  0.5,
    normRange:   0.5,
    minRhythm:   0.05,
  },
  drift: {
    speed:   0.3,
    ampFact: 0.025,
    vertRat: 0.6,
    xPhase:  0,        yPhase: 2.0,      zPhase: 0,
  },
  orbit: {
    speed:  0.4,
    factor: 0.18,
  },
  ghostDrift: {
    baseAmp: 0.06,     sevAmp: 0.03,     speed: 0.2,
    xPhase: 1.0,       yPhase: 3.0,      zPhase: 2.0,
    xFreq:  1.0,       yFreq:  0.7,      zFreq:  0.8,
  },
  reveal: {
    rate:           1.5,
    layerStagger:   0.12,
    activationRamp: 0.02,
    progressScale:  2,
  },
  sag:           { maxFactor: 0.3 },
  oscillate: {
    speed: 0.8, ampFact: 0.025, freqA: 1.3, freqB: 1.1, severityMult: 0.5,
  },
  stressPulse: {
    speed: 0.35, scaleBase: 0.06, scaleSev: 0.06, sevPhase: 3,
  },
  scan: {
    proxThresh: 0.8, actThresh: 0.5, scanNear: 0.5,
  },
  thermal: {
    rampRate: 0.015, severityMin: 0.3, maxPoints: 20,
  },
  attention: {
    lifetime: 2.5,    scanThresh: 0.6, scaleBase: 0.15,
    scaleGrowth: 0.4, scaleSev: 0.5,  opacityBase: 0.5,
    opacitySev: 0.3,  maxDelay: 0.3,  cooldown: 2.5,
    lifetimePad: 0.5,
  },
  causalFloat: { speed: 1.2, amp: 0.006 },
  markerScale: { base: 0.15, sevF: 0.5 },
  markerDrift: { amp: 0.025, vertRat: 0.6 },
} as const;

// ============================================================
// Semantic tokens interface
// ============================================================
export interface SemanticTokens {
  risk: {
    critical:  { three: number; css: string; opacity: number };
    warning:   { three: number; css: string; opacity: number };
    attention: { three: number; css: string; opacity: number };
    ghost:     { opacity: number };
  };
  scan: {
    plane: { three: number; opacity: number };
    line:  { three: number; opacity: number };
    pulse: { three: number; opacity: number };
  };
  attention: {
    thinWall:     { css: string };
    delamination: { css: string };
    default:      { css: string };
  };
  failure: {
    sag:       { three: number };
    oscillate: { three: number };
    stress:    { three: number };
    overlay:   { sag: number; stress: number };
  };
  thermal: {
    cool:    { three: number };
    warm:    { three: number };
    opacity: number;
  };
  printPath: {
    line: { three: number; opacity: number };
    head: { three: number; opacity: number };
  };
  layerReveal: {
    line: { three: number; opacity: number };
  };
  causalHighlight: {
    three:   number;
    opacity: number;
  };
  /** Icon strings — theme‑independent, defined statically */
  suggestionIcon: {
    thickenWall:    string;
    reduceOverhang: string;
    addSupport:     string;
    splitBridge:    string;
    hollowRegion:   string;
  };
  delta: {
    improvement:     string;
    regression:      string;
    neutral:         string;
    improvementChip: string;
    regressionChip:  string;
  };
  toggle: {
    active:   string;
    inactive: string;
  };
  overlay: {
    heatmap:     string;
    supports:    string;
    risks:       string;
    printPath:   string;
    layerReveal: string;
    failure:     string;
    thermal:     string;
    separator:   string;
  };
  chain: {
    improvement: string;
    regression:  string;
    neutral:     string;
    arrow:       string;
  };
}

// ============================================================
// Theme token builder — produces SemanticTokens from a palette
// ============================================================
export function buildSemantic(palette: ThemeColors): SemanticTokens {
  return {
    risk: {
      critical:  { three: palette.critical.base, css: palette.critical.css,  opacity: OPACITIES.marker },
      warning:   { three: palette.warn.amber,     css: palette.warn.amberCSS, opacity: OPACITIES.marker },
      attention: { three: palette.accent.cyan,    css: palette.accent.cyanCSS,opacity: OPACITIES.marker },
      ghost:     { opacity: OPACITIES.ghostMarker },
    },
    scan: {
      plane: { three: palette.scan.plane, opacity: OPACITIES.scanPlane },
      line:  { three: palette.scan.line,  opacity: OPACITIES.line },
      pulse: { three: palette.neutral.pulse, opacity: OPACITIES.pulsePeak },
    },
    attention: {
      thinWall:     { css: palette.critical.css },
      delamination: { css: palette.warn.amberCSS },
      default:      { css: palette.accent.cyanCSS },
    },
    failure: {
      sag:       { three: palette.warn.amber },
      oscillate: { three: palette.scan.plane },
      stress:    { three: palette.critical.base },
      overlay:   { sag: OPACITIES.failureOverlay, stress: OPACITIES.stressOverlay },
    },
    thermal: {
      cool:    { three: palette.thermal.cool },
      warm:    { three: palette.thermal.warmCore },
      opacity: OPACITIES.thermalShows,
    },
    printPath: {
      line: { three: palette.accent.cyan,    opacity: OPACITIES.line },
      head: { three: palette.accent.cyanGlow, opacity: OPACITIES.printHeadLine },
    },
    layerReveal: {
      line: { three: palette.accent.cyan, opacity: OPACITIES.dimLine },
    },
    causalHighlight: {
      three:   palette.highlight.base,
      opacity: OPACITIES.highlightPt,
    },
    // ── Theme‑independent groups ──
    suggestionIcon: {
      thickenWall:    '\u2550',
      reduceOverhang: '\u2220',
      addSupport:     '\u22A5',
      splitBridge:    '\u2194',
      hollowRegion:   '\u25CB',
    },
    delta: {
      improvement:     'dark:text-cyan-400 text-emerald-700',
      regression:      'dark:text-red-400 text-rose-700',
      neutral:         'dark:text-muted-foreground/40 text-muted-foreground/70',
      improvementChip: 'dark:text-cyan-400/60 dark:bg-cyan-400/5 dark:border-cyan-400/20 text-emerald-700/70 bg-emerald-700/10 border-emerald-700/20',
      regressionChip:  'dark:text-red-400/60 dark:bg-red-400/5 dark:border-red-400/20 text-rose-700/70 bg-rose-700/10 border-rose-700/20',
    },
    toggle: {
      active:   'dark:border-current/30 dark:bg-current/5 border-current/20 bg-current/10',
      inactive: 'dark:text-muted-foreground/40 dark:border-transparent dark:hover:text-muted-foreground text-muted-foreground/70 border-transparent hover:text-muted-foreground',
    },
    overlay: {
      heatmap:     'dark:text-orange-400 text-amber-700',
      supports:    'dark:text-blue-400 text-sky-700',
      risks:       'dark:text-cyan-400 text-emerald-700',
      printPath:   'dark:text-cyan-400 text-emerald-700',
      layerReveal: 'dark:text-cyan-400 text-emerald-700',
      failure:     'dark:text-amber-400 text-amber-700',
      thermal:     'dark:text-orange-400 text-amber-700',
      separator:   'border-t dark:border-border/20 border-border/40 my-1',
    },
    chain: {
      improvement: 'dark:text-cyan-400 text-emerald-700',
      regression:  'dark:text-red-400 text-rose-700',
      neutral:     'dark:text-muted-foreground/40 text-muted-foreground/70',
      arrow:       'dark:text-muted-foreground/20 text-muted-foreground/40',
    },
  };
}

/** Static default tokens for dark theme. For reactive access use useThemeTokens(). */
export const SEMANTIC: SemanticTokens = buildSemantic(THEMES.dark);

// ============================================================
// PANEL — glassmorphism UI tokens (Tailwind, theme‑independent)
// PANEL uses CSS variables (bg-background, border-border, etc.)
// which switch via :root:not(.dark) in index.css, so no dark:
// prefix needed.
// ============================================================
export const PANEL = {
  bg:             'bg-background/80',
  glass:          'backdrop-blur-sm',
  border:         'border border-border/40',
  borderHover:    'hover:border-border/70',
  borderSubtle:   'border border-border/20',
  borderSbtHover: 'hover:border-border/40',
  rounded:        'rounded-sm',
  roundedInner:   'rounded-[2px]',
  padding:        'p-2',
  paddingCard:    'p-3',
  gapSection:     'space-y-3',
  gapItems:       'space-y-1',
  fontLabel:      'text-[10px] font-mono text-muted-foreground/30 tracking-widest',
  fontMetric:     'text-[10px] font-mono',
  fontButton:     'text-[11px] font-mono',
  fontTiny:       'text-[9px] font-mono',
  fontSmall:      'text-[11px] font-mono',
  fontValue:      'text-[10px] font-mono',
  chip:           'text-[9px] font-mono px-1 rounded-[2px]',
  selectedBg:     'bg-foreground/5',
  selectedBorder: 'border-foreground/20',
  chipBg:         'bg-current/5',
  chipBorder:     'border-current/30',
  separator:      'border-t border-border/20 my-1',
} as const;

// ============================================================
// EVENT / PATTERN / PHASE CSS maps
// These use dark: prefix so they work in both dark and light mode.
// ============================================================
export const EVENT_COLORS_CSS: Record<string, string> = {
  thermal_accumulation: 'dark:text-orange-400 dark:border-orange-400/30 dark:bg-orange-400/5 text-amber-700 border-amber-700/30 bg-amber-700/8',
  cooling_imbalance:    'dark:text-yellow-400 dark:border-yellow-400/30 dark:bg-yellow-400/5 text-amber-700 border-amber-700/30 bg-amber-700/8',
  support_instability:  'dark:text-amber-400 dark:border-amber-400/30 dark:bg-amber-400/5 text-amber-700 border-amber-700/30 bg-amber-700/8',
  bridge_oscillation:   'dark:text-cyan-400 dark:border-cyan-400/30 dark:bg-cyan-400/5 text-emerald-700 border-emerald-700/30 bg-emerald-700/8',
  wall_vibration:       'dark:text-blue-400 dark:border-blue-400/30 dark:bg-blue-400/5 text-sky-700 border-sky-700/30 bg-sky-700/8',
  overhang_sag:         'dark:text-rose-400 dark:border-rose-400/30 dark:bg-rose-400/5 text-rose-700 border-rose-700/30 bg-rose-700/8',
  delamination_risk:    'dark:text-red-400 dark:border-red-400/30 dark:bg-red-400/5 text-rose-700 border-rose-700/30 bg-rose-700/8',
  failure_spike:        'dark:text-purple-400 dark:border-purple-400/30 dark:bg-purple-400/5 text-violet-700 border-violet-700/30 bg-violet-700/8',
};

export const PATTERN_COLORS_CSS: Record<string, string> = {
  unsupported_thin_bridge:   'dark:text-rose-400 text-rose-700',
  dense_overhang_cluster:    'dark:text-orange-400 text-amber-700',
  thermal_trap_cavity:       'dark:text-yellow-400 text-amber-700',
  oscillating_vertical_wall: 'dark:text-cyan-400 text-emerald-700',
  unstable_support_island:   'dark:text-amber-400 text-amber-700',
  stress_concentration_void: 'dark:text-red-400 text-rose-700',
};

export const PHASE_COLORS_CSS = [
  { label: 'BASE',        color: 'dark:bg-blue-500/20 bg-emerald-600/15' },
  { label: 'SUPPORT',     color: 'dark:bg-amber-500/20 bg-amber-600/15' },
  { label: 'BRIDGE',      color: 'dark:bg-cyan-500/20 bg-emerald-600/15' },
  { label: 'THERMAL',     color: 'dark:bg-orange-500/20 bg-amber-600/15' },
  { label: 'OVERHANG',    color: 'dark:bg-rose-500/20 bg-rose-600/15' },
  { label: 'FAILURE ZONE',color: 'dark:bg-red-500/20 bg-rose-600/15' },
] as const;
