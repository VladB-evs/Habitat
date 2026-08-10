// The hub, over HTTP.
//
// Hand-rolled against Supabase's REST endpoints rather than pulling in
// @supabase/supabase-js: what sync needs is three calls — sign in, upsert rows,
// read rows after a cursor — and the client library brings realtime, storage
// helpers and a browser-shaped session store that would all have to be worked
// around here. main.js already talks to GitHub and Telegram this way, and the
// same file will run unchanged in the mobile worker, which has no Node and no
// localStorage to hand the library either.
//
// Nothing in here is allowed to log a token.

const REFRESH_MARGIN_MS = 60_000;
const BUCKET = 'habitat-files';

/**
 * @param config   { url, key } — the project URL and its publishable key
 * @param session  { load(), save(s) } — where the signed-in session is kept
 *                 between launches. Deliberately not the vault: a session
 *                 belongs to this installation, and the vault is a folder the
 *                 user is invited to copy between machines.
 */
function createHub({ config, session }) {
  let current = session.load() || null;

  const base = () => String(config().url || '').replace(/\/+$/, '');
  const key = () => String(config().key || '');
  const configured = () => !!base() && !!key();

  async function call(pathname, { method = 'GET', body, headers = {}, auth = true } = {}) {
    if (!configured()) throw new Error('No Supabase project set up yet.');
    const token = auth ? await accessToken() : key();
    const res = await fetch(base() + pathname, {
      method,
      headers: {
        apikey: key(),
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // Surface what the server said, minus anything that could carry a token.
      throw new Error(`Supabase said ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.status === 204 ? null : res.json().catch(() => null);
  }

  const remember = (s) => {
    current = s
      ? {
          accessToken: s.access_token,
          refreshToken: s.refresh_token,
          userId: s.user?.id || current?.userId || null,
          email: s.user?.email || current?.email || null,
          expiresAt: Date.now() + (s.expires_in ?? 3600) * 1000,
        }
      : null;
    session.save(current);
    return current;
  };

  async function token(grant, body) {
    const res = await fetch(`${base()}/auth/v1/token?grant_type=${grant}`, {
      method: 'POST',
      headers: { apikey: key(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error_description || json.msg || json.error || `sign-in failed (${res.status})`);
    return remember(json);
  }

  /** A token good for the next minute at least, refreshing it if not. */
  async function accessToken() {
    if (!current) throw new Error('Not signed in.');
    if (Date.now() < current.expiresAt - REFRESH_MARGIN_MS) return current.accessToken;
    try {
      await token('refresh_token', { refresh_token: current.refreshToken });
    } catch (err) {
      // A refresh token that no longer works means signed out, not a sync
      // failure to retry forever.
      remember(null);
      throw new Error('Signed out — please sign in again.');
    }
    return current.accessToken;
  }

  return {
    configured,
    account: () => (current ? { email: current.email, userId: current.userId } : null),

    signIn(email, password) {
      // Caught here rather than at the server, which answers a blank sign-in
      // with "missing email or phone" — true, but it reads like the account is
      // wrong when the real fault is that the form never arrived.
      if (!email || !password) throw new Error('Enter an email and password.');
      return token('password', { email, password });
    },

    signOut() {
      // Best effort: the local session is what actually matters.
      call('/auth/v1/logout', { method: 'POST' }).catch(() => {});
      return remember(null);
    },

    /**
     * Upsert a batch. The primary key is (user_id, tbl, row_id), so a row
     * already on the hub is replaced by this one — which is where last-write-
     * wins actually happens.
     */
    async push(rows) {
      if (!rows.length) return;
      if (!current?.userId) throw new Error('Not signed in.');
      await call('/rest/v1/habitat_rows?on_conflict=user_id,tbl,row_id', {
        method: 'POST',
        headers: { prefer: 'resolution=merge-duplicates,return=minimal' },
        body: rows.map((r) => ({ ...r, user_id: current.userId })),
      });
    },

    /**
     * Attachments go to a bucket rather than the table — Postgres is the wrong
     * place for a 12MB screenshot. The path is the hash, under a folder named
     * for the owner, so uploading the same file twice is uploading it once and
     * the storage policies have something to check against.
     */
    async uploadBlob({ hash, ext, mime }, bytes) {
      if (!current?.userId) throw new Error('Not signed in.');
      const res = await fetch(`${base()}/storage/v1/object/${BUCKET}/${current.userId}/${hash}${ext || ''}`, {
        method: 'POST',
        headers: {
          apikey: key(),
          authorization: `Bearer ${await accessToken()}`,
          'content-type': mime || 'application/octet-stream',
          // The bytes under a hash can never differ, so a second upload is not
          // a conflict to resolve — it is the same file arriving again.
          'x-upsert': 'true',
        },
        body: bytes,
      });
      if (!res.ok) throw new Error(`upload failed (${res.status}): ${(await res.text().catch(() => '')).slice(0, 200)}`);
    },

    async downloadBlob({ hash, ext }) {
      if (!current?.userId) throw new Error('Not signed in.');
      const res = await fetch(`${base()}/storage/v1/object/${BUCKET}/${current.userId}/${hash}${ext || ''}`, {
        headers: { apikey: key(), authorization: `Bearer ${await accessToken()}` },
      });
      // A blob the hub hasn't got yet isn't a failure: the device that owns it
      // may simply not have uploaded it. We'll ask again next cycle.
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    },

    /** Everything after `cursor`, oldest first. RLS confines this to our own rows. */
    pull(cursor, limit) {
      const q = `select=tbl,row_id,data,deleted,seq&seq=gt.${encodeURIComponent(cursor)}&order=seq.asc&limit=${limit}`;
      return call(`/rest/v1/habitat_rows?${q}`).then((rows) => rows || []);
    },
  };
}

module.exports = { createHub };
