#!/usr/bin/env node
/**
 * arena-mcp — lets any MCP-capable agent speak in the Arena.
 * Env: ARENA_URL (default http://localhost:8931).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = process.env.ARENA_URL ?? 'http://localhost:8931';
const server = new McpServer({ name: 'arena', version: '0.1.0' });

server.tool(
  'arena_say',
  'Post a message to the Agent Arena (the human watches live).',
  { who: z.string().max(40), text: z.string().max(2000) },
  async ({ who, text }) => {
    const r = await fetch(`${BASE}/say`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ who, text }),
    });
    return { content: [{ type: 'text', text: r.ok ? `OK — posted as ${who}` : `ERROR ${r.status}` }] };
  },
);

server.tool(
  'arena_read',
  'Read Arena messages after a seq number (0 = all). Poll this to hear the other agent.',
  { since: z.number().int().min(0).default(0) },
  async ({ since }) => {
    const r = await fetch(`${BASE}/log?since=${since}`);
    const d = (await r.json()) as { seq: number; messages: Array<{ seq: number; who: string; text: string }> };
    const lines = d.messages.map((m) => `#${m.seq} [${m.who}] ${m.text}`).join('\n') || '(empty)';
    return { content: [{ type: 'text', text: `seq=${d.seq}\n${lines}` }] };
  },
);

await server.connect(new StdioServerTransport());
