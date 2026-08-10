// Recurrence is worked out on every calendar read, so these cover the rules the
// expansion depends on: what a rule string means, which days a series lands on,
// and the awkward months a naive "same day next month" gets wrong.
// Run with `npm test`.

import { createRequire } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { parseRule, formatRule, occurrences, nextAfter, occursOn } = require('./recur.js');

const days = (rule, start, from, to) => occurrences(parseRule(rule), start, from, to);

test('a rule round-trips through parse and format', () => {
  const raw = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=2026-12-31';
  assert.equal(formatRule(parseRule(raw)), raw);
  assert.deepEqual(parseRule('FREQ=DAILY'), { freq: 'DAILY', interval: 1 });
});

test('anything unreadable is simply not a repeat', () => {
  for (const raw of ['', null, undefined, 'every tuesday', 'FREQ=FORTNIGHTLY']) assert.equal(parseRule(raw), null);
  // A nonsense interval falls back to every one rather than repeating forever in place.
  assert.equal(parseRule('FREQ=DAILY;INTERVAL=0').interval, 1);
});

test('daily counts from the start date, interval and all', () => {
  assert.deepEqual(days('FREQ=DAILY', '2026-08-10', '2026-08-10', '2026-08-13'), [
    '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13',
  ]);
  assert.deepEqual(days('FREQ=DAILY;INTERVAL=3', '2026-08-10', '2026-08-10', '2026-08-20'), [
    '2026-08-10', '2026-08-13', '2026-08-16', '2026-08-19',
  ]);
});

test('a window away from the start still lines up with the series', () => {
  // 2026-08-10 is a Monday; the every-other-week ones are the 10th, 24th, …
  assert.deepEqual(days('FREQ=WEEKLY;INTERVAL=2', '2026-08-10', '2026-09-01', '2026-09-30'), [
    '2026-09-07', '2026-09-21',
  ]);
});

test('weekly with several days repeats the whole set each interval', () => {
  assert.deepEqual(days('FREQ=WEEKLY;BYDAY=MO,WE,FR', '2026-08-10', '2026-08-10', '2026-08-21'), [
    '2026-08-10', '2026-08-12', '2026-08-14', '2026-08-17', '2026-08-19', '2026-08-21',
  ]);
});

test('the start date belongs to the series even when BYDAY does not name it', () => {
  // Started on a Tuesday, set to repeat Mondays: the Tuesday already scheduled stays.
  const got = days('FREQ=WEEKLY;BYDAY=MO', '2026-08-11', '2026-08-10', '2026-08-24');
  assert.deepEqual(got, ['2026-08-11', '2026-08-17', '2026-08-24']);
});

test('nothing happens before the start', () => {
  assert.deepEqual(days('FREQ=DAILY', '2026-08-10', '2026-08-01', '2026-08-11'), ['2026-08-10', '2026-08-11']);
});

test('UNTIL ends the series on its own day, inclusive', () => {
  assert.deepEqual(days('FREQ=DAILY;UNTIL=2026-08-12', '2026-08-10', '2026-08-10', '2026-08-20'), [
    '2026-08-10', '2026-08-11', '2026-08-12',
  ]);
});

test('COUNT counts occurrences, not the ones you happen to be looking at', () => {
  // Three in total, so a later window sees only what is left of them.
  assert.deepEqual(days('FREQ=DAILY;COUNT=3', '2026-08-10', '2026-08-11', '2026-08-30'), ['2026-08-11', '2026-08-12']);
  assert.deepEqual(days('FREQ=DAILY;COUNT=3', '2026-08-10', '2026-08-13', '2026-08-30'), []);
});

test('monthly skips the months that are too short instead of sliding', () => {
  assert.deepEqual(days('FREQ=MONTHLY', '2026-01-31', '2026-01-01', '2026-05-31'), [
    '2026-01-31', '2026-03-31', '2026-05-31',
  ]);
});

test('yearly holds the date, and a leap day waits for a leap year', () => {
  assert.deepEqual(days('FREQ=YEARLY', '2026-03-01', '2026-01-01', '2028-12-31'), [
    '2026-03-01', '2027-03-01', '2028-03-01',
  ]);
  assert.deepEqual(days('FREQ=YEARLY', '2024-02-29', '2025-01-01', '2028-12-31'), ['2028-02-29']);
});

test('a distant window is answered without walking every day of the decade', () => {
  const got = days('FREQ=DAILY', '2026-08-10', '2036-08-10', '2036-08-12');
  assert.deepEqual(got, ['2036-08-10', '2036-08-11', '2036-08-12']);
});

test('next and occursOn agree with the expansion', () => {
  const rule = parseRule('FREQ=WEEKLY;BYDAY=TU');
  assert.equal(nextAfter(rule, '2026-08-11', '2026-08-11'), '2026-08-18');
  assert.equal(occursOn(rule, '2026-08-11', '2026-08-18'), true);
  assert.equal(occursOn(rule, '2026-08-11', '2026-08-19'), false);
  assert.equal(nextAfter(parseRule('FREQ=DAILY;UNTIL=2026-08-12'), '2026-08-10', '2026-08-12'), null);
});
