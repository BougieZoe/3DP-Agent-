/**
 * CADHeader — title bar for CAD Studio workspace.
 * Pure presentational, no props needed.
 */

export function CADHeader({ spanCols }: { spanCols: string }) {
  return (
    <header className={`${spanCols} flex items-center justify-between px-6 pt-5 border-b border-border/15 bg-card/30`}>
      <div className="flex items-center gap-6">
        <div>
          <h1 className="text-lg font-mono font-bold tracking-tight text-foreground">3DP AGENT</h1>
          <p className="text-sm font-mono text-muted-foreground/40 tracking-wider">CAD Studio</p>
        </div>
      </div>
    </header>
  );
}
