export function MetricRow({ label, value, unit = '', highlight = false }: {
  label: string; value: string | number; unit?: string; highlight?: boolean;
}) {
  return (
    <div className="flex justify-between items-center py-1.5 border-b border-border/30 last:border-0">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className={`text-xs font-mono ${highlight ? 'text-primary' : 'text-foreground'}`}>
        {value}{unit && <span className="text-muted-foreground/50 ml-1 text-xs">{unit}</span>}
      </span>
    </div>
  );
}
