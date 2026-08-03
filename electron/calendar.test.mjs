// The calendar resolves times in the main process, so these cover the rules the
// whole app depends on: what counts as timed, what falls back to all-day, how
// long something runs, and that a late-evening entry stays on its own day.
// Run with `npm test`.

import { createRequire } from 'node:module';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dbmod = require('./db.js');

const api = dbmod.api;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-cal-'));

before(() => {
  dbmod.initDb(path.join(tmp, 'test.db'));
  dbmod.seedFlavor('work');
});

after(() => {
  dbmod.closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const range = (from, to) => api['calendar:range']({ from, to });
const find = (rows, title) => rows.find((r) => r.title === title);

test('the migration gives Task and Meeting a time and a length', () => {
  const task = api['types:list']().find((t) => t.id === 'task');
  const meeting = api['types:list']().find((t) => t.id === 'meeting');
  for (const type of [task, meeting]) {
    const ids = type.properties.map((p) => p.id);
    assert.ok(ids.includes('startsAt'), `${type.name} should have startsAt`);
    assert.ok(ids.includes('duration'), `${type.name} should have duration`);
  }
  assert.equal(task.properties.find((p) => p.id === 'startsAt').kind, 'datetime');
  assert.equal(task.properties.find((p) => p.id === 'duration').kind, 'number');
});

test('a datetime places an object at an hour, with its own length', () => {
  api['objects:create']({
    typeId: 'meeting',
    title: 'Standup',
    props: { startsAt: '2026-08-03T09:30', duration: 15 },
  });

  const [e] = range('2026-08-03', '2026-08-03').filter((r) => r.title === 'Standup');
  assert.equal(e.allDay, false);
  assert.equal(e.dayKey, '2026-08-03');
  assert.equal(e.startMinute, 9 * 60 + 30);
  assert.equal(e.minutes, 15);
});

test('a timed entry with no length runs an hour', () => {
  api['objects:create']({ typeId: 'meeting', title: 'Review', props: { startsAt: '2026-08-03T14:00' } });
  assert.equal(find(range('2026-08-03', '2026-08-03'), 'Review').minutes, 60);
});

test('a date with no time is all-day', () => {
  api['objects:create']({ typeId: 'task', title: 'Ship it', props: { due: '2026-08-04' } });

  const e = find(range('2026-08-04', '2026-08-04'), 'Ship it');
  assert.equal(e.allDay, true);
  assert.equal(e.startMinute, null);
  assert.equal(e.minutes, null);
});

test('a time wins over a plain date on the same object', () => {
  api['objects:create']({
    typeId: 'task',
    title: 'Both',
    props: { due: '2026-08-05', startsAt: '2026-08-06T11:00' },
  });

  assert.equal(find(range('2026-08-05', '2026-08-05'), 'Both'), undefined);
  const e = find(range('2026-08-06', '2026-08-06'), 'Both');
  assert.equal(e.allDay, false);
  assert.equal(e.startMinute, 11 * 60);
});

test('a late evening time stays on its own local day', () => {
  api['objects:create']({ typeId: 'meeting', title: 'Late call', props: { startsAt: '2026-08-07T23:30' } });

  assert.equal(find(range('2026-08-07', '2026-08-07'), 'Late call').dayKey, '2026-08-07');
  assert.equal(find(range('2026-08-08', '2026-08-08'), 'Late call'), undefined);
});

test('the window is inclusive at both ends and excludes what falls outside', () => {
  const inside = range('2026-08-03', '2026-08-07').map((r) => r.title);
  assert.ok(inside.includes('Standup'));
  assert.ok(inside.includes('Late call'));
  assert.equal(range('2026-09-01', '2026-09-30').length, 0);
});

test('a finished task is marked done', () => {
  const t = api['objects:create']({
    typeId: 'task',
    title: 'Finished',
    props: { startsAt: '2026-08-03T16:00', status: 'Todo' },
  });
  assert.equal(find(range('2026-08-03', '2026-08-03'), 'Finished').done, false);

  api['objects:update']({ id: t.id, patch: { props: { startsAt: '2026-08-03T16:00', status: 'Done' } } });
  assert.equal(find(range('2026-08-03', '2026-08-03'), 'Finished').done, true);
});

test('tags never appear, and a bad window returns nothing', () => {
  api['tags:ensure']('somewhere');
  assert.ok(!range('2020-01-01', '2030-01-01').some((r) => r.typeId === 'tag'));
  assert.deepEqual(range('nonsense', '2026-08-03'), []);
});
