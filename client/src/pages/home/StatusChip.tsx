export function StatusChip({ status, label }: { status: 'good' | 'warning' | 'critical'; label: string }) {
  const cfg = {
    good:     { cls: 'text-emerald-400 border-emerald-400/30 bg-emerald-400/5' },
    warning:  { cls: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/5' },
    critical: { cls: 'text-red-400 border-red-400/30 bg-red-400/5' },
  }[status];
  return <span className={`text-xs font-mono px-2 py-0.5 border rounded-sm ${cfg.cls}`}>{label}</span>;
}
