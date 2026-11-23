import type { NextFunction, Request, Response } from 'express';
import { bridgeAuthDecision } from './loopbackGuard';

export type BridgeGuard = (
  req: Request,
  res: Response,
  next: NextFunction,
) => void;

/**
 * Bearer-token guard for host-side bridge execution. A missing token is a
 * configuration error, not an open door: return 503 instead of letting the
 * request reach Python or a slicer CLI.
 */
export function createBridgeAuth(token: string | undefined): BridgeGuard {
  return (req, res, next) => {
    if (!token) {
      res.status(503).json({ error: 'bridge unavailable: BRIDGE_TOKEN not configured' });
      return;
    }
    const expected = `Bearer ${token}`;
    if (req.headers.authorization !== expected) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };
}

/**
 * Dev gate: loopback callers may use the bridges without a token; everyone
 * else goes through `createBridgeAuth`. The decision comes from the request
 * source chain, never from the Express bind host.
 */
export function createDevLocalBridgeGuard(
  token: string | undefined,
  isProduction: boolean,
): BridgeGuard {
  const bridgeAuth = createBridgeAuth(token);
  return (req, res, next) => {
    if (bridgeAuthDecision(req, isProduction)) return bridgeAuth(req, res, next);
    next();
  };
}
