import { addDays, keyOf } from './util';

/** A moment as the picker carries it: a local day, and a clock time when one was named. */
export interface When {
  /** Local day, `YYYY-MM-DD`. */
  key: string;
  /** Minutes past local midnight, or null when the text named no time. */
  minutes: number | null;
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** Abbreviations that aren't a prefix of the full word, so `startsWith` can do the rest. */
const ALIASES: [RegExp, string][] = [
  [/\btues\b/g, 'tue'],
  [/\bthur?s\b/g, 'thu'],
  [/\bweds\b/g, 'wed'],
  [/\btmrw?\b/g, 'tomorrow'],
  [/\btom\b/g, 'tomorrow'],
  [/\btod\b/g, 'today'],
  [/\byest\b/g, 'yesterday'],
  [/\bsept\b/g, 'sep'],
];

/** Vague times of day, so "tomorrow evening" lands somewhere sensible. */
const DAYPARTS: Record<string, number> = {
  morning: 9 * 60,
  noon: 12 * 60,
  midday: 12 * 60,
  afternoon: 14 * 60,
  evening: 18 * 60,
  tonight: 20 * 60,
  night: 20 * 60,
  midnight: 0,
};

const UNIT_DAYS: Record<string, number> = { d: 1, day: 1, days: 1, w: 7, week: 7, weeks: 7 };

/** Three letters is the shortest abbreviation we take — "ju" can't choose between June and July. */
function nameIndex(list: string[], word: string): number {
  if (word.length < 3) return -1;
  return list.findIndex((n) => n.startsWith(word));
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Monday-start week number, for deciding whether a weekday falls in "this" week or the next. */
const weekStart = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x.getTime();
};

/**
 * Turn what someone typed into a day and maybe a time — "tomorrow", "next fri 3pm",
 * "in 2 weeks", "aug 12", "8/12", "17:30".
 *
 * Deliberately conservative: anything it can't read confidently comes back null so the
 * field keeps what it had, rather than guessing a date the person never meant. Returns
 * a local day key, never a Date, because that's what the properties store.
 */
export function parseWhen(input: string, now: Date = new Date()): When | null {
  let s = String(input || '')
    .toLowerCase()
    .replace(/[,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return null;
  for (const [re, to] of ALIASES) s = s.replace(re, to);

  const today = keyOf(now);

  // ISO is unambiguous, so it never goes through the guessing below.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[t ](\d{1,2}):(\d{2}))?$/);
  if (iso) {
    const key = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return { key, minutes: iso[4] ? clamp(+iso[4], 0, 23) * 60 + clamp(+iso[5], 0, 59) : null };
  }

  let minutes: number | null = null;
  /** Pull the first match out of `s` so what's left is only the date part. */
  const take = (re: RegExp, read: (m: RegExpMatchArray) => void): boolean => {
    const m = s.match(re);
    if (!m) return false;
    read(m);
    s = (s.slice(0, m.index!) + ' ' + s.slice(m.index! + m[0].length)).replace(/\s+/g, ' ').trim();
    return true;
  };

  const hour12 = (h: number, suffix: string) => (suffix === 'pm' ? (h % 12) + 12 : h % 12) * 60;

  // Order matters: am/pm forms must be read before the bare 24-hour one, or "3:30pm"
  // gets taken as 03:30 and the suffix left behind as garbage.
  take(/\b(?:at\s+)?(\d{1,2})[:.](\d{2})\s*([ap])\.?m\.?\b/, (m) => {
    minutes = hour12(+m[1], m[3] + 'm') + clamp(+m[2], 0, 59);
  }) ||
    take(/\b(?:at\s+)?(\d{1,2})\s*([ap])\.?m\.?\b/, (m) => {
      minutes = hour12(+m[1], m[2] + 'm');
    }) ||
    take(/\b(?:at\s+)?([01]?\d|2[0-3])[:.]([0-5]\d)\b/, (m) => {
      minutes = +m[1] * 60 + +m[2];
    }) ||
    // A bare "at 3" is far more often the afternoon than dawn.
    take(/\bat\s+(\d{1,2})\b/, (m) => {
      const h = clamp(+m[1], 0, 23);
      minutes = (h >= 1 && h <= 6 ? h + 12 : h) * 60;
    }) ||
    take(new RegExp(`\\b(${Object.keys(DAYPARTS).join('|')})\\b`), (m) => {
      minutes = DAYPARTS[m[1]];
      // "tonight" names the day as well as the hour.
      if (m[1] === 'tonight' && !s.trim()) s = 'today';
    });

  const at = (key: string): When => ({ key, minutes });

  // Relative offsets that can move the clock as well as the day.
  const rel = s.match(/^in (\d+) ?(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/);
  if (rel) {
    const step = /^m/.test(rel[2]) ? +rel[1] : +rel[1] * 60;
    const then = new Date(now.getTime() + step * 60_000);
    return { key: keyOf(then), minutes: then.getHours() * 60 + then.getMinutes() };
  }

  if (!s) return minutes === null ? null : at(today);

  if (s === 'today' || s === 'now') return at(today);
  if (s === 'tomorrow') return at(addDays(today, 1));
  if (s === 'yesterday') return at(addDays(today, -1));

  const inN = s.match(/^in (\d+) ?(d|day|days|w|week|weeks|mo|month|months|y|year|years)$/);
  const agoN = s.match(/^(\d+) ?(d|day|days|w|week|weeks|mo|month|months|y|year|years) ago$/);
  if (inN || agoN) {
    const m = (inN || agoN)!;
    const n = +m[1] * (agoN ? -1 : 1);
    const unit = m[2];
    if (UNIT_DAYS[unit]) return at(addDays(today, n * UNIT_DAYS[unit]));
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (unit.startsWith('y')) d.setFullYear(d.getFullYear() + n);
    else d.setMonth(d.getMonth() + n);
    return at(keyOf(d));
  }

  const span = s.match(/^(next|last|this) (week|month|year|weekend)$/);
  if (span) {
    const sign = span[1] === 'last' ? -1 : span[1] === 'this' ? 0 : 1;
    if (span[2] === 'weekend') return at(upcoming(now, 6, sign > 0));
    if (span[2] === 'week') return at(addDays(today, 7 * sign));
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (span[2] === 'month') d.setMonth(d.getMonth() + sign);
    else d.setFullYear(d.getFullYear() + sign);
    return at(keyOf(d));
  }
  if (s === 'weekend') return at(upcoming(now, 6, false));

  const dow = s.match(/^(?:(next|last|this|coming) )?([a-z]+)$/);
  if (dow) {
    const idx = nameIndex(DAYS, dow[2]);
    if (idx >= 0) {
      if (dow[1] === 'last') {
        let back = (now.getDay() - idx + 7) % 7;
        return at(addDays(today, -(back || 7)));
      }
      return at(upcoming(now, idx, dow[1] === 'next'));
    }
  }

  // "aug 12", "12 aug", either with a year, ordinals allowed.
  const ord = (v: string) => +v.replace(/(st|nd|rd|th)$/, '');
  const md = s.match(/^([a-z]+) (\d{1,2}(?:st|nd|rd|th)?)(?: (\d{4}))?$/);
  const dm = s.match(/^(\d{1,2}(?:st|nd|rd|th)?) (?:of )?([a-z]+)(?: (\d{4}))?$/);
  for (const [m, monthAt, dayAt] of [
    [md, 1, 2],
    [dm, 2, 1],
  ] as const) {
    if (!m) continue;
    const month = nameIndex(MONTHS, m[monthAt]);
    const day = ord(m[dayAt]);
    if (month < 0 || day < 1 || day > 31) continue;
    const year = m[3] ? +m[3] : now.getFullYear();
    const d = new Date(year, month, day);
    if (d.getMonth() !== month) return null; // rejects "feb 31"
    return at(keyOf(d));
  }

  // Numeric, month first — the same order the app formats dates in.
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (slash) {
    const month = +slash[1] - 1;
    const day = +slash[2];
    let year = slash[3] ? +slash[3] : now.getFullYear();
    if (year < 100) year += 2000;
    if (month < 0 || month > 11 || day < 1 || day > 31) return null;
    const d = new Date(year, month, day);
    if (d.getMonth() !== month) return null;
    return at(keyOf(d));
  }

  // A bare number is a day of this month, rolling forward once it's past.
  const bare = s.match(/^(\d{1,2})(?:st|nd|rd|th)?$/);
  if (bare) {
    const day = +bare[1];
    if (day < 1 || day > 31) return null;
    for (const delta of [0, 1]) {
      const d = new Date(now.getFullYear(), now.getMonth() + delta, day);
      if (d.getDate() !== day) continue;
      if (delta === 0 && keyOf(d) < today) continue;
      return at(keyOf(d));
    }
    return null;
  }

  return null;
}

/**
 * The next given weekday. Bare "friday" includes today, because on a Friday that is
 * what people mean; "next friday" always moves into a later calendar week.
 */
function upcoming(now: Date, weekday: number, forceNext: boolean): string {
  const today = keyOf(now);
  const ahead = (weekday - now.getDay() + 7) % 7;
  let key = addDays(today, ahead);
  if (forceNext) {
    if (ahead === 0) key = addDays(key, 7);
    else if (weekStart(new Date(key + 'T12:00:00')) === weekStart(now)) key = addDays(key, 7);
  }
  return key;
}

/** How a committed value reads back in the closed field. */
export function fmtWhen(key: string, minutes: number | null): string {
  const d = new Date(key + 'T12:00:00');
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const day = d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return minutes === null ? day : `${day} · ${fmtClock(minutes)}`;
}

export function fmtClock(minutes: number): string {
  return new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` — the shapes the date and datetime properties store. */
export function toValue(key: string, minutes: number | null): string {
  if (minutes === null) return key;
  return `${key}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** The inverse, tolerant of whatever is already in the vault. */
export function fromValue(value: string | null | undefined): When | null {
  const s = String(value || '');
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  return { key: m[1], minutes: m[2] ? clamp(+m[2], 0, 23) * 60 + clamp(+m[3], 0, 59) : null };
}
