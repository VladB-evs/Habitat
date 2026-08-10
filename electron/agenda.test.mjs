// The agenda is what the Tasks page draws, so these cover the rules it plans by:
// what is an event and what is a task, which days a run of days covers, and where
// a task shows up when it belongs to an event.
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-agenda-'));

/** A fixed week to plan in, well clear of today so nothing rolls over onto it. */
const FROM = '2027-06-07';
const agenda = (from = FROM, days = 21) => api['agenda:range']({ from, days });
const dayOf = (a, key) => a.days.find((d) => d.dayKey === key);
const event = (a, key, title) => dayOf(a, key).events.find((e) => e.title === title);

before(() => {
  dbmod.initDb(path.join(tmp, 'test.db'));
  dbmod.seedFlavor('work');
});

after(() => {
  dbmod.closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('an event happens and a task is worked on — and only one of them can be ticked', () => {
  api['objects:create']({
    typeId: 'event',
    title: 'Design review',
    props: { startsAt: '2027-06-08T14:00', endsAt: '2027-06-08T15:30', location: 'Room 2' },
  });
  api['objects:create']({ typeId: 'task', title: 'Write the brief', props: { due: '2027-06-08', status: 'Todo' } });

  const day = dayOf(agenda(), '2027-06-08');
  const e = day.events.find((x) => x.title === 'Design review');
  assert.equal(e.startMinute, 14 * 60);
  assert.equal(e.endMinute, 15 * 60 + 30, 'an end, not a length in minutes');
  assert.equal(e.location, 'Room 2');
  assert.deepEqual(day.tasks.map((t) => t.title), ['Write the brief']);
  // An event has no Done to give, so it is never listed as something to tick off.
  assert.equal(day.tasks.find((t) => t.title === 'Design review'), undefined);
  assert.equal(api['tasks:forDay']({ dateKey: '2027-06-08' }).find((t) => t.title === 'Design review'), undefined);
});

test('an event carries its tasks, and an undated one lives only in there', () => {
  const meeting = api['objects:create']({
    typeId: 'event',
    title: 'Team weekly',
    props: { startsAt: '2027-06-09T10:00', endsAt: '2027-06-09T11:00' },
  });
  api['objects:create']({ typeId: 'task', title: 'Prep the deck', props: { status: 'Todo', partOf: [meeting.id] } });

  const a = agenda();
  assert.deepEqual(event(a, '2027-06-09', 'Team weekly').tasks.map((t) => t.title), ['Prep the deck']);
  assert.equal(a.backlog.find((t) => t.title === 'Prep the deck'), undefined, 'it is not loose in the backlog');
  assert.equal(dayOf(a, '2027-06-09').tasks.find((t) => t.title === 'Prep the deck'), undefined, 'nor loose on the day');
});

test("a task with its own day is shown there too, saying which event it is for", () => {
  const trip = api['objects:create']({
    typeId: 'event',
    title: 'Holiday in Portugal',
    props: { startsAt: '2027-06-19T00:00', endsAt: '2027-06-26T22:00' },
  });
  api['objects:create']({
    typeId: 'task',
    title: 'Book the parking',
    props: { status: 'Todo', due: '2027-06-16', partOf: [trip.id] },
  });

  const a = agenda();
  const onItsDay = dayOf(a, '2027-06-16').tasks.find((t) => t.title === 'Book the parking');
  assert.ok(onItsDay, 'a thing due on Wednesday has to appear on Wednesday');
  assert.equal(onItsDay.eventName, 'Holiday in Portugal');
  assert.ok(
    event(a, '2027-06-19', 'Holiday in Portugal').tasks.some((t) => t.title === 'Book the parking'),
    "and still inside the event, so the event's own list is whole"
  );
});

test('a run of days covers every one of them, with the detail on the first', () => {
  const a = agenda();
  const first = event(a, '2027-06-19', 'Holiday in Portugal');
  assert.equal(first.spanDay, 1);
  assert.equal(first.spanOf, 8);
  assert.equal(first.allDay, true, 'starting at midnight means the day, not a minute past twelve');

  for (const [i, key] of ['2027-06-20', '2027-06-23', '2027-06-26'].entries()) {
    const on = event(a, key, 'Holiday in Portugal');
    assert.ok(on, `the holiday should still be on ${key}`);
    assert.ok(on.spanDay > 1, 'and know it is not its first day');
    assert.equal(on.tasks.length, 0, 'the tasks belong to the first day only');
    assert.ok(i >= 0);
  }
  assert.equal(dayOf(a, '2027-06-27').events.find((e) => e.title === 'Holiday in Portugal'), undefined, 'and it ends');
});

test('a repeating event comes back on each of its days, tasks and all', () => {
  const standup = api['objects:create']({
    typeId: 'event',
    title: 'Standup',
    props: { startsAt: '2027-06-07T09:00', endsAt: '2027-06-07T09:15', repeat: 'FREQ=WEEKLY;BYDAY=MO,TH' },
  });
  api['objects:create']({ typeId: 'task', title: 'Bring the numbers', props: { status: 'Todo', partOf: [standup.id] } });

  const a = agenda();
  const days = a.days.filter((d) => d.events.some((e) => e.title === 'Standup')).map((d) => d.dayKey);
  assert.deepEqual(days.slice(0, 4), ['2027-06-07', '2027-06-10', '2027-06-14', '2027-06-17']);
  assert.deepEqual(event(a, '2027-06-10', 'Standup').tasks.map((t) => t.title), ['Bring the numbers']);
  assert.equal(event(a, '2027-06-07', 'Standup').repeats, true);
});

test('what is late floats to the top and what has no day waits in the backlog', () => {
  api['objects:create']({ typeId: 'task', title: 'Ancient thing', props: { due: '2019-01-01', status: 'Todo' } });
  api['objects:create']({ typeId: 'task', title: 'One day maybe', props: { status: 'Todo' } });
  const done = api['objects:create']({ typeId: 'task', title: 'Already handled', props: { status: 'Todo' } });
  api['tasks:setDone']({ id: done.id, done: true });

  const a = agenda();
  assert.ok(a.overdue.some((t) => t.title === 'Ancient thing'), 'a late task is never buried on a day gone by');
  assert.ok(a.backlog.some((t) => t.title === 'One day maybe'));
  assert.equal(a.backlog.find((t) => t.title === 'Already handled'), undefined, 'a finished task is not waiting for a day');
});

test('the window is the window: nothing outside it is reported as a day', () => {
  const a = agenda(FROM, 7);
  assert.equal(a.days.length, 7);
  assert.equal(a.days[0].dayKey, FROM);
  assert.equal(a.days[6].dayKey, '2027-06-13');
  assert.equal(dayOf(a, '2027-06-19'), undefined);
});
