// What changed since the last sync, tracked by the database itself.
//
// Sync needs two questions answered cheaply: which rows have changed since a
// given moment, and which rows have been deleted. Neither is free to bolt onto
// this codebase by hand — the data layer writes from close to three hundred
// places, and a scheme that depends on every one of them remembering to stamp a
// flag is a scheme that breaks the first time a feature is added.
//
// So the bookkeeping is done by triggers. Every tracked table gets three, and
// they maintain a single queue table:
//
//   sync_changes(tbl, row_id, changed_at, deleted)
//
// One row per changed row, upserted, so editing the same note forty times costs
// one entry rather than forty. `deleted = 1` is a tombstone: without one, a row
// deleted on a phone is simply a row the phone is missing, and the next pull
// puts it back.
//
// Deletes stay real deletes. The alternative — a `deleted_at` column on every
// table — would mean auditing some two hundred SELECTs to filter the dead rows
// out, and any one that was missed would show deleted objects in the UI. A
// separate tombstone means the existing queries are already correct.
//
// Timestamps come from SQLite rather than JavaScript so they are consistent
// whichever host is driving the database. They order the outbound queue and
// nothing more: the authority on when a change actually happened is the server,
// which stamps rows as they arrive. Two devices with badly set clocks can
// therefore disagree about their own history without corrupting each other's.

/**
 * The tables that belong to the user's vault, with the column that identifies a
 * row and the one to date it by when backfilling an existing vault.
 *
 * `links` is deliberately absent: it is derived from note content and is rebuilt
 * on write, so syncing it would move data that the receiving side is about to
 * recompute anyway.
 */
const TABLES = [
  { name: 'types', pk: 'id', stamp: 'created_at' },
  { name: 'objects', pk: 'id', stamp: 'updated_at' },
  { name: 'templates', pk: 'id', stamp: 'created_at' },
  { name: 'files', pk: 'hash', stamp: 'created_at' },
  { name: 'kv', pk: 'key', stamp: null },
  { name: 'canvases', pk: 'id', stamp: 'updated_at' },
  { name: 'canvas_items', pk: 'id', stamp: 'created_at' },
  { name: 'canvas_edges', pk: 'id', stamp: null },
  { name: 'decks', pk: 'id', stamp: 'created_at' },
  { name: 'study_notes', pk: 'id', stamp: 'updated_at' },
  { name: 'cards', pk: 'id', stamp: 'created_at' },
  { name: 'reviews', pk: 'id', stamp: 'at' },
];

/**
 * Settings that are about this machine rather than about the vault, and must not
 * leave it. `httpApi` and `telegram` hold bearer tokens; `migration:*` records
 * which one-time fixups this database file has had, which is meaningless
 * elsewhere and actively wrong to copy onto a vault that hasn't had them.
 */
const KV_PRIVATE = ['httpApi', 'telegram'];

/** The same rule as SQL, for use inside a trigger's WHEN clause. */
const kvAllowed = (ref) =>
  `${ref}.key NOT LIKE 'migration:%' AND ${ref}.key NOT IN (${KV_PRIVATE.map((k) => `'${k}'`).join(', ')})`;

/** Milliseconds since the epoch, UTC, from SQLite's clock rather than the host's. */
const NOW = `CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)`;

// `seq` is what makes acknowledging a batch safe, and it is deliberately not a
// timestamp. Milliseconds tie: an edit made in the same millisecond the batch
// was read would look no newer than the batch, and clearing the batch would
// throw that edit away — a write the user watched land, never sent, gone at the
// next restart. AUTOINCREMENT never repeats a number and never goes backwards,
// so "changed since I read it" is a question with an exact answer.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS sync_changes (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  tbl        TEXT    NOT NULL,
  row_id     TEXT    NOT NULL,
  changed_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tbl, row_id)
);
CREATE TABLE IF NOT EXISTS sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- Which attachments this device has confirmed are on the hub. Blobs are
-- addressed by the hash of their own bytes and never change, so "uploaded" is a
-- fact that stays true. It is recorded here rather than on the files table
-- because it describes this device's relationship with the hub, not the file.
CREATE TABLE IF NOT EXISTS sync_blobs (
  hash TEXT PRIMARY KEY,
  at   INTEGER NOT NULL
);
`;

/**
 * The three triggers for one table. Writing a row clears any tombstone it had,
 * which is what makes an id that comes back — an undo, or a restore from
 * elsewhere — behave as a live row again rather than staying buried.
 */
function triggersFor({ name, pk }) {
  const guard = name === 'kv' ? kvAllowed : null;
  const when = (ref) => (guard ? `\n  WHEN ${guard(ref)}` : '');
  // Delete then insert rather than upsert, so the entry takes a *new* seq. An
  // upsert would keep the original, and a row edited while its batch was in
  // flight would look untouched to `ack`.
  const mark = (ref, deleted) => `
  DELETE FROM sync_changes WHERE tbl = '${name}' AND row_id = ${ref}.${pk};
  INSERT INTO sync_changes (tbl, row_id, changed_at, deleted)
  VALUES ('${name}', ${ref}.${pk}, ${NOW}, ${deleted});`;

  return `
CREATE TRIGGER IF NOT EXISTS trk_${name}_ins AFTER INSERT ON ${name}${when('NEW')}
BEGIN${mark('NEW', 0)}
END;
CREATE TRIGGER IF NOT EXISTS trk_${name}_upd AFTER UPDATE ON ${name}${when('NEW')}
BEGIN${mark('NEW', 0)}
END;
CREATE TRIGGER IF NOT EXISTS trk_${name}_del AFTER DELETE ON ${name}${when('OLD')}
BEGIN${mark('OLD', 1)}
END;
`;
}

/**
 * A vault that existed before sync did has rows no trigger ever saw. Queue them
 * all, dated by whatever the table already knows about when they were touched,
 * so the first sync pushes the vault rather than only what happens after it.
 */
function backfill(db) {
  for (const { name, pk, stamp } of TABLES) {
    const at = stamp ? `COALESCE(${stamp}, 0)` : '0';
    const where = name === 'kv' ? ` WHERE ${kvAllowed(name)}` : '';
    db.exec(
      `INSERT OR IGNORE INTO sync_changes (tbl, row_id, changed_at, deleted)
       SELECT '${name}', ${pk}, ${at}, 0 FROM ${name}${where}`
    );
  }
}

/**
 * Put change tracking in place. Safe to call on every open: the tables and
 * triggers are created only if missing, and the backfill runs only the first
 * time, when there is no queue to preserve.
 */
function install(db) {
  const existing = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sync_changes'").get();
  let fresh = !existing;

  if (existing) {
    const cols = db.prepare('PRAGMA table_info(sync_changes)').all().map((c) => c.name);
    if (!cols.includes('seq')) {
      // An earlier build ordered the queue by timestamp. Nothing is lost by
      // starting it over — the backfill below re-queues the whole vault, and a
      // row sent twice is a row written twice to the same values.
      db.exec('DROP TABLE sync_changes; DROP INDEX IF EXISTS idx_sync_changes_at;');
      fresh = true;
    }
  }

  db.exec(SCHEMA);
  // Dropped and rebuilt every open rather than created-if-missing: a trigger
  // body that changed between builds would otherwise survive in its old form,
  // silently tracking changes the way last month's code thought was right.
  for (const t of TABLES) {
    for (const k of ['ins', 'upd', 'del']) db.exec(`DROP TRIGGER IF EXISTS trk_${t.name}_${k}`);
    db.exec(triggersFor(t));
  }

  if (fresh) backfill(db);
  deviceId(db);
}

/**
 * This installation's identity, minted once per vault file and kept out of `kv`
 * so it is never itself synced. It breaks ties when two devices claim the same
 * moment, and lets the server tell a device's own echo from someone else's edit.
 */
function deviceId(db) {
  const row = db.prepare("SELECT value FROM sync_state WHERE key = 'deviceId'").get();
  if (row) return row.value;
  const id = require('crypto').randomUUID();
  db.prepare("INSERT INTO sync_state (key, value) VALUES ('deviceId', ?)").run(id);
  return id;
}

const getState = (db, key) => db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key)?.value ?? null;

const setState = (db, key, value) =>
  db
    .prepare('INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));

/** How much is waiting to go up — the number the settings pane shows. */
const pendingCount = (db) => db.prepare('SELECT COUNT(*) AS n FROM sync_changes').get().n;

/**
 * The next batch to push, oldest first, each with the row it refers to. A
 * tombstone carries no row, only the id to delete.
 */
function pending(db, limit = 500) {
  const out = [];
  const rows = db.prepare('SELECT * FROM sync_changes ORDER BY seq LIMIT ?').all(limit);
  for (const c of rows) {
    const spec = TABLES.find((t) => t.name === c.tbl);
    if (!spec) continue;
    const row = c.deleted ? null : db.prepare(`SELECT * FROM ${c.tbl} WHERE ${spec.pk} = ?`).get(c.row_id);
    // Written and deleted again before we got here: nothing to send but the tombstone.
    out.push({ table: c.tbl, id: c.row_id, seq: c.seq, changedAt: c.changed_at, deleted: !!c.deleted || !row, row });
  }
  return out;
}

/**
 * Drop entries the hub has taken — but only the exact ones sent. A row edited
 * while its batch was in flight has been given a new seq by the triggers, so it
 * survives the acknowledgement and goes up on the next cycle.
 */
function ack(db, entries) {
  const del = db.prepare('DELETE FROM sync_changes WHERE tbl = ? AND row_id = ? AND seq <= ?');
  for (const e of entries) del.run(e.table, e.id, e.seq);
}

module.exports = { TABLES, KV_PRIVATE, install, deviceId, getState, setState, pending, pendingCount, ack };
