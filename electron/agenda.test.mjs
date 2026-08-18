// The agenda is what the Tasks page draws, so these cover the rules it plans
// by: a Task carries a time, a location and who's involved just as an Event
// used to, ticks off like any other task, and a run of days or a repeat still
// work the same way. Meeting is the one type left that happens without a
// Done to give, so it still draws as a block rather than a line.
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

before(() => {
  dbmod.initDb(path.join(tmp, 'test.db'));
  dbmod.seedFlavor('work');
});

after(() => {
  dbmod.closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('a timed task carries an end, a place and who with, and still ticks off', () => {
  const t = api['objects:create']({
    typeId: 'task',
    title: 'Design review',
    props: { status: 'Todo', startsAt: '2027-06-08T14:00', endsAt: '2027-06-08T15:30', location: 'Room 2' },
  });

  const day = dayOf(agenda(), '2027-06-08');
  const found = day.tasks.find((x) => x.title === 'Design review');
  assert.ok(found, 'a task with a time is still a task, listed on its day');
  assert.equal(found.startMinute, 14 * 60);

  const saved = api['objects:get'](t.id);
  assert.equal(saved.props.location, 'Room 2');

  api['tasks:setDone']({ id: t.id, done: true });
  assert.equal(dayOf(agenda(), '2027-06-08').tasks.find((x) => x.title === 'Design review').done, true);
});

test('Meeting still happens rather than gets ticked off — the one type left without a Done', () => {
  api['objects:create']({
    typeId: 'meeting',
    title: 'Team weekly',
    props: { date: '2027-06-09' },
  });

  const a = agenda();
  const day = dayOf(a, '2027-06-09');
  assert.ok(day.events.some((e) => e.title === 'Team weekly'));
  assert.equal(day.tasks.find((t) => t.title === 'Team weekly'), undefined, 'never listed as something to tick off');
});

test('a task that runs several days still shows up, on the day it starts', () => {
  // A run across days drawn on every one of them is a calendar-grid thing (see
  // calendar.test.mjs — that expansion is generic, unaffected by what folded
  // into Task). The agenda list gives a task exactly one line, like it always
  // has for anything with a "Done" to give.
  api['objects:create']({
    typeId: 'task',
    title: 'Holiday in Portugal',
    props: { status: 'Todo', startsAt: '2027-06-19T00:00', endsAt: '2027-06-26T22:00' },
  });

  const a = agenda();
  assert.ok(dayOf(a, '2027-06-19').tasks.some((t) => t.title === 'Holiday in Portugal'));
  assert.equal(dayOf(a, '2027-06-20').tasks.find((t) => t.title === 'Holiday in Portugal'), undefined);
});

test('a repeating task shows only its next occurrence in the agenda, not every future day', () => {
  // Same reasoning as above: the agenda list has always given a repeating task
  // one line that moves forward as it's ticked off, rather than a block per
  // occurrence — that's unchanged by anything folding into Task. Every
  // occurrence is still there in the calendar grid and the table.
  api['objects:create']({
    typeId: 'task',
    title: 'Standup',
    props: { status: 'Todo', startsAt: '2027-06-07T09:00', repeat: 'FREQ=WEEKLY;BYDAY=MO,TH' },
  });

  const a = agenda();
  const days = a.days.filter((d) => d.tasks.some((t) => t.title === 'Standup')).map((d) => d.dayKey);
  assert.equal(days.length, 1, 'only the next occurrence is listed');
  assert.equal(dayOf(a, days[0]).tasks.find((t) => t.title === 'Standup').repeats, true);
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
