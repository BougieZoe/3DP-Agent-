/**
 * Webhook delivery — CloudEvents 1.0 over HTTP POST.
 *
 * The contract says events are CloudEvents 1.0 (see docs/capability-open-standard-contract.md),
 * so the envelope is built here once and never hand-rolled at call sites. A consumer who
 * already speaks CloudEvents should be able to route our events with zero bespoke code.
 *
 * Honesty rules baked in:
 *  - One attempt per terminal transition in v1. No silent retries, no success reported for a
 *    delivery that did not happen. The outcome is persisted on the job so it is inspectable.
 *  - Signing is optional but always advertised through the header set we send. When
 *    RECON_WEBHOOK_SECRET is set we sign the raw body with HMAC-SHA256; when it is not we
 *    send no signature header at all rather than a meaningless one.
 *  - Delivery never changes the job's own status. A failed callback is the consumer's problem
 *    to reconcile, not a reason to fail a reconstruction that actually succeeded.
 */
import { createHmac, randomBytes } from "node:crypto";

import type { ReconstructionJob, WebhookDelivery } from "./types.js";

export const CLOUDEVENTS_SPECVERSION = "1.0";
export const EVENT_SOURCE = "urn:3dp:capability:photo-to-cad";

export type ReconstructionEventType =
  | "io.3dp.reconstruction.queued.v1"
  | "io.3dp.reconstruction.succeeded.v1"
  | "io.3dp.reconstruction.failed.v1"
  | "io.3dp.reconstruction.cancelled.v1";

export interface CloudEvent {
  specversion: string;
  id: string;
  source: string;
  type: ReconstructionEventType;
  subject: string;
  time: string;
  datacontenttype: string;
  data: Record<string, unknown>;
}

const TERMINAL_EVENT: Partial<Record<string, ReconstructionEventType>> = {
  succeeded: "io.3dp.reconstruction.succeeded.v1",
  failed: "io.3dp.reconstruction.failed.v1",
  cancelled: "io.3dp.reconstruction.cancelled.v1",
};

export function eventTypeFor(status: string): ReconstructionEventType | null {
  return TERMINAL_EVENT[status] ?? null;
}

/**
 * Build the envelope. `subject` is the job id so a consumer can correlate without parsing
 * `data`; `data` carries the same public projection polling returns, minus the inputs.
 */
export function buildEvent(
  type: ReconstructionEventType,
  job: ReconstructionJob,
  publicJob: Record<string, unknown>,
): CloudEvent {
  return {
    specversion: CLOUDEVENTS_SPECVERSION,
    id: `evt_${randomBytes(8).toString("hex")}`,
    source: EVENT_SOURCE,
    type,
    subject: job.job_id,
    time: new Date().toISOString(),
    datacontenttype: "application/json",
    data: publicJob,
  };
}

export function signBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

export interface DeliverOptions {
  url: string;
  event: CloudEvent;
  /** Milliseconds; delivery must not hold a request open indefinitely. */
  timeoutMs?: number;
  secret?: string;
  /** Injection point for tests — avoids reaching the network in unit tests. */
  fetchImpl?: typeof fetch;
}

/**
 * POST the event. Returns a delivery record instead of throwing: the caller persists it, and
 * "the callback failed" must never be conflated with "the job failed".
 */
export async function deliverWebhook({
  url,
  event,
  timeoutMs = 5_000,
  secret,
  fetchImpl = fetch,
}: DeliverOptions): Promise<WebhookDelivery> {
  const body = JSON.stringify(event);
  const headers: Record<string, string> = {
    "content-type": "application/cloudevents+json",
    "user-agent": "3dp-capability/photo-to-cad-v1",
    "ce-specversion": event.specversion,
    "ce-id": event.id,
    "ce-source": event.source,
    "ce-type": event.type,
    "ce-subject": event.subject,
  };
  if (secret) headers["x-3dp-signature"] = signBody(body, secret);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    const at = new Date().toISOString();
    if (!response.ok) {
      return {
        status: "failed",
        http_status: response.status,
        error: `Webhook responded ${response.status}.`,
        at,
      };
    }
    return { status: "delivered", http_status: response.status, at };
  } catch (err) {
    return {
      status: "failed",
      error: (err as Error).name === "AbortError" ? `Timed out after ${timeoutMs}ms.` : (err as Error).message,
      at: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
  }
}
