// Habitat data layer — everything is an object of a type; links connect objects.
// Runs in the Electron main process on node:sqlite (no native build step).
const fs = require('fs');
const path = require('path');
const { randomBytes, randomUUID } = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const files = require('./files');
const canvas = require('./canvas');
const study = require('./study');
const recur = require('./recur');
const synclog = require('./synclog');

let db;

const now = () => Date.now();
const uid = () => randomUUID().replace(/-/g, '').slice(0, 16);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL DEFAULT '📦',
  color TEXT NOT NULL DEFAULT '#9C9C97',
  properties TEXT NOT NULL DEFAULT '[]',
  builtin INTEGER NOT NULL DEFAULT 0,
  starred INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS objects (
  id TEXT PRIMARY KEY,
  type_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  props TEXT NOT NULL DEFAULT '{}',
  content TEXT,
  date_key TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  extra_props TEXT NOT NULL DEFAULT '[]',
  search_text TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  type_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  props TEXT NOT NULL DEFAULT '{}',
  content TEXT,
  extra_props TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_objects_type ON objects(type_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_objects_daily ON objects(date_key) WHERE date_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'mention',
  prop_id TEXT,
  UNIQUE(from_id, to_id, kind)
);
CREATE TABLE IF NOT EXISTS files (
  hash TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL DEFAULT '',
  ext TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_links_to ON links(to_id);
CREATE INDEX IF NOT EXISTS idx_links_from ON links(from_id);
`;

/**
 * The properties that put an object at an hour rather than on a day. Conventional
 * ids, not a new schema: any type gains a place on the calendar's time grid by
 * having a `datetime` property, and these two are simply the ones Habitat adds to
 * Task and Meeting itself. `duration` is in minutes.
 */
const TIME_PROP = 'startsAt';
const DURATION_PROP = 'duration';
/**
 * When something finishes. A task is given a length in minutes, but an event is
 * given an end — a holiday or a flight runs to a moment, sometimes days later,
 * and "1440 minutes" is nobody's idea of a week away.
 */
const END_PROP = 'endsAt';
const DEFAULT_MINUTES = 60;

/** Where a task says which event it belongs to. */
const PART_OF_PROP = 'partOf';

/**
 * How something repeats, and what has happened to the individual days of a
 * series. `repeat` is a rule string (see recur.js) on the object itself; the
 * other two are bookkeeping the UI never shows as properties:
 *
 *   repeatDone — days of the series that have been ticked off
 *   repeatSkip — days that were moved out of the series or deleted
 *
 * Occurrences are worked out on read, so a series stays one row and editing the
 * rule changes every future occurrence at once.
 */
const REPEAT_PROP = 'repeat';
const REPEAT_DONE_PROP = 'repeatDone';
const REPEAT_SKIP_PROP = 'repeatSkip';

/** The builtin types that happen at a time, wherever they get created. */
const TIMED_TYPES = new Set(['task', 'meeting']);

/**
 * One definition of "this type carries a time", used both when a flavor seeds
 * its types and when the migration back-fills a vault that predates them.
 */
function withTimeProps(typeId, defs) {
  if (!TIMED_TYPES.has(typeId)) return defs;
  const out = [...(defs || [])];
  if (!out.some((p) => p.id === TIME_PROP)) out.push({ id: TIME_PROP, name: 'Starts', kind: 'datetime' });
  if (!out.some((p) => p.id === DURATION_PROP)) out.push({ id: DURATION_PROP, name: 'Minutes', kind: 'number' });
  if (!out.some((p) => p.id === REPEAT_PROP)) out.push({ id: REPEAT_PROP, name: 'Repeats', kind: 'repeat' });
  return out;
}

/** The rule on an object, or null when it happens once. */
const ruleOf = (obj) => recur.parseRule(obj.props[REPEAT_PROP]);

/** Days of a series the object itself no longer answers for. */
const daySet = (obj, propId) => new Set(Array.isArray(obj.props[propId]) ? obj.props[propId] : []);

/**
 * The days a scheduled object lands on inside a window: just its own, or every
 * occurrence of its series minus the ones that were moved out or deleted.
 */
function scheduledDays(obj, anchorKey, from, to) {
  const rule = ruleOf(obj);
  if (!rule) return anchorKey >= from && anchorKey <= to ? [anchorKey] : [];
  const skipped = daySet(obj, REPEAT_SKIP_PROP);
  return recur.occurrences(rule, anchorKey, from, to).filter((key) => !skipped.has(key));
}

/**
 * The property that carries an object's place on the calendar. A filled one wins, so
 * reading and moving always agree about which of several dates is "the" one; an empty
 * one is still offered, so something unscheduled can be given a time.
 */
const scheduleDef = (defs, props, kind) =>
  defs.find((p) => p.kind === kind && props[p.id]) || defs.find((p) => p.kind === kind);

/**
 * Take one day out of a series and give it its own object.
 *
 * What "move just this one", "delete just this one" and "note just this one"
 * all need: the series records that the day is no longer its to answer for,
 * and the day becomes a plain unrepeating copy that can be moved, edited or
 * deleted on its own. Ticks already made on that day come with it, so nothing
 * appears to un-finish. `opts.content` carries notes onto the new copy — the
 * series row keeps whatever it had, which is what every occurrence still
 * pointed at it goes on showing.
 */
function detachOccurrence(obj, defs, dayKey, opts = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey || '')) return null;
  const skip = daySet(obj, REPEAT_SKIP_PROP);
  if (skip.has(dayKey)) return null;
  skip.add(dayKey);

  const done = daySet(obj, REPEAT_DONE_PROP);
  const master = { ...obj.props, [REPEAT_SKIP_PROP]: [...skip].sort() };
  if (done.has(dayKey)) master[REPEAT_DONE_PROP] = [...done].filter((d) => d !== dayKey).sort();
  updateObject({ id: obj.id, patch: { props: master } });

  const props = { ...obj.props };
  delete props[REPEAT_PROP];
  delete props[REPEAT_DONE_PROP];
  delete props[REPEAT_SKIP_PROP];

  // Same clock time on its new day, whichever property carries the schedule.
  const timeDef = scheduleDef(defs, obj.props, 'datetime');
  const dayDef = scheduleDef(defs, obj.props, 'date');
  if (timeDef && obj.props[timeDef.id]) props[timeDef.id] = dayKey + String(obj.props[timeDef.id]).slice(10);
  else if (dayDef && obj.props[dayDef.id]) props[dayDef.id] = dayKey;

  const doneProp = doneDef(obj, getType(obj.typeId));
  if (doneProp && done.has(dayKey)) props[doneProp.id] = 'Done';

  return createObject({
    typeId: obj.typeId,
    title: obj.title,
    props,
    extraProps: obj.extraProps || [],
    content: opts.content !== undefined ? opts.content : null,
  });
}

/**
 * Save an edit that may belong to a single occurrence of a series.
 *
 * Notes are the one kind of edit that's about a particular day rather than
 * the whole series — moving or renaming a series still means every future
 * occurrence, but jotting something down during Tuesday's standup shouldn't
 * appear on Thursday's too. So only a `content` edit, and only while the day
 * hasn't already forked, takes this detour: the occurrence gets its own
 * object (carrying the new notes) and the series is left untouched for
 * everyone else. Anything else — including a later edit to a day that's
 * already forked — is an ordinary update.
 */
function updateObjectForOccurrence({ id, patch, occurrence }) {
  const key = String(occurrence || '').slice(0, 10);
  if (key && patch && patch.content !== undefined) {
    const row = db.prepare('SELECT * FROM objects WHERE id = ?').get(id);
    if (row) {
      const obj = parseObj(row);
      if (ruleOf(obj) && !daySet(obj, REPEAT_SKIP_PROP).has(key)) {
        const type = getType(row.type_id);
        const defs = [...(type ? type.properties : []), ...obj.extraProps];
        const detached = detachOccurrence(obj, defs, key, { content: patch.content });
        if (detached) return detached;
      }
    }
  }
  return updateObject({ id, patch });
}

/** A `datetime` property's value as a local Date, or null when it isn't one. */
function readStamp(value) {
  const raw = value == null ? '' : String(value);
  if (raw.length < 16) return null;
  const d = new Date(raw.length === 16 ? raw + ':00' : raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * For something that runs across days, midnight means "that day" rather than "at
 * 12am": nobody typing a holiday from the 15th to the 22nd is scheduling a
 * minute past twelve, and a run of days belongs in the all-day strip anyway.
 *
 * Only for runs, though. A single entry dragged to the top of the grid was put
 * at midnight deliberately, and must stay where it was dropped.
 */
const startsAllDay = (d, span) => span > 1 && !!d && d.getHours() === 0 && d.getMinutes() === 0;

/**
 * How long something runs, in minutes: an explicit length, or the gap to its
 * end, or the default. Capped at the end of its first day — a run of days is
 * drawn as a span across them, not as a single block 40 hours tall.
 */
function minutesOf(props, startsAt) {
  const explicit = Number(props[DURATION_PROP]);
  if (Number.isFinite(explicit) && explicit > 0) return Math.round(explicit);
  const ends = readStamp(props[END_PROP]);
  if (ends && startsAt && ends > startsAt) {
    const mins = Math.round((ends - startsAt) / 60000);
    const untilMidnight = 24 * 60 - (startsAt.getHours() * 60 + startsAt.getMinutes());
    return Math.min(mins, untilMidnight);
  }
  return DEFAULT_MINUTES;
}

/** Every day an object covers: one, or the whole run from its start to its end. */
function spanDays(props, firstKey) {
  const ends = readStamp(props[END_PROP]);
  if (!ends) return [firstKey];
  const lastKey = localKey(ends);
  if (lastKey <= firstKey) return [firstKey];
  const out = [];
  for (let key = firstKey; key <= lastKey && out.length < 400; key = shiftDay(key, 1)) out.push(key);
  return out;
}

/** `YYYY-MM-DDTHH:mm`, the shape the datetime properties already store. */
const stamp = (dayKey, minute) =>
  `${dayKey}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

/** A date's own day, not UTC's — 00:30 local must not land on the day before. */
const localKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** What "not done" is called for a given status property — its first other option. */
const openStatusOf = (def) => (def.options || []).find((o) => o !== 'Done') || 'Todo';

/** The property that says whether something is finished: a select offering "Done". */
const doneDef = (obj, type) =>
  [...(type ? type.properties : []), ...(obj.extraProps || [])].find(
    (p) => p.kind === 'select' && (p.options || []).includes('Done')
  );

/**
 * Finished, for any type built the way a task is: a select property offering
 * "Done". The same rule the renderer uses, so a calendar entry fades exactly
 * when its checklist row does.
 *
 * A repeating object is finished one day at a time — ticking Tuesday's must not
 * grey out the rest of the series — so with a `dayKey` the answer comes from the
 * days ticked off rather than from the shared status.
 */
function isDoneObject(obj, type, dayKey = null) {
  if (dayKey && ruleOf(obj)) return daySet(obj, REPEAT_DONE_PROP).has(dayKey);
  const def = doneDef(obj, type);
  return !!def && obj.props[def.id] === 'Done';
}

// ---------- helpers ----------

// The `emoji` column now stores an icon key (e.g. 'file-text'); exposed as `icon`.
function parseType(r) {
  return {
    id: r.id,
    name: r.name,
    icon: r.emoji,
    color: r.color,
    builtin: !!r.builtin,
    starred: !!r.starred,
    properties: JSON.parse(r.properties || '[]'),
  };
}

function docText(node, acc) {
  if (!node) return acc;
  if (typeof node.text === 'string') acc.push(node.text);
  // An attachment's filename and caption are the only text it has — index both.
  if (node.type === 'media' && node.attrs) {
    if (node.attrs.name) acc.push(String(node.attrs.name));
    if (node.attrs.caption) acc.push(String(node.attrs.caption));
  }
  if (node.type === 'mention' && node.attrs && node.attrs.label) acc.push(node.attrs.label);
  if (node.type === 'tagMention' && node.attrs && node.attrs.label) acc.push('#' + node.attrs.label);
  if (Array.isArray(node.content)) node.content.forEach((c) => docText(c, acc));
  return acc;
}

/** Flat text of a document, kept in the `search_text` column so search can look inside notes. */
function plainText(content) {
  if (!content) return '';
  try {
    const doc = typeof content === 'string' ? JSON.parse(content) : content;
    return docText(doc, []).join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

/** A window of text around the first hit, so results show why they matched. */
function matchContext(text, query, pad = 46) {
  if (!text || !query) return '';
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return '';
  const start = Math.max(0, at - pad);
  const end = Math.min(text.length, at + query.length + pad);
  return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
}

function snippet(contentStr, len = 140) {
  if (!contentStr) return '';
  try {
    const t = docText(JSON.parse(contentStr), []).join(' ').replace(/\s+/g, ' ').trim();
    return t.length > len ? t.slice(0, len) + '…' : t;
  } catch {
    return '';
  }
}

function parseObj(r, withContent = false) {
  const content = r.content || null;
  const o = {
    id: r.id,
    typeId: r.type_id,
    title: r.title ?? '',
    props: JSON.parse(r.props || '{}'),
    extraProps: JSON.parse(r.extra_props || '[]'),
    dateKey: r.date_key || null,
    pinned: !!r.pinned,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    snippet: snippet(content),
  };
  if (withContent) o.content = content ? JSON.parse(content) : null;
  return o;
}

function parseTemplate(r, withContent = false) {
  const content = r.content || null;
  const t = {
    id: r.id,
    typeId: r.type_id,
    name: r.name ?? '',
    props: JSON.parse(r.props || '{}'),
    extraProps: JSON.parse(r.extra_props || '[]'),
    createdAt: r.created_at,
  };
  if (withContent) t.content = content ? JSON.parse(content) : null;
  return t;
}

function getType(id) {
  const r = db.prepare('SELECT * FROM types WHERE id = ?').get(id);
  return r ? parseType(r) : null;
}

function getObj(id, withContent = false) {
  const r = db.prepare('SELECT * FROM objects WHERE id = ?').get(id);
  return r ? parseObj(r, withContent) : null;
}

// Both @-mentions and #-tags are stored as mention-style nodes pointing at an
// object id, so they produce the same links and backlinks.
function collectMentionIds(node, out) {
  if (!node) return out;
  const isMention = node.type === 'mention' || node.type === 'tagMention';
  if (isMention && node.attrs && node.attrs.id) out.add(String(node.attrs.id));
  if (Array.isArray(node.content)) node.content.forEach((c) => collectMentionIds(c, out));
  return out;
}

/**
 * Remove every mention/tag node pointing at `targetId` from a document, in place.
 * Returns whether anything changed.
 */
function stripMentionNodes(node, targetId) {
  if (!node || !Array.isArray(node.content)) return false;
  let changed = false;
  const kept = node.content.filter((c) => {
    const isMention = c && (c.type === 'mention' || c.type === 'tagMention');
    if (isMention && c.attrs && String(c.attrs.id) === String(targetId)) {
      changed = true;
      return false;
    }
    return true;
  });
  node.content = kept;
  for (const c of kept) if (stripMentionNodes(c, targetId)) changed = true;
  return changed;
}

function syncMentionLinks(id, contentJson) {
  db.prepare("DELETE FROM links WHERE from_id = ? AND kind = 'mention'").run(id);
  if (!contentJson) return;
  const ids = collectMentionIds(contentJson, new Set());
  const ins = db.prepare("INSERT OR IGNORE INTO links (id, from_id, to_id, kind) VALUES (?, ?, ?, 'mention')");
  for (const to of ids) if (to !== id) ins.run(uid(), id, to);
}

function syncRelationLinks(id, typeId, props, extraProps = []) {
  db.prepare("DELETE FROM links WHERE from_id = ? AND kind = 'relation'").run(id);
  const type = getType(typeId);
  const defs = [...(type ? type.properties : []), ...extraProps];
  const ins = db.prepare("INSERT OR IGNORE INTO links (id, from_id, to_id, kind, prop_id) VALUES (?, ?, ?, 'relation', ?)");
  for (const p of defs) {
    if (p.kind !== 'relation') continue;
    const v = props[p.id];
    if (Array.isArray(v)) for (const to of v) if (to && to !== id) ins.run(uid(), id, to, p.id);
  }
}

// ---------- search index ----------
//
// An FTS5 index over the text worth searching, kept in step by triggers rather
// than by every write site remembering to update it. Three columns so the
// ranking can care more about a name than a passing mention in a note body,
// and so a person still turns up by nickname.

const FTS_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS objects_fts USING fts5(
  title, body, alias,
  tokenize = 'unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS objects_fts_insert AFTER INSERT ON objects BEGIN
  INSERT INTO objects_fts (rowid, title, body, alias)
  VALUES (
    new.rowid, new.title, new.search_text,
    CASE WHEN json_valid(new.props) THEN COALESCE(json_extract(new.props, '$.nickname'), '') ELSE '' END
  );
END;
CREATE TRIGGER IF NOT EXISTS objects_fts_delete AFTER DELETE ON objects BEGIN
  DELETE FROM objects_fts WHERE rowid = old.rowid;
END;
CREATE TRIGGER IF NOT EXISTS objects_fts_update AFTER UPDATE OF title, search_text, props ON objects BEGIN
  DELETE FROM objects_fts WHERE rowid = old.rowid;
  INSERT INTO objects_fts (rowid, title, body, alias)
  VALUES (
    new.rowid, new.title, new.search_text,
    CASE WHEN json_valid(new.props) THEN COALESCE(json_extract(new.props, '$.nickname'), '') ELSE '' END
  );
END;
`;

/**
 * Create the index if it's missing, and rebuild it whenever it doesn't line up
 * with the objects table — which covers both the first run on an existing vault
 * and any drift from a file edited outside the app.
 */
function ensureSearchIndex() {
  db.exec(FTS_SCHEMA);
  const indexed = db.prepare('SELECT COUNT(*) AS c FROM objects_fts').get().c;
  const total = db.prepare('SELECT COUNT(*) AS c FROM objects').get().c;
  if (indexed !== total) rebuildSearchIndex();
}

function rebuildSearchIndex() {
  db.exec(`
    DELETE FROM objects_fts;
    INSERT INTO objects_fts (rowid, title, body, alias)
    SELECT rowid, title, search_text,
      CASE WHEN json_valid(props) THEN COALESCE(json_extract(props, '$.nickname'), '') ELSE '' END
    FROM objects;
  `);
  return db.prepare('SELECT COUNT(*) AS c FROM objects_fts').get().c;
}

/** Every property across every type that holds a date — due dates, start times, finished-on. */
function dateProperties() {
  return db
    .prepare('SELECT properties FROM types')
    .all()
    .flatMap((t) => {
      try {
        return JSON.parse(t.properties || '[]');
      } catch {
        return [];
      }
    })
    .filter((p) => p.kind === 'date' || p.kind === 'datetime')
    .map((p) => p.id);
}

const typeNameMap = () => new Map(db.prepare('SELECT id, name FROM types').all().map((t) => [t.id, t.name]));

/**
 * The shape the on-device model is fed: what a thing is, when it is, and its
 * flattened text.
 *
 * `props` is summarised into a line rather than handed over as JSON, because
 * "due: 2026-08-08 · status: To do" is something a small model can read and
 * `{"due":"2026-08-08","status":"To do"}` is something it tends to quote back.
 */
function asContext(row, typeNames) {
  let detail = '';
  try {
    const props = JSON.parse(row.props || '{}');
    detail = Object.entries(props)
      .filter(([, v]) => v !== '' && v !== null && v !== undefined && !Array.isArray(v))
      .slice(0, 6)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ');
  } catch {
    /* a note with unreadable props still has its text */
  }
  return {
    id: row.id,
    typeId: row.type_id,
    typeName: typeNames.get(row.type_id) || row.type_id,
    title: row.title || '',
    dateKey: row.date_key || null,
    detail,
    text: row.search_text || '',
  };
}

/** Operators the query bar understands, e.g. `type:task tag:habitat due:week`. */
const OPERATORS = new Set(['type', 'tag', 'is', 'due', 'created', 'edited']);

/** Splits `type:task coffee shop` into its operators and the words left over. */
function parseQuery(raw) {
  const filters = {};
  const words = [];
  for (const part of String(raw || '').trim().split(/\s+/)) {
    if (!part) continue;
    const m = part.match(/^(\w+):(.+)$/);
    if (m && OPERATORS.has(m[1].toLowerCase())) filters[m[1].toLowerCase()] = m[2].toLowerCase();
    else words.push(part);
  }
  return { words, filters };
}

/**
 * A MATCH expression from free text. Every word is quoted so punctuation can't
 * be read as FTS syntax, and the last one matches as a prefix so results narrow
 * while you're still typing.
 */
function ftsExpr(words, titleOnly) {
  const terms = words
    .join(' ')
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean);
  if (!terms.length) return null;
  const expr = terms.map((t, i) => `"${t}"${i === terms.length - 1 ? '*' : ''}`).join(' ');
  return titleOnly ? `{title alias} : (${expr})` : expr;
}

/**
 * Result rows never select `content`. The preview a result needs is already
 * flattened into search_text, so there's no reason to parse a whole document
 * per hit — that, not the matching, was the slow part of the old search.
 */
const SEARCH_COLUMNS = `o.id, o.type_id, o.title, o.props, o.extra_props, o.date_key, o.pinned,
  o.created_at, o.updated_at, substr(o.search_text, 1, 160) AS preview`;

function parseSearchRow(r) {
  const preview = (r.preview || '').trim();
  return {
    id: r.id,
    typeId: r.type_id,
    title: r.title ?? '',
    props: JSON.parse(r.props || '{}'),
    extraProps: JSON.parse(r.extra_props || '[]'),
    dateKey: r.date_key || null,
    pinned: !!r.pinned,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    snippet: preview.length > 140 ? preview.slice(0, 140) + '…' : preview,
  };
}

const dayStart = (key) => new Date(key + 'T00:00:00').getTime();
const dayEnd = (key) => new Date(key + 'T23:59:59.999').getTime();

/** `created:`/`edited:` look backwards from today. */
function pastWindow(v) {
  const t = todayKey();
  if (v === 'today') return [t, t];
  if (v === 'yesterday') return [shiftDay(t, -1), shiftDay(t, -1)];
  if (v === 'week') return [shiftDay(t, -7), t];
  if (v === 'month') return [shiftDay(t, -30), t];
  return null;
}

/** `due:` looks forwards, except `overdue`. */
function dueWindow(v) {
  const t = todayKey();
  if (v === 'today') return [t, t];
  if (v === 'tomorrow') return [shiftDay(t, 1), shiftDay(t, 1)];
  if (v === 'week') return [t, shiftDay(t, 7)];
  if (v === 'month') return [t, shiftDay(t, 30)];
  if (v === 'overdue') return ['0001-01-01', shiftDay(t, -1)];
  return null;
}

const singular = (v) => String(v).replace(/s$/, '');

function resolveType(value) {
  const types = db.prepare('SELECT id, name FROM types').all();
  const want = String(value).toLowerCase();
  return (
    types.find((t) => t.id.toLowerCase() === want) ||
    types.find((t) => t.name.toLowerCase() === want) ||
    types.find((t) => singular(t.name.toLowerCase()) === singular(want))
  );
}

function resolveTag(value) {
  const want = String(value).replace(/^#/, '').toLowerCase();
  return db
    .prepare("SELECT id, title FROM objects WHERE type_id = 'tag'")
    .all()
    .find((t) => String(t.title).toLowerCase() === want);
}

/**
 * Search, as one indexed query. Operators become SQL filters; the free text
 * goes to FTS5, which ranks by bm25 with the title weighted well above the
 * body, and hands back the snippet around the hit.
 */
function searchObjects({ q, content = false, limit = 0 }) {
  const { words, filters } = parseQuery(q);
  const cap = limit > 0 ? limit : content ? 40 : 20;
  const where = [];
  const params = [];

  if (filters.type) {
    const type = resolveType(filters.type);
    if (!type) return [];
    where.push('o.type_id = ?');
    params.push(type.id);
  }
  if (filters.tag) {
    const tag = resolveTag(filters.tag);
    if (!tag) return [];
    where.push('o.id IN (SELECT from_id FROM links WHERE to_id = ?)');
    params.push(tag.id);
  }
  if (filters.is === 'pinned') where.push('o.pinned = 1');
  for (const [key, column] of [
    ['created', 'created_at'],
    ['edited', 'updated_at'],
  ]) {
    if (!filters[key]) continue;
    const win = pastWindow(filters[key]);
    if (!win) return [];
    where.push(`o.${column} BETWEEN ? AND ?`);
    params.push(dayStart(win[0]), dayEnd(win[1]));
  }
  if (filters.due) {
    const win = dueWindow(filters.due);
    if (!win) return [];
    // Date values live inside the props JSON under a per-type property id, so
    // match against whichever of them looks like the date being asked about.
    const dateProps = db
      .prepare('SELECT properties FROM types')
      .all()
      .flatMap((t) => {
        try {
          return JSON.parse(t.properties || '[]');
        } catch {
          return [];
        }
      })
      .filter((p) => p.kind === 'date' || p.kind === 'datetime')
      .map((p) => p.id);
    if (!dateProps.length) return [];
    where.push(
      `EXISTS (SELECT 1 FROM json_each(o.props) WHERE json_each.key IN (${dateProps.map(() => '?').join(',')})
         AND json_each.value >= ? AND json_each.value <= ?)`
    );
    params.push(...dateProps, win[0], win[1]);
  }

  const expr = ftsExpr(words, !content);
  const clause = where.length ? ' AND ' + where.join(' AND ') : '';

  // Operators on their own still need an answer, and there's nothing to rank by.
  if (!expr) {
    const sql = `SELECT ${SEARCH_COLUMNS} FROM objects o ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY o.updated_at DESC LIMIT ?`;
    return db
      .prepare(sql)
      .all(...params, cap)
      .map(parseSearchRow);
  }

  // Two things this query is fussy about, both worth a comment because getting
  // either wrong is quiet rather than loud:
  //  - MATCH and the auxiliary functions want the table's own name, not an alias.
  //  - CROSS JOIN pins the index as the outer loop. With a plain JOIN and any
  //    filter, SQLite drives from `objects` instead and re-runs the match per
  //    row — same results, roughly three hundred times slower.
  const rows = db
    .prepare(
      `SELECT ${SEARCH_COLUMNS}, snippet(objects_fts, 1, '', '', '…', 12) AS hit
         FROM objects_fts CROSS JOIN objects o ON o.rowid = objects_fts.rowid
        WHERE objects_fts MATCH ?${clause}
        ORDER BY bm25(objects_fts, 12.0, 1.0, 8.0)
        LIMIT ?`
    )
    .all(expr, ...params, cap);

  return rows.map((r) => {
    const o = parseSearchRow(r);
    // Only content searches promised the surrounding text; a body-less hit has none.
    if (content && r.hit && !String(r.title || '').toLowerCase().includes(String(words.join(' ')).toLowerCase())) o.match = r.hit;
    return o;
  });
}

/** Every attachment hash still pointed at, from note bodies and from properties alike. */
function referencedHashes() {
  const used = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'media' && node.attrs?.hash) used.add(String(node.attrs.hash));
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  for (const r of db.prepare('SELECT content, props FROM objects').all()) {
    if (r.content) {
      try {
        walk(JSON.parse(r.content));
      } catch {
        /* unreadable content can't be proved to reference anything */
      }
    }
    if (!r.props || !r.props.includes('hash')) continue;
    try {
      // File properties hold a list of refs; anything shaped like one counts.
      for (const value of Object.values(JSON.parse(r.props))) {
        for (const ref of Array.isArray(value) ? value : [value]) {
          if (ref && typeof ref === 'object' && ref.hash) used.add(String(ref.hash));
        }
      }
    } catch {
      /* same */
    }
  }
  // Templates can carry attachments too, and outlive the objects made from them.
  for (const r of db.prepare('SELECT content FROM templates WHERE content IS NOT NULL').all()) {
    try {
      walk(JSON.parse(r.content));
    } catch {
      /* ignore */
    }
  }
  return used;
}

// ---------- core operations ----------


// ---------- habitat code ----------

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const pickChars = (n) =>
  Array.from(randomBytes(n))
    .map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
    .join('');

/** HAB-XXXX-XXXX — a stable id for this file, unambiguous enough to read aloud. */
function makeHabitatCode() {
  return `HAB-${pickChars(4)}-${pickChars(4)}`;
}

/** Six characters, no lookalikes — short enough to thumb into Telegram. */
function makePairCode() {
  return pickChars(6);
}

// ---------- automations ----------
//
// A rule is: trigger → optional conditions → a list of actions. Object events
// fire from createObject/updateObject/deleteObject, timed ones from the minute
// tick the main process sends. Runs are depth-capped so a rule that writes an
// object can't set itself off forever.

let automationDepth = 0;
let notifier = null;
let telegramSender = null;

/** main.js hands us a way to raise a system notification. */
function setNotifier(fn) {
  notifier = fn;
}

/** …and a way to message the user's Telegram chat. */
function setTelegramSender(fn) {
  telegramSender = fn;
}

function loadAutomations() {
  const r = db.prepare("SELECT value FROM kv WHERE key = 'automations'").get();
  if (!r) return [];
  try {
    const list = JSON.parse(r.value);
    if (!Array.isArray(list)) return [];
    // Rules used to hold a single `action`; keep those working.
    return list.map((rule) => ({
      conditions: [],
      ...rule,
      actions: Array.isArray(rule.actions) ? rule.actions : rule.action ? [rule.action] : [],
    }));
  } catch {
    return [];
  }
}

function saveAutomations(list) {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    'automations', JSON.stringify(list)
  );
}

const pad2 = (n) => String(n).padStart(2, '0');
const todayKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function shiftDay(key, days) {
  const d = new Date(key + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return todayKey(d);
}

/** A readable bullet list of what a scoped rule matched, for notification text. */
function listText(matches, limit = 10) {
  const shown = matches.slice(0, limit).map((o) => '• ' + (o.title || 'Untitled'));
  const rest = matches.length - shown.length;
  return shown.concat(rest > 0 ? [`• …and ${rest} more`] : []).join('\n');
}

/**
 * Tokens usable in any action text: object fields plus a few dates. `ctx.matches`
 * is present for rules that look at a whole set of objects at once, and is what
 * makes {{count}} and {{list}} work.
 */
function fillTemplate(text, obj, ctx) {
  return String(text ?? '').replace(/{{\s*([\w:+-]+)\s*}}/g, (_m, key) => {
    if (key === 'date' || key === 'today') return todayKey();
    if (key === 'count') return String(ctx?.matches?.length ?? 0);
    if (key === 'list') return listText(ctx?.matches ?? []);
    if (key.startsWith('list:')) return listText(ctx?.matches ?? [], Number(key.slice(5)) || 10);
    if (key === 'tomorrow') return shiftDay(todayKey(), 1);
    if (key === 'yesterday') return shiftDay(todayKey(), -1);
    if (key === 'now') return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (key.startsWith('date+')) return shiftDay(todayKey(), Number(key.slice(5)) || 0);
    if (!obj) return '';
    if (key === 'title') return obj.title || 'Untitled';
    if (key === 'type') return obj.typeId || '';
    if (key === 'id') return obj.id || '';
    // Handy in birthday rules: "{{title}} turns {{turning}} today".
    if (key === 'turning' || key === 'age') {
      const b = birthdayInfo(obj.props?.birthday);
      const n = b ? b[key] : null;
      return n == null ? '' : String(n);
    }
    if (key.startsWith('prop:')) {
      const v = obj.props?.[key.slice(5)];
      return v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v);
    }
    return '';
  });
}

/** Dates reach us as 'YYYY-MM-DD' from properties and as epoch millis from timestamps. */
function asDayKey(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return todayKey(new Date(v));
  return String(v).slice(0, 10);
}

/** Values arrive as strings from the UI; coerce for the comparison being asked for. */
function compare(op, actual, expected) {
  const a = Array.isArray(actual) ? actual.join(', ') : actual;
  const empty = a == null || a === '' || (Array.isArray(actual) && actual.length === 0);
  if (op === 'empty') return empty;
  if (op === 'notEmpty') return !empty;

  // Relative-date comparisons — "edited in the last 7 days", and its negation,
  // which is the only way to say "nobody has touched this in a while".
  if (op === 'inLast' || op === 'notInLast') {
    const key = asDayKey(actual);
    const days = Math.abs(Number(expected) || 0);
    const within = !!key && key >= shiftDay(todayKey(), -days) && key <= todayKey();
    return op === 'inLast' ? within : !within;
  }
  if (op === 'before' || op === 'after') {
    const key = asDayKey(actual);
    const want = asDayKey(fillTemplate(expected, null));
    if (!key || !want) return false;
    return op === 'before' ? key < want : key > want;
  }

  const want = fillTemplate(expected, null);
  const as = String(a ?? '').toLowerCase();
  const ws = String(want ?? '').toLowerCase();
  if (op === 'eq') return as === ws;
  if (op === 'ne') return as !== ws;
  if (op === 'contains') return as.includes(ws);
  if (op === 'gt' || op === 'lt') {
    const an = Number(a);
    const wn = Number(want);
    if (!Number.isNaN(an) && !Number.isNaN(wn)) return op === 'gt' ? an > wn : an < wn;
    return op === 'gt' ? as > ws : as < ws;
  }
  return false;
}

/** Conditions read a property, or one of the three fields every object has. */
function conditionValue(obj, propId) {
  if (propId === '__title') return obj.title;
  if (propId === '__created') return obj.createdAt;
  if (propId === '__updated') return obj.updatedAt;
  return obj.props?.[propId];
}

function conditionsPass(rule, obj) {
  const list = rule.conditions || [];
  if (!list.length) return true;
  if (!obj) return false;
  const check = (c) => compare(c.op || 'eq', conditionValue(obj, c.propId), c.value);
  return rule.match === 'any' ? list.some(check) : list.every(check);
}

/** The objects a scheduled rule is about: everything of its type that its conditions accept. */
function matchesForRule(rule) {
  const typeId = rule.trigger?.typeId;
  if (!typeId) return [];
  return db
    .prepare('SELECT * FROM objects WHERE type_id = ? ORDER BY updated_at')
    .all(typeId)
    .map((r) => parseObj(r))
    .filter((o) => conditionsPass(rule, o));
}

/**
 * Turns action text into inline nodes. `{{link}}` becomes a real mention of the
 * object that set the rule off, so the daily note links to it (and backlinks
 * work) instead of just naming it.
 */
function renderInline(text, obj, ctx) {
  const raw = String(text ?? '');
  const nodes = [];
  const push = (t) => {
    const filled = fillTemplate(t, obj, ctx);
    if (filled) nodes.push({ type: 'text', text: filled });
  };
  let rest = raw;
  const token = /{{\s*link\s*}}/;
  let m;
  while ((m = token.exec(rest))) {
    push(rest.slice(0, m.index));
    if (obj) nodes.push({ type: 'mention', attrs: { id: obj.id, label: obj.title || 'Untitled' } });
    rest = rest.slice(m.index + m[0].length);
  }
  push(rest);
  return nodes;
}

/** Appends blocks to a daily note (today's by default), creating it if needed. */
function appendBlocksToDaily(blocks, dateKey) {
  const key = dateKey || todayKey();
  const row = db.prepare("SELECT * FROM objects WHERE type_id = 'daily' AND date_key = ?").get(key);
  if (!row)
    return createObject({ typeId: 'daily', title: formatDateKey(key), dateKey: key, content: { type: 'doc', content: blocks } });
  const doc = row.content ? JSON.parse(row.content) : { type: 'doc', content: [] };
  doc.content = [...(doc.content || []), ...blocks];
  return updateObject({ id: row.id, patch: { content: doc } });
}

/** Appends one paragraph to a daily note. */
function appendToDaily(nodes, dateKey) {
  return appendBlocksToDaily([{ type: 'paragraph', content: nodes.length ? nodes : [] }], dateKey);
}

/**
 * A line followed by a real bullet list of the objects a rule matched — mentions,
 * not bare names, so the daily note links to each one and backlinks work.
 */
function appendListToDaily(nodes, matches, dateKey) {
  const blocks = [{ type: 'paragraph', content: nodes.length ? nodes : [] }];
  if (matches.length)
    blocks.push({
      type: 'bulletList',
      content: matches.map((o) => ({
        type: 'listItem',
        content: [
          { type: 'paragraph', content: [{ type: 'mention', attrs: { id: o.id, label: o.title || 'Untitled' } }] },
        ],
      })),
    });
  return appendBlocksToDaily(blocks, dateKey);
}

function ensureTag(name) {
  const title = String(name || '').trim().replace(/^#+/, '');
  if (!title) return null;
  ensureTagType();
  const existing = db
    .prepare("SELECT * FROM objects WHERE type_id = 'tag'")
    .all()
    .map((r) => parseObj(r))
    .find((t) => t.title.toLowerCase() === title.toLowerCase());
  return existing || createObject({ typeId: 'tag', title });
}

function runAction(action, obj, ctx) {
  if (!action || !action.kind) return;

  if (action.kind === 'setProp') {
    if (!obj || !action.propId) return;
    const raw = fillTemplate(action.value, obj, ctx);
    const value = raw === '' ? null : raw === 'true' ? true : raw === 'false' ? false : raw;
    updateObject({ id: obj.id, patch: { props: { ...obj.props, [action.propId]: value } } });
    return;
  }

  if (action.kind === 'createObject') {
    if (!action.typeId) return;
    const defs = getType(action.typeId)?.properties ?? [];
    const props = {};
    for (const p of action.props || []) {
      if (!p.propId) continue;
      const value = fillTemplate(p.value, obj, ctx);
      // Relations hold a list of ids — '{{id}}' points the new object back at this one.
      props[p.propId] = defs.find((d) => d.id === p.propId)?.kind === 'relation' ? (value ? [value] : []) : value;
    }
    const made = createObject({ typeId: action.typeId, title: fillTemplate(action.text || '{{title}}', obj, ctx), props });
    // A note-shaped type gets the source mentioned in its body, so it links both ways.
    if (made && obj && action.mention) {
      updateObject({
        id: made.id,
        patch: { content: { type: 'doc', content: [{ type: 'paragraph', content: renderInline('From {{link}}', obj) }] } },
      });
    }
    return;
  }

  if (action.kind === 'appendDaily') {
    const nodes = renderInline(action.text || '{{link}}', obj, ctx);
    // A rule about a whole set writes the set out as links underneath the line.
    if (ctx?.matches) appendListToDaily(nodes, ctx.matches);
    else appendToDaily(nodes);
    return;
  }

  if (action.kind === 'addTag') {
    const tag = ensureTag(fillTemplate(action.text, obj, ctx));
    if (!tag || !obj) return;
    db.prepare('INSERT OR IGNORE INTO links (id, from_id, to_id, kind) VALUES (?, ?, ?, ?)').run(
      uid(), obj.id, tag.id, 'mention'
    );
    return;
  }

  if (action.kind === 'link') {
    // Point a relation property at whatever object the rule names, by title.
    if (!obj || !action.propId) return;
    const wanted = fillTemplate(action.text, obj, ctx).toLowerCase();
    const target = db
      .prepare('SELECT * FROM objects WHERE type_id = ?')
      .all(action.typeId || obj.typeId)
      .map((r) => parseObj(r))
      .find((o) => o.title.toLowerCase() === wanted);
    if (!target) return;
    const cur = obj.props?.[action.propId];
    const next = Array.isArray(cur) ? [...new Set([...cur, target.id])] : [target.id];
    updateObject({ id: obj.id, patch: { props: { ...obj.props, [action.propId]: next } } });
    return;
  }

  if (action.kind === 'pin') {
    if (obj) updateObject({ id: obj.id, patch: { pinned: action.value !== 'false' } });
    return;
  }

  if (action.kind === 'notify' && notifier) {
    notifier(fillTemplate(action.text || '{{title}}', obj, ctx), fillTemplate(action.value || '', obj, ctx));
    return;
  }

  if (action.kind === 'telegram' && telegramSender) {
    telegramSender([fillTemplate(action.text || '{{title}}', obj, ctx), fillTemplate(action.value || '', obj, ctx)]
      .filter(Boolean)
      .join('\n'));
  }
}

function matchesTrigger(rule, event, obj, prevProps) {
  const t = rule.trigger || {};
  if (t.kind !== event) return false;
  if (t.typeId && obj && obj.typeId !== t.typeId) return false;
  if (event === 'propSet') {
    if (!t.propId) return false;
    const next = obj?.props?.[t.propId];
    const was = prevProps ? prevProps[t.propId] : undefined;
    const hit = t.value ? compare(t.op || 'eq', next, t.value) : next != null && next !== '';
    // Only on the transition, so re-saving an unchanged object stays quiet.
    return hit && JSON.stringify(was ?? null) !== JSON.stringify(next ?? null);
  }
  return true;
}

function markRun(ruleId) {
  const list = loadAutomations();
  const rule = list.find((r) => r.id === ruleId);
  if (!rule) return;
  rule.lastRun = todayKey();
  rule.lastRunAt = now();
  rule.runs = (rule.runs || 0) + 1;
  saveAutomations(list);
}

/** `event` is 'created' | 'updated' | 'propSet' | 'deleted'. */
function runAutomations(event, obj, prevProps) {
  if (!obj || automationDepth > 2) return;
  const rules = loadAutomations().filter((r) => r.enabled !== false);
  if (!rules.length) return;
  automationDepth++;
  try {
    for (const rule of rules) {
      if (!matchesTrigger(rule, event, obj, prevProps)) continue;
      if (!conditionsPass(rule, obj)) continue;
      let fired = false;
      for (const action of rule.actions || []) {
        try {
          runAction(action, obj);
          fired = true;
        } catch (err) {
          console.error('automation failed', rule.name, err);
        }
      }
      if (fired) markRun(rule.id);
    }
  } finally {
    automationDepth--;
  }
}

/**
 * Timed rules: 'daily' at a time, 'weekly' on chosen days, 'dueToday' on a date
 * property, 'birthday' on a person's.
 *
 * A scheduled rule can also be pointed at a type ("look at Tasks where…"). It
 * then either runs its actions once with the whole matching set in hand — that's
 * what {{count}} and {{list}} report on — or once per matching object. With
 * nothing matching it stays quiet rather than announcing an empty list.
 */
function runTimedRule(rule) {
  const kind = rule.trigger?.kind;

  if ((kind === 'daily' || kind === 'weekly' || kind === 'appStart') && rule.trigger.typeId) {
    const matches = matchesForRule(rule);
    if (!matches.length) return 0;
    if (rule.trigger.each) {
      for (const obj of matches) for (const action of rule.actions || []) runAction(action, obj);
      return matches.length;
    }
    for (const action of rule.actions || []) runAction(action, null, { matches });
    return matches.length;
  }

  if (kind === 'birthday') {
    // `offset` is how many days ahead to look, so 0 is the day itself and 7 is a week's notice.
    const lead = Math.abs(Number(rule.trigger.offset) || 0);
    let n = 0;
    for (const p of listPeople()) {
      if (!p.nextBirthday || p.nextBirthday.days !== lead) continue;
      if (!conditionsPass(rule, p)) continue;
      for (const action of rule.actions || []) runAction(action, p);
      n++;
    }
    return n;
  }
  if (rule.trigger?.kind !== 'dueToday') {
    for (const action of rule.actions || []) runAction(action, null);
    return 1;
  }
  const key = shiftDay(todayKey(), Number(rule.trigger.offset) || 0);
  const rows = db
    .prepare('SELECT * FROM objects WHERE type_id = ?')
    .all(rule.trigger.typeId || '')
    .map((r) => parseObj(r));
  let n = 0;
  for (const obj of rows) {
    if (String(obj.props?.[rule.trigger.propId] ?? '') !== key) continue;
    if (!conditionsPass(rule, obj)) continue;
    for (const action of rule.actions || []) runAction(action, obj);
    n++;
  }
  return n;
}

function createObject({ typeId, title = '', props = {}, content = null, dateKey = null, pinned = false, extraProps = [] }) {
  const id = uid();
  const t = now();
  db.prepare(
    'INSERT INTO objects (id, type_id, title, props, content, date_key, pinned, extra_props, search_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id, typeId, String(title), JSON.stringify(props), content ? JSON.stringify(content) : null,
    dateKey, pinned ? 1 : 0, JSON.stringify(extraProps), plainText(content), t, t
  );
  syncRelationLinks(id, typeId, props, extraProps);
  if (content) syncMentionLinks(id, content);
  const made = getObj(id, true);
  runAutomations('created', made);
  return made;
}

function updateObject({ id, patch }) {
  const cur = db.prepare('SELECT * FROM objects WHERE id = ?').get(id);
  if (!cur) return null;
  if (patch.title !== undefined) db.prepare('UPDATE objects SET title = ? WHERE id = ?').run(String(patch.title), id);
  if (patch.pinned !== undefined) db.prepare('UPDATE objects SET pinned = ? WHERE id = ?').run(patch.pinned ? 1 : 0, id);
  if (patch.props !== undefined && cur.type_id === 'task') {
    // Stamp completion time on the Todo→Done transition, clear it when reopened.
    const prev = JSON.parse(cur.props || '{}');
    if (patch.props.status === 'Done' && prev.status !== 'Done') patch.props.completedAt = now();
    else if (patch.props.status !== 'Done') delete patch.props.completedAt;
  }
  if (patch.props !== undefined && cur.type_id === PEOPLE_TYPE && id === selfId()) {
    // The self card is its own entity: nothing that describes a link to someone
    // else sticks to it, whoever writes it — the app, the HTTP API or an agent.
    for (const p of SELF_HIDDEN_PROPS) delete patch.props[p];
  }
  if (patch.props !== undefined) db.prepare('UPDATE objects SET props = ? WHERE id = ?').run(JSON.stringify(patch.props), id);
  if (patch.extraProps !== undefined)
    db.prepare('UPDATE objects SET extra_props = ? WHERE id = ?').run(JSON.stringify(patch.extraProps), id);
  if (patch.props !== undefined || patch.extraProps !== undefined) {
    const props = patch.props !== undefined ? patch.props : JSON.parse(cur.props || '{}');
    const extra = patch.extraProps !== undefined ? patch.extraProps : JSON.parse(cur.extra_props || '[]');
    syncRelationLinks(id, cur.type_id, props, extra);
  }
  if (patch.content !== undefined) {
    db.prepare('UPDATE objects SET content = ?, search_text = ? WHERE id = ?').run(
      patch.content ? JSON.stringify(patch.content) : null,
      plainText(patch.content),
      id
    );
    syncMentionLinks(id, patch.content || null);
  }
  db.prepare('UPDATE objects SET updated_at = ? WHERE id = ?').run(now(), id);
  const saved = getObj(id, true);
  const before = JSON.parse(cur.props || '{}');
  runAutomations('updated', saved, before);
  if (patch.props !== undefined) runAutomations('propSet', saved, before);
  return saved;
}

/**
 * Daily notes, tags and people are not interchangeable with ordinary types: a
 * daily note is keyed by its date, a tag is only a label, and a person backs the
 * address book and the self card. Moving one in or out would leave the feature
 * that owns it holding an object it can't render.
 */
const fixedType = (id) => id === 'daily' || id === 'tag' || id === PEOPLE_TYPE;

/**
 * Move an object to a different type.
 *
 * Values whose property the new type also defines carry over untouched. The rest
 * would otherwise vanish — the type no longer describes them — so their
 * definitions ride along as the object's own extra properties, which is exactly
 * what extra_props is for. Nothing entered is lost, and moving back restores the
 * original layout.
 */
function setObjectType({ id, typeId }) {
  const cur = db.prepare('SELECT * FROM objects WHERE id = ?').get(id);
  if (!cur) return { error: 'not-found' };
  if (cur.type_id === typeId) return getObj(id, true);
  if (!getType(typeId)) return { error: 'unknown-type' };
  if (fixedType(cur.type_id) || fixedType(typeId)) return { error: 'fixed-type' };

  const target = getType(typeId);
  const from = getType(cur.type_id);
  const props = JSON.parse(cur.props || '{}');
  const extra = JSON.parse(cur.extra_props || '[]');
  const defined = new Set(target.properties.map((p) => p.id));
  const already = new Set(extra.map((p) => p.id));

  const filled = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);
  const carried = [...extra];
  for (const def of from ? from.properties : []) {
    if (defined.has(def.id) || already.has(def.id)) continue;
    if (filled(props[def.id])) carried.push(def);
  }
  // An extra property the new type defines itself would otherwise render twice.
  const kept = carried.filter((p) => !defined.has(p.id));

  db.prepare('UPDATE objects SET type_id = ?, extra_props = ?, updated_at = ? WHERE id = ?').run(
    typeId,
    JSON.stringify(kept),
    now(),
    id
  );
  // Relation targets are read off the type's definitions, so they must be
  // rebuilt against the new type or backlinks keep pointing through old props.
  syncRelationLinks(id, typeId, props, kept);
  const saved = getObj(id, true);
  runAutomations('updated', saved, props);
  return saved;
}

function deleteObject(id) {
  const gone = getObj(id);
  db.prepare('DELETE FROM links WHERE from_id = ? OR to_id = ?').run(id, id);
  canvas.forgetObject(db, id);
  study.forgetObject(db, id);
  db.prepare('DELETE FROM objects WHERE id = ?').run(id);
  if (gone) runAutomations('deleted', gone);
  return true;
}

/**
 * The short form a board card shows: enough to draw it without loading a whole
 * note's document into every tile. `null` when the object is gone, which is how
 * a card that outlived its target says so.
 */
function objectCard(id) {
  // With content, because a card large enough to read gets the note's text.
  const obj = getObj(id, true);
  if (!obj) return null;
  const type = getType(obj.typeId);
  const defs = [...(type ? type.properties : []), ...(obj.extraProps || [])];

  /**
   * Filled properties, already flattened to text. A board card decides how many
   * of these it has room for, so they arrive in the order the type defines them
   * and the empty ones are dropped here rather than being counted and skipped in
   * the renderer.
   */
  const props = defs
    .map((def) => {
      const raw = obj.props[def.id];
      const value = Array.isArray(raw) ? raw.filter(Boolean).join(', ') : raw;
      if (value === undefined || value === null || value === '') return null;
      if (def.kind === 'checkbox') return { id: def.id, name: def.name, kind: def.kind, value: value ? 'Yes' : 'No' };
      if (def.kind === 'relation') {
        // A relation stores ids; a card wants the names behind them.
        const ids = Array.isArray(raw) ? raw : [raw];
        const names = ids
          .map((rid) => db.prepare('SELECT title FROM objects WHERE id = ?').get(String(rid))?.title)
          .filter(Boolean);
        if (!names.length) return null;
        return { id: def.id, name: def.name, kind: def.kind, value: names.join(', ') };
      }
      return { id: def.id, name: def.name, kind: def.kind, value: String(value) };
    })
    .filter(Boolean);

  return {
    id: obj.id,
    title: obj.title,
    typeId: obj.typeId,
    typeName: type?.name ?? '',
    icon: type?.icon ?? 'box',
    color: type?.color ?? '#9C9C97',
    snippet: obj.snippet,
    /** The note's own text, for cards big enough to be worth reading. */
    body: plainText(obj.content ?? null).slice(0, 1200),
    props,
    dateKey: obj.dateKey,
    done: isDoneObject(obj, type),
    updatedAt: obj.updatedAt,
  };
}

function formatDateKey(dateKey) {
  const d = new Date(dateKey + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Overdue incomplete tasks move to today, flagged so the UI can show "carried over".
function rolloverTasks() {
  const today = localToday();
  const rows = db.prepare("SELECT id, props FROM objects WHERE type_id = 'task'").all();
  const upd = db.prepare('UPDATE objects SET props = ?, updated_at = ? WHERE id = ?');
  for (const r of rows) {
    const p = JSON.parse(r.props || '{}');
    // A series keeps its anchor: dragging "every Monday" forward each morning
    // would rewrite the rule's whole future from a date that was never missed.
    if (recur.parseRule(p[REPEAT_PROP])) continue;
    if (p.due && p.due < today && p.status !== 'Done') {
      p.due = today;
      p.rolled = true;
      upd.run(JSON.stringify(p), now(), r.id);
    }
  }
}

// ---------- seed ----------

function li(text) {
  return { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

// Every habitat gets Daily Note and nothing else automatically — the rest of
// its types come from seedTypesForFlavor(), so habitats actually differ.
function seed() {
  const c = db.prepare('SELECT COUNT(*) AS c FROM types').get().c;
  if (c > 0) return;
  db.prepare('INSERT INTO types (id, name, emoji, color, properties, builtin, starred, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    'daily', 'Daily Note', 'calendar-days', '#e87ba4', '[]', 1, 0, now()
  );
}

// ---------- public API (one function per IPC channel) ----------

// Validated categorical palette (light-mode hex is canonical; renderer maps to dark steps).
const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

// Study keeps to itself: its own tables, no object types of its own, nothing in
// the sidebar's type list. So it gets the connection and nothing else.
const studyApi = study.create(() => db);

const api = {
  // Boards and decks keep their own tables and their own modules; they are spread
  // in here so every channel is still reachable from one place.
  ...canvas.channels(() => db, {
    objectCard,
    fileRow: (hash) => db.prepare('SELECT * FROM files WHERE hash = ?').get(String(hash)) ?? null,
  }),
  ...studyApi,

  'types:list': () => db.prepare('SELECT * FROM types ORDER BY builtin DESC, created_at').all().map(parseType),

  'types:create': ({ name, icon, color }) => {
    const id = uid();
    const count = db.prepare('SELECT COUNT(*) AS c FROM types').get().c;
    db.prepare('INSERT INTO types (id, name, emoji, color, properties, builtin, starred, created_at) VALUES (?, ?, ?, ?, ?, 0, 1, ?)').run(
      id, String(name || 'Untitled'), String(icon || 'box'), String(color || PALETTE[count % PALETTE.length]), '[]', now()
    );
    return getType(id);
  },

  'types:update': ({ id, patch }) => {
    const cur = getType(id);
    if (!cur) return null;
    if (patch.name !== undefined) db.prepare('UPDATE types SET name = ? WHERE id = ?').run(String(patch.name), id);
    if (patch.icon !== undefined) db.prepare('UPDATE types SET emoji = ? WHERE id = ?').run(String(patch.icon), id);
    if (patch.color !== undefined) db.prepare('UPDATE types SET color = ? WHERE id = ?').run(String(patch.color), id);
    if (patch.starred !== undefined) db.prepare('UPDATE types SET starred = ? WHERE id = ?').run(patch.starred ? 1 : 0, id);
    if (patch.properties !== undefined) db.prepare('UPDATE types SET properties = ? WHERE id = ?').run(JSON.stringify(patch.properties), id);
    return getType(id);
  },

  'types:delete': (id) => {
    if (id === 'daily') throw new Error('The Daily Note type cannot be deleted');
    if (id === PEOPLE_TYPE) throw new Error('The People type cannot be deleted');
    const objs = db.prepare('SELECT id FROM objects WHERE type_id = ?').all(id);
    for (const o of objs) deleteObject(o.id);
    db.prepare('DELETE FROM templates WHERE type_id = ?').run(id);
    db.prepare('DELETE FROM types WHERE id = ?').run(id);
    return true;
  },

  'objects:list': ({ typeId } = {}) => {
    const rows = typeId
      ? db.prepare('SELECT * FROM objects WHERE type_id = ? ORDER BY created_at').all(typeId)
      : db.prepare('SELECT * FROM objects ORDER BY updated_at DESC').all();
    return rows.map((r) => parseObj(r));
  },

  /**
   * Everything in the vault, for export.
   *
   * `httpApi` and `telegram` are held back on purpose: they hold the API bearer
   * token and the Telegram bot token, and an export is a file people copy to a
   * drive or hand to someone else. Nothing else in kv is a secret.
   */
  'export:data': () => {
    const secret = new Set(['httpApi', 'telegram']);
    return {
      app: 'habitat',
      exportedAt: now(),
      types: db.prepare('SELECT * FROM types ORDER BY builtin DESC, created_at').all().map(parseType),
      objects: db.prepare('SELECT * FROM objects ORDER BY created_at').all().map((r) => parseObj(r, true)),
      templates: db.prepare('SELECT * FROM templates ORDER BY created_at').all().map((r) => parseTemplate(r, true)),
      links: db.prepare('SELECT from_id, to_id, kind, prop_id FROM links').all(),
      files: db.prepare('SELECT * FROM files ORDER BY created_at').all(),
      settings: db
        .prepare('SELECT key, value FROM kv')
        .all()
        .filter((r) => !secret.has(r.key)),
    };
  },

  /**
   * Everything happening between two day keys, across every type.
   *
   * Resolved here rather than in the renderer so the HTTP API and MCP see the
   * same calendar the app does. Each entry is either timed — a `datetime`
   * property, placed at an hour and given a length — or all-day, from a `date`
   * property or a daily note's own date. A type needs no special support: give
   * it a datetime property and its objects land on the time grid.
   */
  'calendar:range': ({ from, to }) => {
    const first = String(from || '').slice(0, 10);
    const last = String(to || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(first) || !/^\d{4}-\d{2}-\d{2}$/.test(last)) return [];

    const types = new Map(db.prepare('SELECT * FROM types').all().map((r) => [r.id, parseType(r)]));
    const out = [];

    for (const row of db.prepare('SELECT * FROM objects').all()) {
      // A tag is a label, never an appointment.
      if (row.type_id === 'tag') continue;
      const type = types.get(row.type_id);
      const obj = parseObj(row);
      const defs = [...(type ? type.properties : []), ...obj.extraProps];

      const timeDef = defs.find((p) => p.kind === 'datetime' && obj.props[p.id]);
      const dayDef = defs.find((p) => p.kind === 'date' && obj.props[p.id]);
      // `datetime-local` values have no zone: read them as local time, which is
      // what the person who typed them meant.
      const startsAt = timeDef ? readStamp(obj.props[timeDef.id]) : null;
      const timed = !!startsAt;

      const anchor = timed
        ? localKey(startsAt)
        : dayDef
          ? String(obj.props[dayDef.id]).slice(0, 10)
          : row.date_key || null;
      if (!anchor) continue;

      const repeats = !!ruleOf(obj);
      // A run of days — a holiday, a flight with a stopover — is one entry per
      // day it covers, and the days after the first are all-day: the hours it
      // started at say nothing about the middle of a week away.
      const span = spanDays(obj.props, anchor);
      // A series contributes one entry per occurrence in the window; everything
      // else contributes its own day, or nothing when that falls outside.
      for (const dayKey of scheduledDays(obj, anchor, first, last)) {
        for (const [i, key] of span.entries()) {
          const on = i === 0 ? dayKey : shiftDay(dayKey, i);
          if (key !== span[i] || on < first || on > last) continue;
          const head = timed && i === 0 && !startsAllDay(startsAt, span.length);
          out.push({
            id: obj.id,
            typeId: obj.typeId,
            typeName: type ? type.name : obj.typeId,
            title: obj.title || 'Untitled',
            dayKey: on,
            allDay: !head,
            startMinute: head ? startsAt.getHours() * 60 + startsAt.getMinutes() : null,
            minutes: head ? minutesOf(obj.props, startsAt) : null,
            done: isDoneObject(obj, type, on),
            repeats,
            /** Which day of a run this is, and how many there are: "2 of 5". */
            spanDay: span.length > 1 ? i + 1 : null,
            spanOf: span.length > 1 ? span.length : null,
          });
        }
      }
    }

    out.sort((a, b) => a.dayKey.localeCompare(b.dayKey) || (a.startMinute ?? -1) - (b.startMinute ?? -1));
    return out;
  },

  /**
   * Move something that's already on the calendar, or change how long it runs.
   *
   * The renderer knows pixels, not which property holds the time, so the choice is
   * made here beside `calendar:range` — a drag and a read can't disagree about where
   * an object sits. `startMinute` null means all-day.
   *
   * Refuses rather than improvises: an object with no datetime property can't be
   * dropped onto the time grid, because inventing one would quietly change its type's
   * shape from a gesture as small as a drag.
   *
   * Dragging one occurrence of a series moves only that day: the series drops the
   * day and a copy takes it, which is what "move next Tuesday's standup" means.
   * Pass `scope: 'all'` to shift the whole series instead.
   */
  'calendar:reschedule': ({ id, dayKey, startMinute = null, minutes = null, occurrence = null, scope = 'one' }) => {
    const key = String(dayKey || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;

    const row = db.prepare('SELECT * FROM objects WHERE id = ?').get(id);
    if (!row) return null;
    // A daily note is its date and a tag is only a label — neither is an appointment.
    if (row.type_id === 'daily' || row.type_id === 'tag') return null;

    const type = getType(row.type_id);
    const obj = parseObj(row);
    const defs = [...(type ? type.properties : []), ...obj.extraProps];
    const props = { ...obj.props };

    if (occurrence && scope !== 'all' && ruleOf(obj)) {
      const detached = detachOccurrence(obj, defs, String(occurrence).slice(0, 10));
      if (!detached) return null;
      return api['calendar:reschedule']({ id: detached.id, dayKey: key, startMinute, minutes });
    }

    if (startMinute === null) {
      const dayDef = scheduleDef(defs, obj.props, 'date');
      if (!dayDef) return null;
      props[dayDef.id] = key;
    } else {
      const timeDef = scheduleDef(defs, obj.props, 'datetime');
      if (!timeDef) return null;
      props[timeDef.id] = stamp(key, Math.max(0, Math.min(24 * 60 - 1, Math.round(startMinute))));
      if (Number.isFinite(minutes) && minutes > 0) props[DURATION_PROP] = Math.round(minutes);
    }

    updateObject({ id, patch: { props } });
    return getObj(id, true);
  },

  /**
   * Make something at a spot on the grid. Only types that carry a datetime can be
   * created this way — the same property `calendar:range` reads them back through.
   */
  'calendar:create': ({ typeId, title = '', dayKey, startMinute, minutes = DEFAULT_MINUTES, repeat = null }) => {
    const key = String(dayKey || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;

    const type = getType(typeId);
    if (!type) return null;
    const timeDef = type.properties.find((p) => p.kind === 'datetime');
    if (!timeDef) return null;

    const props = { [timeDef.id]: stamp(key, Math.max(0, Math.min(24 * 60 - 1, Math.round(startMinute)))) };
    if (Number.isFinite(minutes) && minutes > 0) props[DURATION_PROP] = Math.round(minutes);
    // Normalised through the parser, so only a rule the calendar can read is stored.
    const rule = recur.parseRule(repeat);
    if (rule) props[REPEAT_PROP] = recur.formatRule(rule);
    return createObject({ typeId, title: String(title).trim() || 'Untitled', props });
  },

  /**
   * Take one day off a series without touching the rest of it — "skip this
   * week's". The day becomes its own object first and is then deleted, so
   * anything linked to that occurrence goes the way a deleted object goes
   * rather than silently losing its target.
   */
  'calendar:skip': ({ id, dayKey }) => {
    const row = db.prepare('SELECT * FROM objects WHERE id = ?').get(id);
    if (!row) return false;
    const obj = parseObj(row);
    if (!ruleOf(obj)) return false;
    const type = getType(row.type_id);
    const defs = [...(type ? type.properties : []), ...obj.extraProps];
    const detached = detachOccurrence(obj, defs, String(dayKey || '').slice(0, 10));
    if (!detached) return false;
    deleteObject(detached.id);
    return true;
  },

  'objects:get': (id) => getObj(id, true),
  'objects:create': (p) => createObject(p),
  'objects:update': (p) => updateObjectForOccurrence(p),
  'objects:setType': (p) => setObjectType(p),
  'objects:delete': (id) => deleteObject(id),

  'objects:bulkDelete': (ids) => {
    for (const id of ids || []) deleteObject(id);
    return { deleted: (ids || []).length };
  },

  // Applies one property value across many objects, going through updateObject
  // so relation links and task completion stamps stay correct.
  'objects:bulkSetProp': ({ ids, propId, value }) => {
    let changed = 0;
    for (const id of ids || []) {
      const cur = getObj(id);
      if (!cur) continue;
      const props = { ...cur.props };
      if (value === null || value === '') delete props[propId];
      else props[propId] = value;
      updateObject({ id, patch: { props } });
      changed++;
    }
    return { changed };
  },

  /**
   * Matches title or nickname always; with `content: true` it also searches the
   * text of every note, including daily entries. Goes through the FTS5 index, so
   * it stays an index lookup however big the vault gets, and understands
   * operators — `type:task`, `tag:habitat`, `is:pinned`, `due:week`,
   * `created:today`, `edited:month` — mixed in with the words.
   */
  'objects:search': (payload) => {
    const { q, content, limit } = typeof payload === 'string' ? { q: payload, content: false } : payload || {};
    if (!String(q || '').trim())
      return db
        .prepare(`SELECT ${SEARCH_COLUMNS} FROM objects o ORDER BY o.updated_at DESC LIMIT 20`)
        .all()
        .map(parseSearchRow);
    return searchObjects({ q, content: !!content, limit: Number(limit) || 0 });
  },


  'tags:list': () => {
    if (!getType('tag')) return [];
    return db
      .prepare(
        `SELECT o.*, (SELECT COUNT(DISTINCT l.from_id) FROM links l WHERE l.to_id = o.id) AS uses
         FROM objects o WHERE o.type_id = 'tag'
         ORDER BY uses DESC`
      )
      .all()
      .map((r) => ({ ...parseObj(r), uses: r.uses }))
      .sort((a, b) => b.uses - a.uses || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  },

  'tags:search': (q) => {
    if (!getType('tag')) return [];
    const query = String(q || '').trim().toLowerCase();
    const all = db.prepare("SELECT * FROM objects WHERE type_id = 'tag' ORDER BY updated_at DESC").all().map((r) => parseObj(r));
    const list = query ? all.filter((t) => t.title.toLowerCase().includes(query)) : all;
    return list
      .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
      .slice(0, 8);
  },

  /**
   * Deleting a tag removes the tag itself everywhere — the chips are stripped out
   * of every document that used it, leaving the surrounding text untouched.
   */
  'tags:delete': (id) => {
    const rows = db.prepare('SELECT id, content FROM objects WHERE content IS NOT NULL').all();
    const upd = db.prepare('UPDATE objects SET content = ?, updated_at = ? WHERE id = ?');
    let touched = 0;
    for (const r of rows) {
      let doc;
      try {
        doc = JSON.parse(r.content);
      } catch {
        continue;
      }
      if (!stripMentionNodes(doc, id)) continue;
      upd.run(JSON.stringify(doc), now(), r.id);
      syncMentionLinks(r.id, doc);
      touched++;
    }
    deleteObject(id);
    return { ok: true, touched };
  },

  // Find-or-create by name (case-insensitive) so typing the same tag twice never duplicates it.
  'tags:ensure': (name) => {
    const title = String(name || '').trim().replace(/^#+/, '');
    if (!title) return null;
    ensureTagType();
    const existing = db
      .prepare("SELECT * FROM objects WHERE type_id = 'tag'")
      .all()
      .map((r) => parseObj(r))
      .find((t) => t.title.toLowerCase() === title.toLowerCase());
    return existing || createObject({ typeId: 'tag', title });
  },

  'daily:get': ({ dateKey }) => {
    const r = db.prepare("SELECT * FROM objects WHERE type_id = 'daily' AND date_key = ?").get(dateKey);
    return r ? parseObj(r, true) : null;
  },

  // Daily rows are only created once the user actually writes something.
  'daily:create': ({ dateKey, content }) => {
    const existing = db.prepare("SELECT * FROM objects WHERE type_id = 'daily' AND date_key = ?").get(dateKey);
    if (existing) return updateObject({ id: existing.id, patch: { content } });
    return createObject({ typeId: 'daily', title: formatDateKey(dateKey), dateKey, content });
  },

  /**
   * Import a whole vault: date-named files become daily notes, everything else
   * becomes a Note. Runs in two passes so [[wikilinks]] between imported files
   * resolve into real mentions. Nothing already here is overwritten.
   */
  'import:vault': ({ entries }) => {
    const { mdToDoc } = require('./markdown');

    const tagCache = new Map();
    const onTag = (name) => {
      const key = name.toLowerCase();
      if (tagCache.has(key)) return tagCache.get(key);
      ensureTagType();
      const existing = db
        .prepare("SELECT * FROM objects WHERE type_id = 'tag'")
        .all()
        .map((r) => parseObj(r))
        .find((t) => t.title.toLowerCase() === key);
      const id = existing ? existing.id : createObject({ typeId: 'tag', title: name }).id;
      tagCache.set(key, id);
      return id;
    };

    // Pass 1 — create the objects so every link target exists before we parse.
    const byName = new Map(); // lowercased wikilink target -> {id, label}
    const created = [];
    let daily = 0;
    let notes = 0;
    let skipped = 0;
    const hasNoteType = !!getType('note');

    for (const e of entries || []) {
      if (!e) continue;
      if (e.dateKey) {
        const taken = db.prepare("SELECT * FROM objects WHERE type_id = 'daily' AND date_key = ?").get(e.dateKey);
        if (taken) {
          // Don't touch it, but still let other files link to it.
          byName.set(e.dateKey.toLowerCase(), { id: taken.id, label: taken.title });
          skipped++;
          continue;
        }
        const o = createObject({ typeId: 'daily', title: formatDateKey(e.dateKey), dateKey: e.dateKey });
        byName.set(e.dateKey.toLowerCase(), { id: o.id, label: o.title });
        created.push({ id: o.id, markdown: e.markdown });
        daily++;
      } else {
        if (!hasNoteType) continue; // habitat has no Note type to import into
        const title = String(e.title || 'Untitled');
        const o = createObject({ typeId: 'note', title });
        if (!byName.has(title.toLowerCase())) byName.set(title.toLowerCase(), { id: o.id, label: title });
        created.push({ id: o.id, markdown: e.markdown });
        notes++;
      }
    }

    // Pass 2 — convert content, now that links can be resolved.
    const onLink = (target) => byName.get(String(target).toLowerCase()) ?? null;
    let links = 0;
    for (const c of created) {
      const doc = mdToDoc(c.markdown, {
        onTag,
        onLink: (t) => {
          const hit = onLink(t);
          if (hit) links++;
          return hit;
        },
      });
      updateObject({ id: c.id, patch: { content: doc } });
    }

    return { daily, notes, skipped, tags: tagCache.size, links };
  },

  /**
   * Everything that falls on a span of days, whatever kind it is.
   *
   * `date_key` alone would only find daily notes and anything dragged onto the
   * calendar. The dates that matter most — a task's due date, an event's start —
   * live inside the props JSON under a per-type property id, so those are matched
   * too. Without this, "do I have any tasks today" reads an empty day.
   */
  'objects:onDates': ({ from, to, typeId }) => {
    const dateProps = dateProperties();
    const where = ["(o.date_key BETWEEN ? AND ?)"];
    const params = [from, to];
    if (dateProps.length) {
      where[0] =
        `((o.date_key BETWEEN ? AND ?) OR EXISTS (
            SELECT 1 FROM json_each(o.props)
             WHERE json_each.key IN (${dateProps.map(() => '?').join(',')})
               AND substr(json_each.value, 1, 10) BETWEEN ? AND ?))`;
      params.push(...dateProps, from, to);
    }
    if (typeId) {
      where.push('o.type_id = ?');
      params.push(typeId);
    }
    const names = typeNameMap();
    return db
      .prepare(
        `SELECT id, type_id, title, date_key, props, search_text FROM objects o
          WHERE ${where.join(' AND ')}
          ORDER BY (o.type_id = 'daily') DESC, o.date_key DESC, o.updated_at DESC
          LIMIT 40`
      )
      .all(...params)
      .map((r) => asContext(r, names));
  },

  /** The most recent objects of one type — "what have I been reading", "any tasks". */
  'objects:ofType': ({ typeId, limit = 5 }) => {
    const names = typeNameMap();
    return db
      .prepare('SELECT id, type_id, title, date_key, props, search_text FROM objects WHERE type_id = ? ORDER BY updated_at DESC LIMIT ?')
      .all(typeId, Number(limit) || 5)
      .map((r) => asContext(r, names));
  },

  /**
   * The objects a set of words matches, optionally within one type. Ranked by
   * the FTS index rather than re-scored here — bm25 already weights the title
   * above the body, which is the ordering a person expects.
   */
  'objects:withText': ({ words, limit = 5, typeId }) => {
    const expr = ftsExpr(Array.isArray(words) ? words : String(words || '').split(/\s+/), false);
    const names = typeNameMap();
    // A question that names only a type — "any movies" — has nothing to match on.
    if (!expr) return typeId ? api['objects:ofType']({ typeId, limit }) : [];
    // Same shape as searchObjects for the same reasons — see the note there:
    // MATCH wants the table's own name, and CROSS JOIN keeps the index as the
    // outer loop instead of re-running the match once per row.
    return db
      .prepare(
        `SELECT o.id, o.type_id, o.title, o.date_key, o.props, o.search_text
           FROM objects_fts CROSS JOIN objects o ON o.rowid = objects_fts.rowid
          WHERE objects_fts MATCH ?${typeId ? ' AND o.type_id = ?' : ''}
          ORDER BY bm25(objects_fts, 12.0, 1.0, 8.0)
          LIMIT ?`
      )
      .all(...[expr, ...(typeId ? [typeId] : []), Number(limit) || 5])
      .map((r) => asContext(r, names));
  },

  'daily:list': () =>
    db
      .prepare("SELECT id, date_key, content, updated_at FROM objects WHERE type_id = 'daily' ORDER BY date_key DESC")
      .all()
      .map((r) => ({ id: r.id, dateKey: r.date_key, snippet: snippet(r.content), updatedAt: r.updated_at })),

  'backlinks:list': (id) =>
    db
      .prepare('SELECT * FROM objects WHERE id IN (SELECT DISTINCT from_id FROM links WHERE to_id = ?) ORDER BY updated_at DESC')
      .all(id)
      .map((r) => parseObj(r)),

  /**
   * A task belongs to a day if it's due then or starts then — either one puts it in
   * time, which is the same rule the checklist splits on. Only `due` rolls forward
   * when it's missed: a start time is when something was meant to happen, and moving
   * it would quietly rewrite history rather than remind anyone.
   */
  'tasks:forDay': ({ dateKey }) => {
    if (dateKey === localToday()) rolloverTasks();
    const startsOn = (o) => String(o.props[TIME_PROP] || '').slice(0, 10);
    return db
      .prepare("SELECT * FROM objects WHERE type_id = 'task'")
      .all()
      .map((r) => parseObj(r))
      .filter((o) => {
        const anchor = startsOn(o) || o.props.due;
        // A repeating task shows up on each of its days, with that day's own tick.
        if (ruleOf(o)) return !!anchor && scheduledDays(o, anchor, dateKey, dateKey).length > 0;
        return o.props.due === dateKey || startsOn(o) === dateKey;
      })
      .map((o) => {
        if (!ruleOf(o)) return o;
        // The status shared by the whole series can't speak for one of its days,
        // so the day's own tick is what the list is handed.
        const type = getType(o.typeId);
        const def = doneDef(o, type);
        if (!def) return { ...o, occurrence: dateKey };
        const status = isDoneObject(o, type, dateKey) ? 'Done' : openStatusOf(def);
        return { ...o, occurrence: dateKey, props: { ...o.props, [def.id]: status } };
      })
      .sort(
        (a, b) =>
          (a.props.status === 'Done' ? 1 : 0) - (b.props.status === 'Done' ? 1 : 0) ||
          // Timed first and in order, then whatever only carries a date.
          (startsOn(a) ? 0 : 1) - (startsOn(b) ? 0 : 1) ||
          String(a.props[TIME_PROP] || '').localeCompare(String(b.props[TIME_PROP] || '')) ||
          a.createdAt - b.createdAt
      );
  },

  /**
   * The agenda: the next few weeks as days, each with what happens on it.
   *
   * Two shapes, told apart the way the rest of Habitat tells them apart. A type
   * with a "Done" option makes **tasks** — things to work on and tick off. A type
   * without one, but with a date, makes **events** — things that happen: a
   * meeting, a flight, a week away. Events hold tasks, through the task's
   * `partOf`, so an agenda and a booking reference live where they belong; a
   * task inside an event is shown there and nowhere else.
   *
   * Also returns the two piles that aren't on any day: what is late, and what
   * has never been given one.
   */
  'agenda:range': ({ from, days = 21 } = {}) => {
    const today = localToday();
    const first = /^\d{4}-\d{2}-\d{2}$/.test(String(from || '')) ? String(from).slice(0, 10) : today;
    const last = shiftDay(first, Math.max(1, Math.min(180, Number(days) || 21)) - 1);

    const types = new Map(db.prepare('SELECT * FROM types').all().map((r) => [r.id, parseType(r)]));
    const titleOf = (id) => {
      const r = db.prepare('SELECT title FROM objects WHERE id = ?').get(id);
      return r ? r.title || 'Untitled' : null;
    };

    const byDay = new Map();
    const dayList = [];
    for (let key = first; key <= last; key = shiftDay(key, 1)) {
      const day = { dayKey: key, events: [], tasks: [] };
      byDay.set(key, day);
      dayList.push(day);
    }

    const overdue = [];
    const backlog = [];
    /** Tasks waiting for the event they belong to, by event id. */
    const nested = new Map();

    const rows = db.prepare('SELECT * FROM objects').all();
    const events = new Map();

    for (const row of rows) {
      if (row.type_id === 'daily' || row.type_id === 'tag') continue;
      const type = types.get(row.type_id);
      const obj = parseObj(row);
      const defs = [...(type ? type.properties : []), ...obj.extraProps];
      const status = doneDef(obj, type);

      const timeDef = defs.find((p) => p.kind === 'datetime' && obj.props[p.id]);
      const dayDef = defs.find((p) => p.kind === 'date' && obj.props[p.id]);
      const startsAt = timeDef ? readStamp(obj.props[timeDef.id]) : null;
      const anchor = startsAt
        ? localKey(startsAt)
        : dayDef
          ? String(obj.props[dayDef.id]).slice(0, 10)
          : null;
      const rule = ruleOf(obj);

      if (status) {
        // A task: on a day, late, in an event, or waiting in the backlog.
        const partOf = [].concat(obj.props[PART_OF_PROP] || []).filter(Boolean)[0] || null;
        let when = anchor;
        if (anchor && rule) {
          const ahead = scheduledDays(obj, anchor, today, shiftDay(today, 366 * 5));
          when = ahead[0] || scheduledDays(obj, anchor, anchor, today).pop() || anchor;
        }
        const done = isDoneObject(obj, type, when);
        const card = {
          id: obj.id,
          typeId: obj.typeId,
          typeName: type ? type.name : obj.typeId,
          title: obj.title || 'Untitled',
          when,
          startMinute: startsAt ? startsAt.getHours() * 60 + startsAt.getMinutes() : null,
          minutes: startsAt ? minutesOf(obj.props, startsAt) : null,
          done,
          repeats: !!rule,
          overdue: !!when && when < today && !done,
          rolled: !!obj.props.rolled,
          partOf,
        };

        if (partOf) {
          if (!nested.has(partOf)) nested.set(partOf, []);
          nested.get(partOf).push(card);
        } else if (!when) {
          if (!done) backlog.push(card);
        } else if (card.overdue) {
          overdue.push(card);
        } else if (byDay.has(when)) {
          byDay.get(when).tasks.push(card);
        }
        continue;
      }

      // An event: something that happens, on every day it covers.
      if (!anchor) continue;
      const span = spanDays(obj.props, anchor);
      const people = [].concat(obj.props.attendees || []).map(titleOf).filter(Boolean);

      for (const occurrence of scheduledDays(obj, anchor, shiftDay(first, -span.length), last)) {
        for (let i = 0; i < span.length; i++) {
          const key = shiftDay(occurrence, i);
          if (!byDay.has(key)) continue;
          const head = !!startsAt && i === 0 && !startsAllDay(startsAt, span.length);
          const entry = {
            id: obj.id,
            typeId: obj.typeId,
            typeName: type ? type.name : obj.typeId,
            title: obj.title || 'Untitled',
            dayKey: key,
            startMinute: head ? startsAt.getHours() * 60 + startsAt.getMinutes() : null,
            minutes: head ? minutesOf(obj.props, startsAt) : null,
            endMinute: null,
            allDay: !head,
            spanDay: span.length > 1 ? i + 1 : null,
            spanOf: span.length > 1 ? span.length : null,
            location: obj.props.location || '',
            people,
            repeats: !!rule,
            /** Filled in below, and only on the first day of a run. */
            tasks: [],
          };
          if (entry.startMinute !== null && entry.minutes) entry.endMinute = entry.startMinute + entry.minutes;
          byDay.get(key).events.push(entry);
          if (i === 0) {
            if (!events.has(obj.id)) events.set(obj.id, []);
            events.get(obj.id).push(entry);
          }
        }
      }
    }

    // Tasks join their event once every event is known. An event's card carries
    // all of them, so its checklist is whole — but one with a day of its own is
    // also listed there, because "book the parking by Friday" is no use to you
    // buried inside a holiday three weeks out. The day's copy says which event
    // it belongs to, so the two readings can't be mistaken for two tasks.
    for (const [eventId, cards] of nested) {
      const hosts = events.get(eventId) || [];
      for (const host of hosts) host.tasks = cards.map((c) => ({ ...c, eventName: host.title }));

      for (const card of cards) {
        if (card.done) continue;
        const elsewhere = !hosts.length || !hosts.some((h) => h.dayKey === card.when);
        const named = { ...card, eventName: hosts.length ? hosts[0].title : null };
        if (card.overdue) overdue.push(named);
        else if (card.when && elsewhere && byDay.has(card.when)) byDay.get(card.when).tasks.push(named);
        else if (!card.when && !hosts.length) backlog.push(named);
      }
    }

    const byTime = (a, b) => (a.startMinute ?? -1) - (b.startMinute ?? -1) || a.title.localeCompare(b.title);
    for (const day of dayList) {
      day.events.sort(byTime);
      day.tasks.sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || byTime(a, b));
    }

    return {
      days: dayList,
      overdue: overdue.sort((a, b) => (a.when || '').localeCompare(b.when || '')),
      backlog: backlog.sort((a, b) => b.id.localeCompare(a.id)),
    };
  },

  /**
   * Tick something off, for a day.
   *
   * Ticking a repeating task means "today's is done", never "the series is
   * over", so for a series the day is remembered and the shared status is left
   * alone. Everything else just gets its status property set, exactly as
   * clicking it in a table would.
   */
  'tasks:setDone': ({ id, dayKey = null, done = true }) => {
    const row = db.prepare('SELECT * FROM objects WHERE id = ?').get(id);
    if (!row) return null;
    const obj = parseObj(row);
    const type = getType(row.type_id);

    if (dayKey && ruleOf(obj)) {
      const days = daySet(obj, REPEAT_DONE_PROP);
      if (done) days.add(String(dayKey).slice(0, 10));
      else days.delete(String(dayKey).slice(0, 10));
      updateObject({ id, patch: { props: { ...obj.props, [REPEAT_DONE_PROP]: [...days].sort() } } });
      return getObj(id, true);
    }

    const def = doneDef(obj, type);
    if (!def) return getObj(id, true);
    updateObject({ id, patch: { props: { ...obj.props, [def.id]: done ? 'Done' : openStatusOf(def) } } });
    return getObj(id, true);
  },

  'templates:list': ({ typeId }) =>
    db.prepare('SELECT * FROM templates WHERE type_id = ? ORDER BY created_at').all(typeId).map((r) => parseTemplate(r)),

  'templates:get': (id) => {
    const r = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
    return r ? parseTemplate(r, true) : null;
  },

  'templates:create': ({ typeId, name }) => {
    const id = uid();
    db.prepare('INSERT INTO templates (id, type_id, name, props, content, extra_props, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id, typeId, String(name || ''), '{}', null, '[]', now()
    );
    return parseTemplate(db.prepare('SELECT * FROM templates WHERE id = ?').get(id), true);
  },

  'templates:update': ({ id, patch }) => {
    const cur = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
    if (!cur) return null;
    if (patch.name !== undefined) db.prepare('UPDATE templates SET name = ? WHERE id = ?').run(String(patch.name), id);
    if (patch.props !== undefined) db.prepare('UPDATE templates SET props = ? WHERE id = ?').run(JSON.stringify(patch.props), id);
    if (patch.extraProps !== undefined)
      db.prepare('UPDATE templates SET extra_props = ? WHERE id = ?').run(JSON.stringify(patch.extraProps), id);
    if (patch.content !== undefined)
      db.prepare('UPDATE templates SET content = ? WHERE id = ?').run(patch.content ? JSON.stringify(patch.content) : null, id);
    return parseTemplate(db.prepare('SELECT * FROM templates WHERE id = ?').get(id), true);
  },

  'templates:delete': (id) => {
    db.prepare('DELETE FROM templates WHERE id = ?').run(id);
    return true;
  },

  'objects:createFromTemplate': (templateId) => {
    const r = db.prepare('SELECT * FROM templates WHERE id = ?').get(templateId);
    if (!r) return null;
    const t = parseTemplate(r, true);
    return createObject({
      typeId: t.typeId,
      title: t.name,
      props: { ...t.props },
      content: t.content,
      extraProps: t.extraProps.map((p) => ({ ...p })),
    });
  },

  /** The greeting name: the self card's, so renaming your card renames the greeting. */
  'profile:get': () => {
    const me = api['people:self']();
    if (me?.title) return { name: me.title, id: me.id };
    const r = db.prepare("SELECT value FROM kv WHERE key = 'profile'").get();
    return r ? JSON.parse(r.value) : null;
  },

  // ---------- People ----------

  'people:list': () => listPeople(),

  'people:get': (id) => {
    const o = getObj(id, true);
    return o && o.typeId === PEOPLE_TYPE ? decoratePerson(o) : null;
  },

  /** The catalogue of optional details, grouped for the "add detail" picker. */
  'people:fields': () => PEOPLE_FIELDS,

  /**
   * `self: true` makes the user's own card, and only when there isn't one — the
   * self card is claimed at creation, never taken from an existing contact.
   */
  'people:create': ({ title, name, props, extraProps, self } = {}) => {
    ensurePeopleType();
    const mine = self && !selfId();
    const clean = { ...(props || {}) };
    if (mine) for (const p of SELF_HIDDEN_PROPS) delete clean[p];
    const made = createObject({
      typeId: PEOPLE_TYPE,
      title: String(title ?? name ?? '').trim(),
      props: clean,
      extraProps: extraProps || [],
    });
    if (made && mine) setSelfPerson(made.id);
    return decoratePerson(made);
  },

  /** The card that represents the user. `null` until they make one. */
  'people:self': () => {
    const id = selfId();
    if (!id) return null;
    const o = getObj(id, true);
    if (!o || o.typeId !== PEOPLE_TYPE) {
      setSelfPerson(null); // the card was deleted
      return null;
    }
    return decoratePerson(o, id);
  },


  /**
   * Birthdays coming up, soonest first. `within` is a number of days from today;
   * today's birthdays are always included.
   */
  'people:birthdays': ({ within = 60, limit = 0 } = {}) => {
    const span = Number(within) || 60;
    const list = listPeople()
      .filter((p) => p.nextBirthday && p.nextBirthday.days <= span)
      .sort((a, b) => a.nextBirthday.days - b.nextBirthday.days);
    return limit > 0 ? list.slice(0, limit) : list;
  },

  // ---------- attachments ----------

  /**
   * Take bytes into the store and remember what they are. Returns the reference
   * that gets embedded in a note or a property — everything a view needs to draw
   * the thing without another lookup.
   */
  'files:add': ({ name, mime, data, width, height } = {}) => {
    const buffer = Buffer.from(data);
    if (!buffer.length) throw new Error('that file is empty');
    const { hash, ext, size } = files.store(buffer, name);
    db.prepare(
      `INSERT INTO files (hash, name, mime, ext, size, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(hash) DO UPDATE SET width = COALESCE(excluded.width, files.width), height = COALESCE(excluded.height, files.height)`
    ).run(hash, String(name || 'file'), String(mime || ''), ext, size, width ?? null, height ?? null, now());
    return { hash, name: String(name || 'file'), mime: String(mime || ''), ext, size, width: width ?? null, height: height ?? null };
  },

  'files:get': (hash) => db.prepare('SELECT * FROM files WHERE hash = ?').get(String(hash)) ?? null,

  /** How much room attachments take, and how much of it nothing points at any more. */
  'files:stats': () => {
    const kept = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM files').get();
    const used = referencedHashes();
    const unused = db
      .prepare('SELECT hash, size FROM files')
      .all()
      .filter((f) => !used.has(f.hash));
    return {
      count: kept.n,
      bytes: kept.bytes,
      unusedCount: unused.length,
      unusedBytes: unused.reduce((a, f) => a + f.size, 0),
      dir: files.dir(),
    };
  },

  /**
   * Delete every stored file nothing refers to any more. Reference counting would
   * drift; walking what's actually there is slower but always right.
   */
  'files:gc': () => {
    const used = referencedHashes();
    let removed = 0;
    let freed = 0;
    const drop = db.prepare('DELETE FROM files WHERE hash = ?');
    for (const f of db.prepare('SELECT hash, ext, size FROM files').all()) {
      if (used.has(f.hash)) continue;
      freed += files.remove(f.hash, f.ext) || f.size;
      drop.run(f.hash);
      removed++;
    }
    // Blobs the database never knew about — a crash between write and insert.
    const known = new Set(db.prepare('SELECT hash FROM files').all().map((r) => r.hash));
    for (const stored of files.listStored()) {
      if (known.has(stored.hash)) continue;
      freed += files.remove(stored.hash, stored.ext) || stored.size;
      removed++;
    }
    return { removed, freed };
  },

  'automations:list': () => loadAutomations(),

  'automations:save': (list) => {
    saveAutomations(Array.isArray(list) ? list : []);
    return true;
  },

  /**
   * Minute tick from the main process. Time-based rules run at most once a day,
   * at or after their time; 'appStart' rules are handled separately.
   */
  'automations:tick': () => {
    const rules = loadAutomations();
    const key = todayKey();
    const d = new Date();
    const minutes = d.getHours() * 60 + d.getMinutes();
    let ran = 0;
    let dirty = false;
    for (const rule of rules) {
      const kind = rule.trigger?.kind;
      if (rule.enabled === false) continue;
      if (kind !== 'daily' && kind !== 'weekly' && kind !== 'dueToday' && kind !== 'birthday') continue;
      if (kind === 'weekly' && !(rule.trigger.days || []).includes(d.getDay())) continue;
      const [h, m] = String(rule.trigger.time || '09:00').split(':').map(Number);
      if (minutes < (h || 0) * 60 + (m || 0)) continue;
      if (rule.lastRun === key) continue;
      try {
        ran += runTimedRule(rule);
      } catch (err) {
        console.error('automation failed', rule.name, err);
      }
      rule.lastRun = key;
      rule.lastRunAt = now();
      rule.runs = (rule.runs || 0) + 1;
      dirty = true;
    }
    if (dirty) saveAutomations(rules);
    return { ran };
  },

  /** Rules that run once when the app opens. */
  'automations:appStart': () => {
    let ran = 0;
    for (const rule of loadAutomations()) {
      if (rule.enabled === false || rule.trigger?.kind !== 'appStart') continue;
      try {
        ran += runTimedRule(rule);
        markRun(rule.id);
      } catch (err) {
        console.error('automation failed', rule.name, err);
      }
    }
    return { ran };
  },

  /**
   * What a scheduled rule would act on right now, without acting. The builder
   * shows this live, so a rule can be checked before it's ever left to run.
   */
  'automations:preview': (rule) => {
    if (!rule?.trigger?.typeId) return { scoped: false, count: 0, titles: [] };
    try {
      const matches = matchesForRule(rule);
      return { scoped: true, count: matches.length, titles: matches.slice(0, 6).map((o) => o.title || 'Untitled') };
    } catch {
      return { scoped: true, count: 0, titles: [] };
    }
  },

  /** "Run now" from the builder — same path, ignoring the schedule. */
  'automations:run': (id) => {
    const rule = loadAutomations().find((r) => r.id === id);
    if (!rule) return { ran: 0 };
    const ran = runTimedRule(rule);
    markRun(rule.id);
    return { ran };
  },

  /** Telegram settings live with the vault: { enabled, token, chatId, typeId, botName, offset }. */
  /** Append a line to a daily note. Used by the HTTP API and by scripts. */
  'daily:append': ({ text, dateKey }) => {
    const line = String(text || '').trim();
    if (!line) return null;
    return appendToDaily([{ type: 'text', text: line }], dateKey || null);
  },

  /** A habitat's own id — stable, shareable, and stored with the file. */
  'habitat:code': () => {
    const r = db.prepare("SELECT value FROM kv WHERE key = 'habitatCode'").get();
    if (r?.value) return r.value;
    const code = makeHabitatCode();
    db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      'habitatCode', code
    );
    return code;
  },

  /** The token the local HTTP API expects, minted on first use. */  /** The token the local HTTP API expects, minted on first use. */
  'api:config': () => {
    const r = db.prepare("SELECT value FROM kv WHERE key = 'httpApi'").get();
    let cfg = { enabled: false, port: 37373, token: '', mcpEdit: false };
    if (r) {
      try {
        cfg = { ...cfg, ...JSON.parse(r.value) };
      } catch {
        // fall through to defaults
      }
    }
    if (!cfg.token) {
      cfg.token = randomUUID().replace(/-/g, '');
      api['api:save'](cfg);
    }
    return cfg;
  },

  'api:save': (patch) => {
    const r = db.prepare("SELECT value FROM kv WHERE key = 'httpApi'").get();
    let cur = { enabled: false, port: 37373, token: '', mcpEdit: false };
    if (r) {
      try {
        cur = { ...cur, ...JSON.parse(r.value) };
      } catch {
        // ignore malformed rows
      }
    }
    const next = { ...cur, ...(patch || {}) };
    db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      'httpApi', JSON.stringify(next)
    );
    return next;
  },

  'telegram:get': () => {
    const blank = { enabled: false, token: '', chatId: '', userId: '', userName: '', typeId: 'note' };
    const r = db.prepare("SELECT value FROM kv WHERE key = 'telegram'").get();
    if (!r) return blank;
    try {
      return { ...blank, ...JSON.parse(r.value) };
    } catch {
      return blank;
    }
  },

  /**
   * Start pairing: mint a short code and forget any current link. A bot is
   * reachable by anyone who finds it, so the code — not "whoever writes first" —
   * is what decides whose chat this vault belongs to. It expires quickly.
   */
  'telegram:pair': () => {
    const code = makePairCode();
    return api['telegram:save']({
      pairCode: code,
      pairExpires: now() + 15 * 60 * 1000,
      chatId: '',
      userId: '',
      userName: '',
    });
  },

  /** Drop the link without opening the door: nothing is accepted until a new code is used. */
  'telegram:unpair': () =>
    api['telegram:save']({ chatId: '', userId: '', userName: '', pairCode: '', pairExpires: 0 }),

  'telegram:save': (cfg) => {
    const cur = api['telegram:get']();
    db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      'telegram', JSON.stringify({ ...cur, ...(cfg || {}) })
    );
    return api['telegram:get']();
  },

  /**
   * Turns one captured message into something in the vault. The first word says
   * where it goes: "daily …" appends to today's note, "task …" makes a Task, and
   * anything unrecognised falls back to the configured type with the text intact.
   */
  'telegram:ingest': ({ text, typeId }) => {
    const body = String(text || '').trim();
    if (!body) return null;

    const asDoc = (lines) =>
      lines.length ? { type: 'doc', content: lines.map((l) => ({ type: 'paragraph', content: [{ type: 'text', text: l }] })) } : null;

    // Accept "daily …", "/daily …" and "daily: …".
    const m = body.match(/^\/?([\p{L}\d_-]+)\s*:?\s+([\s\S]+)$/u);
    const word = m ? m[1].toLowerCase() : '';
    const rest = m ? m[2].trim() : '';

    if (rest && (word === 'daily' || word === 'journal' || word === 'today')) {
      appendToDaily([{ type: 'text', text: rest }]);
      return { kind: 'daily', title: rest.split('\n')[0].slice(0, 80), typeName: 'today’s note' };
    }

    // Match a type by name, forgiving plurals in either direction.
    const singular = (v) => v.replace(/s$/, '');
    const types = db.prepare('SELECT * FROM types').all().map(parseType);
    const hit = rest
      ? types.find((t) => {
          const name = t.name.toLowerCase();
          return name === word || singular(name) === singular(word);
        })
      : null;

    const target = hit || getType(typeId) || getType('note');
    if (!target) return null;
    const lines = (hit ? rest : body).split('\n');
    const made = createObject({
      typeId: target.id,
      title: lines[0].slice(0, 120),
      content: asDoc(lines.slice(1).filter((l) => l.trim())),
    });
    return { kind: 'object', id: made.id, title: made.title, typeName: target.name, matched: !!hit };
  },

  'vars:list': () => {
    const r = db.prepare("SELECT value FROM kv WHERE key = 'variables'").get();
    return r ? JSON.parse(r.value) : [];
  },

  'vars:save': (list) => {
    db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      'variables', JSON.stringify(Array.isArray(list) ? list : [])
    );
    return true;
  },

  /** Dashboard widget layout. `null` means "never customised" — the renderer installs its default. */
  'dashboard:get': () => {
    const r = db.prepare("SELECT value FROM kv WHERE key = 'dashboard'").get();
    if (!r) return null;
    try {
      return JSON.parse(r.value);
    } catch {
      return null;
    }
  },

  'dashboard:save': (layout) => {
    db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      'dashboard', JSON.stringify(layout && Array.isArray(layout.widgets) ? layout : { widgets: [] })
    );
    return true;
  },

  /** Forget the customised layout so the dashboard falls back to the default set. */
  'dashboard:reset': () => {
    db.prepare("DELETE FROM kv WHERE key = 'dashboard'").run();
    return true;
  },

  'kv:get': (key) => {
    const r = db.prepare('SELECT value FROM kv WHERE key = ?').get(String(key));
    return r ? r.value : null;
  },

  'kv:set': ({ key, value }) => {
    if (value == null) db.prepare('DELETE FROM kv WHERE key = ?').run(String(key));
    else
      db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
        String(key), String(value)
      );
    return true;
  },

  'stats:get': () => {
    const counts = {};
    for (const r of db.prepare('SELECT type_id, COUNT(*) AS c FROM objects GROUP BY type_id').all()) counts[r.type_id] = r.c;
    const recent = db.prepare('SELECT * FROM objects ORDER BY updated_at DESC LIMIT 8').all().map((r) => parseObj(r));
    const pinned = db.prepare('SELECT * FROM objects WHERE pinned = 1 ORDER BY updated_at DESC').all().map((r) => parseObj(r));
    return { counts, recent, pinned };
  },
};

let currentFile = null;

function initDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  currentFile = file;
  files.useVault(file);
  // Another vault may be a build behind or ahead; its columns are its own.
  columnCache.clear();
  db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA journal_mode = WAL;');
  } catch {
    // WAL can fail on some filesystems or with stale lock files — the default journal still works.
  }
  db.exec(SCHEMA);
  db.exec(canvas.SCHEMA);
  db.exec(canvas.INDEXES);
  db.exec(study.SCHEMA);
  // Columns before indexes: a vault from an earlier build still has the old
  // shape of these tables, and an index over a column that hasn't been added
  // yet fails the statement and stops the app from opening at all.
  ensureColumn('reviews', 'before', "before TEXT NOT NULL DEFAULT '{}'");
  ensureColumn('cards', 'note_id', 'note_id TEXT');
  ensureColumn('study_notes', 'props', "props TEXT NOT NULL DEFAULT '{}'");
  db.exec(study.INDEXES);
  ensureColumn('objects', 'extra_props', "extra_props TEXT NOT NULL DEFAULT '[]'");
  ensureColumn('objects', 'search_text', "search_text TEXT NOT NULL DEFAULT ''");
  const starredAdded = ensureColumn('types', 'starred', 'starred INTEGER NOT NULL DEFAULT 0');
  if (starredAdded) db.exec("UPDATE types SET starred = 1 WHERE id IN ('note', 'task', 'project')");
  // Before the vault is seeded or migrated, so those writes are tracked like any
  // other rather than needing a backfill of their own.
  synclog.install(db);
  seed();
  migrate();
  // After migrations, so the index is built from settled search_text.
  ensureSearchIndex();
  rolloverTasks();
}

/** Close the vault handle without opening another — used right before deleting its files. */
function closeDb() {
  if (!db) return;
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    db.close();
  } catch {
    /* already closed */
  }
  db = null;
}

/** Wipe everything except the daily-note type. Used when onboarding chooses "blank". */
function resetToBlank() {
  db.exec('DELETE FROM objects; DELETE FROM links; DELETE FROM templates;');
  db.exec("DELETE FROM types WHERE id != 'daily'");
  return true;
}

function ensureColumn(table, col, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name);
  if (!cols.includes(col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    return true;
  }
  return false;
}

/** Close the current vault (if any) and open another file. */
function openVault(file) {
  closeDb();
  initDb(file);
}

// One-time fixups for databases created by earlier builds (emoji era → icon keys).
function migrate() {
  const LEGACY = {
    '📅': 'calendar-days',
    '📝': 'file-text',
    '✅': 'circle-check',
    '📂': 'folder',
    '👤': 'user',
    '📦': 'box',
  };
  const upd = db.prepare('UPDATE types SET emoji = ? WHERE emoji = ?');
  for (const [emoji, icon] of Object.entries(LEGACY)) upd.run(icon, emoji);

  // Backfill the search index for notes written before content search existed.
  runOnce('backfill-search-text', () => {
    const rows = db.prepare("SELECT id, content FROM objects WHERE content IS NOT NULL AND search_text = ''").all();
    const upd = db.prepare('UPDATE objects SET search_text = ? WHERE id = ?');
    for (const r of rows) upd.run(plainText(r.content), r.id);
  });

  /**
   * Study briefly shipped a builtin Vocabulary type, so every word also became
   * an object in the sidebar's type list. It shouldn't have: what is made in the
   * Study tab belongs to the Study tab. The flashcards are the real record and
   * they stay exactly as they are, history included — only the objects and the
   * type go. The reverse "recall" cards go with them, since asking both ways is
   * now something a deck opts into rather than the default.
   */
  runOnce('study-no-vocab-type', () => {
    const orphaned = db.prepare("SELECT id, extra FROM cards WHERE obj_id IN (SELECT id FROM objects WHERE type_id = 'vocab')").all();
    const reverse = orphaned.filter((c) => {
      try {
        return JSON.parse(c.extra || '{}').dir === 'recall';
      } catch {
        return false;
      }
    });
    for (const c of reverse) {
      db.prepare('DELETE FROM reviews WHERE card_id = ?').run(c.id);
      db.prepare('DELETE FROM cards WHERE id = ?').run(c.id);
    }
    db.prepare("UPDATE cards SET obj_id = NULL WHERE obj_id IN (SELECT id FROM objects WHERE type_id = 'vocab')").run();
    db.exec(
      `DELETE FROM links WHERE from_id IN (SELECT id FROM objects WHERE type_id = 'vocab')
          OR to_id IN (SELECT id FROM objects WHERE type_id = 'vocab');
       DELETE FROM objects WHERE type_id = 'vocab';
       DELETE FROM templates WHERE type_id = 'vocab';
       DELETE FROM types WHERE id = 'vocab';`
    );
  });

  /**
   * The old Person type is replaced by People — a standalone directory with its
   * own properties and view. Person entries are dropped rather than carried
   * over, and anything that pointed a relation at Person now points at People.
   */
  runOnce('people-v1', () => {
    if (getType('person')) {
      db.exec(
        `DELETE FROM links WHERE from_id IN (SELECT id FROM objects WHERE type_id = 'person')
            OR to_id IN (SELECT id FROM objects WHERE type_id = 'person');
         DELETE FROM objects WHERE type_id = 'person';
         DELETE FROM templates WHERE type_id = 'person';
         DELETE FROM types WHERE id = 'person';`
      );
    }
    ensurePeopleType();
    const upd = db.prepare('UPDATE types SET properties = ? WHERE id = ?');
    for (const t of db.prepare('SELECT id, properties FROM types').all()) {
      let defs;
      try {
        defs = JSON.parse(t.properties || '[]');
      } catch {
        continue;
      }
      if (!defs.some((p) => p.targetTypeId === 'person')) continue;
      upd.run(JSON.stringify(defs.map((p) => (p.targetTypeId === 'person' ? { ...p, targetTypeId: PEOPLE_TYPE } : p))), t.id);
    }
  });

  /**
   * Relationship becomes a multi-select — someone can be a colleague and a
   * friend — over a longer list of kinds. Single values become one-item lists,
   * any option a user added by hand is kept, and the self card loses the
   * property altogether: there is no relationship between me and me.
   */
  runOnce('people-relationships-v2', () => {
    const type = getType(PEOPLE_TYPE);
    if (!type) return;
    const defs = (type.properties || []).map((p) => {
      if (p.id !== 'relationship') return p;
      const extra = (p.options || []).filter((o) => !RELATIONSHIPS.includes(o));
      return { ...p, kind: 'multiselect', options: [...RELATIONSHIPS, ...extra] };
    });
    db.prepare('UPDATE types SET properties = ? WHERE id = ?').run(JSON.stringify(defs), PEOPLE_TYPE);

    const self = selfId();
    const upd = db.prepare('UPDATE objects SET props = ? WHERE id = ?');
    for (const r of db.prepare('SELECT id, props FROM objects WHERE type_id = ?').all(PEOPLE_TYPE)) {
      let props;
      try {
        props = JSON.parse(r.props || '{}');
      } catch {
        continue;
      }
      const was = props.relationship;
      if (r.id === self) {
        if (was === undefined) continue;
        delete props.relationship;
      } else if (was == null || was === '' || Array.isArray(was)) continue;
      else props.relationship = [String(was)];
      upd.run(JSON.stringify(props), r.id);
    }
  });

  // Anything that happens at a time rather than on a day needs somewhere to put
  // that time. Added once: a user who removes either property again shouldn't
  // have it grow back on the next launch.
  runOnce('timed-props-v1', () => {
    for (const typeId of TIMED_TYPES) {
      const type = getType(typeId);
      if (!type) continue;
      db.prepare('UPDATE types SET properties = ? WHERE id = ?').run(
        JSON.stringify(withTimeProps(typeId, type.properties)),
        typeId
      );
    }
  });

  /**
   * Repeating came later than timing, so the same types need the rule property
   * back-filled. Separate from timed-props-v1 rather than folded into it: a
   * vault that already ran that one would otherwise never be offered `repeat`.
   */
  runOnce('repeat-prop-v1', () => {
    const upd = db.prepare('UPDATE types SET properties = ? WHERE id = ?');
    for (const typeId of TIMED_TYPES) {
      const type = getType(typeId);
      if (!type || type.properties.some((p) => p.id === REPEAT_PROP)) continue;
      upd.run(JSON.stringify([...type.properties, { id: REPEAT_PROP, name: 'Repeats', kind: 'repeat' }]), typeId);
    }
  });

  /**
   * An Event is a thing that happens — a meeting, a flight, a holiday. It isn't
   * a to-do and can't be ticked off, which is exactly why it is its own type:
   * anything with a "Done" option is a task everywhere else in Habitat.
   *
   * Tasks live inside events through `partOf`, so a team meeting can carry its
   * agenda and a flight its booking details.
   */
  runOnce('event-type-v2', () => {
    const defs = [
      { id: TIME_PROP, name: 'Starts', kind: 'datetime' },
      { id: END_PROP, name: 'Ends', kind: 'datetime' },
      { id: 'location', name: 'Where', kind: 'text' },
      { id: 'attendees', name: 'With', kind: 'relation', targetTypeId: PEOPLE_TYPE },
      { id: REPEAT_PROP, name: 'Repeats', kind: 'repeat' },
    ];
    const existing = getType('event');
    if (existing) {
      // An earlier build's Event had a length in minutes rather than an end.
      const kept = existing.properties.filter((p) => !defs.some((d) => d.id === p.id) && p.id !== DURATION_PROP);
      db.prepare('UPDATE types SET properties = ? WHERE id = ?').run(JSON.stringify([...defs, ...kept]), 'event');
      return;
    }
    // A vault deliberately emptied to "blank" keeps its empty type list.
    const others = db.prepare("SELECT COUNT(*) AS c FROM types WHERE id NOT IN ('daily', ?)").get(PEOPLE_TYPE);
    if (!others || !others.c) return;
    db.prepare(
      'INSERT INTO types (id, name, emoji, color, properties, builtin, starred, created_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?)'
    ).run('event', 'Event', 'calendar-days', '#7b5cd6', JSON.stringify(defs), now());
  });

  /**
   * Where a task sits, and what it belongs to. Somewhere to be and someone to be
   * there with are an event's business now, so Task hands both back — but only
   * from the type. A task that had a value keeps it as a property of its own,
   * because deleting what someone typed to tidy a schema is never worth it.
   */
  runOnce('task-partof-v1', () => {
    const type = getType('task');
    if (!type) return;

    const retired = type.properties.filter((p) => p.id === 'location' || p.id === 'attendees');
    const defs = type.properties.filter((p) => !retired.includes(p));
    if (!defs.some((p) => p.id === 'partOf'))
      defs.push({ id: 'partOf', name: 'Part of', kind: 'relation', targetTypeId: 'event' });
    db.prepare('UPDATE types SET properties = ? WHERE id = ?').run(JSON.stringify(defs), 'task');

    if (!retired.length) return;
    const upd = db.prepare('UPDATE objects SET extra_props = ? WHERE id = ?');
    for (const row of db.prepare("SELECT id, props, extra_props FROM objects WHERE type_id = 'task'").all()) {
      let props, extra;
      try {
        props = JSON.parse(row.props || '{}');
        extra = JSON.parse(row.extra_props || '[]');
      } catch {
        continue;
      }
      const filled = retired.filter((p) => {
        const v = props[p.id];
        return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);
      });
      const add = filled.filter((p) => !extra.some((e) => e.id === p.id));
      if (add.length) upd.run(JSON.stringify([...extra, ...add]), row.id);
    }
  });
}

/** Run a one-time data migration, remembered in the kv table. */
function runOnce(key, fn) {
  const flag = 'migration:' + key;
  if (db.prepare('SELECT 1 FROM kv WHERE key = ?').get(flag)) return;
  fn();
  db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(flag, String(now()));
}

// ---------- flavor template packs (onboarding / new habitats) ----------

function docP(text) {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

function docBullets(items) {
  return { type: 'bulletList', content: items.map(li) };
}

function docChecks(items) {
  return {
    type: 'taskList',
    content: items.map((text) => ({
      type: 'taskItem',
      attrs: { checked: false },
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })),
  };
}

const doc = (...content) => ({ type: 'doc', content });

// Each flavor gets its own TYPES, not just templates on generic ones — a Work
// habitat has Meeting/Project, School has Course, Personal has Book/Habit, and
// so on. People is deliberately excluded: it's seeded separately (see
// ensurePeopleType/seedPeople) so it's always available, in every flavor.
const FLAVOR_TYPES = {
  personal: [
    { id: 'note', name: 'Note', icon: 'file-text', color: '#2a78d6', properties: [] },
    {
      id: 'task', name: 'Task', icon: 'circle-check', color: '#008300',
      properties: [
        { id: 'status', name: 'Status', kind: 'select', options: ['Todo', 'Doing', 'Done'] },
        { id: 'due', name: 'Due', kind: 'date' },
        { id: 'partOf', name: 'Part of', kind: 'relation', targetTypeId: 'event' },
      ],
    },
    {
      id: 'event', name: 'Event', icon: 'calendar-days', color: '#7b5cd6',
      properties: [
        { id: 'startsAt', name: 'Starts', kind: 'datetime' },
        { id: 'endsAt', name: 'Ends', kind: 'datetime' },
        { id: 'location', name: 'Where', kind: 'text' },
        { id: 'attendees', name: 'With', kind: 'relation', targetTypeId: 'people' },
        { id: 'repeat', name: 'Repeats', kind: 'repeat' },
      ],
    },
    {
      id: 'book', name: 'Book', icon: 'book', color: '#1baf7a',
      properties: [
        { id: 'author', name: 'Author', kind: 'text' },
        { id: 'status', name: 'Status', kind: 'select', options: ['Want to read', 'Reading', 'Finished'] },
        { id: 'rating', name: 'Rating', kind: 'select', options: ['★', '★★', '★★★', '★★★★', '★★★★★'] },
      ],
    },
    {
      id: 'habit', name: 'Habit', icon: 'zap', color: '#eb6834',
      properties: [
        { id: 'frequency', name: 'Frequency', kind: 'select', options: ['Daily', 'Weekly', 'Monthly'] },
        { id: 'status', name: 'Status', kind: 'select', options: ['Building', 'Established'] },
      ],
    },
  ],
  work: [
    { id: 'note', name: 'Note', icon: 'file-text', color: '#2a78d6', properties: [] },
    {
      id: 'project', name: 'Project', icon: 'folder', color: '#eda100',
      properties: [
        { id: 'status', name: 'Status', kind: 'select', options: ['Active', 'On hold', 'Done'] },
        { id: 'deadline', name: 'Deadline', kind: 'date' },
        { id: 'link', name: 'Link', kind: 'url' },
      ],
    },
    {
      id: 'task', name: 'Task', icon: 'circle-check', color: '#008300',
      properties: [
        { id: 'status', name: 'Status', kind: 'select', options: ['Todo', 'Doing', 'Done'] },
        { id: 'due', name: 'Due', kind: 'date' },
        { id: 'project', name: 'Project', kind: 'relation', targetTypeId: 'project' },
        { id: 'partOf', name: 'Part of', kind: 'relation', targetTypeId: 'event' },
      ],
    },
    {
      id: 'event', name: 'Event', icon: 'calendar-days', color: '#7b5cd6',
      properties: [
        { id: 'startsAt', name: 'Starts', kind: 'datetime' },
        { id: 'endsAt', name: 'Ends', kind: 'datetime' },
        { id: 'location', name: 'Where', kind: 'text' },
        { id: 'attendees', name: 'With', kind: 'relation', targetTypeId: 'people' },
        { id: 'repeat', name: 'Repeats', kind: 'repeat' },
      ],
    },
    {
      id: 'meeting', name: 'Meeting', icon: 'coffee', color: '#1baf7a',
      properties: [
        { id: 'date', name: 'Date', kind: 'date' },
        { id: 'attendees', name: 'Attendees', kind: 'relation', targetTypeId: 'people' },
      ],
    },
  ],
  school: [
    { id: 'note', name: 'Note', icon: 'file-text', color: '#2a78d6', properties: [] },
    {
      id: 'course', name: 'Course', icon: 'bookmark', color: '#1baf7a',
      properties: [
        { id: 'instructor', name: 'Instructor', kind: 'text' },
        { id: 'term', name: 'Term', kind: 'text' },
      ],
    },
    {
      id: 'task', name: 'Assignment', icon: 'circle-check', color: '#008300',
      properties: [
        { id: 'status', name: 'Status', kind: 'select', options: ['Todo', 'Doing', 'Done'] },
        { id: 'due', name: 'Due', kind: 'date' },
        { id: 'course', name: 'Course', kind: 'relation', targetTypeId: 'course' },
        { id: 'partOf', name: 'Part of', kind: 'relation', targetTypeId: 'event' },
      ],
    },
    {
      id: 'event', name: 'Event', icon: 'calendar-days', color: '#7b5cd6',
      properties: [
        { id: 'startsAt', name: 'Starts', kind: 'datetime' },
        { id: 'endsAt', name: 'Ends', kind: 'datetime' },
        { id: 'location', name: 'Where', kind: 'text' },
        { id: 'attendees', name: 'With', kind: 'relation', targetTypeId: 'people' },
        { id: 'repeat', name: 'Repeats', kind: 'repeat' },
      ],
    },
  ],
  creative: [
    { id: 'note', name: 'Note', icon: 'file-text', color: '#2a78d6', properties: [] },
    {
      id: 'project', name: 'Project', icon: 'folder', color: '#eda100',
      properties: [
        { id: 'status', name: 'Status', kind: 'select', options: ['Active', 'On hold', 'Done'] },
        { id: 'medium', name: 'Medium', kind: 'text' },
      ],
    },
    {
      id: 'reference', name: 'Reference', icon: 'camera', color: '#1baf7a',
      properties: [
        { id: 'link', name: 'Link', kind: 'url' },
        { id: 'tag', name: 'Tag', kind: 'select', options: ['Visual', 'Audio', 'Text', 'Other'] },
      ],
    },
    {
      id: 'task', name: 'Task', icon: 'circle-check', color: '#008300',
      properties: [
        { id: 'status', name: 'Status', kind: 'select', options: ['Todo', 'Doing', 'Done'] },
        { id: 'due', name: 'Due', kind: 'date' },
        { id: 'project', name: 'Project', kind: 'relation', targetTypeId: 'project' },
        { id: 'partOf', name: 'Part of', kind: 'relation', targetTypeId: 'event' },
      ],
    },
    {
      id: 'event', name: 'Event', icon: 'calendar-days', color: '#7b5cd6',
      properties: [
        { id: 'startsAt', name: 'Starts', kind: 'datetime' },
        { id: 'endsAt', name: 'Ends', kind: 'datetime' },
        { id: 'location', name: 'Where', kind: 'text' },
        { id: 'attendees', name: 'With', kind: 'relation', targetTypeId: 'people' },
        { id: 'repeat', name: 'Repeats', kind: 'repeat' },
      ],
    },
  ],
  blank: [],
};

function seedTypesForFlavor(flavor) {
  const list = FLAVOR_TYPES[flavor] || [];
  const ins = db.prepare(
    'INSERT OR IGNORE INTO types (id, name, emoji, color, properties, builtin, starred, created_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?)'
  );
  list.forEach((t, i) =>
    ins.run(t.id, t.name, t.icon, t.color, JSON.stringify(withTimeProps(t.id, t.properties)), now() + i)
  );
  return list.length;
}

const FLAVOR_TEMPLATES = {
  personal: [
    {
      typeId: 'note', name: 'Weekly reflection',
      content: doc(docBullets(['What gave me energy this week?', 'What drained me?', 'One thing to change next week.'])),
    },
    {
      typeId: 'habit', name: 'New habit', props: { status: 'Building', frequency: 'Daily' },
      content: doc(docP('Why this habit matters — and the trigger, routine, and reward that will make it stick.')),
    },
  ],
  work: [
    {
      typeId: 'meeting', name: '1:1',
      content: doc(docP('Wins since last time:'), docBullets(['—']), docP('Blockers:'), docBullets(['—']), docP('One growth topic:'), docBullets(['—'])),
    },
    {
      typeId: 'project', name: 'Client project', props: { status: 'Active' },
      content: doc(docP('Goal, scope, stakeholders, and risks. Link people with @ as they join.')),
    },
  ],
  school: [
    {
      typeId: 'note', name: 'Lecture notes',
      content: doc(docP('Big ideas:'), docBullets(['—']), docP('Questions to follow up:'), docBullets(['—'])),
    },
    {
      typeId: 'task', name: 'Assignment checklist',
      content: doc(docChecks(['Read the brief', 'Draft', 'Review', 'Submit'])),
    },
  ],
  creative: [
    {
      typeId: 'note', name: 'Idea capture',
      content: doc(docP('What is it? Why now? What is the smallest version I could make this week?')),
    },
    {
      typeId: 'project', name: 'Creative project', props: { status: 'Active' },
      content: doc(docBullets(['Vision', 'References & inspiration', 'Next physical action'])),
    },
  ],
  blank: [],
};

function seedFlavor(flavor) {
  seedTypesForFlavor(flavor);
  const list = FLAVOR_TEMPLATES[flavor] || [];
  const ins = db.prepare('INSERT INTO templates (id, type_id, name, props, content, extra_props, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const t of list) {
    ins.run(
      uid(), t.typeId, t.name,
      JSON.stringify(t.props || {}),
      t.content ? JSON.stringify(t.content) : null,
      JSON.stringify(t.extraProps || []),
      now()
    );
  }
  return list.length;
}

// ---------- People ----------
//
// People is a type like any other — so @-mentions, relations and backlinks all
// keep working — but it ships with a fixed set of properties and has
// its own view instead of the generic table. PEOPLE_PROPS live on the type;
// PEOPLE_FIELDS is a catalogue of extras any single person can be given. The
// user's own card is the exception: it is its own entity, fixed once made and
// without the properties that only describe someone else (SELF_HIDDEN_PROPS).

const PEOPLE_TYPE = 'people';

/** People wear more than one hat — relationship is a multi-select, so a friend can also be a colleague. */
const RELATIONSHIPS = [
  'Partner',
  'Spouse',
  'Family',
  'Parent',
  'Sibling',
  'Child',
  'Relative',
  'Close friend',
  'Friend',
  'Acquaintance',
  'Neighbour',
  'Flatmate',
  'Colleague',
  'Manager',
  'Direct report',
  'Teammate',
  'Client',
  'Business partner',
  'Collaborator',
  'Mentor',
  'Mentee',
  'Classmate',
];

const PEOPLE_PROPS = [
  { id: 'nickname', name: 'Nickname', kind: 'text' },
  { id: 'relationship', name: 'Relationship', kind: 'multiselect', options: RELATIONSHIPS },
  { id: 'birthday', name: 'Birthday', kind: 'date' },
  { id: 'phone', name: 'Phone', kind: 'phone' },
  { id: 'email', name: 'Email', kind: 'email' },
  { id: 'company', name: 'Company', kind: 'text' },
  { id: 'role', name: 'Role', kind: 'text' },
];

/**
 * The self card is its own entity, not one of the contacts: properties that
 * describe a link between you and someone else make no sense on it — there is
 * no relationship between me and me. Kept out of the editor and stripped on
 * write. Mirrored in src/util.ts, which hides them in the person page.
 */
const SELF_HIDDEN_PROPS = ['relationship'];

/** Optional details, added per person. Ids are stable so the same field means the same thing everywhere. */
const PEOPLE_FIELDS = [
  {
    group: 'Contact',
    fields: [
      { id: 'phone2', name: 'Other phone', kind: 'phone' },
      { id: 'email2', name: 'Other email', kind: 'email' },
      { id: 'address', name: 'Address', kind: 'text' },
      { id: 'location', name: 'Location', kind: 'text' },
      { id: 'timezone', name: 'Timezone', kind: 'text' },
    ],
  },
  {
    group: 'Work',
    fields: [
      { id: 'workEmail', name: 'Work email', kind: 'email' },
      { id: 'team', name: 'Team', kind: 'text' },
      { id: 'website', name: 'Website', kind: 'url' },
      { id: 'linkedin', name: 'LinkedIn', kind: 'url' },
    ],
  },
  {
    group: 'Social',
    fields: [
      { id: 'instagram', name: 'Instagram', kind: 'text' },
      { id: 'telegram', name: 'Telegram', kind: 'text' },
      { id: 'whatsapp', name: 'WhatsApp', kind: 'phone' },
      { id: 'signal', name: 'Signal', kind: 'phone' },
      { id: 'x', name: 'X', kind: 'text' },
      { id: 'github', name: 'GitHub', kind: 'text' },
    ],
  },
  {
    group: 'Personal',
    fields: [
      { id: 'partner', name: 'Partner', kind: 'relation', targetTypeId: PEOPLE_TYPE },
      { id: 'family', name: 'Family', kind: 'relation', targetTypeId: PEOPLE_TYPE },
      { id: 'kids', name: 'Kids', kind: 'relation', targetTypeId: PEOPLE_TYPE },
      { id: 'anniversary', name: 'Anniversary', kind: 'date' },
      { id: 'metOn', name: 'Met on', kind: 'date' },
      { id: 'howWeMet', name: 'How we met', kind: 'text' },
      { id: 'interests', name: 'Interests', kind: 'text' },
      { id: 'languages', name: 'Languages', kind: 'text' },
      { id: 'foodDrink', name: 'Food & drink', kind: 'text' },
      { id: 'allergies', name: 'Allergies', kind: 'text' },
      { id: 'giftIdeas', name: 'Gift ideas', kind: 'longtext' },
      { id: 'pets', name: 'Pets', kind: 'text' },
    ],
  },
  {
    group: 'Keeping in touch',
    fields: [
      { id: 'lastCaughtUp', name: 'Last caught up', kind: 'date' },
      {
        id: 'cadence',
        name: 'Keep in touch',
        kind: 'select',
        options: ['Weekly', 'Monthly', 'Quarterly', 'Twice a year', 'Yearly'],
      },
    ],
  },
];

function ensurePeopleType() {
  const existing = getType(PEOPLE_TYPE);
  if (existing) return existing;
  db.prepare('INSERT INTO types (id, name, emoji, color, properties, builtin, starred, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    PEOPLE_TYPE, 'People', 'users', '#4a3aa7', JSON.stringify(PEOPLE_PROPS), 1, 0, now()
  );
  return getType(PEOPLE_TYPE);
}

/**
 * Birthday maths, from a 'YYYY-MM-DD' value. The year is only used for ages, so
 * a placeholder year still gives a correct countdown; ages are reported only
 * when the year looks real.
 */
function birthdayInfo(value, from = new Date()) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let next = new Date(today.getFullYear(), month - 1, day);
  if (next < today) next = new Date(today.getFullYear() + 1, month - 1, day);
  const days = Math.round((next - today) / 86400000);
  const knownYear = year >= 1900;
  const turning = knownYear ? next.getFullYear() - year : null;
  return {
    date: value,
    month,
    day,
    days,
    key: todayKey(next),
    turning,
    age: turning == null ? null : days === 0 ? turning : turning - 1,
  };
}

const selfId = () => db.prepare("SELECT value FROM kv WHERE key = 'selfPersonId'").get()?.value || null;

/** One person, with the derived bits every view wants: are they me, when's the next birthday. */
function decoratePerson(obj, self = selfId()) {
  if (!obj) return null;
  return { ...obj, isSelf: obj.id === self, nextBirthday: birthdayInfo(obj.props?.birthday) };
}

function listPeople() {
  const self = selfId();
  return db
    .prepare(`SELECT * FROM objects WHERE type_id = ? ORDER BY title COLLATE NOCASE`)
    .all(PEOPLE_TYPE)
    .map((r) => decoratePerson(parseObj(r), self));
}

function ensureTagType() {
  const existing = getType('tag');
  if (existing) return existing;
  db.prepare('INSERT INTO types (id, name, emoji, color, properties, builtin, starred, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    'tag', 'Tag', 'tag', '#eb6834', '[]', 1, 0, now()
  );
  return getType('tag');
}

/**
 * Onboarding: save the user's own name (used for the dashboard greeting) and
 * create their own card plus anyone else they listed — every person is
 * mentionable with @ anywhere, since mentions search across all objects. The
 * user's own card is marked as the self card.
 */
function seedPeople(userName, people) {
  ensurePeopleType();
  const name = String(userName || '').trim();
  if (name) {
    db.prepare(
      "INSERT INTO kv (key, value) VALUES ('profile', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(JSON.stringify({ name }));
    const me = createObject({ typeId: PEOPLE_TYPE, title: name });
    if (me) setSelfPerson(me.id);
  }
  for (const p of people || []) {
    const pname = String(p?.name || '').trim();
    if (!pname) continue;
    // Nickname is a People type property, so it needs no per-object extraProp.
    const nickname = String(p?.nickname || '').trim();
    createObject({ typeId: PEOPLE_TYPE, title: pname, props: nickname ? { nickname } : {} });
  }
}

/**
 * Point at the card that is "me". Internal on purpose: the self card is claimed
 * when it is created and never handed over to another person; passing null only
 * clears a pointer whose card is gone.
 */
function setSelfPerson(id) {
  if (!id) {
    db.prepare("DELETE FROM kv WHERE key = 'selfPersonId'").run();
    return null;
  }
  const obj = getObj(id);
  if (!obj || obj.typeId !== PEOPLE_TYPE) return null;
  db.prepare("INSERT INTO kv (key, value) VALUES ('selfPersonId', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(id);
  return decoratePerson(obj, id);
}

/**
 * Point Habitat at a different vault folder. If the folder already contains a
 * habitat.db it is opened as-is; otherwise the current vault is copied there.
 * The previous file is left in place as a backup.
 */
function switchVault(dir) {
  const target = path.join(dir, 'habitat.db');
  if (path.resolve(target) === path.resolve(currentFile)) return { dbPath: currentFile, changed: false, existed: true };
  const existed = fs.existsSync(target);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
  if (!existed) fs.copyFileSync(currentFile, target);
  initDb(target);
  return { dbPath: target, changed: true, existed };
}

// ---------- sync ----------
//
// The vault's half of syncing: what has changed, and how to take in what
// changed elsewhere. The engine that talks to the hub lives in sync.js and
// reaches the database only through here, so it never needs a handle of its own
// and never has to know how a link or a search index is kept up to date.

/** SQLite will only bind these; jsonb hands back booleans and nested values. */
const bindable = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
};

const columnCache = new Map();
const columnsOf = (table) => {
  if (!columnCache.has(table)) {
    columnCache.set(table, db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  }
  return columnCache.get(table);
};

/**
 * Write one row from the hub. Only columns this build actually has are used: a
 * phone a version behind must be able to take a row a newer laptop wrote rather
 * than failing on a column it has never heard of, and the column it drops is
 * one it has no way to display anyway.
 */
function writeRemoteRow(table, pk, id, data) {
  const cols = columnsOf(table).filter((c) => Object.prototype.hasOwnProperty.call(data, c));
  if (!cols.includes(pk)) cols.push(pk);
  const set = cols.filter((c) => c !== pk).map((c) => `${c} = excluded.${c}`);
  const sql =
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})` +
    (set.length ? ` ON CONFLICT(${pk}) DO UPDATE SET ${set.join(', ')}` : ` ON CONFLICT(${pk}) DO NOTHING`);
  db.prepare(sql).run(...cols.map((c) => (c === pk ? id : bindable(data[c]))));
}

/** Recompute what an object points at, since links are never synced. */
function relink(id) {
  const r = db.prepare('SELECT * FROM objects WHERE id = ?').get(id);
  if (!r) return;
  const parse = (s, fallback) => {
    try {
      return s ? JSON.parse(s) : fallback;
    } catch {
      return fallback;
    }
  };
  syncMentionLinks(id, parse(r.content, null));
  syncRelationLinks(id, r.type_id, parse(r.props, {}), parse(r.extra_props, []));
}

/**
 * Take in a batch pulled from the hub, all or nothing.
 *
 * Writing these rows trips the tracking triggers exactly as a local edit would,
 * which would send them straight back up again. So each row's queue entry is
 * cleared as it lands — that is this device hearing its own echo, not a change
 * anyone made here. It is safe to do inside the transaction because nothing
 * else can write to the vault while it is open: the data layer is synchronous
 * and single-threaded.
 */
function applyRemote(rows) {
  const objectsTouched = new Set();
  const forget = db.prepare('DELETE FROM sync_changes WHERE tbl = ? AND row_id = ?');
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      const spec = synclog.TABLES.find((t) => t.name === r.table);
      if (!spec) continue; // A table this build doesn't have yet.
      if (r.deleted) db.prepare(`DELETE FROM ${spec.name} WHERE ${spec.pk} = ?`).run(r.id);
      else writeRemoteRow(spec.name, spec.pk, r.id, r.row || {});
      if (spec.name === 'objects') objectsTouched.add(r.id);
      forget.run(spec.name, r.id);
    }
    for (const id of objectsTouched) relink(id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return rows.length;
}

// ---------- attachments ----------
//
// The rows in `files` are only a description; the bytes live beside the vault
// in a folder addressed by content. Syncing the description without the bytes
// is what makes an image arrive on another device as a broken one, so the two
// travel separately and are reconciled separately.
//
// Being addressed by content is what keeps this simple: a blob never changes,
// so it is uploaded once and never again, and it can be fetched whenever it
// turns out to be missing rather than in step with anything else.

/** Attachments this device has that the hub has not been told about. */
const blobsToUpload = (limit = 20) =>
  db
    .prepare(
      `SELECT f.hash, f.ext, f.name, f.mime FROM files f
       WHERE NOT EXISTS (SELECT 1 FROM sync_blobs b WHERE b.hash = f.hash)
       ORDER BY f.created_at LIMIT ?`
    )
    .all(limit)
    .filter((f) => files.resolve(f.hash, f.ext)); // Skip ones whose bytes have gone missing locally.

const markBlobUploaded = (hash) =>
  db.prepare('INSERT OR REPLACE INTO sync_blobs (hash, at) VALUES (?, ?)').run(hash, now());

/** Attachments this vault knows about but hasn't got the bytes for. */
const blobsMissing = (limit = 20) =>
  db
    .prepare('SELECT hash, ext, name FROM files ORDER BY created_at LIMIT ?')
    .all(limit * 10)
    .filter((f) => !files.resolve(f.hash, f.ext))
    .slice(0, limit);

const readBlob = (hash, ext) => {
  const at = files.resolve(hash, ext);
  return at ? fs.readFileSync(at) : null;
};

/**
 * Keep bytes fetched from the hub. The store hashes what it is given, so a
 * download that arrived damaged lands under a different name than the one asked
 * for — which is how we notice rather than quietly saving a corrupt file.
 */
function saveBlob(hash, name, buffer) {
  const stored = files.store(buffer, name || '');
  if (stored.hash !== hash) {
    files.remove(stored.hash, stored.ext);
    throw new Error(`downloaded attachment did not match its hash (${hash.slice(0, 8)}…)`);
  }
  markBlobUploaded(hash); // It is demonstrably on the hub — we just got it from there.
  return stored;
}

/** Everything sync.js is allowed to do to the vault. */
const sync = {
  blobsToUpload,
  blobsMissing,
  markBlobUploaded,
  readBlob,
  saveBlob,
  pending: (limit) => synclog.pending(db, limit),
  ack: (entries) => synclog.ack(db, entries),
  pendingCount: () => synclog.pendingCount(db),
  deviceId: () => synclog.deviceId(db),
  cursor: () => synclog.getState(db, 'cursor'),
  setCursor: (v) => synclog.setState(db, 'cursor', v),
  applyRemote,
};

module.exports = { initDb, api, sync, setNotifier, setTelegramSender, switchVault, openVault, closeDb, seedFlavor, resetToBlank, seedPeople, ensurePeopleType, ensureTagType };
