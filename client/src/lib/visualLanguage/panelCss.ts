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
