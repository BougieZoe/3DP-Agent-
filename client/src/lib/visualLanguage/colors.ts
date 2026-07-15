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

export const COLORS: ThemeColors = THEMES.dark;
