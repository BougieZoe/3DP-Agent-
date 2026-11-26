/**
 * Photo intake for the reconstruction capability.
 *
 * `POST /v1/reconstructions` takes image *paths* — deliberately, because the control plane
 * must not own blob storage and a job must be reproducible from its request. A browser,
 * however, only has bytes. This router is the one place those bytes become paths, and it
 * does nothing else: no image decoding, no resizing, no "enhancement". Whatever the phone
 * wrote is what the engine gets, so a bad reconstruction can always be traced back to the
 * actual pixels that were submitted.
 *
 * Uploads land under `<recon data dir>/uploads/<session>/<name>` — inside the same tree the
 * provider copies from, so a submitted job survives a restart and can be re-run.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import express, { type Request, type Response, type Router } from "express";

/** Extensions the v1 providers (Apple Object Capture, COLMAP/Meshroom) accept as input. */
export const UPLOAD_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
  ".webp",
] as const;

/** 48 MB per photo: a modern phone HEIC/JPEG is 2–8 MB, so this is a generous ceiling. */
export const UPLOAD_LIMIT_BYTES = 48 * 1024 * 1024;

/** Keep only a basename, drop anything that could climb out of the upload directory. */
function safeName(raw: string): string {
  const base = path.basename(raw).replace(/[^\w.\- ]+/g, "_").trim();
  return base.length > 0 ? base.slice(-120) : "photo.jpg";
}

function sessionId(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (/^[A-Za-z0-9_-]{6,64}$/.test(value)) return value;
  return crypto.randomUUID();
}

export interface UploadRouterOptions {
  /** Root of the reconstruction data tree (same one jobs live in). */
  rootDir: string;
}

export function createReconstructionUploadRouter(options: UploadRouterOptions): Router {
  const router = express.Router();

  router.post(
    "/",
    // Raw body, any content type: the browser sends the file's own bytes, and the content
    // type it reports is not worth trusting for an extension we set from the filename.
    express.raw({ type: () => true, limit: UPLOAD_LIMIT_BYTES }),
    async (req: Request, res: Response) => {
      const body = req.body as unknown;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({
          error: {
            code: "UPLOAD_EMPTY",
            message: "Body must be the image bytes. Send the file itself, not a JSON envelope.",
          },
        });
        return;
      }

      const rawName = String(req.header("x-file-name") ?? "");
      const name = safeName(decodeURIComponent(rawName || "photo.jpg"));
      const ext = path.extname(name).toLowerCase();
      if (!UPLOAD_EXTENSIONS.includes(ext as (typeof UPLOAD_EXTENSIONS)[number])) {
        res.status(415).json({
          error: {
            code: "UPLOAD_UNSUPPORTED_TYPE",
            message:
              `"${ext || "(no extension)"}" is not a photo type the engines accept. ` +
              `Supported: ${UPLOAD_EXTENSIONS.join(", ")}.`,
          },
        });
        return;
      }

      const session = sessionId(req.header("x-session-id"));
      const dir = path.join(options.rootDir, "uploads", session);
      try {
        await fs.mkdir(dir, { recursive: true });
        // Collide-safe: two identical filenames in one session must both survive, because
        // they may be two different views of the same part.
        const stamp = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
        const finalName = `${path.basename(name, ext)}-${stamp}${ext}`;
        const target = path.join(dir, finalName);
        await fs.writeFile(target, body);
        res.status(201).json({
          path: target,
          bytes: body.length,
          session_id: session,
          file_name: finalName,
        });
      } catch (err) {
        res.status(500).json({
          error: {
            code: "UPLOAD_WRITE_FAILED",
            message: `Could not store the upload: ${(err as Error).message}`,
          },
        });
      }
    }
  );

  return router;
}
