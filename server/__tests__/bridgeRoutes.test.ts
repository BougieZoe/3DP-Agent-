/**
 * Bridge route E2E — the real Express app, real JSON bodies, real Python worker.
 *
 * These are not client-mock tests. They catch the failure mode we hit in the
 * browser smoke: Vite proxy points at a token-gated/disabled backend, so the
 * UI sees 403 even though every unit test is green.
 *
 * The Python mesh test runs when trimesh is importable; CI can install it in a
 * dedicated job. The slicer test runs when a real PrusaSlicer binary is found,
 * otherwise it is skipped exactly like server/__tests__/slicerBridge.test.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createApp, type CreateAppOptions } from '../index';
import { resolveMeshPython } from '../meshProcess';
import { discoverSlicer } from '../slicerRouter';

const TOKEN = 'bridge-e2e-token';
const CUBE_PATH = path.join(import.meta.dirname, '..', '..', 'docs', '_stls', 'watertight-cube.stl');

function canImport(python: string, moduleName: string): boolean {
  try {
    execFileSync(python, ['-c', `import ${moduleName}`], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

const meshPythonAvailable = canImport(resolveMeshPython(), 'trimesh');
const prusaSlicer = await discoverSlicer('prusaslicer');

const openServers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
});

async function withApp(
  options: CreateAppOptions,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = createServer(createApp(options));
  openServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind to a port');
  await fn(`http://127.0.0.1:${address.port}`);
}

function post(
  baseUrl: string,
  route: string,
  body: unknown,
  token?: string,
): Promise<Response> {
  return fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe('bridge route auth', () => {
  it('production rejects missing and wrong bearer tokens before validation', async () => {
    await withApp({ isProduction: true, bridgeToken: TOKEN }, async (base) => {
      const missing = await post(base, '/api/mesh/process', {});
      expect(missing.status).toBe(401);

      const wrong = await post(base, '/api/mesh/process', {}, 'wrong-token');
      expect(wrong.status).toBe(401);
    });
  });

  it('production with a configured token reaches route validation', async () => {
    await withApp({ isProduction: true, bridgeToken: TOKEN }, async (base) => {
      const res = await post(base, '/api/mesh/process', {}, TOKEN);
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        ok: false,
        error: { code: 'invalid-artifact' },
      });
    });
  });

  it('production without a token leaves the bridges unmounted', async () => {
    await withApp({ isProduction: true, bridgeToken: undefined }, async (base) => {
      const res = await post(base, '/api/mesh/process', {}, TOKEN);
      expect(res.status).toBe(404);
    });
  });

  it('dev loopback can reach the bridge without a token', async () => {
    await withApp({ isProduction: false, bridgeToken: undefined }, async (base) => {
      const res = await post(base, '/api/mesh/process', {});
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        ok: false,
        error: { code: 'invalid-artifact' },
      });
    });
  });

  it('the slicer route is mounted behind the same guard', async () => {
    await withApp({ isProduction: true, bridgeToken: TOKEN }, async (base) => {
      const missing = await post(base, '/api/slice', {});
      expect(missing.status).toBe(401);

      const res = await post(base, '/api/slice', {}, TOKEN);
      expect(res.status).toBe(400);
    });
  });
});

describe('bridge route execution', () => {
  it.skipIf(!meshPythonAvailable)(
    'processes a real watertight cube through the Python mesh worker',
    async () => {
      const cube = await readFile(CUBE_PATH);
      await withApp({ isProduction: true, bridgeToken: TOKEN }, async (base) => {
        const res = await post(
          base,
          '/api/mesh/process',
          { stlBase64: cube.toString('base64'), decimateTo: 0 },
          TOKEN,
        );
        expect(res.status).toBe(200);

        const data = (await res.json()) as {
          ok: boolean;
          processedStlBase64: string;
          diagnostics: { triangleCount?: number; watertight?: boolean; volumeMm3?: number | null };
        };
        expect(data.ok).toBe(true);
        expect(Buffer.from(data.processedStlBase64, 'base64').byteLength).toBeGreaterThan(84);
        expect(data.diagnostics.triangleCount).toBe(12);
        expect(data.diagnostics.watertight).toBe(true);
        expect(data.diagnostics.volumeMm3 ?? 0).toBeGreaterThan(0);
      });
    },
    60_000,
  );

  it.skipIf(!prusaSlicer)(
    'slices a real cube through the slicer route',
    async () => {
      const cube = await readFile(CUBE_PATH);
      await withApp({ isProduction: true, bridgeToken: TOKEN }, async (base) => {
        const res = await post(
          base,
          '/api/slice',
          {
            stlBase64: cube.toString('base64'),
            fileName: 'bridge-e2e-cube.stl',
            slicer: 'prusaslicer',
            autoDropToBed: true,
            timeoutMs: 60_000,
          },
          TOKEN,
        );
        expect(res.status).toBe(200);

        const data = (await res.json()) as {
          ok: boolean;
          result: { gcode: string; metadata: { printTimeMinutes: number; layerCount: number } };
        };
        expect(data.ok).toBe(true);
        expect(data.result.gcode).toContain('G1');
        expect(data.result.metadata.printTimeMinutes).toBeGreaterThan(0);
        expect(data.result.metadata.layerCount).toBeGreaterThan(0);
      });
    },
    90_000,
  );
});
