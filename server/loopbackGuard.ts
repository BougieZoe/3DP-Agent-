import type { Request } from "express";

/**
 * Bridge-auth decision logic for the dev server. Extracted as pure functions so
 * the security property is unit-testable.
 *
 * Why the decision is made from the EFFECTIVE CLIENT IP and never from the
 * Express bind host:
 *
 *   The Vite dev proxy (often published on 0.0.0.0 via `vite --host`) forwards
 *   every LAN peer to this Express server through a local connection, so
 *   `req.socket.remoteAddress` is loopback for *all* proxied callers. A check
 *   like "am I bound to 127.0.0.1" therefore says nothing about who the caller
 *   really is — the bind host alone cannot tell a local browser apart from a
 *   192.168.1.x client riding the proxy.
 *
 *   Instead, decide from the request-source chain:
 *    - the Vite proxy is configured with `xfwd: true` for the bridge prefixes
 *      (/api/cad, /api/slice, /api/mesh), so it stamps the REAL client address
 *      into `x-forwarded-for` (first hop);
 *    - we trust that header ONLY when the direct socket peer is itself loopback
 *      (i.e. the local proxy/curl process). A remote attacker cannot spoof it:
 *      from the network the socket peer is non-loopback, so the header is
 *      ignored and their real (non-loopback) socket address decides.
 *
 * Safe-by-default: production always authenticates; a dev server accidentally
 * published on 0.0.0.0 still leaves every bridge token-gated, because the
 * decision never depends on how the server is bound.
 */

export function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

/**
 * Resolve the effective client IP.
 * Trust `x-forwarded-for` (leftmost hop) only when the direct socket peer is
 * itself loopback; otherwise fall back to the socket address verbatim.
 */
export function effectiveClientIp(
  socketIp: string,
  forwardedHeader: string | undefined,
): string {
  if (isLoopback(socketIp) && forwardedHeader) {
    const first = forwardedHeader.split(",")[0]?.trim();
    if (first) return first;
  }
  return socketIp;
}

/**
 * True when this request must still go through BRIDGE_TOKEN auth.
 * - production: always true.
 * - dev: false (skip auth) only for genuinely-loopback callers.
 */
export function bridgeAuthDecision(
  req: Pick<Request, "socket" | "headers">,
  isProduction: boolean,
): boolean {
  if (isProduction) return true;
  const socketIp = req.socket?.remoteAddress ?? "";
  const forwarded =
    typeof req.headers?.["x-forwarded-for"] === "string"
      ? req.headers["x-forwarded-for"]
      : undefined;
  return !isLoopback(effectiveClientIp(socketIp, forwarded));
}