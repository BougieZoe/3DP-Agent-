/**
 * deploy/amd/capture-traces.ts — batch-capture agent pipeline traces from the
 * command line (no browser needed). Each run executes N rounds of the real
 * 5-agent pipeline and appends every step (incl. critic retries) to
 * deploy/amd/agent-traces.jsonl, feeding deploy/amd/build-dataset.py.
 *
 * Requirements:
 *   - local dev server running (Vite or the API server on 3001) so the
 *     same-origin /api/llm relay is reachable
 *   - a keyed provider key via env (AMD path needs the unlock + a live
 *     instance — see README)
 *
 * Usage:
 *   CAPTURE_API_KEY=sk-... npx tsx deploy/amd/capture-traces.ts --rounds 5
 *   CAPTURE_API_KEY=sk-... CAPTURE_BASE_URL=http://localhost:3001 \
 *     npx tsx deploy/amd/capture-traces.ts --rounds 5 --provider deepseek
 *   # walk the ~70-variant pool across runs with --offset:
 *   CAPTURE_API_KEY=sk-... npx tsx deploy/amd/capture-traces.ts --rounds 10 --offset 10
 */

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelData } from '../../client/src/lib/ruleEngine';
import type { Material } from '../../shared/domain/material';
import { DEFAULT_MATERIAL } from '../../shared/domain/material';
import { buildModelDataSummary } from '../../client/src/agents/deepAnalysis';
import { runAgentPipeline, type AgentTrace } from '../../client/src/lib/agentPipeline';
import { saveAPIKeys } from '../../client/src/lib/apiKeys';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRACES_PATH = path.join(__dirname, 'agent-traces.jsonl');

// ---- minimal localStorage shim (apiKeys reads/writes it) ----
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
  key: (i: number) => Array.from(store.keys())[i] ?? null,
  get length() { return store.size; },
};

// ---- rewrite relative /api/* URLs against the dev server ----
const base = process.env.CAPTURE_BASE_URL ?? 'http://localhost:3001';
const realFetch = globalThis.fetch.bind(globalThis);
(globalThis as { fetch: typeof fetch }).fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const resolved = url.startsWith('/') ? base + url : url;
  return realFetch(resolved, init);
}) as typeof fetch;

function parseArgs(argv: string[]): { rounds: number; provider: string; offset: number } {
  const roundsIdx = argv.indexOf('--rounds');
  const providerIdx = argv.indexOf('--provider');
  const offsetIdx = argv.indexOf('--offset');
  return {
    rounds: roundsIdx >= 0 ? Number(argv[roundsIdx + 1]) || 3 : 3,
    provider: providerIdx >= 0 ? argv[providerIdx + 1] ?? 'deepseek' : 'deepseek',
    offset: offsetIdx >= 0 ? Number(argv[offsetIdx + 1]) || 0 : 0,
  };
}

/**
 * Procedurally generated model variants — a deterministic grid over wall
 * thickness × overhang area, with derived (physically consistent) statuses
 * and varied names/dims/volume. ~70 distinct parts instead of a handful of
 * hand-written ones, so captured traces don't overfit to a few shapes.
 * Use --offset to walk the pool across multiple invocations.
 * For real diversity, prefer live traffic via the server's /api/agent-trace.
 */
function buildVariants(): ModelData[] {
  const names = [
    'bracket', 'lamp-shade', 'enclosure', 'gearbox-cover', 'phone-stand',
    'impeller', 'cable-clip', 'drone-arm', 'pipe-elbow', 'hinge',
  ];
  const walls: (number | null)[] = [null, 0.5, 0.7, 0.9, 1.1, 1.3, 1.6, 2.0, 2.5, 3.0];
  const overhangs = [0, 40, 90, 160, 260, 420, 700];

  const variants: ModelData[] = [];
  for (const wall of walls) {
    for (const ohAreas of overhangs) {
      const i = variants.length;
      const wtStatus: ModelData['wallThickness']['status'] =
        wall === null ? 'warning' : wall < 0.8 ? 'critical' : wall < 1.3 ? 'warning' : 'good';
      const ohStatus: ModelData['overhang']['status'] =
        ohAreas >= 300 ? 'critical' : ohAreas > 0 ? 'warning' : 'good';
      const thin = wtStatus !== 'good';
      variants.push({
        fileName: `${names[i % names.length]}-${i}.stl`,
        wallThickness: {
          minThickness: wall, p1Thickness: wall, p5Thickness: wall, p10Thickness: wall,
          medianThickness: wall, avgThickness: wall,
          thinWallCount: thin ? 4 + (i % 20) : 0,
          thinWallPercentage: thin ? 1.5 + (i % 9) * 0.6 : 0,
          thinWallRatio: thin ? 0.015 + (i % 9) * 0.006 : 0,
          averageConfidence: 0.7 + (i % 4) * 0.08,
          areas: Math.floor(ohAreas * 0.3),
          status: wtStatus,
        },
        overhang: { angle: 40 + (i % 5) * 5, areas: ohAreas, status: ohStatus },
        volume: 5_000 + ((i * 7) % 60) * 1_000,
        surfaceArea: 2_000 + ((i * 11) % 40) * 200,
        dims: { x: 40 + ((i * 13) % 160), y: 30 + ((i * 17) % 120), z: 10 + ((i * 7) % 60) },
      });
    }
  }
  return variants;
}

async function main(): Promise<void> {
  const { rounds, provider, offset } = parseArgs(process.argv.slice(2));

  const key = process.env.CAPTURE_API_KEY;
  if (!key) {
    console.error('CAPTURE_API_KEY is required (keyed provider path).');
    process.exit(1);
  }
  saveAPIKeys({ [provider]: key });

  const material: Material = DEFAULT_MATERIAL;
  const variants = buildVariants();
  await mkdir(path.dirname(TRACES_PATH), { recursive: true });

  // Collect write promises so the process never exits before the final steps
  // (score / summary) are flushed — fire-and-forget drops the last entries.
  const pending: Promise<void>[] = [];
  const traceFn = (t: AgentTrace) => {
    pending.push(
      appendFile(TRACES_PATH, JSON.stringify(t) + '\n', 'utf-8')
        .catch((err) => console.error('trace append failed:', err)),
    );
  };

  let total = 0;
  for (let round = 0; round < rounds; round++) {
    const model = variants[(offset + round) % variants.length];
    const summary = buildModelDataSummary(model, material);
    console.log(`[round ${round + 1}/${rounds}] analyzing ${model.fileName} (${provider})`);
    const result = await runAgentPipeline(summary, 'en', undefined, material, undefined, traceFn);
    total += result.steps.length;
    console.log(`  -> ${result.steps.length} steps, final score: ${JSON.stringify(result.finalScore)?.slice(0, 80)}`);
  }

  await Promise.all(pending);
  console.log(`\ncaptured ${total} trace entries -> ${TRACES_PATH}`);
  console.log('next: python3 deploy/amd/build-dataset.py');
}

main().catch((err) => {
  console.error('capture failed:', err);
  process.exit(1);
});
