/**
 * 服务端判定入口测试 —— 证明可打印性判定可以完全脱离浏览器运行。
 *
 * 覆盖三层：
 *  1. analyzeStlBuffer 的判定正确性（直接消费真实 STL fixture）；
 *  2. 输入鲁棒性（空载荷 / 过短载荷 / Node 池化 Buffer 的非零偏移）；
 *  3. /api/analyze 的 HTTP 往返（raw 字节与 base64 JSON 两种载荷）。
 */

import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Server } from 'node:http';
import { analyzeStlBuffer, AnalyzeInputError } from '../server/analyzeService';
import { createAnalyzeRouter } from '../server/analyzeRouter';

const FIXTURE_DIR = path.join(
  process.cwd(),
  'client/src/analysis/__tests__/fixtures/stl',
);

function fixture(name: string): Buffer {
  return readFileSync(path.join(FIXTURE_DIR, `${name}.stl`));
}

describe('analyzeStlBuffer — 判定正确性', () => {
  it('20mm 立方体：水密、通过、尺寸准确', () => {
    const r = analyzeStlBuffer(fixture('t_cube20'), { fileName: 'cube.stl' });

    expect(r.modelFileName).toBe('cube.stl');
    expect(r.summary.isWatertight).toBe(true);
    expect(r.summary.holeCount).toBe(0);
    expect(r.summary.bboxMm).toEqual({ x: 20, y: 20, z: 20 });
    expect(r.summary.fitsBuildVolume).toBe(true);
    expect(r.gate.status).toBe('clean');
    expect(r.gate.criticalCount).toBe(0);
    expect(r.findings).toEqual([]);
  });

  it('开口盒：判为不水密并升级为 critical', () => {
    const r = analyzeStlBuffer(fixture('t_openbox'));

    expect(r.summary.isWatertight).toBe(false);
    expect(r.summary.holeCount).toBeGreaterThan(0);
    expect(r.gate.status).toBe('fail');

    const critical = r.findings.filter((f) => f.severity === 'critical');
    expect(critical.length).toBeGreaterThan(0);
    expect(critical.some((f) => f.moduleSource === 'validation')).toBe(true);
  });

  it('300mm 超大件：超出打印床被拦截', () => {
    const r = analyzeStlBuffer(fixture('t_big300'));

    expect(r.summary.bboxMm).toEqual({ x: 300, y: 300, z: 300 });
    expect(r.summary.fitsBuildVolume).toBe(false);
    expect(r.gate.status).toBe('fail');
    expect(r.findings.some((f) => f.moduleSource === 'bedFit')).toBe(true);
  });

  it('0.5mm 薄壁件：判为警告而非直接失败', () => {
    const r = analyzeStlBuffer(fixture('t_thinwall05'));

    expect(r.summary.minWallThicknessMm).toBeCloseTo(0.5, 3);
    expect(r.summary.isWatertight).toBe(true);
    expect(r.gate.status).toBe('warning');
    expect(r.gate.warningCount).toBeGreaterThan(0);
    expect(r.findings.some((f) => f.moduleSource === 'metrics')).toBe(true);
  });

  it('输出结构稳定：必填字段齐备', () => {
    const r = analyzeStlBuffer(fixture('t_cube20'));

    expect(typeof r.analyzedAt).toBe('string');
    expect(Number.isNaN(Date.parse(r.analyzedAt))).toBe(false);
    expect(typeof r.elapsedMs).toBe('number');
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(typeof r.overallConfidence).toBe('number');
    expect(['clean', 'warning', 'fail']).toContain(r.gate.status);
  });
});

describe('analyzeStlBuffer — 输入鲁棒性', () => {
  it('空载荷抛 AnalyzeInputError', () => {
    expect(() => analyzeStlBuffer(new Uint8Array(0))).toThrow(AnalyzeInputError);
  });

  it('过短载荷抛 AnalyzeInputError', () => {
    expect(() => analyzeStlBuffer(new Uint8Array(10))).toThrow(AnalyzeInputError);
  });

  it('非 STL 字节不会崩溃，抛 AnalyzeInputError 或返回结果', () => {
    const garbage = new Uint8Array(200).fill(0xab);
    let threw: unknown = null;
    let result: ReturnType<typeof analyzeStlBuffer> | null = null;
    try {
      result = analyzeStlBuffer(garbage);
    } catch (err) {
      threw = err;
    }
    // 只要求"不静默成功伪装合法"，要么明确报错，要么给出可判定的结果。
    if (threw) expect(threw).toBeInstanceOf(AnalyzeInputError);
    else expect(result).not.toBeNull();
  });

  it('Node 池化 Buffer 的非零字节偏移被正确处理', () => {
    const stl = fixture('t_cube20');
    // 一个远大于 8KB 池的大缓冲，subarray 视图的 byteOffset 非零。
    const pool = Buffer.alloc(stl.byteLength + 1024 * 16, 0x7f);
    stl.copy(pool, 5000);
    const view = pool.subarray(5000, 5000 + stl.byteLength);
    expect(view.byteOffset).not.toBe(0);

    const fromView = analyzeStlBuffer(view);
    const fromClean = analyzeStlBuffer(fixture('t_cube20'));

    expect(fromView.summary.bboxMm).toEqual(fromClean.summary.bboxMm);
    expect(fromView.summary.isWatertight).toBe(fromClean.summary.isWatertight);
    expect(fromView.gate.status).toBe(fromClean.gate.status);
  });
});

describe('POST /api/analyze — HTTP 往返', () => {
  const app = express();
  app.use('/api/analyze', createAnalyzeRouter());
  let server: Server | null = null;
  let base = '';

  function ensureServer(): string {
    if (!server) {
      server = app.listen(0);
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('no port');
      base = `http://127.0.0.1:${address.port}`;
    }
    return base;
  }

  afterAll(() => {
    server?.close();
  });

  it('raw 字节 + octet-stream 返回判定结果', async () => {
    const origin = ensureServer();
    const res = await fetch(`${origin}/api/analyze`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-model-filename': 'from-http.stl',
      },
      body: fixture('t_openbox'),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.modelFileName).toBe('from-http.stl');
    expect(body.summary.isWatertight).toBe(false);
    expect(body.gate.status).toBe('fail');
    expect(Array.isArray(body.findings)).toBe(true);
  });

  it('JSON base64 载荷等价于 raw 字节', async () => {
    const origin = ensureServer();
    const res = await fetch(`${origin}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        stlBase64: fixture('t_thinwall05').toString('base64'),
        fileName: 'thin.stl',
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.modelFileName).toBe('thin.stl');
    expect(body.gate.status).toBe('warning');
    expect(body.summary.minWallThicknessMm).toBeCloseTo(0.5, 3);
  });

  it('无载荷返回 400', async () => {
    const origin = ensureServer();
    const res = await fetch(`${origin}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nothing: true }),
    });

    expect(res.status).toBe(400);
  });

  it('非法 STL 返回 422 而非 500', async () => {
    const origin = ensureServer();
    const res = await fetch(`${origin}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.from(new Uint8Array(96).fill(0x11)),
    });

    expect(res.status).toBe(422);
    const body = (await res.json()) as any;
    expect(typeof body.error).toBe('string');
  });

  it('健康检查可用', async () => {
    const origin = ensureServer();
    const res = await fetch(`${origin}/api/analyze/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.service).toBe('analyze');
  });
});
