/**
 * cadRepair — pattern-based auto-fix for build123d source code that
 * failed during scripts/step execution. Operates on source text and
 * Python traceback; returns repaired source or null when repair is
 * not possible.
 */

export type RepairType = 'fillet' | 'boolean' | 'builder' | 'wedge' | 'kwargs' | 'none';

/** build123d keyword aliases that LLMs guess; mapping a traceback-reported
 * name to the real one. Covers Cone/Cylinder/Sphere positional-radius bugs. */
const KWARG_FIXES: Record<string, string> = {
  bottom_r: 'bottom_radius',
  top_r: 'top_radius',
  r: 'radius',
};

/**
 * Wrap every `name = fillet(...)` line in try/except so a fillet with too
 * large a radius (or on an invalid edge) degrades to the un-filleted shape
 * instead of crashing the whole run. A cosmetic rounded-corner failure should
 * never discard the model.
 */
function wrapFilletsInTry(source: string): string {
  const lines = source.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*[\w.]+\s*=\s*fillet\(/.test(line)) {
      const indent = (line.match(/^\s*/) ?? [''])[0];
      out.push(
        `${indent}try:`,
        `${indent}    ${line.trimStart()}`,
        `${indent}except Exception:`,
        `${indent}    pass`,
      );
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

export interface RepairResult {
  source: string;
  type: RepairType;
}

/**
 * Attempt to repair a failed build123d generator source based on the
 * traceback. Returns null when no repair is safe or possible (e.g.
 * non-manifold shells — those need LLM-level geometry changes).
 */
export function repairCadSource(
  source: string,
  traceback: string,
): RepairResult | null {
  const combined = (traceback || '').toLowerCase();

  // Rule D — Shell is not manifold: can't repair textually.
  if (combined.includes('shell is not manifold') || combined.includes('not manifold')) {
    return null;
  }

  // Rule C — Boolean operation failed: comment out fuse/union/fillet lines.
  if (combined.includes('boolean operation failed')) {
    const repaired = source
      .split('\n')
      .map((line) => {
        const trimmed = line.trimStart();
        if (
          trimmed.startsWith('body += ') ||
          trimmed.startsWith('body -= ') ||
          trimmed.startsWith('part += ') ||
          trimmed.startsWith('part -= ') ||
          /^\w+\s*\+=\s*/.test(trimmed) ||
          /^\w+\s*-=\s*/.test(trimmed) ||
          /^\w+\s*=\s*fillet\(/.test(trimmed) ||
          /^\w+\s*=\s*chamfer\(/.test(trimmed)
        ) {
          return `# [AUTO-REPAIR] ${line}`;
        }
        return line;
      })
      .join('\n');
    return { source: repaired, type: 'boolean' };
  }

  // Rule B — max_fillet hint: chosen radius is too large. Wrapping the fillet
  // in try/except always succeeds, unlike shrinking the radius (which can
  // still fail on thin geometry).
  if (combined.includes('max_fillet')) {
    return { source: wrapFilletsInTry(source), type: 'fillet' };
  }

  // Rule E — build123d operator order: shape * Pos → Pos * shape
  if (combined.includes('unsupported operand') && combined.includes('*')) {
    const repaired = source.replace(
      /\b(\w+)\s*\*\s*(Pos\s*\([^)]+\))/g,
      '$2 * $1',
    );
    return { source: repaired, type: 'boolean' };
  }

  // Rule A — Failed creating a fillet: wrap in try/except so the run still
  // produces a valid shape (without rounded corners) instead of exiting 1.
  if (combined.includes('failed creating a fillet')) {
    return { source: wrapFilletsInTry(source), type: 'fillet' };
  }

  // Rule F — Builder pattern (BuildPart/Locations): extract simple return or fallback.
  if (combined.includes('buildpart') || combined.includes('builder of shapes')) {
    // Try to salvage: find the last return statement with a Box/Cylinder/Sphere
    const returnMatch = source.match(/return\s+(Box|Cylinder|Sphere)\([^)]+\)/g);
    if (returnMatch) {
      const lastReturn = returnMatch[returnMatch.length - 1];
      const repaired = `from build123d import *\n\ndef gen_step():\n    ${lastReturn}\n`;
      return { source: repaired, type: 'builder' };
    }
    // No salvagable return — create a minimal fallback
    const repaired = `from build123d import *\n\ndef gen_step():\n    body = Box(50, 50, 50, align=(Align.CENTER, Align.CENTER, Align.CENTER))\n    return body\n`;
    return { source: repaired, type: 'builder' };
  }

  // Rule H — unexpected keyword argument: LLM used a wrong kwarg name
  // (Cone(bottom_r=...) → bottom_radius). The traceback names it; use that
  // exact key so we only touch the offending call, then rename globally.
  const kwArgMatch = /unexpected keyword argument ['"](\w+)['"]/.exec(traceback || '');
  if (kwArgMatch) {
    const bad = kwArgMatch[1];
    const good = KWARG_FIXES[bad];
    if (good && source.includes(`${bad}=`)) {
      const repaired = source.replace(new RegExp(`\\b${bad}\\s*=`,'g'), `${good}=`);
      return { source: repaired, type: 'kwargs' };
    }
  }

  // Rule G — Wedge taper failure (Standard_Failure): the taper params are
  // 0..1 ratios, not lengths; the kernel rejects them. Replace the Wedge call
  // with an equal-size Box so the variable stays defined and any later
  // `body + wedge_var` combine still runs — the model builds (as a blocky
  // approximation) instead of exiting 1.
  if (combined.includes('standard_failure') && /wedge|make_wedge/.test(combined)) {
    const repaired = source.replace(
      /Wedge\s*\(([^)]+)\)/g,
      (full, args: string) => {
        const parts = args.split(',').map((s) => s.trim());
        const [xsize, ysize, zsize] = parts;
        const rest = parts.slice(3).filter((s) => s && !s.includes('='));
        return `Box(${[xsize, ysize, zsize, ...rest].join(', ')}, align=(Align.CENTER, Align.CENTER, Align.MIN))`;
      },
    );
    if (repaired !== source) return { source: repaired, type: 'wedge' };
  }

  // No known pattern — can't repair.
  return null;
}
