import { useState, useCallback, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";

/* ─── Types ─── */

export interface CADPanelParams {
  width: number;
  depth: number;
  thickness: number;
  holes: number;
  holeDia: number;
  corner: number;
}

export interface CADPanelProps {
  /** Called on every parameter change with the full params object. */
  onChange?: (params: CADPanelParams) => void;
  /** Optional external overrides (e.g. from parent state). */
  initial?: Partial<CADPanelParams>;
  /** Called (debounced 300ms) with build123d source to drive 3D regeneration. */
  onRegenerate?: (source: string) => void;
}

interface SliderDef {
  key: keyof CADPanelParams;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  /** If true, the value is an integer (holes count). */
  int?: boolean;
}

/* ─── Slider definitions ─── */

const SLIDERS: SliderDef[] = [
  { key: "width",     label: "Width",     min: 20,  max: 200, step: 1,   unit: "mm" },
  { key: "depth",     label: "Depth",     min: 20,  max: 200, step: 1,   unit: "mm" },
  { key: "thickness", label: "Thickness", min: 0.8, max: 20,  step: 0.2, unit: "mm" },
  { key: "holes",     label: "Holes",     min: 0,   max: 8,   step: 1,   unit: "",   int: true },
  { key: "holeDia",   label: "Hole Dia",  min: 2,   max: 12,  step: 0.5, unit: "mm" },
  { key: "corner",    label: "Corner",    min: 0,   max: 15,  step: 0.5, unit: "mm" },
];

/* ─── Defaults ─── */

const DEFAULTS: CADPanelParams = {
  width: 60,
  depth: 45,
  thickness: 4.0,
  holes: 4,
  holeDia: 5.0,
  corner: 5.0,
};

/* ─── build123d generator (drives 3D preview) ─── */

export function generateBuild123dSource(p: CADPanelParams): string {
  const hw = p.width / 2;
  const hd = p.depth / 2;
  const margin = 7;
  let code = `from build123d import *\n\n`;
  code += `# PARAM plate_w "Plate Width" mm 20 200 1\n`;
  code += `# PARAM plate_d "Plate Depth" mm 20 200 1\n`;
  code += `# PARAM plate_h "Plate Thickness" mm 0.8 20 0.2\n`;
  code += `# PARAM holes "Holes" 0 8 1\n`;
  code += `# PARAM hole_r "Hole Radius" mm 1 6 0.5\n`;
  code += `# PARAM corner_r "Corner Radius" mm 0 15 0.5\n`;
  code += `def gen_step():\n`;
  code += `    plate_w = ${p.width}; plate_d = ${p.depth}; plate_h = ${p.thickness}; holes = ${p.holes}; hole_r = ${(p.holeDia / 2).toFixed(1)}; corner_r = ${p.corner.toFixed(1)}\n`;

  if (p.corner > 0) {
    code += `    base = Box(plate_w, plate_d, plate_h, align=(Align.CENTER, Align.CENTER, Align.MIN))\n`;
    code += `    base = fillet(base.edges().group_by(Axis.Z)[0], radius=corner_r)\n`;
  } else {
    code += `    base = Box(plate_w, plate_d, plate_h, align=(Align.CENTER, Align.CENTER, Align.MIN))\n`;
  }

  code += `    body = base\n`;
  if (p.holes > 0) {
    const positions: [number, number][] = [];
    if (p.holes >= 1) positions.push([-(hw - margin), -(hd - margin)]);
    if (p.holes >= 2) positions.push([ hw - margin, -(hd - margin)]);
    if (p.holes >= 3) positions.push([-(hw - margin),  hd - margin]);
    if (p.holes >= 4) positions.push([ hw - margin,  hd - margin]);
    if (p.holes >= 5) positions.push([0, -(hd - margin)]);
    if (p.holes >= 6) positions.push([0,  hd - margin]);
    if (p.holes >= 7) positions.push([-(hw - margin), 0]);
    if (p.holes >= 8) positions.push([ hw - margin, 0]);
    for (const [x, y] of positions) {
      code += `    hole = Pos(${x.toFixed(1)}, ${y.toFixed(1)}, 0) * Cylinder(radius=hole_r, height=plate_h + 0.2, align=(Align.CENTER, Align.CENTER, Align.MIN))\n`;
      code += `    body -= hole\n`;
    }
  }
  code += `    return body\n`;
  return code;
}

/* ─── OpenSCAD generator (display only) ─── */

function generateOpenSCAD(p: CADPanelParams): string {
  const hw = p.width / 2;
  const hd = p.depth / 2;
  let code = `// M5 Mounting Plate — ${p.width}×${p.depth}×${p.thickness}mm\n`;
  code += `difference() {\n`;
  if (p.corner > 0) {
    code += `  // Base plate with corner radius\n`;
    code += `  hull() {\n`;
    code += `    for (x = [-${(hw - p.corner).toFixed(1)}, ${(hw - p.corner).toFixed(1)}])\n`;
    code += `      for (y = [-${(hd - p.corner).toFixed(1)}, ${(hd - p.corner).toFixed(1)}])\n`;
    code += `        translate([x, y, 0])\n`;
    code += `          cylinder(h = ${p.thickness}, r = ${p.corner}, $fn = 32);\n`;
    code += `  }\n`;
  } else {
    code += `  cube([${p.width}, ${p.depth}, ${p.thickness}], center = true);\n`;
  }
  if (p.holes > 0) {
    code += `\n  // Mounting holes — M5 clearance\n`;
    const margin = 7;
    const hx = hw - margin;
    const hy = hd - margin;
    const positions: [number, number][] = [];
    if (p.holes >= 1) positions.push([-hx, -hy]);
    if (p.holes >= 2) positions.push([ hx, -hy]);
    if (p.holes >= 3) positions.push([-hx,  hy]);
    if (p.holes >= 4) positions.push([ hx,  hy]);
    // 5–8: edge midpoints
    if (p.holes >= 5) positions.push([0, -hy]);
    if (p.holes >= 6) positions.push([0,  hy]);
    if (p.holes >= 7) positions.push([-hx, 0]);
    if (p.holes >= 8) positions.push([ hx, 0]);
    for (const [x, y] of positions) {
      code += `  translate([${x.toFixed(1)}, ${y.toFixed(1)}, 0])\n`;
      code += `    cylinder(h = ${(p.thickness + 0.2).toFixed(1)}, r = ${(p.holeDia / 2).toFixed(1)}, center = true, $fn = 32);\n`;
    }
  }
  code += `}\n`;
  return code;
}

/* ─── Component ─── */

export function ParametricCADPanel({ onChange, initial, onRegenerate }: CADPanelProps) {
  const [params, setParams] = useState<CADPanelParams>({ ...DEFAULTS, ...initial });
  const [codeOpen, setCodeOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const handleChange = useCallback(
    (key: keyof CADPanelParams, raw: number) => {
      setParams((prev) => {
        const def = SLIDERS.find((s) => s.key === key)!;
        const clamped = Math.max(def.min, Math.min(def.max, raw));
        const value = def.int ? Math.round(clamped) : clamped;
        const next = { ...prev, [key]: value };
        onChange?.(next);
        return next;
      });

      // Debounced regeneration — fires 300ms after last slider move
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (onRegenerate) {
          const source = generateBuild123dSource(paramsRef.current);
          onRegenerate(source);
        }
      }, 300);
    },
    [onChange, onRegenerate],
  );

  // Sync external overrides
  useEffect(() => {
    if (initial) {
      setParams((prev) => ({ ...prev, ...initial }));
    }
  }, [initial]);

  const scad = generateOpenSCAD(params);
  const wallOk = params.thickness >= 1.2;
  const bedFits = params.width <= 256 && params.depth <= 256;

  return (
    <div className="flex flex-col h-full bg-[#05080d] text-[#c0c8d0] font-mono select-none">
      {/* ── Header ── */}
      <div className="px-4 py-3 border-b border-[#00F2FF]/10">
        <div className="text-[10px] tracking-[0.3em] text-[#00F2FF]/40 uppercase">Parametric Control</div>
        <div className="text-[8px] text-[#00F2FF]/15 tracking-[0.5em] mt-0.5">M5 · MOUNTING PLATE</div>
      </div>

      {/* ── Sliders ── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {SLIDERS.map((def) => {
          const value = params[def.key];
          const pct = ((value - def.min) / (def.max - def.min)) * 100;
          return (
            <div key={def.key} className="space-y-1">
              {/* Label row */}
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[#8899aa] tracking-[0.15em] uppercase">
                  {def.label}
                </span>
                <span className="text-[13px] font-bold text-[#00F2FF] tabular-nums">
                  {def.int ? value : value.toFixed(1)}
                  {def.unit && (
                    <span className="text-[10px] font-normal text-[#00F2FF]/40 ml-0.5">
                      {def.unit}
                    </span>
                  )}
                </span>
              </div>

              {/* Slider */}
              <div className="relative h-5 flex items-center">
                <input
                  type="range"
                  min={def.min}
                  max={def.max}
                  step={def.step}
                  value={value}
                  onChange={(e) => handleChange(def.key, parseFloat(e.target.value))}
                  className="w-full h-[2px] appearance-none cursor-pointer bg-[#1a2230] outline-none
                    [&::-webkit-slider-thumb]:appearance-none
                    [&::-webkit-slider-thumb]:w-3.5
                    [&::-webkit-slider-thumb]:h-3.5
                    [&::-webkit-slider-thumb]:rounded-full
                    [&::-webkit-slider-thumb]:bg-[#00F2FF]
                    [&::-webkit-slider-thumb]:cursor-pointer
                    [&::-webkit-slider-thumb]:shadow-[0_0_10px_#00F2FF]
                    [&::-webkit-slider-thumb]:border-0
                    [&::-webkit-slider-thumb]:transition-shadow
                    [&::-webkit-slider-thumb]:duration-150
                    [&::-webkit-slider-thumb]:hover:shadow-[0_0_18px_#00F2FF]
                    [&::-moz-range-thumb]:w-3.5
                    [&::-moz-range-thumb]:h-3.5
                    [&::-moz-range-thumb]:rounded-full
                    [&::-moz-range-thumb]:bg-[#00F2FF]
                    [&::-moz-range-thumb]:border-0
                    [&::-moz-range-thumb]:shadow-[0_0_10px_#00F2FF]
                    [&::-moz-range-track]:bg-transparent"
                  style={{
                    background: `linear-gradient(to right, #00F2FF 0%, #00F2FF ${pct}%, #1a2230 ${pct}%, #1a2230 100%)`,
                  }}
                />
              </div>

              {/* Range labels */}
              <div className="flex justify-between text-[8px] text-[#556677]/40">
                <span>{def.min}{def.unit}</span>
                <span>{def.max}{def.unit}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Print Check ── */}
      <div className="px-4 py-3 border-t border-[#00F2FF]/10 space-y-2">
        <div className="text-[9px] text-[#556677] tracking-[0.25em] uppercase">
          // PRINT CHECK
        </div>

        {/* Wall thickness card */}
        <div
          className={`p-2.5 rounded-sm border text-[10px] leading-relaxed transition-colors ${
            wallOk
              ? "bg-[#0a1218] border-[#00F2FF]/8 text-[#8899aa]"
              : "bg-[#120a0a] border-red-500/20 text-red-400/80"
          }`}
        >
          {wallOk ? (
            <>
              Wall{" "}
              <span className="text-[#00F2FF]/80">
                {params.thickness.toFixed(1)}mm
              </span>{" "}
              — adequate for PLA FDM.
            </>
          ) : (
            <div className="flex items-start gap-1.5">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
              <span>
                WARNING: Thin wall risk (
                <span className="text-red-400">{params.thickness.toFixed(1)}mm</span>{" "}
                &lt; 1.2mm)
              </span>
            </div>
          )}
        </div>

        {/* Bed fit card */}
        <div className="p-2.5 rounded-sm border border-[#00F2FF]/8 bg-[#0a1218] text-[10px] text-[#8899aa] leading-relaxed">
          {bedFits ? (
            <>
              Bed fit{" "}
              <span className="text-[#00F2FF]/60">OK</span> (
              {params.width}×{params.depth}mm).
            </>
          ) : (
            <div className="flex items-start gap-1.5 text-amber-400/80">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
              <span>
                May exceed print bed ({params.width}×{params.depth}mm) — split or
                rotate.
              </span>
            </div>
          )}
        </div>

        {/* Material card */}
        <div className="p-2.5 rounded-sm border border-[#00F2FF]/8 bg-[#0a1218] text-[10px] text-[#556677] leading-relaxed">
          PLA: overhang threshold{" "}
          <span className="text-[#00F2FF]/50">50°</span>, density{" "}
          <span className="text-[#00F2FF]/50">1.24g/cm³</span>.
        </div>
      </div>

      {/* ── OpenSCAD Snapshot ── */}
      <div className="border-t border-[#00F2FF]/10">
        <button
          onClick={() => setCodeOpen((o) => !o)}
          className="w-full flex items-center gap-1.5 px-4 py-2.5 text-[10px] text-[#00F2FF]/50 hover:text-[#00F2FF] hover:bg-[#00F2FF]/3 transition-colors tracking-[0.15em]"
        >
          {codeOpen ? (
            <ChevronDown className="w-3 h-3" />
          ) : (
            <ChevronRight className="w-3 h-3" />
          )}
          OPENSCAD SNAPSHOT
        </button>
        {codeOpen && (
          <pre className="px-4 pb-3 text-[9px] text-[#556677] leading-relaxed whitespace-pre overflow-x-auto max-h-[220px] overflow-y-auto font-mono border-t border-[#00F2FF]/5">
            {scad}
          </pre>
        )}
      </div>
    </div>
  );
}

/* ── Expose params type for consumers ── */
export type { CADPanelParams as default };
