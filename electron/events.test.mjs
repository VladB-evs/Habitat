// Events, rebuilt as their own type (see `events:create` in db.js for why —
// the short version: a repeating one used to be a single row expanded at read
// time, forking a new row the moment someone took notes on one occurrence,
// and that forking was unreliable. Now every occurrence is a real, independent
// row from the moment the series is created — nothing forks, ever.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-events-'));

before(() => {
  dbmod.initDb(path.join(tmp, 'test.db'));
  dbmod.seedFlavor('work');
});

after(() => {
  dbmod.closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('Event exists as its own universal type, not tied to a flavor', () => {
  const type = api['types:list']().find((t) => t.id === 'event');
  assert.ok(type, 'seedFlavor("work") never lists Event, but it still exists');
  const ids = type.properties.map((p) => p.id);
  for (const id of ['startsAt', 'endsAt', 'location', 'link', 'attendees']) assert.ok(ids.includes(id));
});

test('a one-off event is a single row, nothing more', () => {
  const made = api['events:create']({
    title: 'Dentist',
    startsAt: '2027-03-01T09:00',
    endsAt: '2027-03-01T09:30',
    location: 'Clinic',
  });
  assert.equal(made.typeId, 'event');
  assert.equal(made.props.startsAt, '2027-03-01T09:00');
  assert.equal(made.props.seriesId, undefined, 'nothing to group it with');
  assert.equal(api['events:list']().filter((e) => e.title === 'Dentist').length, 1);
});

test('a weekly series materialises one independent row per occurrence, not one row with a rule', () => {
  const first = api['events:create']({
    title: 'Standup',
    startsAt: '2027-04-05T09:00', // a Monday
    endsAt: '2027-04-05T09:15',
    repeat: 'FREQ=WEEKLY;BYDAY=MO;COUNT=4',
  });

  const rows = api['events:list']().filter((e) => e.title === 'Standup');
  assert.equal(rows.length, 4, 'four real rows, not one row a caller has to expand');
  assert.ok(rows.every((r) => r.props.seriesId === first.props.seriesId), 'all four share a series id');
  assert.deepEqual(
    rows.map((r) => r.props.startsAt),
    ['2027-04-05T09:00', '2027-04-12T09:00', '2027-04-19T09:00', '2027-04-26T09:00'],
    'the time of day carries across every date'
  );
  // No `repeat` on the objects themselves — the rule only ever existed to
  // decide where to place these rows, once, at creation.
  assert.ok(rows.every((r) => r.props.repeat === undefined));
});

test('a note added to one occurrence never touches the rest of the series', () => {
  const rows = api['events:list']().filter((e) => e.title === 'Standup');
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Discussed the launch date.' }] }] };
  api['objects:update']({ id: rows[1].id, patch: { content: doc } });

  const touched = api['objects:get'](rows[1].id, true);
  assert.deepEqual(touched.content, doc);
  const others = api['events:list']().filter((e) => e.title === 'Standup' && e.id !== rows[1].id);
  assert.ok(others.every((o) => !api['objects:get'](o.id, true).content), 'nobody else was written to');
});

test('deleting a series from one occurrence onward leaves the earlier ones alone', () => {
  const rows = api['events:list']()
    .filter((e) => e.title === 'Standup')
    .sort((a, b) => a.props.startsAt.localeCompare(b.props.startsAt));

  const result = api['events:deleteSeries']({ id: rows[2].id }); // the 3rd of 4
  assert.equal(result.count, 2, 'that occurrence and the one after it');

  const left = api['events:list']().filter((e) => e.title === 'Standup');
  assert.equal(left.length, 2);
  assert.deepEqual(
    left.map((r) => r.props.startsAt).sort(),
    ['2027-04-05T09:00', '2027-04-12T09:00']
  );
});

test('deleting a one-off event just removes the one row', () => {
  const one = api['events:create']({ title: 'Solo', startsAt: '2027-05-01T10:00' });
  const result = api['events:deleteSeries']({ id: one.id });
  assert.equal(result.count, 1);
  assert.equal(api['objects:get'](one.id), null);
});

test('an open-ended rule is capped rather than materialised forever', () => {
  api['events:create']({ title: 'Forever', startsAt: '2027-01-01T08:00', repeat: 'FREQ=DAILY' });
  const rows = api['events:list']().filter((e) => e.title === 'Forever');
  assert.ok(rows.length > 300 && rows.length <= 367, `capped around a year out, got ${rows.length}`);
});

test('events never show up on the Tasks page — its calendar, its reschedule, its agenda', () => {
  const ev = api['events:create']({ title: 'Standalone', startsAt: '2027-06-01T09:00' });
  assert.equal(api['calendar:range']({ from: '2027-06-01', to: '2027-06-01' }).length, 0);
  assert.equal(api['calendar:reschedule']({ id: ev.id, dayKey: '2027-06-02', startMinute: 600 }), null);
  const day = api['agenda:range']({ from: '2027-06-01', days: 1 }).days[0];
  assert.ok(!day.events.some((e) => e.id === ev.id) && !day.tasks.some((t) => t.id === ev.id));
});
