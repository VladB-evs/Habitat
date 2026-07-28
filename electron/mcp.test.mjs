// The /mcp endpoint an HTTP MCP client connects to: it has to answer a real
// handshake, list the tools, run one against the vault, and keep the read-only
// ones out of reach until editing is allowed. Run with `npm test`.

import { createRequire } from 'node:module';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dbmod = require('./db.js');
const server = require('./server.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-mcp-'));
const TOKEN = 'test-token';
let base = '';

/** One JSON-RPC call, the way a streamable-HTTP client makes it. */
async function rpc(method, params, { token = TOKEN } = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Math.floor(Math.random() * 1e6), method, params }),
  });
  const body = await res.text();
  // With JSON replies enabled the payload is plain JSON; an SSE frame would
  // arrive as `data: {...}` lines instead.
  const json = body.startsWith('data:') ? JSON.parse(body.slice(body.indexOf('{'))) : body ? JSON.parse(body) : null;
  return { status: res.status, json };
}

const restart = async (patch) => {
  const cfg = dbmod.api['api:save']({ enabled: true, port: 37374, token: TOKEN, ...patch });
  const out = await server.start(dbmod.api, cfg);
  assert.ok(out.ok, out.error);
  base = `http://127.0.0.1:${out.port}`;
};

before(async () => {
  dbmod.initDb(path.join(dir, 'test.db'));
  dbmod.seedFlavor('work');
  await restart({ mcpEdit: false });
});

after(() => {
  server.stop();
  dbmod.closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('it shakes hands and names itself', async () => {
  const { status, json } = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'probe', version: '1' },
  });
  assert.equal(status, 200);
  assert.equal(json.result.serverInfo.name, 'habitat');
  assert.ok(json.result.capabilities.tools, 'offers tools');
});

test('it lists the vault tools', async () => {
  const { json } = await rpc('tools/list', {});
  const names = json.result.tools.map((t) => t.name);
  for (const tool of ['search', 'create_object', 'whoami', 'capture', 'update_object']) {
    assert.ok(names.includes(tool), `${tool} is offered`);
  }
});

test('a tool call reaches the vault', async () => {
  const made = await rpc('tools/call', {
    name: 'create_object',
    arguments: { type: 'note', title: 'From an agent', body: 'written over http' },
  });
  assert.ok(!made.json.result.isError, JSON.stringify(made.json));
  const id = JSON.parse(made.json.result.content[0].text).id;

  const found = await rpc('tools/call', { name: 'search', arguments: { query: 'From an agent' } });
  assert.match(found.json.result.content[0].text, /From an agent/);
  assert.ok(dbmod.api['objects:get'](id), 'and it is really there');
});

test('editing is off until it is turned on', async () => {
  const id = dbmod.api['objects:create']({ typeId: 'note', title: 'Not yours to delete' }).id;

  const blocked = await rpc('tools/call', { name: 'delete_object', arguments: { id } });
  assert.ok(blocked.json.result.isError, 'refused');
  assert.match(blocked.json.result.content[0].text, /read-and-add only/);
  assert.ok(dbmod.api['objects:get'](id), 'still there');

  await restart({ mcpEdit: true });
  const done = await rpc('tools/call', { name: 'delete_object', arguments: { id } });
  assert.ok(!done.json.result.isError, JSON.stringify(done.json));
  assert.equal(dbmod.api['objects:get'](id), null, 'gone');
});

test('the token guards it like every other route', async () => {
  const { status, json } = await rpc('tools/list', {}, { token: 'wrong' });
  assert.equal(status, 401);
  assert.match(json.error, /token/);
});
