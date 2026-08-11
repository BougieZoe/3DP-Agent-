// Four small L-shaped brackets framing the STL upload dropzone.
// Purely decorative — never intercepts pointer events (dropzone stays draggable/clickable).
// Color comes from the existing `primary` design token (teal in the dark theme).

const CORNERS = [
  { pos: 'top-0 left-0', edges: 'border-t-2 border-l-2' },
  { pos: 'top-0 right-0', edges: 'border-t-2 border-r-2' },
  { pos: 'bottom-0 left-0', edges: 'border-b-2 border-l-2' },
  { pos: 'bottom-0 right-0', edges: 'border-b-2 border-r-2' },
];

export function ViewfinderCorners() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      {CORNERS.map((c) => (
        <span
          key={c.pos}
          className={`absolute h-3.5 w-3.5 border-primary ${c.pos} ${c.edges}`}
        />
      ))}
    </div>
  );
}
