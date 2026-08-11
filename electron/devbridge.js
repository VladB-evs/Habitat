// A development-only door into the same IPC channels the renderer uses.
//
// Why it exists: the renderer reaches the vault through `window.habitat.invoke`,
// which only exists inside Electron's preload. That means the UI cannot be opened
// in a plain browser at all — and a phone-sized viewport with real data is the
// only honest way to do the mobile work. This serves the identical channel map
// over HTTP so `vite` alone is enough.
//
// It is also the seam the Capacitor build will use: the native shell talks to a
// local or remote endpoint with exactly this shape, and `src/api.ts` already
// chooses its transport at runtime.
//
// It has two modes, with genuinely different exposure:
//
//   HABITAT_DEV — localhost only. Binds 127.0.0.1 and checks that the request
//     came from the Vite dev server, which stops a stray page in the developer's
//     browser reaching the vault. No token: a local process running as the same
//     user could read the SQLite file directly, so one would be theatre.
//
//   HABITAT_LAN — reachable from the network, for running the app on a real
//     phone. Binds 0.0.0.0 and requires a bearer token on every request. This
//     one is a real exposure and is opt-in for that reason: while it is running,
//     anything on the same wifi can reach the vault if it has the token.
//
// Neither ever starts in a packaged app.

const http = require('http');
const os = require('os');
const { randomBytes, timingSafeEqual } = require('crypto');

/** Where `npm run dev` serves the renderer from. */
const DEV_ORIGINS = new Set([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
]);

const PORT = 37380;

/**
 * LAN mode, for running the app on a real phone.
 *
 * The iOS build has no vault of its own — there is no Node and no SQLite in a
 * webview — so it talks to the Habitat running on your Mac. That means binding
 * past localhost, which changes the threat model completely: on localhost the
 * only callers are processes that could already read the SQLite file, but on a
 * network anything on the coffee-shop wifi can reach it.
 *
 * So LAN mode is opt-in, and it requires a bearer token. Set HABITAT_LAN_TOKEN
 * to keep the same one across restarts (otherwise the phone build has to be
 * rebuilt every launch); leave it unset and one is generated and printed.
 */
const LAN = !!process.env.HABITAT_LAN;
const TOKEN = process.env.HABITAT_LAN_TOKEN || randomBytes(16).toString('hex');

let server = null;

const sameToken = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && timingSafeEqual(x, y);
};

/** The address a phone on the same network can actually reach. */
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

const json = (res, code, body, origin) => {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'POST, OPTIONS',
  });
  res.end(JSON.stringify(body ?? null));
};

function readBody(req, limit = 8_000_000) {
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
 * `channels` is the data map from db.js; `extra` carries the handlers main.js
 * registers itself (settings, sync, the model) so the app can actually boot.
 * Anything absent from both answers 404 rather than pretending to succeed —
 * a dialog or a traffic-light call has no meaning in a browser tab, and the
 * renderer is better off seeing that plainly.
 */
function start(channels, extra = {}) {
  if (!process.env.HABITAT_DEV && !LAN) return null;
  stop();

  server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';

    /**
     * Two different doors.
     *
     * On localhost the origin is the check: it stops a random page in the
     * developer's browser reaching the vault, and a local process needs no
     * help from us anyway.
     *
     * Over the network the origin is worthless — a Capacitor webview sends
     * `capacitor://localhost`, and anything can claim that — so the token is
     * the check, and CORS is opened up because the bearer header is what
     * matters rather than where the request says it came from.
     */
    const allowed = LAN ? '*' : origin;
    if (LAN) {
      const auth = req.headers.authorization || '';
      const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (req.method !== 'OPTIONS' && !sameToken(given, TOKEN)) {
        return json(res, 401, { error: 'dev bridge: bad or missing token' }, allowed);
      }
    } else if (!DEV_ORIGINS.has(origin)) {
      return json(res, 403, { error: 'dev bridge: bad origin' }, 'null');
    }

    if (req.method === 'OPTIONS') return json(res, 204, null, allowed);
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only' }, allowed);

    try {
      const { channel, payload } = await readBody(req);
      const fn = extra[channel] || channels[channel];
      if (typeof fn !== 'function') {
        return json(res, 404, { error: `dev bridge: no channel ${channel}` }, allowed);
      }
      // `await` covers both: most channels are synchronous SQLite calls.
      const out = await fn(payload);
      json(res, 200, { ok: true, value: out === undefined ? null : out }, allowed);
    } catch (err) {
      json(res, 500, { error: String(err?.message || err) }, allowed);
    }
  });

  server.on('error', (err) => {
    console.error('[dev bridge] ' + err.message);
    server = null;
  });

  server.listen(PORT, LAN ? '0.0.0.0' : '127.0.0.1', () => {
    if (!LAN) {
      console.log(`[dev bridge] http://127.0.0.1:${PORT} — open the app at http://127.0.0.1:5173`);
      return;
    }
    const host = `http://${lanAddress()}:${PORT}`;
    console.log('[dev bridge] LAN mode — this vault is reachable from your network.');
    console.log(`[dev bridge]   VITE_HABITAT_BRIDGE=${host}`);
    console.log(`[dev bridge]   VITE_HABITAT_TOKEN=${TOKEN}`);
  });

  return server;
}

function stop() {
  if (!server) return;
  server.close();
  server = null;
}

module.exports = { start, stop, PORT };
