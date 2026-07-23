/**
 * cadRepair — pattern-based auto-fix for build123d source code that
 * failed during scripts/step execution. Operates on source text and
 * Python traceback; returns repaired source or null when repair is
 * not possible.
 */

export type RepairType = 'fillet' | 'boolean' | 'none';

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

  // Rule B — max_fillet hint: use smallest radius.
  if (combined.includes('max_fillet')) {
    const repaired = source.replace(
      /(fillet\s*\([^,)]*,\s*radius\s*=\s*)[\d.]+/gi,
      '$10.5',
    );
    return { source: repaired, type: 'fillet' };
  }

  // Rule A — Failed creating a fillet: downgrade radius to 1.
  if (combined.includes('failed creating a fillet')) {
    const repaired = source.replace(
      /(fillet\s*\([^,)]*,\s*radius\s*=\s*)[\d.]+/gi,
      '$11',
    );
    return { source: repaired, type: 'fillet' };
  }

  // No known pattern — can't repair.
  return null;
}
