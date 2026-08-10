/**
 * Repeating things — "every Tuesday", "the 1st of the month" — as a rule on the
 * object rather than a row per occurrence.
 *
 * A series is one object: its date property holds the first occurrence and a
 * `repeat` property holds the rule. Everything after that is worked out when the
 * calendar is read, so a weekly standup costs one row however long it runs, and
 * changing the rule changes every future occurrence at once.
 *
 * The rule is stored as a short string in RRULE's spelling, so it stays readable
 * in the property, survives export, and can grow toward real iCalendar later:
 *
 *   FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=2026-12-31
 *   FREQ=MONTHLY;COUNT=6
 *
 * Days are local `YYYY-MM-DD` keys throughout. Dates are built at noon so a
 * daylight-saving jump can never round an occurrence onto its neighbour.
 */

const FREQS = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Enough steps for a daily rule to reach ~55 years out before it gives up. */
const MAX_STEPS = 20000;
/** Nothing sane asks for more than this from one window; stops a bad rule eating the read. */
const MAX_RESULTS = 750;

const at = (key) => new Date(key + 'T12:00:00');

const keyOf = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function addDays(key, n) {
  const d = at(key);
  d.setDate(d.getDate() + n);
  return keyOf(d);
}

/**
 * Read a rule string. Returns null for anything unrecognised — an empty
 * property, a hand-typed mess — so callers can treat "doesn't repeat" and
 * "can't be understood" the same way and simply show the single date.
 */
function parseRule(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const parts = new Map();
  for (const chunk of raw.trim().split(';')) {
    const i = chunk.indexOf('=');
    if (i > 0) parts.set(chunk.slice(0, i).trim().toUpperCase(), chunk.slice(i + 1).trim().toUpperCase());
  }

  const freq = parts.get('FREQ');
  if (!FREQS.includes(freq)) return null;

  const interval = Number(parts.get('INTERVAL') || 1);
  const byDay = (parts.get('BYDAY') || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => DAY_CODES.includes(s));
  const count = Number(parts.get('COUNT') || 0);
  const until = parts.get('UNTIL') || '';

  const rule = { freq, interval: Number.isFinite(interval) && interval > 0 ? Math.floor(interval) : 1 };
  if (freq === 'WEEKLY' && byDay.length) rule.byDay = byDay;
  if (Number.isFinite(count) && count > 0) rule.count = Math.floor(count);
  if (KEY_RE.test(until)) rule.until = until;
  return rule;
}

/** Back to the stored string. Round-trips whatever `parseRule` understood. */
function formatRule(rule) {
  if (!rule || !FREQS.includes(rule.freq)) return '';
  const out = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) out.push(`INTERVAL=${Math.floor(rule.interval)}`);
  if (rule.freq === 'WEEKLY' && rule.byDay && rule.byDay.length) out.push(`BYDAY=${rule.byDay.join(',')}`);
  if (rule.count) out.push(`COUNT=${Math.floor(rule.count)}`);
  if (rule.until) out.push(`UNTIL=${rule.until}`);
  return out.join(';');
}

/**
 * Every day the series lands on between `from` and `to`, inclusive.
 *
 * `start` is the first occurrence — the date already on the object — and is
 * always part of the series even when a WEEKLY rule's BYDAY doesn't name its
 * weekday, because that date is what the person actually scheduled.
 */
function occurrences(rule, start, from, to) {
  if (!rule || !KEY_RE.test(start || '') || !KEY_RE.test(from || '') || !KEY_RE.test(to || '')) return [];
  if (to < start) return [];

  const last = rule.until && rule.until < to ? rule.until : to;
  if (last < start) return [];

  const out = [];
  let emitted = 0;
  let steps = 0;

  // `push` is the single place COUNT and the window are applied, so every
  // frequency below only has to say which days it would like.
  const push = (key) => {
    if (key < start || key > last) return true;
    if (rule.count && emitted >= rule.count) return false;
    emitted++;
    if (key >= from && out.length < MAX_RESULTS) out.push(key);
    return true;
  };

  if (rule.freq === 'WEEKLY') {
    const wanted = rule.byDay && rule.byDay.length ? rule.byDay : [DAY_CODES[at(start).getDay()]];
    // Weeks are stepped from the start's own Monday, so INTERVAL=2 means the
    // same alternate weeks whichever weekday you look at.
    const monday = addDays(start, -((at(start).getDay() + 6) % 7));
    // The date already on the object counts, even when the chosen weekdays don't
    // include its own: it is the appointment that was actually made.
    const startIsSpare = !wanted.includes(DAY_CODES[at(start).getDay()]);
    if (startIsSpare && !push(start)) return out;
    for (let week = 0; steps < MAX_STEPS; week += rule.interval) {
      const weekStart = addDays(monday, week * 7);
      if (weekStart > last && addDays(weekStart, 6) > last) break;
      for (let i = 0; i < 7; i++) {
        steps++;
        const key = addDays(weekStart, i);
        if (!wanted.includes(DAY_CODES[at(key).getDay()])) continue;
        if (!push(key)) return out;
      }
      if (rule.count && emitted >= rule.count) break;
    }
    return out;
  }

  if (rule.freq === 'MONTHLY' || rule.freq === 'YEARLY') {
    const s = at(start);
    const day = s.getDate();
    const stepMonths = (rule.freq === 'YEARLY' ? 12 : 1) * rule.interval;
    for (let n = 0; steps < MAX_STEPS; n++) {
      steps++;
      const d = new Date(s.getFullYear(), s.getMonth() + n * stepMonths, 1, 12);
      // A rule anchored on the 31st simply skips the months that are shorter,
      // rather than sliding onto the 1st of the next one.
      const lastOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12).getDate();
      if (day > lastOfMonth) {
        if (keyOf(new Date(d.getFullYear(), d.getMonth(), lastOfMonth, 12)) > last) break;
        continue;
      }
      const key = keyOf(new Date(d.getFullYear(), d.getMonth(), day, 12));
      if (key > last) break;
      if (!push(key)) return out;
    }
    return out;
  }

  for (let key = start; steps < MAX_STEPS && key <= last; key = addDays(key, rule.interval)) {
    steps++;
    if (!push(key)) return out;
  }
  return out;
}

/** The first occurrence strictly after `afterKey`, or null once the series ends. */
function nextAfter(rule, start, afterKey) {
  if (!rule) return null;
  const from = addDays(afterKey, 1);
  // A year is enough for every frequency this supports to produce something.
  const found = occurrences(rule, start, from, addDays(from, 366 * (rule.freq === 'YEARLY' ? rule.interval + 1 : 1)));
  return found[0] || null;
}

/** Does this series land on this day? */
const occursOn = (rule, start, key) => occurrences(rule, start, key, key).length > 0;

module.exports = { parseRule, formatRule, occurrences, nextAfter, occursOn, DAY_CODES };
