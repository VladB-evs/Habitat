#!/usr/bin/env node
// Habitat MCP server over stdio — lets an AI agent read and write your vault.
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
//
// A client that speaks MCP over HTTP instead needs no command at all: the app
// serves the same tools at <HABITAT_URL>/mcp while it is running.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHabitatServer } from './tools.mjs';

const BASE = (process.env.HABITAT_URL || 'http://127.0.0.1:37373').replace(/\/$/, '');
const TOKEN = process.env.HABITAT_TOKEN || '';

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

const server = createHabitatServer({ call, canEdit: process.env.HABITAT_EDIT === '1' });

await server.connect(new StdioServerTransport());
