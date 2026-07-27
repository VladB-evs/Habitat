// Habitat data layer — everything is an object of a type; links connect objects.
// Runs in the Electron main process on node:sqlite (no native build step).
const fs = require('fs');
const path = require('path');
const { randomBytes, randomUUID } = require('crypto');
const { DatabaseSync } = require('node:sqlite');

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
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_links_to ON links(to_id);
CREATE INDEX IF NOT EXISTS idx_links_from ON links(from_id);
`;

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
// object id, so they produce the same links, backlinks, and graph edges.
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

// ---------- core operations ----------


// ---------- habitat code ----------

/** HAB-XXXX-XXXX — a stable id for this file, unambiguous enough to read aloud. */
function makeHabitatCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = (n) =>
    Array.from(randomBytes(n))
      .map((b) => alphabet[b % alphabet.length])
      .join('');
  return `HAB-${pick(4)}-${pick(4)}`;
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

/** Tokens usable in any action text: object fields plus a few dates. */
function fillTemplate(text, obj) {
  return String(text ?? '').replace(/{{\s*([\w:+-]+)\s*}}/g, (_m, key) => {
    if (key === 'date' || key === 'today') return todayKey();
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

/** Values arrive as strings from the UI; coerce for the comparison being asked for. */
function compare(op, actual, expected) {
  const a = Array.isArray(actual) ? actual.join(', ') : actual;
  const empty = a == null || a === '' || (Array.isArray(actual) && actual.length === 0);
  if (op === 'empty') return empty;
  if (op === 'notEmpty') return !empty;
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

function conditionsPass(rule, obj) {
  const list = rule.conditions || [];
  if (!list.length) return true;
  if (!obj) return false;
  const check = (c) => compare(c.op || 'eq', c.propId === '__title' ? obj.title : obj.props?.[c.propId], c.value);
  return rule.match === 'any' ? list.some(check) : list.every(check);
}

/**
 * Turns action text into inline nodes. `{{link}}` becomes a real mention of the
 * object that set the rule off, so the daily note links to it (and backlinks
 * work) instead of just naming it.
 */
function renderInline(text, obj) {
  const raw = String(text ?? '');
  const nodes = [];
  const push = (t) => {
    const filled = fillTemplate(t, obj);
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

/** Appends one paragraph to a daily note (today's by default), creating it if needed. */
function appendToDaily(nodes, dateKey) {
  const key = dateKey || todayKey();
  const para = { type: 'paragraph', content: nodes.length ? nodes : [] };
  const row = db.prepare("SELECT * FROM objects WHERE type_id = 'daily' AND date_key = ?").get(key);
  if (!row)
    return createObject({ typeId: 'daily', title: formatDateKey(key), dateKey: key, content: { type: 'doc', content: [para] } });
  const doc = row.content ? JSON.parse(row.content) : { type: 'doc', content: [] };
  doc.content = [...(doc.content || []), para];
  return updateObject({ id: row.id, patch: { content: doc } });
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

function runAction(action, obj) {
  if (!action || !action.kind) return;

  if (action.kind === 'setProp') {
    if (!obj || !action.propId) return;
    const raw = fillTemplate(action.value, obj);
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
      const value = fillTemplate(p.value, obj);
      // Relations hold a list of ids — '{{id}}' points the new object back at this one.
      props[p.propId] = defs.find((d) => d.id === p.propId)?.kind === 'relation' ? (value ? [value] : []) : value;
    }
    const made = createObject({ typeId: action.typeId, title: fillTemplate(action.text || '{{title}}', obj), props });
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
    appendToDaily(renderInline(action.text || '{{link}}', obj));
    return;
  }

  if (action.kind === 'addTag') {
    const tag = ensureTag(fillTemplate(action.text, obj));
    if (!tag || !obj) return;
    db.prepare('INSERT OR IGNORE INTO links (id, from_id, to_id, kind) VALUES (?, ?, ?, ?)').run(
      uid(), obj.id, tag.id, 'mention'
    );
    return;
  }

  if (action.kind === 'link') {
    // Point a relation property at whatever object the rule names, by title.
    if (!obj || !action.propId) return;
    const wanted = fillTemplate(action.text, obj).toLowerCase();
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
    notifier(fillTemplate(action.text || '{{title}}', obj), fillTemplate(action.value || '', obj));
    return;
  }

  if (action.kind === 'telegram' && telegramSender) {
    telegramSender([fillTemplate(action.text || '{{title}}', obj), fillTemplate(action.value || '', obj)]
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

/** Timed rules: 'daily' at a time, 'weekly' on chosen days, 'dueToday' on a date property, 'birthday' on a person's. */
function runTimedRule(rule) {
  if (rule.trigger?.kind === 'birthday') {
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

function deleteObject(id) {
  const gone = getObj(id);
  db.prepare('DELETE FROM links WHERE from_id = ? OR to_id = ?').run(id, id);
  db.prepare('DELETE FROM objects WHERE id = ?').run(id);
  if (gone) runAutomations('deleted', gone);
  return true;
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

const api = {
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

  'objects:get': (id) => getObj(id, true),
  'objects:create': (p) => createObject(p),
  'objects:update': (p) => updateObject(p),
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
   * text of every note, including daily entries. Title hits rank above body hits.
   */
  /**
   * Matching happens in memory so title hits can be ranked above body hits and
   * the surrounding snippet returned with each result.
   */
  'objects:search': (payload) => {
    const { q, content } = typeof payload === 'string' ? { q: payload, content: false } : payload || {};
    const query = String(q || '').trim().toLowerCase();
    if (!query) return db.prepare('SELECT * FROM objects ORDER BY updated_at DESC LIMIT 20').all().map((r) => parseObj(r));

    const rows = db.prepare('SELECT * FROM objects ORDER BY updated_at DESC').all();
    const hits = [];
    for (const r of rows) {
      const title = String(r.title || '').toLowerCase();
      const nickname = String(JSON.parse(r.props || '{}').nickname || '').toLowerCase();
      const date = String(r.date_key || '').toLowerCase();
      const inTitle = title.includes(query);
      let match = null;
      if (!inTitle && content) {
        const text = r.search_text || '';
        const at = text.toLowerCase().indexOf(query);
        if (at >= 0) match = text.slice(Math.max(0, at - 40), at + query.length + 60).trim();
      }
      if (!inTitle && !match && !nickname.includes(query) && !date.includes(query)) continue;
      const o = parseObj(r);
      if (match) o.match = match;
      hits.push({ o, inTitle });
      if (hits.length >= (content ? 40 : 20) * 4) break;
    }
    hits.sort((a, b) => Number(b.inTitle) - Number(a.inTitle));
    return hits.slice(0, content ? 40 : 20).map((h) => h.o);
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

  'graph:data': () => {
    const nodes = db.prepare('SELECT id, title, type_id, date_key FROM objects').all().map((r) => ({
      id: r.id,
      title: r.title || 'Untitled',
      typeId: r.type_id,
    }));
    const have = new Set(nodes.map((n) => n.id));
    const edges = db
      .prepare('SELECT DISTINCT from_id, to_id FROM links')
      .all()
      .filter((r) => have.has(r.from_id) && have.has(r.to_id))
      .map((r) => ({ from: r.from_id, to: r.to_id }));
    return { nodes, edges };
  },

  'tasks:forDay': ({ dateKey }) => {
    if (dateKey === localToday()) rolloverTasks();
    return db
      .prepare("SELECT * FROM objects WHERE type_id = 'task'")
      .all()
      .map((r) => parseObj(r))
      .filter((o) => o.props.due === dateKey)
      .sort(
        (a, b) =>
          (a.props.status === 'Done' ? 1 : 0) - (b.props.status === 'Done' ? 1 : 0) || a.createdAt - b.createdAt
      );
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

  'people:create': ({ title, name, props, extraProps, self } = {}) => {
    ensurePeopleType();
    const made = createObject({
      typeId: PEOPLE_TYPE,
      title: String(title ?? name ?? '').trim(),
      props: props || {},
      extraProps: extraProps || [],
    });
    if (made && self) setSelfPerson(made.id);
    return decoratePerson(made);
  },

  /** The card that represents the user. `null` until one is chosen. */
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

  'people:setSelf': (id) => setSelfPerson(id || null),

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
        for (const action of rule.actions || []) runAction(action, null);
        markRun(rule.id);
        ran++;
      } catch (err) {
        console.error('automation failed', rule.name, err);
      }
    }
    return { ran };
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
    let cfg = { enabled: false, port: 37373, token: '' };
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
    let cur = { enabled: false, port: 37373, token: '' };
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
    const r = db.prepare("SELECT value FROM kv WHERE key = 'telegram'").get();
    if (!r) return { enabled: false, token: '', chatId: '', typeId: 'note' };
    try {
      return JSON.parse(r.value);
    } catch {
      return { enabled: false, token: '', chatId: '', typeId: 'note' };
    }
  },

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
  db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA journal_mode = WAL;');
  } catch {
    // WAL can fail on some filesystems or with stale lock files — the default journal still works.
  }
  db.exec(SCHEMA);
  ensureColumn('objects', 'extra_props', "extra_props TEXT NOT NULL DEFAULT '[]'");
  ensureColumn('objects', 'search_text', "search_text TEXT NOT NULL DEFAULT ''");
  const starredAdded = ensureColumn('types', 'starred', 'starred INTEGER NOT NULL DEFAULT 0');
  if (starredAdded) db.exec("UPDATE types SET starred = 1 WHERE id IN ('note', 'task', 'project')");
  seed();
  migrate();
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
  list.forEach((t, i) => ins.run(t.id, t.name, t.icon, t.color, JSON.stringify(t.properties || []), now() + i));
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
// People is a type like any other — so @-mentions, relations, backlinks and the
// graph all keep working — but it ships with a fixed set of properties and has
// its own view instead of the generic table. PEOPLE_PROPS live on the type;
// PEOPLE_FIELDS is a catalogue of extras any single person can be given.

const PEOPLE_TYPE = 'people';

const RELATIONSHIPS = [
  'Family',
  'Partner',
  'Close friend',
  'Friend',
  'Colleague',
  'Client',
  'Mentor',
  'Neighbour',
  'Acquaintance',
];

const PEOPLE_PROPS = [
  { id: 'nickname', name: 'Nickname', kind: 'text' },
  { id: 'relationship', name: 'Relationship', kind: 'select', options: RELATIONSHIPS },
  { id: 'birthday', name: 'Birthday', kind: 'date' },
  { id: 'phone', name: 'Phone', kind: 'phone' },
  { id: 'email', name: 'Email', kind: 'email' },
  { id: 'company', name: 'Company', kind: 'text' },
  { id: 'role', name: 'Role', kind: 'text' },
];

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

/** Mark which card is "me". Passing null clears it. */
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

module.exports = { initDb, api, setNotifier, setTelegramSender, switchVault, openVault, closeDb, seedFlavor, resetToBlank, seedPeople, ensurePeopleType, ensureTagType };
