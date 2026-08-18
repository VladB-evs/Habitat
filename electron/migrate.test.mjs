// Migrations run against vaults that already exist, so the only honest test is
// one that builds the old shape by hand and opens it. This covers a vault from
// before Event folded into Task: an Event type with an object of its own, and
// a Task carrying `partOf` plus a location it had kept as an extra property
// from an even earlier build.
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

const api = dbmod.api;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-migrate-'));
const file = path.join(tmp, 'old.db');

before(() => {
  dbmod.initDb(file);
  dbmod.seedFlavor('work');
  dbmod.closeDb();

  const raw = new DatabaseSync(file);

  // The Event type an earlier build had, plus one of its objects.
  raw
    .prepare('INSERT INTO types (id, name, emoji, color, properties, builtin, starred, created_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?)')
    .run(
      'event', 'Event', 'calendar-days', '#7b5cd6',
      JSON.stringify([
        { id: 'startsAt', name: 'Starts', kind: 'datetime' },
        { id: 'endsAt', name: 'Ends', kind: 'datetime' },
        { id: 'location', name: 'Where', kind: 'text' },
        { id: 'attendees', name: 'With', kind: 'relation', targetTypeId: 'people' },
        { id: 'repeat', name: 'Repeats', kind: 'repeat' },
      ]),
      1
    );

  // The Task of that same build: it points at an event through `partOf`, and
  // still has no location or attendees of its own.
  raw.prepare('UPDATE types SET properties = ? WHERE id = ?').run(
    JSON.stringify([
      { id: 'status', name: 'Status', kind: 'select', options: ['Todo', 'Doing', 'Done'] },
      { id: 'due', name: 'Due', kind: 'date' },
      { id: 'project', name: 'Project', kind: 'relation', targetTypeId: 'project' },
      { id: 'partOf', name: 'Part of', kind: 'relation', targetTypeId: 'event' },
      { id: 'startsAt', name: 'Starts', kind: 'datetime' },
      { id: 'duration', name: 'Minutes', kind: 'number' },
      { id: 'repeat', name: 'Repeats', kind: 'repeat' },
    ]),
    'task'
  );

  const ins = raw.prepare(
    'INSERT INTO objects (id, type_id, title, props, extra_props, search_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  ins.run(
    'evt1', 'event', 'Standup',
    JSON.stringify({ startsAt: '2026-09-07T09:00', endsAt: '2026-09-07T09:15', location: 'Room 2' }),
    '[]', '', 1, 1
  );
  // Carries `partOf`, and a location it kept as an extra property from before
  // task-partof-v1 moved that off the type — the exact shape a real vault
  // that had already updated once was left in.
  ins.run(
    'tsk1', 'task', 'Prep the deck',
    JSON.stringify({ status: 'Todo', partOf: ['evt1'], location: 'Home' }),
    JSON.stringify([{ id: 'location', name: 'Location', kind: 'text' }]),
    '', 1, 1
  );
  ins.run('tsk2', 'task', 'Nothing special', JSON.stringify({ status: 'Todo' }), '[]', '', 1, 1);

  raw.prepare('DELETE FROM kv WHERE key = ?').run('migration:fold-event-into-task-v1');
  raw.close();

  dbmod.openVault(file);
});

after(() => {
  dbmod.closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the Event type and everything in it are gone', () => {
  assert.equal(api['types:list']().find((t) => t.id === 'event'), undefined);
  assert.equal(api['objects:get']('evt1'), null);
  assert.equal(api['calendar:range']({ from: '2026-09-07', to: '2026-09-07' }).length, 0);
});

test('Task gains everything Event had, and gives up partOf', () => {
  const ids = api['types:list']().find((t) => t.id === 'task').properties.map((p) => p.id);
  for (const id of ['status', 'due', 'project', 'startsAt', 'duration', 'repeat', 'endsAt', 'location', 'link', 'attendees'])
    assert.ok(ids.includes(id), `Task should have ${id}`);
  assert.ok(!ids.includes('partOf'), 'nothing left to be part of');
});

test('a task that pointed at the deleted event loses that link, keeps the rest', () => {
  const kept = api['objects:get']('tsk1');
  assert.equal(kept.props.partOf, undefined, 'the event it pointed at is gone');
  assert.equal(kept.props.status, 'Todo', 'nothing else about it was touched');
});

test('a location kept as an extra property folds back into a real one, not a duplicate', () => {
  const kept = api['objects:get']('tsk1');
  assert.equal(kept.props.location, 'Home', 'the value is never thrown away');
  assert.deepEqual(kept.extraProps, [], 'and it is not still listed as an extra now that Task has its own');

  const plain = api['objects:get']('tsk2');
  assert.deepEqual(plain.extraProps, [], 'a task that never had one is left alone');
});
