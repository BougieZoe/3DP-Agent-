/**
 * Share Report API
 *
 * Stores analysis reports in memory with a 7-day TTL.
 * Provides POST /api/share (create) and GET /api/share/:id (retrieve).
 *
 * For production, replace the in-memory store with Redis/Supabase.
 */

import { Router } from 'express';
import { logger } from './logger';

// ── In-memory store ────────────────────────────────────────────────────────

interface StoredReport {
  id: string;
  payload: unknown;
  createdAt: number;
}

const store = new Map<string, StoredReport>();
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // hourly

// Periodic cleanup of expired entries
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (now - entry.createdAt > TTL_MS) {
      store.delete(id);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

// ── ID generation ──────────────────────────────────────────────────────────

function generateId(): string {
  // 8-char alphanumeric — 62^8 ≈ 218 trillion combinations
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  for (let i = 0; i < 8; i++) {
    id += chars[arr[i] % chars.length];
  }
  return id;
}

// ── Router ─────────────────────────────────────────────────────────────────

export function createShareRouter(): Router {
  const router = Router();

  // Create a share link
  router.post('/', (req, res) => {
    try {
      const payload = req.body;
      if (!payload || typeof payload !== 'object') {
        res.status(400).json({ error: 'Invalid payload' });
        return;
      }

      const id = generateId();
      store.set(id, {
        id,
        payload,
        createdAt: Date.now(),
      });

      logger.info('Share link created', {
        context: 'share',
        metadata: { id, fileName: payload.fileName, size: JSON.stringify(payload).length },
      });

      res.json({ id });
    } catch (err) {
      logger.error('Share creation failed', {
        context: 'share',
        error: err instanceof Error ? err : new Error(String(err)),
      });
      res.status(500).json({ error: 'Failed to create share link' });
    }
  });

  // Retrieve a shared report
  router.get('/:id', (req, res) => {
    try {
      const { id } = req.params;
      const entry = store.get(id);

      if (!entry) {
        res.status(404).json({ error: 'Report not found or expired' });
        return;
      }

      // Check TTL
      if (Date.now() - entry.createdAt > TTL_MS) {
        store.delete(id);
        res.status(404).json({ error: 'Report expired' });
        return;
      }

      res.json(entry.payload);
    } catch (err) {
      logger.error('Share retrieval failed', {
        context: 'share',
        error: err instanceof Error ? err : new Error(String(err)),
      });
      res.status(500).json({ error: 'Failed to retrieve report' });
    }
  });

  return router;
}
