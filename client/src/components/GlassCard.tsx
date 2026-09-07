interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  accent?: string;
}

export function GlassCard({ children, className = '', accent }: GlassCardProps) {
  return (
    <div
      className={`backdrop-blur-xl bg-background/60 border border-border/30 rounded-lg overflow-hidden shadow-lg shadow-black/20 relative ${className}`}
    >
      {/* Top edge highlight */}
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)' }} />
      {/* Left accent border */}
      {accent && <div className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l-lg" style={{ background: accent }} />}
      <div className="relative">
        {children}
      </div>
    </div>
  );
}
