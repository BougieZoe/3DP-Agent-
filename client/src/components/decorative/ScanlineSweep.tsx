import './scanline.css';

// 1px teal gradient, transparent at both ends — built from the existing
// `--color-primary` design token (no hardcoded colors). Sweep is a pure CSS
// keyframe translateY loop (see scanline.css), paused/hidden under
// prefers-reduced-motion.
const LINE_GRADIENT =
  'linear-gradient(90deg, transparent, color-mix(in oklab, var(--color-primary) 45%, transparent) 50%, transparent)';

/** Thin scanline sweeping top-to-bottom inside the upload dropzone. Purely decorative. */
export function ScanlineSweep() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="decorative-scanline-runner absolute inset-0">
        <div
          className="decorative-scanline-line absolute left-0 right-0 top-0 h-px"
          style={{ background: LINE_GRADIENT }}
        />
      </div>
    </div>
  );
}
