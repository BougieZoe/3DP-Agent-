/**
 * POST /api/analyze — 服务端可打印性判定入口。
 *
 * 与 /api/slice、/api/mesh/* 不同，本路由不调用任何外部二进制或沙箱，
 * 纯进程内计算，因此不依赖 BRIDGE_TOKEN，始终可用。
 *
 * 接受两种载荷：
 *   1. 原始 STL 字节：Content-Type: application/octet-stream | model/stl | application/sla
 *   2. JSON：{ stlBase64: string, fileName?: string }
 */

import express, { Router, type Request, type Response } from 'express';
import { analyzeStlBuffer, AnalyzeInputError, type AnalyzeResult } from './analyzeService';
import { isContentLang } from '../shared/i18n/content';
import { describeVerdictPolicy } from './verdictPolicy';

/** 单次分析载荷上限。STL 是明文浮点，50MB 约等于数百万三角面。 */
export const MAX_ANALYZE_BYTES = 50 * 1024 * 1024;

interface AnalyzeJsonBody {
  stlBase64?: unknown;
  fileName?: unknown;
}

function extractPayload(req: Request): { bytes: Uint8Array; fileName?: string } | null {
  // 1) 二进制直传
  if (Buffer.isBuffer(req.body)) {
    if (req.body.byteLength === 0) return null;
    const header = req.get('x-model-filename');
    return { bytes: req.body, fileName: header || undefined };
  }

  // 2) JSON base64
  const body = req.body as AnalyzeJsonBody | undefined;
  if (body && typeof body === 'object' && typeof body.stlBase64 === 'string') {
    const raw = body.stlBase64.replace(/^data:[^;]*;base64,/, '');
    if (raw.length === 0) return null;
    const bytes = Buffer.from(raw, 'base64');
    if (bytes.byteLength === 0) return null;
    return {
      bytes,
      fileName: typeof body.fileName === 'string' ? body.fileName : undefined,
    };
  }

  return null;
}

export function createAnalyzeRouter(): Router {
  const router = Router();

  const binaryParser = express.raw({
    type: ['application/octet-stream', 'model/stl', 'application/sla', 'application/zip'],
    limit: MAX_ANALYZE_BYTES,
  });
  const jsonParser = express.json({ limit: Math.ceil(MAX_ANALYZE_BYTES * 1.4) });

  router.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true, service: 'analyze', maxPayloadBytes: MAX_ANALYZE_BYTES });
  });

  /**
   * 暴露当前生效的判定阈值。前端据此渲染"硬门是多少"，
   * 避免把阈值复制一份到客户端后两边漂移。
   */
  router.get('/policy', (_req: Request, res: Response) => {
    res.json(describeVerdictPolicy());
  });

  router.post('/', binaryParser, jsonParser, (req: Request, res: Response) => {
    const payload = extractPayload(req);
    if (!payload) {
      res.status(400).json({
        error: 'no STL payload',
        hint: 'send raw bytes as application/octet-stream, or JSON { stlBase64, fileName }',
      });
      return;
    }

    let result: AnalyzeResult;
    try {
      // `?lang=` 可选，缺省英文；用于让返回的 findings 文案跟随请求语言。
      const language = isContentLang(req.query.lang) ? req.query.lang : 'en';
      result = analyzeStlBuffer(payload.bytes, { fileName: payload.fileName, language });
    } catch (err) {
      if (err instanceof AnalyzeInputError) {
        res.status(422).json({ error: err.message });
        return;
      }
      res.status(500).json({
        error: 'analysis failed',
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    res.json(result);
  });

  return router;
}
