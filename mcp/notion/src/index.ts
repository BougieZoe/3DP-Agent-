#!/usr/bin/env node
/**
 * handoff-notion-mcp — stdio MCP server.
 * Tools: quote_build | proofread | notion_push
 * Env: NOTION_TOKEN (required for notion_push), NOTION_PARENT_ID (page or database id).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Client as NotionClient } from '@notionhq/client';
import { z } from 'zod';
import { proofread } from './proofread.js';
import { buildQuoteText } from './quote.js';

const server = new McpServer({ name: 'handoff-notion', version: '0.1.0' });

server.tool(
  'quote_build',
  'Build a client quote draft (JA/EN/ZH) from analysis numbers. No rates inside — rates are filled by hand.',
  {
    fileName: z.string(),
    lang: z.enum(['ja', 'en', 'zh']),
    verdict: z.string(),
    score: z.number().min(0).max(100),
    size: z.string().optional(),
    volume: z.string().optional(),
    weight: z.string().optional(),
    time: z.string().optional(),
    estimatesBlocked: z.boolean().default(false),
    cheapestStep: z.string().optional(),
  },
  async (q) => ({ content: [{ type: 'text', text: buildQuoteText(q) }] }),
);

server.tool(
  'proofread',
  'Deterministic business-tone check for handoff texts. Returns findings + fixed text.',
  { text: z.string(), lang: z.enum(['ja', 'en', 'zh']) },
  async ({ text, lang }) => {
    const r = proofread(text, lang);
    const head =
      r.findings.length === 0
        ? 'OK — no findings.'
        : r.findings.map((f) => `[${f.severity}] ${f.rule}: ${f.before} → ${f.after} (${f.why})`).join('\n');
    return { content: [{ type: 'text', text: `${head}\n---\n${r.fixed}` }] };
  },
);

server.tool(
  'notion_push',
  'Create a Notion page with the (optionally proofread) quote. Needs NOTION_TOKEN + NOTION_PARENT_ID.',
  {
    title: z.string(),
    text: z.string(),
    lang: z.enum(['ja', 'en', 'zh']).default('ja'),
    autoProofread: z.boolean().default(true),
  },
  async ({ title, text, lang, autoProofread }) => {
    const token = process.env.NOTION_TOKEN;
    const parentId = process.env.NOTION_PARENT_ID;
    if (!token || !parentId) {
      return { content: [{ type: 'text', text: 'ERROR: set NOTION_TOKEN and NOTION_PARENT_ID first.' }], isError: true };
    }
    const finalText = autoProofread ? proofread(text, lang).fixed : text;
    const notion = new NotionClient({ auth: token });
    const isDb = parentId.replace(/-/g, '').length === 32;
    const page = await notion.pages.create({
      parent: isDb ? { database_id: parentId } : { page_id: parentId },
      properties: isDb
        ? { Name: { title: [{ text: { content: title } }] } }
        : { title: [{ text: { content: title } }] },
      children: finalText.split('\n').map((line) => ({
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: line || ' ' } }] },
      })),
    } as never);
    return { content: [{ type: 'text', text: `OK — page ${(page as { id: string }).id}` }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
