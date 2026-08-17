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

// ---------- moving and creating from the grid ----------

const move = (p) => api['calendar:reschedule'](p);

test('a drag moves an entry to another day and hour, keeping its length', () => {
  const m = api['objects:create']({
    typeId: 'meeting',
    title: 'Movable',
    props: { startsAt: '2026-08-03T09:00', duration: 30 },
  });

  move({ id: m.id, dayKey: '2026-08-05', startMinute: 13 * 60 + 45 });

  const e = find(range('2026-08-05', '2026-08-05'), 'Movable');
  assert.equal(e.dayKey, '2026-08-05');
  assert.equal(e.startMinute, 13 * 60 + 45);
  assert.equal(e.minutes, 30, 'a move must not change the duration');
  assert.equal(find(range('2026-08-03', '2026-08-03'), 'Movable'), undefined, 'and it leaves the old day');
});

test('a resize writes the new length without moving the start', () => {
  const m = api['objects:create']({
    typeId: 'meeting',
    title: 'Stretchy',
    props: { startsAt: '2026-08-06T10:00', duration: 30 },
  });

  move({ id: m.id, dayKey: '2026-08-06', startMinute: 10 * 60, minutes: 90 });

  const e = find(range('2026-08-06', '2026-08-06'), 'Stretchy');
  assert.equal(e.startMinute, 10 * 60);
  assert.equal(e.minutes, 90);
});

test('an all-day entry moves between days through its date property', () => {
  const t = api['objects:create']({ typeId: 'task', title: 'Allday', props: { due: '2026-08-04' } });

  move({ id: t.id, dayKey: '2026-08-06', startMinute: null });

  const e = find(range('2026-08-06', '2026-08-06'), 'Allday');
  assert.equal(e.allDay, true);
  assert.equal(e.dayKey, '2026-08-06');
});

test('a move refuses what it cannot place rather than inventing a property', () => {
  // A note has neither a datetime nor a date property to write to.
  const n = api['objects:create']({ typeId: 'note', title: 'Just a note' });
  assert.equal(move({ id: n.id, dayKey: '2026-08-06', startMinute: 600 }), null);

  const daily = api['daily:create']({ dateKey: '2026-08-06', content: null });
  assert.equal(move({ id: daily.id, dayKey: '2026-08-07', startMinute: null }), null, 'a daily note is its date');

  assert.equal(move({ id: 'nope', dayKey: '2026-08-06', startMinute: 600 }), null);
  assert.equal(move({ id: 'nope', dayKey: 'rubbish', startMinute: 600 }), null);
});

test('out-of-range minutes are clamped into the day', () => {
  const m = api['objects:create']({ typeId: 'meeting', title: 'Clamped', props: { startsAt: '2026-08-07T09:00' } });

  move({ id: m.id, dayKey: '2026-08-07', startMinute: 5000 });
  assert.equal(find(range('2026-08-07', '2026-08-07'), 'Clamped').startMinute, 23 * 60 + 59);

  move({ id: m.id, dayKey: '2026-08-07', startMinute: -60 });
  assert.equal(find(range('2026-08-07', '2026-08-07'), 'Clamped').startMinute, 0);
});

test('creating on the grid lands where it was drawn', () => {
  const made = api['calendar:create']({
    typeId: 'meeting',
    title: 'Drawn here',
    dayKey: '2026-08-05',
    startMinute: 11 * 60 + 30,
    minutes: 45,
  });
  assert.ok(made);

  const e = find(range('2026-08-05', '2026-08-05'), 'Drawn here');
  assert.equal(e.startMinute, 11 * 60 + 30);
  assert.equal(e.minutes, 45);
  assert.equal(e.allDay, false);
});

test('creating falls back to an hour, names the untitled, and refuses a type with no time', () => {
  api['calendar:create']({ typeId: 'meeting', title: '  ', dayKey: '2026-08-05', startMinute: 8 * 60 });
  const e = find(range('2026-08-05', '2026-08-05'), 'Untitled');
  assert.equal(e.minutes, 60);

  assert.equal(api['calendar:create']({ typeId: 'note', title: 'x', dayKey: '2026-08-05', startMinute: 60 }), null);
  assert.equal(api['calendar:create']({ typeId: 'nope', title: 'x', dayKey: '2026-08-05', startMinute: 60 }), null);
  assert.equal(api['calendar:create']({ typeId: 'meeting', title: 'x', dayKey: 'bad', startMinute: 60 }), null);
});

// ---------- what counts as scheduled ----------

test("a day's tasks include what starts then, not only what's due then", () => {
  api['objects:create']({ typeId: 'task', title: 'Due that day', props: { due: '2026-08-11', status: 'Todo' } });
  api['objects:create']({
    typeId: 'task',
    title: 'Starts that day',
    props: { startsAt: '2026-08-11T09:30', status: 'Todo' },
  });
  api['objects:create']({
    typeId: 'task',
    title: 'Both that day',
    props: { due: '2026-08-11', startsAt: '2026-08-11T08:00', status: 'Todo' },
  });
  api['objects:create']({ typeId: 'task', title: 'Neither', props: { status: 'Todo' } });

  const titles = api['tasks:forDay']({ dateKey: '2026-08-11' }).map((t) => t.title);
  assert.deepEqual(titles, ['Both that day', 'Starts that day', 'Due that day'], 'timed first, in time order');
  assert.ok(!titles.includes('Neither'), 'nothing without a date or a time belongs to a day');
});

test('a start time is not rolled forward the way a missed due date is', () => {
  const today = api['calendar:create']({
    typeId: 'task',
    title: 'Rollover check',
    dayKey: '2020-01-02',
    startMinute: 10 * 60,
  });
  api['tasks:forDay']({ dateKey: '2020-01-02' });

  const after = api['objects:get'](today.id);
  assert.equal(after.props.startsAt.slice(0, 10), '2020-01-02', 'it stays on the day it was meant to happen');
});

// ---------- repeating ----------

test('Task is what you tick off, Event is what happens', () => {
  const task = api['types:list']().find((t) => t.id === 'task');
  const event = api['types:list']().find((t) => t.id === 'event');

  const tids = task.properties.map((p) => p.id);
  for (const id of ['status', 'due', 'startsAt', 'duration', 'repeat', 'partOf'])
    assert.ok(tids.includes(id), `Task should have ${id}`);
  assert.ok(!tids.includes('location') && !tids.includes('attendees'), 'where and who with are an event\'s business');

  const eids = event.properties.map((p) => p.id);
  for (const id of ['startsAt', 'endsAt', 'location', 'attendees', 'repeat'])
    assert.ok(eids.includes(id), `Event should have ${id}`);
  assert.ok(
    !event.properties.some((p) => p.kind === 'select' && (p.options || []).includes('Done')),
    'an event happens; it is never finished'
  );
});

test('one repeating object fills every day of its series', () => {
  api['objects:create']({
    typeId: 'task',
    title: 'Standup',
    props: { startsAt: '2026-09-07T09:00', duration: 15, repeat: 'FREQ=WEEKLY;BYDAY=MO,WE' },
  });

  const week = range('2026-09-07', '2026-09-13').filter((e) => e.title === 'Standup');
  assert.deepEqual(week.map((e) => e.dayKey), ['2026-09-07', '2026-09-09']);
  for (const e of week) {
    assert.equal(e.startMinute, 9 * 60, 'each occurrence keeps the time of day');
    assert.equal(e.minutes, 15);
    assert.equal(e.repeats, true);
  }
  // A window months later needs no rows of its own.
  assert.equal(range('2026-12-01', '2026-12-31').filter((e) => e.title === 'Standup').length, 9);
});

test('ticking one day of a repeating task leaves the rest of the series alone', () => {
  const task = api['objects:create']({
    typeId: 'task',
    title: 'Water the plants',
    props: { startsAt: '2026-09-07T18:00', status: 'Todo', repeat: 'FREQ=DAILY' },
  });

  api['tasks:setDone']({ id: task.id, dayKey: '2026-09-08', done: true });

  const done = (key) => range(key, key).find((e) => e.title === 'Water the plants').done;
  assert.equal(done('2026-09-08'), true);
  assert.equal(done('2026-09-09'), false, 'tomorrow is still to do');
  assert.equal(api['objects:get'](task.id).props.status, 'Todo', 'the series itself is not finished');

  const listed = api['tasks:forDay']({ dateKey: '2026-09-08' }).find((t) => t.id === task.id);
  assert.equal(listed.props.status, 'Done');
  assert.equal(listed.occurrence, '2026-09-08');
  assert.equal(api['tasks:forDay']({ dateKey: '2026-09-09' }).find((t) => t.id === task.id).props.status, 'Todo');

  api['tasks:setDone']({ id: task.id, dayKey: '2026-09-08', done: false });
  assert.equal(done('2026-09-08'), false, 'and it unticks again');
});

test('a repeating task is never rolled forward onto today', () => {
  const task = api['objects:create']({
    typeId: 'task',
    title: 'Old repeater',
    props: { due: '2020-03-01', status: 'Todo', repeat: 'FREQ=WEEKLY' },
  });
  api['tasks:forDay']({ dateKey: new Date().toISOString().slice(0, 10) });
  assert.equal(api['objects:get'](task.id).props.due, '2020-03-01');
});

test('moving one occurrence takes it out of the series and leaves the rest', () => {
  const series = api['objects:create']({
    typeId: 'task',
    title: 'Gym',
    props: { startsAt: '2026-10-05T07:00', duration: 60, repeat: 'FREQ=WEEKLY' },
  });

  const moved = api['calendar:reschedule']({
    id: series.id,
    occurrence: '2026-10-12',
    dayKey: '2026-10-13',
    startMinute: 19 * 60,
  });

  assert.notEqual(moved.id, series.id, 'the moved day becomes its own object');
  assert.equal(moved.props.repeat, undefined, 'and it no longer repeats');
  assert.equal(moved.props.startsAt, '2026-10-13T19:00');

  const on = (key) => range(key, key).filter((e) => e.title === 'Gym');
  assert.equal(on('2026-10-12').length, 0, 'the series gave up that day');
  assert.equal(on('2026-10-13')[0].startMinute, 19 * 60);
  assert.equal(on('2026-10-05').length, 1, 'the week before is untouched');
  assert.equal(on('2026-10-19')[0].startMinute, 7 * 60, 'and so is the week after');
});

test('taking notes on one occurrence forks it, leaving the rest of the series untouched', () => {
  const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

  const series = api['objects:create']({
    typeId: 'meeting',
    title: 'Weekly sync',
    props: { startsAt: '2027-01-05T09:00', duration: 15, repeat: 'FREQ=WEEKLY' },
  });

  // No notes anywhere yet: every occurrence carries the same (empty) object id.
  const before = range('2027-01-05', '2027-01-19').filter((e) => e.title === 'Weekly sync');
  assert.equal(before.length, 3);
  assert.ok(before.every((e) => e.id === series.id));

  const forked = api['objects:update']({
    id: series.id,
    patch: { content: doc('Discussed the launch date') },
    occurrence: '2027-01-12',
  });

  assert.notEqual(forked.id, series.id, 'the noted day becomes its own object');
  assert.equal(forked.props.repeat, undefined, 'and no longer repeats itself');
  assert.deepEqual(forked.content, doc('Discussed the launch date'));

  const after = range('2027-01-05', '2027-01-19').filter((e) => e.title === 'Weekly sync');
  assert.equal(after.length, 3, 'still three occurrences, just one of them detached');
  const on = (key) => after.find((e) => e.dayKey === key);
  assert.equal(on('2027-01-05').id, series.id);
  assert.equal(on('2027-01-12').id, forked.id, 'the 12th now points at the forked copy');
  assert.equal(on('2027-01-19').id, series.id);

  assert.equal(api['objects:get'](series.id).content, null, 'the series itself never had notes added to it');

  // Editing that same day again — now that it has its own object — is an
  // ordinary update, not another fork.
  const editedAgain = api['objects:update']({
    id: forked.id,
    patch: { content: doc('Discussed the launch date, take two') },
    occurrence: '2027-01-12',
  });
  assert.equal(editedAgain.id, forked.id);

  // A different, still-untouched occurrence forks independently and doesn't
  // see the first occurrence's notes.
  const forkedAgain = api['objects:update']({
    id: series.id,
    patch: { content: doc('A completely different standup') },
    occurrence: '2027-01-19',
  });
  assert.notEqual(forkedAgain.id, series.id);
  assert.notEqual(forkedAgain.id, forked.id);
});

test('the whole series can be moved instead', () => {
  const series = api['objects:create']({
    typeId: 'task',
    title: 'Retro',
    props: { startsAt: '2026-11-02T15:00', duration: 30, repeat: 'FREQ=WEEKLY' },
  });

  api['calendar:reschedule']({
    id: series.id,
    occurrence: '2026-11-02',
    dayKey: '2026-11-02',
    startMinute: 16 * 60,
    scope: 'all',
  });

  const after = range('2026-11-02', '2026-11-16').filter((e) => e.title === 'Retro');
  assert.deepEqual(after.map((e) => e.startMinute), [16 * 60, 16 * 60, 16 * 60], 'every occurrence follows');
  assert.equal(after.length, 3);
});

test('skipping one occurrence removes only that day', () => {
  const series = api['objects:create']({
    typeId: 'task',
    title: 'Lunch',
    props: { startsAt: '2026-12-07T12:00', repeat: 'FREQ=DAILY' },
  });

  assert.equal(api['calendar:skip']({ id: series.id, dayKey: '2026-12-08' }), true);
  const week = range('2026-12-07', '2026-12-10').filter((e) => e.title === 'Lunch');
  assert.deepEqual(week.map((e) => e.dayKey), ['2026-12-07', '2026-12-09', '2026-12-10']);
  assert.equal(api['calendar:skip']({ id: series.id, dayKey: '2026-12-08' }), false, 'and only once');
});

test('an unreadable rule is treated as happening once', () => {
  api['objects:create']({
    typeId: 'task',
    title: 'Odd one',
    props: { startsAt: '2027-01-04T10:00', repeat: 'every other thursday' },
  });
  const found = range('2027-01-04', '2027-02-04').filter((e) => e.title === 'Odd one');
  assert.equal(found.length, 1);
  assert.equal(found[0].repeats, false);
});
