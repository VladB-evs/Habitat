// Search goes through an FTS5 index kept in step by triggers. These cover the
// two things that break quietly: the index drifting away from the objects
// table, and operators being parsed wrong. Run with `npm test`.

import { createRequire } from 'node:module';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dbmod = require('./db.js');
const { DatabaseSync } = require('node:sqlite');

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-search-')), 'test.db');
const api = dbmod.api;
const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const day = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const titles = (rows) => rows.map((r) => r.title).sort();

before(() => {
  dbmod.initDb(file);
  dbmod.seedFlavor('work');
  api['objects:create']({
    typeId: 'note',
    title: 'Sourdough starter',
    content: doc('hydration around seventy percent, feed it twice a day'),
  });
  api['objects:create']({ typeId: 'note', title: 'Café notes', content: doc('espresso machine descaling') });
  api['objects:create']({ typeId: 'task', title: 'Buy flour', props: { status: 'Todo', due: day(2) } });
  api['objects:create']({ typeId: 'task', title: 'Overdue thing', props: { status: 'Todo', due: day(-3) } });
  api['objects:create']({ typeId: 'project', title: 'Bakery', props: {} });
});

after(() => {
  dbmod.closeDb();
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test('finds by title, and by body only when asked', () => {
  assert.equal(api['objects:search']({ q: 'sourdough' }).length, 1);
  assert.equal(api['objects:search']({ q: 'hydration' }).length, 0, 'body is not searched by default');
  assert.equal(api['objects:search']({ q: 'hydration', content: true }).length, 1);
});

test('a body hit carries the text around it, a title hit does not', () => {
  const [body] = api['objects:search']({ q: 'hydration', content: true });
  assert.match(body.match, /hydration/);
  const [title] = api['objects:search']({ q: 'sourdough', content: true });
  assert.equal(title.match, undefined);
});

test('matches while you type, and ignores accents', () => {
  assert.equal(api['objects:search']({ q: 'sour' }).length, 1, 'prefix');
  assert.equal(api['objects:search']({ q: 'cafe' }).length, 1, 'cafe finds Café');
  assert.equal(api['objects:search']({ q: 'café' }).length, 1, 'and the other way round');
});

test('punctuation cannot leak into FTS syntax', () => {
  for (const q of ['"', '*', 'NOT', 'a OR b', '(', 'foo:', '^bar', '-x']) {
    assert.doesNotThrow(() => api['objects:search']({ q, content: true }), `query ${JSON.stringify(q)}`);
  }
});

test('operators filter', () => {
  assert.deepEqual(titles(api['objects:search']({ q: 'type:task' })), ['Buy flour', 'Overdue thing']);
  assert.deepEqual(titles(api['objects:search']({ q: 'type:tasks flour' })), ['Buy flour'], 'plural forgiven');
  assert.deepEqual(titles(api['objects:search']({ q: 'due:week type:task' })), ['Buy flour']);
  assert.deepEqual(titles(api['objects:search']({ q: 'due:overdue type:task' })), ['Overdue thing']);
  assert.equal(api['objects:search']({ q: 'created:today type:project' }).length, 1);
  assert.equal(api['objects:search']({ q: 'created:yesterday' }).length, 0);
  assert.equal(api['objects:search']({ q: 'type:nonexistent' }).length, 0, 'unknown type matches nothing');
});

test('is:pinned narrows to pinned objects', () => {
  const [flour] = api['objects:search']({ q: 'flour' });
  assert.equal(api['objects:search']({ q: 'is:pinned' }).length, 0);
  api['objects:update']({ id: flour.id, patch: { pinned: true } });
  assert.deepEqual(titles(api['objects:search']({ q: 'is:pinned' })), ['Buy flour']);
  api['objects:update']({ id: flour.id, patch: { pinned: false } });
});

test('the index follows creates, edits and deletes', () => {
  const o = api['objects:create']({ typeId: 'note', title: 'Ephemeral', content: doc('zzzuniquetoken') });
  assert.equal(api['objects:search']({ q: 'zzzuniquetoken', content: true }).length, 1);

  api['objects:update']({ id: o.id, patch: { content: doc('replaced entirely') } });
  assert.equal(api['objects:search']({ q: 'zzzuniquetoken', content: true }).length, 0, 'old text is gone');
  assert.equal(api['objects:search']({ q: 'replaced', content: true }).length, 1);

  api['objects:update']({ id: o.id, patch: { title: 'Renamed' } });
  assert.equal(api['objects:search']({ q: 'Ephemeral' }).length, 0);
  assert.equal(api['objects:search']({ q: 'Renamed' }).length, 1);

  api['objects:delete'](o.id);
  assert.equal(api['objects:search']({ q: 'replaced', content: true }).length, 0);

  const raw = new DatabaseSync(file);
  const { o: objects, f: indexed } = raw
    .prepare('SELECT (SELECT COUNT(*) FROM objects) o, (SELECT COUNT(*) FROM objects_fts) f')
    .get();
  raw.close();
  assert.equal(indexed, objects, 'index and objects stay the same size');
});

test('people are findable by nickname', () => {
  dbmod.ensurePeopleType();
  api['people:create']({ title: 'Ana Popescu', props: { nickname: 'Anush' } });
  assert.deepEqual(titles(api['objects:search']({ q: 'anush' })), ['Ana Popescu']);
});
