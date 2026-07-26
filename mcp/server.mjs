#!/usr/bin/env node
// Habitat MCP server — lets an AI agent read and write your vault.
//
// It talks to the local HTTP API (Settings → API), so the app has to be running
// with the server switched on. Configure with:
//
//   HABITAT_TOKEN  required — the token from Settings → API
//   HABITAT_URL    default http://127.0.0.1:37373
//   HABITAT_EDIT   set to 1 to allow updating, deleting and running automations
//
// Reads, creating objects, capture and daily-note appends work without
// HABITAT_EDIT; anything that changes or removes existing data needs it.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = (process.env.HABITAT_URL || 'http://127.0.0.1:37373').replace(/\/$/, '');
const TOKEN = process.env.HABITAT_TOKEN || '';
const CAN_EDIT = process.env.HABITAT_EDIT === '1';

if (!TOKEN) {
  console.error('HABITAT_TOKEN is not set — copy it from Habitat → Settings → API.');
  process.exit(1);
}

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(`Habitat is not reachable at ${BASE}. Is the app open with Settings → API switched on?`);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error || `${method} ${path} failed (${res.status})`);
  return json;
}

const q = (params) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')).toString();
  return s ? `?${s}` : '';
};

/** Objects carry a full editor document; agents only ever need the readable parts. */
const slim = (o) =>
  o && {
    id: o.id,
    type: o.typeId,
    title: o.title,
    props: o.props,
    snippet: o.snippet,
    pinned: o.pinned,
    created: new Date(o.createdAt).toISOString(),
    updated: new Date(o.updatedAt).toISOString(),
  };

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] });

const server = new McpServer({ name: 'habitat', version: '0.1.0' });

// ---------- reading ----------

server.registerTool(
  'list_types',
  {
    title: 'List types',
    description: 'The object types in this vault and the properties each one has. Call this first to learn property ids.',
    inputSchema: {},
  },
  async () => text((await call('GET', '/types')).map((t) => ({ id: t.id, name: t.name, properties: t.properties })))
);

server.registerTool(
  'search',
  {
    title: 'Search',
    description: 'Search objects by title and note text. Use this to find something before reading or updating it.',
    inputSchema: {
      query: z.string().describe('what to look for'),
      include_note_text: z.boolean().optional().describe('also search inside note bodies (default true)'),
    },
  },
  async ({ query, include_note_text }) =>
    text((await call('GET', `/search${q({ q: query, content: include_note_text === false ? 'false' : 'true' })}`)).map(slim))
);

server.registerTool(
  'list_objects',
  {
    title: 'List objects',
    description: 'Objects of a type, newest first. Prefer search when you know roughly what you want.',
    inputSchema: {
      type: z.string().optional().describe('a type id from list_types'),
      limit: z.number().optional().describe('how many to return (default 50)'),
    },
  },
  async ({ type, limit }) => text((await call('GET', `/objects${q({ type, limit: limit ?? 50 })}`)).map(slim))
);

server.registerTool(
  'get_object',
  {
    title: 'Get object',
    description: 'One object with its properties and note text.',
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    const o = await call('GET', `/objects/${encodeURIComponent(id)}`);
    if (!o) throw new Error('no object with that id');
    return text({ ...slim(o), body: docText(o.content) });
  }
);

server.registerTool(
  'get_backlinks',
  {
    title: 'Get backlinks',
    description: 'Everything that links to or mentions this object.',
    inputSchema: { id: z.string() },
  },
  async ({ id }) => text((await call('GET', `/backlinks/${encodeURIComponent(id)}`)).map(slim))
);

server.registerTool(
  'get_daily_note',
  {
    title: 'Get daily note',
    description: "A day's journal entry. Defaults to today.",
    inputSchema: { date: z.string().optional().describe('YYYY-MM-DD') },
  },
  async ({ date }) => {
    const note = await call('GET', `/daily${q({ date })}`);
    return text(note ? { date: note.dateKey, body: docText(note.content) } : 'No entry for that day.');
  }
);

server.registerTool(
  'list_tasks',
  {
    title: 'List tasks',
    description: 'Tasks due on a day. Defaults to today.',
    inputSchema: { date: z.string().optional().describe('YYYY-MM-DD') },
  },
  async ({ date }) => text((await call('GET', `/tasks${q({ date })}`)).map(slim))
);

server.registerTool(
  'get_stats',
  { title: 'Vault stats', description: 'Object counts per type, recently edited, and pinned items.', inputSchema: {} },
  async () => {
    const s = await call('GET', '/stats');
    return text({ counts: s.counts, recent: (s.recent || []).map(slim), pinned: (s.pinned || []).map(slim) });
  }
);

// ---------- adding ----------

server.registerTool(
  'create_object',
  {
    title: 'Create object',
    description:
      'Create an object of a type. Property keys are property ids from list_types; relation properties take arrays of object ids.',
    inputSchema: {
      type: z.string().describe('type id'),
      title: z.string(),
      properties: z.record(z.string(), z.any()).optional(),
      body: z.string().optional().describe('note text, one paragraph per line'),
    },
  },
  async ({ type, title, properties, body }) =>
    text(slim(await call('POST', '/objects', { typeId: type, title, props: properties || {}, content: doc(body) })))
);

server.registerTool(
  'append_daily_note',
  {
    title: 'Append to daily note',
    description: "Add a line to a day's journal entry, creating it if there isn't one. Defaults to today.",
    inputSchema: { text: z.string(), date: z.string().optional().describe('YYYY-MM-DD') },
  },
  async ({ text: line, date }) => {
    await call('POST', '/daily/append', { text: line, date });
    return text('Added.');
  }
);

server.registerTool(
  'capture',
  {
    title: 'Quick capture',
    description:
      'One line of text, routed by its first word: "daily …" appends to today\'s note, a type name like "task …" creates that type, anything else becomes the fallback type.',
    inputSchema: { text: z.string() },
  },
  async ({ text: line }) => {
    const r = await call('POST', '/capture', { text: line });
    return text(r?.kind === 'daily' ? `Added to today's note: ${r.title}` : `Created ${r?.typeName}: ${r?.title}`);
  }
);

// ---------- changing (needs HABITAT_EDIT=1) ----------

const guard = () => {
  if (!CAN_EDIT) throw new Error('This server is read-only. Set HABITAT_EDIT=1 in its config to allow changes.');
};

server.registerTool(
  'update_object',
  {
    title: 'Update object',
    description: 'Change an object\'s title, properties or pinned state. Properties are merged, not replaced.',
    inputSchema: {
      id: z.string(),
      title: z.string().optional(),
      properties: z.record(z.string(), z.any()).optional(),
      pinned: z.boolean().optional(),
    },
  },
  async ({ id, title, properties, pinned }) => {
    guard();
    const cur = await call('GET', `/objects/${encodeURIComponent(id)}`);
    if (!cur) throw new Error('no object with that id');
    const patch = {};
    if (title !== undefined) patch.title = title;
    if (pinned !== undefined) patch.pinned = pinned;
    if (properties) patch.props = { ...cur.props, ...properties };
    return text(slim(await call('PATCH', `/objects/${encodeURIComponent(id)}`, patch)));
  }
);

server.registerTool(
  'delete_object',
  {
    title: 'Delete object',
    description: 'Permanently delete an object and its links. There is no undo — confirm with the user first.',
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    guard();
    await call('DELETE', `/objects/${encodeURIComponent(id)}`);
    return text('Deleted.');
  }
);

server.registerTool(
  'list_automations',
  { title: 'List automations', description: 'The vault\'s automation rules and when they last ran.', inputSchema: {} },
  async () =>
    text(
      (await call('GET', '/automations')).map((r) => ({
        id: r.id,
        name: r.name,
        enabled: r.enabled,
        trigger: r.trigger,
        actions: (r.actions || []).map((a) => a.kind),
        runs: r.runs || 0,
      }))
    )
);

server.registerTool(
  'run_automation',
  {
    title: 'Run automation',
    description: 'Run a rule now, ignoring its schedule. Returns how many objects it touched.',
    inputSchema: { id: z.string() },
  },
  async ({ id }) => {
    guard();
    return text(await call('POST', `/automations/${encodeURIComponent(id)}/run`));
  }
);

// ---------- helpers ----------

function docText(node) {
  if (!node) return '';
  let out = typeof node.text === 'string' ? node.text : '';
  if (node.type === 'mention') out += `@${node.attrs?.label ?? ''}`;
  if (Array.isArray(node.content)) {
    for (const c of node.content) out += docText(c);
    if (node.type === 'paragraph' || node.type?.startsWith('heading')) out += '\n';
  }
  return out;
}

function doc(body) {
  if (!body) return null;
  return {
    type: 'doc',
    content: body
      .split('\n')
      .filter((l) => l.trim())
      .map((line) => ({ type: 'paragraph', content: [{ type: 'text', text: line }] })),
  };
}

await server.connect(new StdioServerTransport());
