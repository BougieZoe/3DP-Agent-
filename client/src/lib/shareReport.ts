/**
 * Share Report — Generate shareable links for analysis reports
 *
 * Strategy:
 *  1. Compress the analysis result + metadata into a compact JSON
 *  2. POST to /api/share to get a short ID
 *  3. Return a public URL: /share/{id}
 *
 * The server stores reports in memory with a 7-day TTL.
 * No authentication required — the share link IS the access token.
 */

import type { UnifiedAnalysis } from '@/analysis/types';
import type { ExpertReview } from '@/agents/expertReview';

// ── Types ──────────────────────────────────────────────────────────────────

export interface SharePayload {
  /** Analysis results (compressed) */
  analysis: UnifiedAnalysis;
  /** Original file name */
  fileName: string;
  /** Material name used */
  material: string;
  /** Expert review if available */
  expertReview?: ExpertReview | null;
  /** ISO timestamp */
  createdAt: string;
}

export interface ShareResult {
  /** Short share ID */
  id: string;
  /** Full shareable URL */
  url: string;
}

// ── API ────────────────────────────────────────────────────────────────────

/**
 * Generate a shareable link for an analysis report.
 */
export async function createShareLink(
  analysis: UnifiedAnalysis,
  fileName: string,
  material: string,
  expertReview?: ExpertReview | null,
): Promise<ShareResult> {
  const payload: SharePayload = {
    analysis,
    fileName,
    material,
    expertReview,
    createdAt: new Date().toISOString(),
  };

  const res = await fetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Share failed: ${res.status}`);
  }

  const { id } = await res.json() as { id: string };
  const url = `${window.location.origin}/share/${id}`;
  return { id, url };
}

/**
 * Retrieve a shared report by ID.
 */
export async function getShareLink(id: string): Promise<SharePayload | null> {
  try {
    const res = await fetch(`/api/share/${id}`);
    if (!res.ok) return null;
    return await res.json() as SharePayload;
  } catch {
    return null;
  }
}

/**
 * Copy share link to clipboard.
 */
export async function copyShareLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    // Fallback for older browsers
    const input = document.createElement('input');
    input.value = url;
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(input);
    return ok;
  }
}
