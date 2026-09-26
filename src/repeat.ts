/**
 * The renderer's half of recurrence: reading and writing the same rule strings
 * `electron/recur.js` expands, and saying them in English.
 *
 * Deliberately only the grammar — which days a rule actually lands on is worked
 * out once, in the main process, so the calendar, the HTTP API and MCP can never
 * disagree about when something happens.
 */

/**
 * Where a rule and its per-day bookkeeping live on an object. Conventional
 * property ids shared with the main process, not a schema of their own.
 */
export const REPEAT_PROP = 'repeat';
export const REPEAT_DONE_PROP = 'repeatDone';

/** The days of a series already ticked off. */
export const doneDays = (props: Record<string, any> | undefined): string[] =>
  Array.isArray(props?.[REPEAT_DONE_PROP]) ? props![REPEAT_DONE_PROP] : [];

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface Rule {
  freq: Freq;
  interval: number;
  /** WEEKLY only, `MO`…`SU`. Empty means "the weekday it starts on". */
  byDay?: string[];
  /** Stops after this many occurrences. */
  count?: number;
  /** Stops on this day, inclusive. */
  until?: string;
}

export const DAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
/** Monday-first, to match the week the calendar draws. */
export const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const FREQS: Freq[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];
const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Sunday-first, the order `Date.getDay()` uses. */
const BY_WEEKDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const FULL_DAYS: Record<string, string> = {
  MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday', SU: 'Sunday',
};

export function parseRule(raw: string | null | undefined): Rule | null {
  if (!raw || typeof raw !== 'string') return null;
  const parts = new Map<string, string>();
  for (const chunk of raw.trim().split(';')) {
    const i = chunk.indexOf('=');
    if (i > 0) parts.set(chunk.slice(0, i).trim().toUpperCase(), chunk.slice(i + 1).trim().toUpperCase());
  }

  const freq = parts.get('FREQ') as Freq;
  if (!FREQS.includes(freq)) return null;

  const interval = Number(parts.get('INTERVAL') || 1);
  const byDay = (parts.get('BYDAY') || '').split(',').map((s) => s.trim()).filter((s) => DAY_CODES.includes(s));
  const count = Number(parts.get('COUNT') || 0);
  const until = parts.get('UNTIL') || '';

  const rule: Rule = { freq, interval: Number.isFinite(interval) && interval > 0 ? Math.floor(interval) : 1 };
  if (freq === 'WEEKLY' && byDay.length) rule.byDay = DAY_CODES.filter((d) => byDay.includes(d));
  if (Number.isFinite(count) && count > 0) rule.count = Math.floor(count);
  if (KEY_RE.test(until)) rule.until = until;
  return rule;
}

export function formatRule(rule: Rule | null): string {
  if (!rule) return '';
  const out = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) out.push(`INTERVAL=${Math.floor(rule.interval)}`);
  if (rule.freq === 'WEEKLY' && rule.byDay?.length) out.push(`BYDAY=${rule.byDay.join(',')}`);
  if (rule.count) out.push(`COUNT=${Math.floor(rule.count)}`);
  if (rule.until) out.push(`UNTIL=${rule.until}`);
  return out.join(';');
}

/** The code for a day key's weekday, so a picker can pre-tick the day you started on. */
export const codeFor = (key: string): string => BY_WEEKDAY[new Date(key + 'T12:00:00').getDay()];

const ordinal = (n: number) => {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

const list = (items: string[]) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/**
 * The rule in words — "Every 2 weeks on Monday and Wednesday, until 12 Mar".
 * `anchor` is the first occurrence, which is what monthly and yearly rules are
 * counted from and what a weekly rule falls back to.
 */
export function describeRule(rule: Rule | null, anchor?: string | null): string {
  if (!rule) return 'Doesn’t repeat';
  const n = rule.interval;
  const day = anchor && KEY_RE.test(anchor.slice(0, 10)) ? new Date(anchor.slice(0, 10) + 'T12:00:00') : null;

  let base: string;
  if (rule.freq === 'DAILY') base = n === 1 ? 'Every day' : `Every ${n} days`;
  else if (rule.freq === 'WEEKLY') {
    const days = rule.byDay?.length ? rule.byDay : anchor ? [codeFor(anchor.slice(0, 10))] : [];
    const named = list(days.map((d) => FULL_DAYS[d] ?? d));
    const every = n === 1 ? 'Every week' : `Every ${n} weeks`;
    base = named ? `${every} on ${named}` : every;
  } else if (rule.freq === 'MONTHLY') {
    const every = n === 1 ? 'Every month' : `Every ${n} months`;
    base = day ? `${every} on the ${ordinal(day.getDate())}` : every;
  } else {
    const every = n === 1 ? 'Every year' : `Every ${n} years`;
    base = day ? `${every} on ${day.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}` : every;
  }

  if (rule.count) return `${base}, ${rule.count} times`;
  if (rule.until)
    return `${base}, until ${new Date(rule.until + 'T12:00:00').toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    })}`;
  return base;
}

/** The short form for a chip or a calendar entry: "Every 2 weeks" without the tail. */
export const shortRule = (rule: Rule | null, anchor?: string | null): string =>
  describeRule(rule, anchor).split(',')[0];

/**
 * Every day the series lands on between `from` and `to`, inclusive.
 */
export function occurrences(rule: Rule | null, start: string, from: string, to: string): string[] {
  if (!rule || !KEY_RE.test(start || '') || !KEY_RE.test(from || '') || !KEY_RE.test(to || '')) return [];
  if (to < start) return [];

  const last = rule.until && rule.until < to ? rule.until : to;
  if (last < start) return [];

  const out: string[] = [];
  let emitted = 0;
  let steps = 0;
  const maxSteps = 20000;
  const maxResults = 750;

  const push = (key: string) => {
    if (key < start || key > last) return true;
    if (rule.count && emitted >= rule.count) return false;
    emitted++;
    if (key >= from && out.length < maxResults) out.push(key);
    return true;
  };

  const addD = (k: string, n: number) => {
    const d = new Date(k + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  if (rule.freq === 'WEEKLY') {
    const wanted = rule.byDay && rule.byDay.length ? rule.byDay : [codeFor(start)];
    const startDay = new Date(start + 'T12:00:00').getDay();
    const monday = addD(start, -((startDay + 6) % 7));
    const startIsSpare = !wanted.includes(codeFor(start));
    if (startIsSpare && !push(start)) return out;
    for (let week = 0; steps < maxSteps; week += rule.interval) {
      const weekStart = addD(monday, week * 7);
      if (weekStart > last && addD(weekStart, 6) > last) break;
      for (let i = 0; i < 7; i++) {
        steps++;
        const key = addD(weekStart, i);
        if (!wanted.includes(codeFor(key))) continue;
        if (!push(key)) return out;
      }
      if (rule.count && emitted >= rule.count) break;
    }
    return out;
  }

  if (rule.freq === 'MONTHLY' || rule.freq === 'YEARLY') {
    const s = new Date(start + 'T12:00:00');
    const day = s.getDate();
    const stepMonths = (rule.freq === 'YEARLY' ? 12 : 1) * rule.interval;
    for (let n = 0; steps < maxSteps; n++) {
      steps++;
      const d = new Date(s.getFullYear(), s.getMonth() + n * stepMonths, 1, 12);
      const lastOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12).getDate();
      if (day > lastOfMonth) {
        const lastDayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(lastOfMonth).padStart(2, '0')}`;
        if (lastDayKey > last) break;
        continue;
      }
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (key > last) break;
      if (!push(key)) return out;
    }
    return out;
  }

  for (let key = start; steps < maxSteps && key <= last; key = addD(key, rule.interval)) {
    steps++;
    if (!push(key)) return out;
  }
  return out;
}
