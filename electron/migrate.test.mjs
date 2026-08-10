// Migrations run against vaults that already exist, so the only honest test is
// one that builds the old shape by hand and opens it. This covers the vault an
// earlier build left behind: an Event with a length in minutes, and a Task
// carrying the where and who that belong to an event.
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
  // The Event of an earlier build: minutes rather than an end.
  raw.prepare('UPDATE types SET properties = ? WHERE id = ?').run(
    JSON.stringify([
      { id: 'location', name: 'Location', kind: 'text' },
      { id: 'attendees', name: 'With', kind: 'relation', targetTypeId: 'people' },
      { id: 'startsAt', name: 'Starts', kind: 'datetime' },
      { id: 'duration', name: 'Minutes', kind: 'number' },
      { id: 'repeat', name: 'Repeats', kind: 'repeat' },
    ]),
    'event'
  );
  // …and the Task that briefly carried an event's properties.
  raw.prepare('UPDATE types SET properties = ? WHERE id = ?').run(
    JSON.stringify([
      { id: 'status', name: 'Status', kind: 'select', options: ['Todo', 'Doing', 'Done'] },
      { id: 'due', name: 'Due', kind: 'date' },
      { id: 'location', name: 'Location', kind: 'text' },
      { id: 'attendees', name: 'With', kind: 'relation', targetTypeId: 'people' },
      { id: 'startsAt', name: 'Starts', kind: 'datetime' },
      { id: 'duration', name: 'Minutes', kind: 'number' },
      { id: 'repeat', name: 'Repeats', kind: 'repeat' },
    ]),
    'task'
  );
  const ins = raw.prepare(
    'INSERT INTO objects (id, type_id, title, props, extra_props, search_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  ins.run('evt1', 'event', 'Standup', JSON.stringify({ startsAt: '2026-09-07T09:00', duration: 15, location: 'Room 2' }), '[]', '', 1, 1);
  ins.run('tsk1', 'task', 'Call the plumber', JSON.stringify({ status: 'Todo', location: 'Home' }), '[]', '', 1, 1);
  ins.run('tsk2', 'task', 'Nothing special', JSON.stringify({ status: 'Todo' }), '[]', '', 1, 1);

  for (const key of ['migration:event-type-v2', 'migration:task-partof-v1'])
    raw.prepare('DELETE FROM kv WHERE key = ?').run(key);
  raw.close();

  dbmod.openVault(file);
});

after(() => {
  dbmod.closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('Event trades its length in minutes for an end', () => {
  const ids = api['types:list']().find((t) => t.id === 'event').properties.map((p) => p.id);
  assert.ok(ids.includes('endsAt'), 'an event needs somewhere to say when it finishes');
  assert.ok(!ids.includes('duration'), 'and no longer measures itself in minutes');
  for (const id of ['startsAt', 'location', 'attendees', 'repeat']) assert.ok(ids.includes(id), `kept ${id}`);
});

test('an event made under the old shape still happens when it did', () => {
  const [entry] = api['calendar:range']({ from: '2026-09-07', to: '2026-09-07' }).filter((e) => e.title === 'Standup');
  assert.equal(entry.startMinute, 9 * 60);
  assert.equal(entry.minutes, 15, 'a length already written stays the length');
  assert.equal(api['objects:get']('evt1').props.location, 'Room 2');
});

test('Task hands back where and who with, and gains its place in an event', () => {
  const ids = api['types:list']().find((t) => t.id === 'task').properties.map((p) => p.id);
  assert.ok(ids.includes('partOf'));
  assert.ok(!ids.includes('location') && !ids.includes('attendees'));
});

test('a task that had a location keeps it as a property of its own', () => {
  const kept = api['objects:get']('tsk1');
  assert.equal(kept.props.location, 'Home', 'the value is never thrown away');
  assert.deepEqual(kept.extraProps.map((p) => p.id), ['location'], 'and it stays visible, on that task alone');

  const plain = api['objects:get']('tsk2');
  assert.deepEqual(plain.extraProps, [], 'a task that never had one is left alone');
});
