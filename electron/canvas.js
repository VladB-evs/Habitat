// Canvas — freeform boards that can hold anything: vault objects, sticky notes,
// images and files, links out to the web, and frames to group them, with curved
// connectors between any two.
//
// A board is deliberately *not* an object of a type. Objects are things you
// write; a board is an arrangement of them, and giving it its own tables keeps
// the note pipeline (search index, mentions, backlinks, export) from having to
// understand geometry. What a board holds is only ever a reference — deleting a
// card never touches the object it points at.

const { randomUUID } = require('crypto');

const uid = () => randomUUID().replace(/-/g, '').slice(0, 16);
const now = () => Date.now();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS canvases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT 'canvas',
  color TEXT NOT NULL DEFAULT '#2a78d6',
  view TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS canvas_items (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'note',
  ref_id TEXT,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  w REAL NOT NULL DEFAULT 220,
  h REAL NOT NULL DEFAULT 140,
  z INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS canvas_edges (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL,
  from_item TEXT NOT NULL,
  to_item TEXT NOT NULL,
  from_side TEXT NOT NULL DEFAULT 'right',
  to_side TEXT NOT NULL DEFAULT 'left',
  label TEXT NOT NULL DEFAULT '',
  color TEXT,
  data TEXT NOT NULL DEFAULT '{}'
);
`;

/** Run after any column migrations — see the note on study.js's INDEXES. */
const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_canvas_items_board ON canvas_items(canvas_id);
CREATE INDEX IF NOT EXISTS idx_canvas_items_ref ON canvas_items(ref_id);
CREATE INDEX IF NOT EXISTS idx_canvas_edges_board ON canvas_edges(canvas_id);
`;

/** The kinds a card can be. Anything else is refused rather than stored. */
const KINDS = new Set(['object', 'note', 'text', 'image', 'file', 'link', 'frame']);

/** Default footprint per kind, used when a drop doesn't say how big it is. */
const SIZES = {
  object: { w: 240, h: 132 },
  note: { w: 220, h: 160 },
  text: { w: 260, h: 56 },
  image: { w: 300, h: 220 },
  file: { w: 240, h: 92 },
  link: { w: 260, h: 108 },
  frame: { w: 520, h: 400 },
};

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const json = (s, fallback) => {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
};

function parseCanvas(r) {
  return {
    id: r.id,
    name: r.name,
    icon: r.icon,
    color: r.color,
    view: json(r.view, { x: 0, y: 0, k: 1 }),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function parseItem(r) {
  return {
    id: r.id,
    kind: r.kind,
    refId: r.ref_id || null,
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    z: r.z,
    data: json(r.data, {}),
  };
}

function parseEdge(r) {
  return {
    id: r.id,
    from: r.from_item,
    to: r.to_item,
    fromSide: r.from_side,
    toSide: r.to_side,
    label: r.label,
    color: r.color || null,
    data: json(r.data, {}),
  };
}

/**
 * The channel table. `getDb` is a getter rather than the handle itself because
 * switching habitat replaces the connection underneath us, and `helpers` carries
 * the bits that only db.js knows how to do (reading an object, naming a file).
 */
function channels(getDb, helpers) {
  const db = () => getDb();
  const { objectCard, fileRow } = helpers;

  /** Everything a card needs to draw itself, resolved in one pass per board. */
  const hydrate = (items) => {
    const objectIds = [...new Set(items.filter((i) => i.kind === 'object' && i.refId).map((i) => i.refId))];
    const hashes = [...new Set(items.filter((i) => (i.kind === 'image' || i.kind === 'file') && i.refId).map((i) => i.refId))];
    const objects = new Map(objectIds.map((id) => [id, objectCard(id)]));
    const files = new Map(hashes.map((h) => [h, fileRow(h)]));
    return items.map((i) =>
      i.kind === 'object'
        ? { ...i, object: objects.get(i.refId) ?? null }
        : i.kind === 'image' || i.kind === 'file'
          ? { ...i, file: files.get(i.refId) ?? null }
          : i
    );
  };

  const touch = (id) => db().prepare('UPDATE canvases SET updated_at = ? WHERE id = ?').run(now(), id);

  const getCanvas = (id) => {
    const r = db().prepare('SELECT * FROM canvases WHERE id = ?').get(String(id));
    return r ? parseCanvas(r) : null;
  };

  /** The next free layer, so a fresh card always lands on top of the pile. */
  const topZ = (canvasId) =>
    num(db().prepare('SELECT MAX(z) AS z FROM canvas_items WHERE canvas_id = ?').get(canvasId)?.z, 0);

  const insertItems = (canvasId, list) => {
    const ins = db().prepare(
      'INSERT INTO canvas_items (id, canvas_id, kind, ref_id, x, y, w, h, z, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    let z = topZ(canvasId);
    const made = [];
    for (const raw of list || []) {
      const kind = KINDS.has(raw?.kind) ? raw.kind : 'note';
      const size = SIZES[kind];
      const item = {
        id: uid(),
        kind,
        refId: raw.refId ? String(raw.refId) : null,
        x: num(raw.x),
        y: num(raw.y),
        w: Math.max(60, num(raw.w, size.w)),
        h: Math.max(40, num(raw.h, size.h)),
        // Frames sit behind everything so the cards they group stay clickable.
        z: kind === 'frame' ? -(++z) : ++z,
        data: raw.data && typeof raw.data === 'object' ? raw.data : {},
      };
      ins.run(
        item.id, canvasId, item.kind, item.refId, item.x, item.y, item.w, item.h, item.z,
        JSON.stringify(item.data), now()
      );
      made.push(item);
    }
    return made;
  };

  return {
    'canvas:list': () => {
      const rows = db().prepare('SELECT * FROM canvases ORDER BY updated_at DESC').all();
      // A handful of positioned cards per board, enough to draw a live minimap
      // on the gallery tile instead of a generic placeholder.
      const peek = db().prepare(
        'SELECT kind, x, y, w, h, data FROM canvas_items WHERE canvas_id = ? ORDER BY z DESC LIMIT 60'
      );
      const tally = db().prepare('SELECT COUNT(*) AS c FROM canvas_items WHERE canvas_id = ?');
      return rows.map((r) => ({
        ...parseCanvas(r),
        count: tally.get(r.id).c,
        preview: peek.all(r.id).map((p) => ({
          kind: p.kind,
          x: p.x,
          y: p.y,
          w: p.w,
          h: p.h,
          color: json(p.data, {}).color || null,
        })),
      }));
    },

    'canvas:create': ({ name, icon, color } = {}) => {
      const id = uid();
      const t = now();
      db().prepare(
        'INSERT INTO canvases (id, name, icon, color, view, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, String(name || 'Untitled board'), String(icon || 'canvas'), String(color || '#2a78d6'), '{}', t, t);
      return getCanvas(id);
    },

    'canvas:get': (id) => {
      const canvas = getCanvas(id);
      if (!canvas) return null;
      const items = db()
        .prepare('SELECT * FROM canvas_items WHERE canvas_id = ? ORDER BY z')
        .all(canvas.id)
        .map(parseItem);
      const edges = db().prepare('SELECT * FROM canvas_edges WHERE canvas_id = ?').all(canvas.id).map(parseEdge);
      return { canvas, items: hydrate(items), edges };
    },

    'canvas:patch': ({ id, patch }) => {
      if (!getCanvas(id)) return null;
      const p = patch || {};
      if (p.name !== undefined) db().prepare('UPDATE canvases SET name = ? WHERE id = ?').run(String(p.name), id);
      if (p.icon !== undefined) db().prepare('UPDATE canvases SET icon = ? WHERE id = ?').run(String(p.icon), id);
      if (p.color !== undefined) db().prepare('UPDATE canvases SET color = ? WHERE id = ?').run(String(p.color), id);
      // The viewport is saved as you leave, so a board reopens where you left it.
      if (p.view !== undefined) db().prepare('UPDATE canvases SET view = ? WHERE id = ?').run(JSON.stringify(p.view || {}), id);
      // Only real edits move a board up the gallery — restoring a viewport doesn't.
      if (p.name !== undefined || p.icon !== undefined || p.color !== undefined) touch(id);
      return getCanvas(id);
    },

    'canvas:delete': (id) => {
      const board = String(id);
      db().prepare('DELETE FROM canvas_edges WHERE canvas_id = ?').run(board);
      db().prepare('DELETE FROM canvas_items WHERE canvas_id = ?').run(board);
      db().prepare('DELETE FROM canvases WHERE id = ?').run(board);
      return true;
    },

    'canvas:addItems': ({ canvasId, items }) => {
      if (!getCanvas(canvasId)) return [];
      const made = insertItems(canvasId, items);
      touch(canvasId);
      return hydrate(made);
    },

    /**
     * The hot path: one write for a whole drag, however many cards moved. Geometry
     * only — a move must never be able to rewrite what a card points at.
     */
    'canvas:moveItems': ({ canvasId, items }) => {
      const upd = db().prepare('UPDATE canvas_items SET x = ?, y = ?, w = ?, h = ? WHERE id = ? AND canvas_id = ?');
      for (const i of items || []) {
        upd.run(num(i.x), num(i.y), Math.max(60, num(i.w, 220)), Math.max(40, num(i.h, 140)), String(i.id), String(canvasId));
      }
      touch(canvasId);
      return true;
    },

    'canvas:patchItem': ({ id, patch }) => {
      const row = db().prepare('SELECT * FROM canvas_items WHERE id = ?').get(String(id));
      if (!row) return null;
      const p = patch || {};
      const data = p.data !== undefined ? { ...json(row.data, {}), ...p.data } : json(row.data, {});
      db().prepare('UPDATE canvas_items SET x = ?, y = ?, w = ?, h = ?, data = ? WHERE id = ?').run(
        p.x !== undefined ? num(p.x) : row.x,
        p.y !== undefined ? num(p.y) : row.y,
        p.w !== undefined ? Math.max(60, num(p.w)) : row.w,
        p.h !== undefined ? Math.max(40, num(p.h)) : row.h,
        JSON.stringify(data),
        row.id
      );
      touch(row.canvas_id);
      return hydrate([parseItem(db().prepare('SELECT * FROM canvas_items WHERE id = ?').get(row.id))])[0];
    },

    'canvas:removeItems': ({ canvasId, ids }) => {
      const list = (ids || []).map(String);
      if (!list.length) return true;
      const marks = list.map(() => '?').join(',');
      // Connectors can't outlive either end.
      db().prepare(`DELETE FROM canvas_edges WHERE from_item IN (${marks}) OR to_item IN (${marks})`).run(...list, ...list);
      db().prepare(`DELETE FROM canvas_items WHERE id IN (${marks})`).run(...list);
      touch(canvasId);
      return true;
    },

    /**
     * Raise a selection: the renderer sends the ids in the order they should
     * stack. Frames stay in negative territory however often they are raised —
     * a frame that climbed above its own contents would swallow every click
     * meant for the cards sitting on it.
     */
    'canvas:order': ({ canvasId, ids }) => {
      const board = String(canvasId);
      const upd = db().prepare('UPDATE canvas_items SET z = ? WHERE id = ? AND canvas_id = ?');
      const kindOf = db().prepare('SELECT kind FROM canvas_items WHERE id = ?');
      let z = topZ(board);
      let back = num(db().prepare('SELECT MIN(z) AS z FROM canvas_items WHERE canvas_id = ?').get(board)?.z, 0);
      for (const id of ids || []) {
        const row = kindOf.get(String(id));
        if (!row) continue;
        upd.run(row.kind === 'frame' ? --back : ++z, String(id), board);
      }
      touch(board);
      return true;
    },

    'canvas:addEdge': ({ canvasId, from, to, fromSide, toSide, label, color, data }) => {
      if (!from || !to || from === to) return null;
      // One connector per direction per pair — dragging the same link twice
      // should feel like a no-op, not stack invisible duplicates.
      const dupe = db()
        .prepare('SELECT id FROM canvas_edges WHERE canvas_id = ? AND from_item = ? AND to_item = ?')
        .get(String(canvasId), String(from), String(to));
      if (dupe) return parseEdge(db().prepare('SELECT * FROM canvas_edges WHERE id = ?').get(dupe.id));
      const id = uid();
      db().prepare(
        'INSERT INTO canvas_edges (id, canvas_id, from_item, to_item, from_side, to_side, label, color, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        id, String(canvasId), String(from), String(to), String(fromSide || 'right'), String(toSide || 'left'),
        String(label || ''), color ? String(color) : null, JSON.stringify(data || {})
      );
      touch(canvasId);
      return parseEdge(db().prepare('SELECT * FROM canvas_edges WHERE id = ?').get(id));
    },

    'canvas:patchEdge': ({ id, patch }) => {
      const row = db().prepare('SELECT * FROM canvas_edges WHERE id = ?').get(String(id));
      if (!row) return null;
      const p = patch || {};
      const data = p.data !== undefined ? { ...json(row.data, {}), ...p.data } : json(row.data, {});
      db().prepare(
        'UPDATE canvas_edges SET from_side = ?, to_side = ?, label = ?, color = ?, data = ? WHERE id = ?'
      ).run(
        p.fromSide !== undefined ? String(p.fromSide) : row.from_side,
        p.toSide !== undefined ? String(p.toSide) : row.to_side,
        p.label !== undefined ? String(p.label) : row.label,
        p.color !== undefined ? (p.color ? String(p.color) : null) : row.color,
        JSON.stringify(data),
        row.id
      );
      touch(row.canvas_id);
      return parseEdge(db().prepare('SELECT * FROM canvas_edges WHERE id = ?').get(row.id));
    },

    'canvas:removeEdge': (id) => {
      const row = db().prepare('SELECT canvas_id FROM canvas_edges WHERE id = ?').get(String(id));
      db().prepare('DELETE FROM canvas_edges WHERE id = ?').run(String(id));
      if (row) touch(row.canvas_id);
      return true;
    },

    /**
     * Swap a board's whole contents for a given set, ids and all. This is what
     * undo is built on: granular inverse operations can't restore a deleted card
     * under its original id, and every connector that pointed at it would be
     * lost with it. Only undo uses this — ordinary edits stay granular.
     */
    'canvas:replace': ({ canvasId, items, edges }) => {
      const board = String(canvasId);
      if (!getCanvas(board)) return null;
      db().exec('BEGIN');
      try {
        db().prepare('DELETE FROM canvas_edges WHERE canvas_id = ?').run(board);
        db().prepare('DELETE FROM canvas_items WHERE canvas_id = ?').run(board);
        const ins = db().prepare(
          'INSERT INTO canvas_items (id, canvas_id, kind, ref_id, x, y, w, h, z, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        for (const i of items || []) {
          if (!i?.id || !KINDS.has(i.kind)) continue;
          ins.run(
            String(i.id), board, i.kind, i.refId ? String(i.refId) : null,
            num(i.x), num(i.y), Math.max(60, num(i.w, 220)), Math.max(40, num(i.h, 140)), num(i.z),
            JSON.stringify(i.data || {}), num(i.createdAt, now())
          );
        }
        const insEdge = db().prepare(
          'INSERT INTO canvas_edges (id, canvas_id, from_item, to_item, from_side, to_side, label, color, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        const alive = new Set((items || []).map((i) => String(i?.id)));
        for (const e of edges || []) {
          if (!e?.id || !alive.has(String(e.from)) || !alive.has(String(e.to))) continue;
          insEdge.run(
            String(e.id), board, String(e.from), String(e.to),
            String(e.fromSide || 'right'), String(e.toSide || 'left'),
            String(e.label || ''), e.color ? String(e.color) : null, JSON.stringify(e.data || {})
          );
        }
        db().exec('COMMIT');
      } catch (err) {
        db().exec('ROLLBACK');
        throw err;
      }
      touch(board);
      return true;
    },

    /** Which boards an object sits on — shown alongside its backlinks. */
    'canvas:forObject': (objectId) =>
      db()
        .prepare(
          `SELECT DISTINCT c.id, c.name, c.icon, c.color FROM canvases c
             JOIN canvas_items i ON i.canvas_id = c.id
            WHERE i.kind = 'object' AND i.ref_id = ?
            ORDER BY c.updated_at DESC`
        )
        .all(String(objectId)),
  };
}

/**
 * An object deleted from the vault takes its cards with it. A card is only a
 * reference, so leaving it behind would put a tombstone on every board that ever
 * mentioned the thing — and the connectors around it would point at nothing.
 */
function forgetObject(db, objectId) {
  const items = db.prepare("SELECT id, canvas_id FROM canvas_items WHERE kind = 'object' AND ref_id = ?").all(String(objectId));
  if (!items.length) return 0;
  const ids = items.map((i) => i.id);
  const marks = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM canvas_edges WHERE from_item IN (${marks}) OR to_item IN (${marks})`).run(...ids, ...ids);
  db.prepare(`DELETE FROM canvas_items WHERE id IN (${marks})`).run(...ids);
  return ids.length;
}

module.exports = { SCHEMA, INDEXES, channels, forgetObject, KINDS, SIZES };
