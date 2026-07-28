// MCP over HTTP, served by the app itself at /mcp on the API port.
//
// Clients that can only speak MCP over a URL — Osaurus, LM Studio, anything
// without a way to spawn a command — get the same tools as `mcp/server.mjs`,
// authenticated with the same bearer token as the rest of the API. Clients that
// can spawn a command still use the stdio server; both share mcp/tools.mjs.
//
// Stateless: a server and a transport per request, so there are no sessions to
// keep, expire or lose when the app restarts.

const path = require('path');
const { pathToFileURL } = require('url');

let sdk = null;

/** The SDK and the tools are ESM, and only worth loading if something asks for /mcp. */
async function load() {
  if (!sdk) {
    const [{ StreamableHTTPServerTransport }, { createHabitatServer }] = await Promise.all([
      import('@modelcontextprotocol/sdk/server/streamableHttp.js'),
      import(pathToFileURL(path.join(__dirname, '..', 'mcp', 'tools.mjs')).href),
    ]);
    sdk = { StreamableHTTPServerTransport, createHabitatServer };
  }
  return sdk;
}

/**
 * Answer one MCP request. `call` goes straight to the route table rather than
 * back out over the socket — same vault, same code path, one less hop.
 */
async function handle(req, res, body, { call, canEdit, version }) {
  const { StreamableHTTPServerTransport, createHabitatServer } = await load();
  const server = createHabitatServer({ call, canEdit, version });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    // Plain JSON replies: a probe that doesn't hold an SSE stream open still
    // gets its answer.
    enableJsonResponse: true,
  });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

module.exports = { handle };
