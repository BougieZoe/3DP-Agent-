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
  key: (i: number) => [...store.keys()][i] ?? null,
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

function parseArgs(argv: string[]): { rounds: number; provider: string } {
  const roundsIdx = argv.indexOf('--rounds');
  const providerIdx = argv.indexOf('--provider');
  return {
    rounds: roundsIdx >= 0 ? Number(argv[roundsIdx + 1]) || 3 : 3,
    provider: providerIdx >= 0 ? argv[providerIdx + 1] ?? 'deepseek' : 'deepseek',
  };
}

/** A few realistic model variants — same shape the browser pipeline sees. */
function buildVariants(): ModelData[] {
  const base = (name: string, wall: number | null, ohAreas: number, wtStatus: 'good' | 'warning' | 'critical', ohStatus: 'good' | 'warning' | 'critical'): ModelData => ({
    fileName: name,
    wallThickness: {
      minThickness: wall, p1Thickness: wall, p5Thickness: wall, p10Thickness: wall,
      medianThickness: wall, avgThickness: wall,
      thinWallCount: wtStatus === 'good' ? 0 : 12,
      thinWallPercentage: wtStatus === 'good' ? 0 : 4.2,
      thinWallRatio: wtStatus === 'good' ? 0 : 0.042,
      averageConfidence: 0.82,
      areas: Math.floor(ohAreas * 0.3),
      status: wtStatus,
    },
    overhang: { angle: 45, areas: ohAreas, status: ohStatus },
    volume: 18_400,
    surfaceArea: 6_200,
    dims: { x: 120, y: 60, z: 25 },
  });
  return [
    base('bracket-120x60.stl', 1.2, 0, 'warning', 'good'),
    base('lamp-shade-organic.stl', 0.8, 340, 'critical', 'warning'),
    base('enclosure-box.stl', 2.0, 0, 'good', 'good'),
    base('gearbox-cover.stl', 1.5, 96, 'warning', 'warning'),
    base('phone-stand.stl', null, 210, 'warning', 'critical'),
  ];
}

async function main(): Promise<void> {
  const { rounds, provider } = parseArgs(process.argv.slice(2));

  const key = process.env.CAPTURE_API_KEY;
  if (!key) {
    console.error('CAPTURE_API_KEY is required (keyed provider path).');
    process.exit(1);
  }
  saveAPIKeys({ [provider]: key });

  const material: Material = DEFAULT_MATERIAL;
  const variants = buildVariants();
  await mkdir(path.dirname(TRACES_PATH), { recursive: true });

  const traceFn = (t: AgentTrace) => {
    appendFile(TRACES_PATH, JSON.stringify(t) + '\n', 'utf-8')
      .catch((err) => console.error('trace append failed:', err));
  };

  let total = 0;
  for (let round = 0; round < rounds; round++) {
    const model = variants[round % variants.length];
    const summary = buildModelDataSummary(model, material);
    console.log(`[round ${round + 1}/${rounds}] analyzing ${model.fileName} (${provider})`);
    const result = await runAgentPipeline(summary, 'en', undefined, material, undefined, traceFn);
    total += result.steps.length;
    console.log(`  -> ${result.steps.length} steps, final score: ${JSON.stringify(result.finalScore)?.slice(0, 80)}`);
  }

  console.log(`\ncaptured ${total} trace entries -> ${TRACES_PATH}`);
  console.log('next: python3 deploy/amd/build-dataset.py');
}

main().catch((err) => {
  console.error('capture failed:', err);
  process.exit(1);
});
