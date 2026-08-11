import { useEffect, useState } from 'react';

// Typewriter-dots status readout. Purely decorative — aria-hidden and
// pointer-events-none so it never interferes with the dropzone.
const BED_PHRASES = ['bed idle', 'bed idle.', 'bed idle..'];
const TICK_MS = 700;

export function BedStatusTicker() {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFrame((f) => (f + 1) % BED_PHRASES.length), TICK_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute bottom-2 left-3 select-none text-[11px] font-mono text-muted-foreground/30"
    >
      {BED_PHRASES[frame]}
    </div>
  );
}
