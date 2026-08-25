/**
 * Notification System — Webhook + Email
 *
 * Sends notifications when analysis completes:
 * - Webhook: POST to a user-configured URL with analysis summary
 * - Email: Send via Resend API (optional)
 *
 * Configuration stored in localStorage:
 * - webhookUrl: The URL to POST to
 * - email: The email address to send to
 * - resendApiKey: Resend API key for email sending
 */

import type { UnifiedAnalysis } from '@/analysis/types';
import type { Material } from '@shared/domain/material';
import { getTrafficLight } from '@/components/ReportGenerator';

// ── Types ──────────────────────────────────────────────────────────────────

export interface NotificationConfig {
  /** Webhook URL to POST analysis results to */
  webhookUrl?: string;
  /** Email address for completion notifications */
  email?: string;
  /** Resend API key for email sending */
  resendApiKey?: string;
}

export interface NotificationPayload {
  /** ISO timestamp */
  timestamp: string;
  /** Original file name */
  fileName: string;
  /** Printability score (0-100) */
  score: number;
  /** Traffic light status */
  status: 'green' | 'yellow' | 'red';
  /** Key findings summary */
  findings: string[];
  /** Material used */
  material: string;
  /** Analysis duration in ms */
  durationMs?: number;
}

export interface NotificationResult {
  webhook?: { sent: boolean; error?: string };
  email?: { sent: boolean; error?: string };
}

// ── Config storage ─────────────────────────────────────────────────────────

const STORAGE_KEY = '3dp_agent_notifications';

export function getNotificationConfig(): NotificationConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveNotificationConfig(config: NotificationConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

// ── Payload builder ────────────────────────────────────────────────────────

function buildPayload(
  fileName: string,
  analysis: UnifiedAnalysis,
  material: Material,
  durationMs?: number,
): NotificationPayload {
  const { light, score } = getTrafficLight(analysis);
  const findings: string[] = [];

  const v = analysis.validation?.result;
  const m = analysis.metrics?.result;
  const s = analysis.support?.result;

  if (v) {
    if (!v.isWatertight) findings.push('Mesh is not watertight');
    if (v.holeCount > 0) findings.push(`${v.holeCount} hole(s) detected`);
    if (v.flippedNormalRatio > 0.1) findings.push('Flipped normals detected');
  }

  if (m) {
    if (m.thinWallRatio > 0.1) findings.push(`${(m.thinWallRatio * 100).toFixed(0)}% thin walls`);
    if (m.overhang.ratio > 0.15) findings.push('Significant overhang areas');
  }

  if (s) {
    if (s.supportFaceCount > 0) findings.push('Support structures needed');
  }
  if (analysis.printTime?.result?.estimatedPrintTimeMinutes) {
    findings.push(`Est. print time: ${analysis.printTime.result.estimatedPrintTimeMinutes.toFixed(0)} min`);
  }

  return {
    timestamp: new Date().toISOString(),
    fileName,
    score,
    status: light,
    findings,
    material: material.name,
    durationMs,
  };
}

// ── Webhook ────────────────────────────────────────────────────────────────

async function sendWebhook(
  url: string,
  payload: NotificationPayload,
): Promise<{ sent: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return { sent: false, error: `HTTP ${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ── Email via Resend ───────────────────────────────────────────────────────

async function sendEmail(
  resendApiKey: string,
  to: string,
  payload: NotificationPayload,
): Promise<{ sent: boolean; error?: string }> {
  try {
    const statusEmoji = payload.status === 'green' ? '✅' : payload.status === 'yellow' ? '⚠️' : '❌';
    const findingsList = payload.findings.length > 0
      ? payload.findings.map(f => `• ${f}`).join('\n')
      : 'No issues found';

    const html = `
      <h2>${statusEmoji} Analysis Complete: ${payload.fileName}</h2>
      <p><strong>Score:</strong> ${payload.score}/100</p>
      <p><strong>Material:</strong> ${payload.material}</p>
      <p><strong>Status:</strong> ${payload.status.toUpperCase()}</p>
      <h3>Findings</h3>
      <pre>${findingsList}</pre>
      <p><strong>Time:</strong> ${new Date(payload.timestamp).toLocaleString()}</p>
      ${payload.durationMs ? `<p><strong>Analysis Duration:</strong> ${(payload.durationMs / 1000).toFixed(1)}s</p>` : ''}
      <hr />
      <p style="color:#888;font-size:12px;">3DP Agent — 3D Printing AI Consultant</p>
    `;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: '3DP Agent <noreply@3dp-agent.com>',
        to,
        subject: `${statusEmoji} Analysis: ${payload.fileName} — Score ${payload.score}/100`,
        html,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const err = await res.text();
      return { sent: false, error: `Resend API: ${res.status} ${err}` };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Send notifications for a completed analysis.
 * Respects the user's notification config — skips any channel that isn't configured.
 */
export async function notifyAnalysisComplete(
  fileName: string,
  analysis: UnifiedAnalysis,
  material: Material,
  durationMs?: number,
): Promise<NotificationResult> {
  const config = getNotificationConfig();
  const payload = buildPayload(fileName, analysis, material, durationMs);
  const result: NotificationResult = {};

  // Send webhook if configured
  if (config.webhookUrl) {
    result.webhook = await sendWebhook(config.webhookUrl, payload);
  }

  // Send email if configured
  if (config.email && config.resendApiKey) {
    result.email = await sendEmail(config.resendApiKey, config.email, payload);
  }

  return result;
}
