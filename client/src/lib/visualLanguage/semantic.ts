import { OPACITIES } from './primitives';
import { THEMES, type ThemeColors } from './colors';

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

export const SEMANTIC: SemanticTokens = buildSemantic(THEMES.dark);
