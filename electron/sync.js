// Push what changed here, pull what changed elsewhere.
//
// The order is deliberate and always the same: push first, then pull. Pushing
// first means this device's work is safe on the hub before anything arrives to
// overwrite it, and it means the rows that come back down include our own —
// which is how a device confirms what the hub actually kept.
//
// Conflicts are settled by arrival, not by clocks. Whoever pushes last wins,
// because a laptop and a phone that have both been offline have no way to agree
// on whose "later" is really later, and a wrong clock should not be able to
// silently outrank a correct one. The cost is the plain last-write-wins the
// design asks for: edit the same note on two devices while both are offline and
// the one that reconnects second is the one that survives.
//
// The transport is passed in rather than reached for, so the whole loop can be
// tested against an in-memory hub — two vaults reconciling with no network in
// sight. supabase.js supplies the real one.

/** Rows per round trip. Big enough to be few trips, small enough to retry cheaply. */
const BATCH = 400;

/** Attachments moved per cycle. Small: text should never wait behind photographs. */
const BLOBS_PER_CYCLE = 8;

/**
 * @param store  the vault's sync surface — db.js's `sync` export
 * @param transport  { push(rows), pull(cursor, limit) }
 */
function createSync(optsOrStore, maybeTransport, maybeOnState) {
  let store, transport, onState;
  if (optsOrStore && optsOrStore.store) {
    store = optsOrStore.store;
    transport = optsOrStore.transport;
    onState = optsOrStore.onState || (() => {});
  } else {
    store = optsOrStore;
    transport = maybeTransport;
    onState = maybeOnState || (() => {});
  }

  let state = {
    status: 'idle',
    pending: store?.pendingCount ? store.pendingCount() : 0,
    error: null,
    at: null,
  };
  let running = null;

  const set = (patch) => {
    state = { ...state, ...patch };
    onState(state);
    return state;
  };

  /**
   * Everything waiting, in the order it changed. Loops because a vault that has
   * been offline for a week can have far more than one batch of work.
   */
  async function pushAll() {
    let sent = 0;
    for (;;) {
      const batch = store.pending(BATCH);
      if (!batch.length) return sent;
      await transport.push(
        batch.map((e) => ({ tbl: e.table, row_id: e.id, data: e.deleted ? null : e.row, deleted: e.deleted }))
      );
      // Only once the hub has it. An entry changed again mid-flight survives,
      // so an edit made while the batch was in the air is not lost.
      store.ack(batch);
      sent += batch.length;
      if (batch.length < BATCH) return sent;
    }
  }

  /**
   * Everything the hub has that this vault hasn't seen. The cursor is the last
   * `seq` taken in, and it moves only after the rows before it are committed —
   * so an interrupted pull is repeated rather than skipped.
   */
  async function pullAll() {
    let taken = 0;
    for (;;) {
      const cursor = store.cursor() || '0';
      const rows = await transport.pull(cursor, BATCH);
      if (!rows.length) return taken;

      store.applyRemote(
        rows.map((r) => ({ table: r.tbl, id: r.row_id, row: r.data, deleted: !!r.deleted }))
      );
      store.setCursor(String(rows[rows.length - 1].seq));
      taken += rows.length;
      if (rows.length < BATCH) return taken;
    }
  }

  /**
   * Attachments, in both directions, a few at a time.
   *
   * Deliberately not all of them: a vault with a thousand images should not
   * hold up the next sync of the text, which is the part that matters and the
   * part that is small. Each cycle moves a handful and the backlog drains over
   * the following ones — and because a blob is named after its own bytes, an
   * interrupted run repeats work rather than corrupting any.
   *
   * A single attachment failing is not allowed to fail the sync. The row that
   * refers to it has already travelled; the bytes catching up late means one
   * image renders once the next cycle has been round, which is a great deal
   * better than a note that never arrives because a photo was too big.
   */
  async function blobs() {
    let up = 0;
    let down = 0;

    for (const f of store.blobsToUpload(BLOBS_PER_CYCLE)) {
      const bytes = store.readBlob(f.hash, f.ext);
      if (!bytes) continue;
      try {
        await transport.uploadBlob(f, bytes);
        store.markBlobUploaded(f.hash);
        up++;
      } catch {
        /* try again next cycle */
      }
    }

    for (const f of store.blobsMissing(BLOBS_PER_CYCLE)) {
      try {
        const bytes = await transport.downloadBlob(f);
        if (!bytes) continue; // Not uploaded by the other device yet.
        store.saveBlob(f.hash, f.name, bytes);
        down++;
      } catch {
        /* try again next cycle */
      }
    }

    return { up, down };
  }

  /**
   * One full cycle. Overlapping calls share the one in flight rather than
   * queueing — a sync started by a timer while the user is pressing the button
   * should be the same sync.
   */
  function run() {
    if (running) return running;
    running = (async () => {
      try {
        set({ status: 'syncing', error: null });
        const pushed = await pushAll();
        const pulled = await pullAll();
        // Last, and only once the rows they belong to are safely across.
        const files = await blobs();
        return set({
          status: 'idle',
          pending: store.pendingCount(),
          error: null,
          at: Date.now(),
          pushed,
          pulled,
          files,
        });
      } catch (err) {
        // Offline is the normal case, not a failure worth shouting about: the
        // queue is durable and the next attempt picks it up unchanged.
        return set({ status: 'error', pending: store.pendingCount(), error: String(err?.message || err) });
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    run,
    cycle: run,
    state: () => state,
    status: () => state,
    pending: () => (store?.pendingCount ? store.pendingCount() : 0),
  };
}

/**
 * A transport connecting a client (e.g. mobile app) to a Habitat instance over HTTP.
 * Implements the transport contract required by createSync:
 *   - push(batch)
 *   - pull(cursor, limit)
 *   - uploadBlob(file, bytes)
 *   - downloadBlob(file)
 * And provides snapshot() for initial device cloning.
 */
function createLanTransport({ baseUrl, token }) {
  const base = () => String(baseUrl || '').replace(/\/+$/, '');
  const authHeaders = () => ({
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    'content-type': 'application/json',
  });

  return {
    configured: () => !!base(),

    async info() {
      const res = await fetch(`${base()}/sync/info`, { method: 'GET', headers: authHeaders() });
      if (!res.ok) throw new Error(`LAN info failed (${res.status})`);
      return res.json();
    },

    async snapshot() {
      const res = await fetch(`${base()}/sync/snapshot`, { method: 'GET', headers: authHeaders() });
      if (!res.ok) throw new Error(`LAN snapshot failed (${res.status})`);
      return res.json();
    },

    async push(batch) {
      const res = await fetch(`${base()}/sync/push`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ batch }),
      });
      if (!res.ok) throw new Error(`LAN push failed (${res.status})`);
      return res.json();
    },

    async pull(cursor, limit = 500) {
      const res = await fetch(`${base()}/sync/pull?cursor=${encodeURIComponent(cursor)}&limit=${limit}`, {
        method: 'GET',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error(`LAN pull failed (${res.status})`);
      const data = await res.json();
      return data.rows || [];
    },

    async uploadBlob({ hash, ext, name, mime }, bytes) {
      const res = await fetch(`${base()}/sync/files/${hash}${ext || ''}`, {
        method: 'POST',
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          'content-type': mime || 'application/octet-stream',
          'x-file-name': encodeURIComponent(name || 'file'),
          'x-file-mime': mime || 'application/octet-stream',
        },
        body: bytes,
      });
      if (!res.ok) throw new Error(`LAN uploadBlob failed (${res.status})`);
      return res.json();
    },

    async downloadBlob({ hash, ext }) {
      const res = await fetch(`${base()}/sync/files/${hash}${ext || ''}`, {
        method: 'GET',
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return null;
      const arrayBuf = await res.arrayBuffer();
      return Buffer.from(arrayBuf);
    },
  };
}

module.exports = { createSync, createLanTransport, BATCH, BLOBS_PER_CYCLE };
