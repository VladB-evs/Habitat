// Local HTTP API for the vault.
//
// Binds to 127.0.0.1 only and every request needs the vault's bearer token, so
// nothing is reachable from the network. Routes are thin wrappers over the same
// handlers the renderer uses, which keeps one code path for reads and writes.

const http = require('http');
const { timingSafeEqual } = require('crypto');
const mcp = require('./mcp');

const version = require('../package.json').version;

let server = null;
let current = { port: 0 };

const json = (res, code, body) => {
  const text = JSON.stringify(body ?? null);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
};

function sameToken(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && timingSafeEqual(x, y);
}

function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('body must be JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Route table: [method, pattern, handler]. `:id` captures a path segment.
 * Handlers get { api, params, query, body } and return the response body.
 */
const ROUTES = [
  ['GET', '/health', ({ api }) => ({ ok: true, app: 'habitat', types: api['types:list']().length })],

  ['GET', '/types', ({ api }) => api['types:list']()],

  [
    'GET',
    '/objects',
    ({ api, query }) => {
      const list = query.q
        ? api['objects:search']({ q: query.q, content: query.content === 'true' })
        : api['objects:list']({ typeId: query.type || undefined });
      const limit = Number(query.limit) || 0;
      const filtered = query.q && query.type ? list.filter((o) => o.typeId === query.type) : list;
      return limit > 0 ? filtered.slice(0, limit) : filtered;
    },
  ],

  ['GET', '/objects/:id', ({ api, params }) => api['objects:get'](params.id)],

  [
    'POST',
    '/objects',
    ({ api, body }) => {
      if (!body.typeId) throw new HttpError(400, 'typeId is required');
      return api['objects:create'](body);
    },
  ],

  ['PATCH', '/objects/:id', ({ api, params, body }) => api['objects:update']({ id: params.id, patch: body })],

  ['DELETE', '/objects/:id', ({ api, params }) => ({ deleted: api['objects:delete'](params.id) })],

  [
    'GET',
    '/search',
    ({ api, query }) => {
      if (!query.q) throw new HttpError(400, 'q is required');
      return api['objects:search']({ q: query.q, content: query.content !== 'false' });
    },
  ],

  ['GET', '/backlinks/:id', ({ api, params }) => api['backlinks:list'](params.id)],

  ['GET', '/daily', ({ api, query }) => api['daily:get']({ dateKey: query.date || today() })],

  [
    'POST',
    '/daily/append',
    ({ api, body }) => {
      if (!body.text) throw new HttpError(400, 'text is required');
      return api['daily:append']({ text: body.text, dateKey: body.date });
    },
  ],

  ['GET', '/tasks', ({ api, query }) => api['tasks:forDay']({ dateKey: query.date || today() })],

  // ---------- People ----------

  [
    'GET',
    '/people',
    ({ api, query }) => {
      const list = api['people:list']();
      const q = String(query.q || '').trim().toLowerCase();
      const filtered = q
        ? list.filter((p) =>
            [p.title, p.props?.nickname, p.props?.company, p.props?.email, p.props?.phone]
              .some((v) => String(v || '').toLowerCase().includes(q))
          )
        : list;
      const limit = Number(query.limit) || 0;
      return limit > 0 ? filtered.slice(0, limit) : filtered;
    },
  ],

  /** Birthdays coming up, soonest first. `within` is days from today (default 60). */
  ['GET', '/people/birthdays', ({ api, query }) => api['people:birthdays']({ within: Number(query.within) || 60 })],

  /** Property ids come from the People type in /types, plus these optional extras. */
  ['GET', '/people/fields', ({ api }) => api['people:fields']()],

  /** The card that represents whoever owns this vault. */
  ['GET', '/me', ({ api }) => api['people:self']()],

  // Literal paths above win because routes are matched in order.
  ['GET', '/people/:id', ({ api, params }) => api['people:get'](params.id)],

  [
    'POST',
    '/people',
    ({ api, body }) => {
      if (!body.name && !body.title) throw new HttpError(400, 'name is required');
      return api['people:create'](body);
    },
  ],

  [
    'PATCH',
    '/people/:id',
    ({ api, params, body }) => {
      const saved = api['objects:update']({ id: params.id, patch: body });
      // Read it back so the reply carries the birthday countdown like every other people route.
      return saved && api['people:get'](params.id);
    },
  ],

  ['GET', '/tags', ({ api }) => api['tags:list']()],

  ['GET', '/stats', ({ api }) => api['stats:get']()],

  ['GET', '/automations', ({ api }) => api['automations:list']()],

  ['POST', '/automations/:id/run', ({ api, params }) => api['automations:run'](params.id)],

  /**
   * The same first-word routing the Telegram bridge uses: "daily …" appends to
   * today's note, a type name creates that type, anything else falls back.
   */
  [
    'POST',
    '/capture',
    ({ api, body }) => {
      if (!body.text) throw new HttpError(400, 'text is required');
      return api['telegram:ingest']({ text: body.text, typeId: body.typeId });
    },
  ],
];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const pad2 = (n) => String(n).padStart(2, '0');
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

function match(route, method, pathname) {
  const [m, pattern] = route;
  if (m !== method) return null;
  const want = pattern.split('/').filter(Boolean);
  const got = pathname.split('/').filter(Boolean);
  if (want.length !== got.length) return null;
  const params = {};
  for (let i = 0; i < want.length; i++) {
    if (want[i].startsWith(':')) params[want[i].slice(1)] = decodeURIComponent(got[i]);
    else if (want[i] !== got[i]) return null;
  }
  return params;
}

/**
 * Run one route in-process, with the same shape the MCP server sees over HTTP:
 * a missing route or an empty result is an error, so a tool behaves the same
 * whether it reached us through a socket or through the /mcp endpoint.
 */
async function dispatch(api, method, path, body) {
  const url = new URL(path, 'http://127.0.0.1');
  for (const route of ROUTES) {
    const params = match(route, method, url.pathname);
    if (!params) continue;
    const query = Object.fromEntries(url.searchParams.entries());
    const out = await route[2]({ api, params, query, body: body || {} });
    if (out === null || out === undefined) throw new Error('not found');
    return out;
  }
  throw new Error(`no route for ${method} ${url.pathname}`);
}

/** Starts (or restarts) the server. Returns { ok, port } or { ok: false, error }. */
function start(api, cfg) {
  stop();
  return new Promise((resolve) => {
    const port = Number(cfg.port) || 37373;
    const srv = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, `http://127.0.0.1:${port}`);
        const auth = req.headers.authorization || '';
        const token = auth.startsWith('Bearer ') ? auth.slice(7) : url.searchParams.get('token') || '';
        if (!cfg.token || !sameToken(token, cfg.token)) return json(res, 401, { error: 'bad or missing token' });

        // MCP speaks its own protocol on top of HTTP, so it takes the raw
        // request rather than going through the route table.
        if (url.pathname === '/mcp' || url.pathname === '/mcp/') {
          const body = req.method === 'GET' || req.method === 'DELETE' ? undefined : await readBody(req);
          return mcp.handle(req, res, body, {
            call: (method, at, payload) => dispatch(api, method, at, payload),
            canEdit: !!cfg.mcpEdit,
            version,
          });
        }

        for (const route of ROUTES) {
          const params = match(route, req.method, url.pathname);
          if (!params) continue;
          const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
          const query = Object.fromEntries(url.searchParams.entries());
          const out = await route[2]({ api, params, query, body });
          return json(res, out === null || out === undefined ? 404 : 200, out ?? { error: 'not found' });
        }
        json(res, 404, { error: `no route for ${req.method} ${url.pathname}` });
      } catch (err) {
        json(res, err.status || 500, { error: err.message || 'server error' });
      }
    });

    srv.on('error', (err) => {
      server = null;
      resolve({ ok: false, error: err.code === 'EADDRINUSE' ? `port ${port} is already in use` : err.message });
    });

    // Loopback only — never exposed to the network.
    srv.listen(port, '127.0.0.1', () => {
      server = srv;
      current = { port };
      resolve({ ok: true, port });
    });
  });
}

function stop() {
  if (server) {
    server.close();
    server = null;
  }
}

const status = () => ({ running: !!server, port: current.port });

module.exports = { start, stop, status, dispatch, ROUTES };
