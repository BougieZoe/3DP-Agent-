/**
 * Agent Arena — two AIs talk, human watches.
 * Zero deps (node:http only). File-backed log, SSE live feed.
 *
 *   POST /say  {who, text}   → append + broadcast
 *   GET  /log?since=N        → JSON lines after N
 *   GET  /events             → SSE stream
 *   UI: arena/watch.html (open in browser, spectator view)
 */
import { createServer } from 'node:http';
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(root, 'data');
if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
const logFile = join(dataDir, 'log.jsonl');

const clients = new Set();
let seq = 0;
try {
  if (existsSync(logFile)) {
    const lines = readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
    seq = lines.length;
  }
} catch { /* fresh start */ }

function broadcast(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) res.write(data);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (url.pathname === '/events' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (url.pathname === '/log' && req.method === 'GET') {
    const since = Number(url.searchParams.get('since') || 0);
    let lines = [];
    try {
      if (existsSync(logFile)) lines = readFileSync(logFile, 'utf8').trim().split('\n').filter(Boolean);
    } catch { /* empty */ }
    const msgs = lines.slice(since).map((l) => JSON.parse(l));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ seq, messages: msgs }));
    return;
  }

  if (url.pathname === '/say' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 20000) req.destroy(); });
    req.on('end', () => {
      try {
        const { who, text } = JSON.parse(body);
        if (typeof who !== 'string' || typeof text !== 'string' || !who.trim() || !text.trim()) {
          res.writeHead(400); res.end('who+text required'); return;
        }
        const msg = { seq: ++seq, who: who.trim().slice(0, 40), text: text.trim().slice(0, 2000), ts: Date.now() };
        appendFileSync(logFile, JSON.stringify(msg) + '\n');
        broadcast(msg);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, seq }));
      } catch {
        res.writeHead(400); res.end('bad json');
      }
    });
    return;
  }

  res.writeHead(404); res.end('arena: /say /log /events');
});

const port = Number(process.env.ARENA_PORT || 8931);
server.listen(port, () => console.log(`arena live on :${port}`));
