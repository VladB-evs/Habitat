// Change tracking is invisible from the API — nothing the renderer calls knows
// it exists — so the only way to check it is to work the vault normally and
// then read the queue behind it. What matters is that ordinary writes are
// noticed without anyone having asked, that deletes leave a tombstone, and that
// the machine's own tokens never end up in the queue at all.
// Run with `npm test`.

import { createRequire } from 'node:module';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const dbmod = require('./db.js');
const synclog = require('./synclog.js');

// The main process keeps one flat map of channel → handler, which is what
// main.js hands to ipcMain. Tests speak to it the same way the renderer does.
const call = (channel, payload) => dbmod.api[channel](payload);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-synclog-'));
const file = path.join(tmp, 'vault.db');

/** A second handle on the same file, to read the queue without going through db.js. */
let raw;
const queue = () => raw.prepare('SELECT * FROM sync_changes ORDER BY tbl, row_id').all();
const entry = (tbl, id) => queue().find((c) => c.tbl === tbl && c.row_id === id);
const clear = () => raw.exec('DELETE FROM sync_changes');

before(() => {
  dbmod.initDb(file);
  dbmod.seedFlavor('work');
  raw = new DatabaseSync(file);
});

after(() => {
  raw?.close();
  dbmod.closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('a seeded vault arrives with its rows already queued', () => {
  const q = queue();
  assert.ok(q.length > 0, 'seeding should have been tracked');
  assert.ok(
    q.some((c) => c.tbl === 'types'),
    'the seeded types should be in the queue'
  );
  assert.ok(q.every((c) => c.deleted === 0), 'nothing has been deleted yet');
});

test('creating and editing an object queues it once, not once per write', () => {
  clear();
  const obj = call('objects:create', { typeId: 'note', title: 'First' });
  call('objects:update', { id: obj.id, patch: { title: 'Second' } });
  call('objects:update', { id: obj.id, patch: { title: 'Third' } });

  const mine = queue().filter((c) => c.tbl === 'objects' && c.row_id === obj.id);
  assert.equal(mine.length, 1, 'three writes, one queue entry');
  assert.equal(mine[0].deleted, 0);
});

test('deleting leaves a tombstone rather than nothing', () => {
  clear();
  const obj = call('objects:create', { typeId: 'note', title: 'Doomed' });
  call('objects:delete', obj.id);

  const e = entry('objects', obj.id);
  assert.ok(e, 'a deleted row still has to be reported');
  assert.equal(e.deleted, 1);
  assert.equal(raw.prepare('SELECT 1 FROM objects WHERE id = ?').get(obj.id), undefined, 'the row itself is gone');
});

test('an id that comes back stops being a tombstone', () => {
  clear();
  const obj = call('objects:create', { typeId: 'note', title: 'Twice' });
  call('objects:delete', obj.id);
  assert.equal(entry('objects', obj.id).deleted, 1);

  // The same id written again — an undo, or a row restored from another device.
  raw
    .prepare(
      `INSERT INTO objects (id, type_id, title, props, extra_props, search_text, created_at, updated_at)
       VALUES (?, 'note', 'Twice', '{}', '[]', '', 1, 1)`
    )
    .run(obj.id);
  assert.equal(entry('objects', obj.id).deleted, 0, 'a live row must not stay buried');
});

test('this machine’s tokens are never queued', () => {
  clear();
  call('telegram:save', { token: 'secret-bot-token', chatId: '123' });
  call('api:save', { token: 'secret-api-token', port: 8787 });
  call('vars:save', [{ id: 'v1', name: 'Home', value: 'Bucharest' }]);

  const keys = queue().filter((c) => c.tbl === 'kv').map((c) => c.row_id);
  assert.ok(!keys.includes('telegram'), 'the bot token stays on this machine');
  assert.ok(!keys.includes('httpApi'), 'the API token stays on this machine');
  assert.ok(keys.includes('variables'), 'ordinary settings still sync');
  assert.ok(
    !keys.some((k) => k.startsWith('migration:')),
    'which fixups this file has had is meaningless elsewhere'
  );
});

test('pending() hands back the row itself, and a tombstone without one', () => {
  clear();
  const kept = call('objects:create', { typeId: 'note', title: 'Kept' });
  const gone = call('objects:create', { typeId: 'note', title: 'Gone' });
  call('objects:delete', gone.id);

  const batch = synclog.pending(raw).filter((e) => e.table === 'objects');
  const a = batch.find((e) => e.id === kept.id);
  const b = batch.find((e) => e.id === gone.id);

  assert.equal(a.deleted, false);
  assert.equal(a.row.title, 'Kept');
  assert.equal(b.deleted, true);
  assert.equal(b.row, null);
});

test('ack clears what was sent but keeps an edit made mid-push', () => {
  clear();
  const obj = call('objects:create', { typeId: 'note', title: 'Racing' });
  const batch = synclog.pending(raw);

  // The user carries on typing while the batch is in flight.
  call('objects:update', { id: obj.id, patch: { title: 'Edited after the batch was read' } });
  synclog.ack(raw, batch);

  const e = entry('objects', obj.id);
  assert.ok(e, 'the later edit must survive the acknowledgement');
  // Strictly greater, not "at least": the whole point of a counter over a clock
  // is that two changes can never tie, however close together they happen.
  assert.ok(e.seq > batch.find((x) => x.id === obj.id).seq, 'the edit was given a new place in the queue');
});

test('an edit in the same millisecond as the push still survives', () => {
  // The bug this guards against only appeared when the write and the
  // acknowledgement landed inside one millisecond, which made it show up as an
  // occasional failure rather than a reliable one. Two hundred rounds back to
  // back is dense enough that a timestamp-based ack loses one every time.
  for (let i = 0; i < 200; i++) {
    clear();
    const obj = call('objects:create', { typeId: 'note', title: `Round ${i}` });
    const batch = synclog.pending(raw);
    call('objects:update', { id: obj.id, patch: { title: `Round ${i} edited` } });
    synclog.ack(raw, batch);
    assert.ok(entry('objects', obj.id), `round ${i}: the edit was dropped`);
  }
});

test('boards and cards are tracked too, not just objects', () => {
  clear();
  const board = call('canvas:create', { name: 'Board' });
  const deck = call('study:deckCreate', { name: 'Deck' });
  const card = call('study:cardCreate', { deckId: deck.id, front: 'q', back: 'a' });

  assert.ok(entry('canvases', board.id), 'boards sync');
  assert.ok(entry('decks', deck.id), 'decks sync');
  assert.ok(entry('cards', card.id), 'cards sync');
});

test('links are left out — the receiving side rebuilds them', () => {
  clear();
  const target = call('objects:create', { typeId: 'note', title: 'Target' });
  call('objects:create', {
    typeId: 'note',
    title: 'Source',
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { id: target.id, label: 'Target' } }] }],
    },
  });

  assert.ok(raw.prepare('SELECT 1 FROM links LIMIT 1').get(), 'the link was written');
  assert.ok(!queue().some((c) => c.tbl === 'links'), 'but it is not something to send');
});

test('the vault has one stable identity of its own', () => {
  const a = synclog.deviceId(raw);
  assert.match(a, /^[0-9a-f-]{36}$/);
  assert.equal(synclog.deviceId(raw), a, 'asking twice must not mint a second');
});
