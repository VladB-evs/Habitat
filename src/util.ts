import type { ObjType, PropDef } from './types';

/**
 * The select property that makes a type behave like a task list — any type with a
 * "Done" option qualifies, not just the builtin Task.
 */
export function taskProp(type?: ObjType): PropDef | undefined {
  return type?.properties.find((p) => p.kind === 'select' && (p.options ?? []).includes('Done'));
}

/** The value a task goes back to when un-ticked. */
export const openStatusOf = (p?: PropDef): string => p?.options?.find((o) => o !== 'Done') ?? 'Todo';

// Dark-mode steps for the validated categorical palette (light hex is canonical in the DB).
const DARK_STEP: Record<string, string> = {
  '#2a78d6': '#3987e5',
  '#eb6834': '#d95926',
  '#1baf7a': '#199e70',
  '#eda100': '#c98500',
  '#e87ba4': '#d55181',
  '#008300': '#008300',
  '#4a3aa7': '#9085e9',
  '#e34948': '#e66767',
  '#0f9bb0': '#17b4cc',
  '#7d4bd8': '#a07ce8',
  '#b8531f': '#cf6c37',
  '#5c7a1e': '#7c9c33',
  '#d1367f': '#e05a99',
  '#2f6f6a': '#43918a',
  '#8a6d3b': '#a98a52',
  '#525c6b': '#7d8899',
};

export const TYPE_PALETTE = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#4a3aa7',
  '#e34948',
  '#0f9bb0',
  '#7d4bd8',
  '#b8531f',
  '#5c7a1e',
  '#d1367f',
  '#2f6f6a',
  '#8a6d3b',
  '#525c6b',
];

export function typeColor(hex: string | undefined, theme: string): string {
  if (!hex) return theme === 'dark' ? '#9c9c97' : '#73726e';
  return theme === 'dark' ? DARK_STEP[hex.toLowerCase()] ?? hex : hex;
}

/**
 * A stable colour per option value: same word always lands on the same hue, so
 * "Done" looks the same everywhere without anyone picking colours by hand.
 */
export function optionColor(value: string, theme: string): { bg: string; fg: string; border: string } {
  let h = 0;
  const v = String(value).trim().toLowerCase();
  for (let i = 0; i < v.length; i++) h = (Math.imul(h, 31) + v.charCodeAt(i)) >>> 0;
  // Spread hues around the wheel and skip the muddy yellow-green band.
  const hue = (h % 320) + (((h % 320) > 60 ? 40 : 0));
  const sat = 55 + (h % 3) * 8;
  return theme === 'dark'
    ? { bg: `hsl(${hue} ${sat - 20}% 20%)`, fg: `hsl(${hue} ${sat}% 76%)`, border: `hsl(${hue} ${sat - 15}% 30%)` }
    : { bg: `hsl(${hue} ${sat + 20}% 93%)`, fg: `hsl(${hue} ${sat}% 32%)`, border: `hsl(${hue} ${sat}% 80%)` };
}

export function keyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const todayKey = () => keyOf(new Date());

export function addDays(key: string, n: number): string {
  const d = new Date(key + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return keyOf(d);
}

export function fmtDay(key: string): string {
  return new Date(key + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

export function fmtMonthYear(key: string): string {
  return new Date(key + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** "Jul 30", or "Jul 30, 2027" when it isn't this year — short enough for a chip. */
export function fmtChipDate(value: string): string {
  const key = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return String(value);
  const d = new Date(key + 'T12:00:00');
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function fmtShort(key: string): string {
  return new Date(key + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Monday-start week containing the given date key. */
export function weekOf(key: string): string[] {
  const d = new Date(key + 'T12:00:00');
  const dow = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dow);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setDate(d.getDate() + i);
    return keyOf(x);
  });
}

/** First day of the month `delta` months from the one containing dateKey. */
export function monthStartKey(dateKey: string, delta: number): string {
  const d = new Date(dateKey + 'T12:00:00');
  return keyOf(new Date(d.getFullYear(), d.getMonth() + delta, 1));
}

/** 42-cell month grid (Monday start) for the month containing dateKey. */
export function monthCells(dateKey: string) {
  const d = new Date(dateKey + 'T12:00:00');
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => {
    const x = new Date(start);
    x.setDate(start.getDate() + i);
    return { key: keyOf(x), day: x.getDate(), inMonth: x.getMonth() === d.getMonth() };
  });
}

export function relBadge(key: string): string {
  const t = todayKey();
  if (key === t) return 'Today';
  if (key === addDays(t, -1)) return 'Yesterday';
  if (key === addDays(t, 1)) return 'Tomorrow';
  return '';
}

export function ago(ts: number): string {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24;
  if (d < 7) return `${Math.floor(d)}d ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export const clientUid = () => Math.random().toString(36).slice(2, 10);

/** The People type id — its own view, its own page, hidden from the generic type list. */
export const PEOPLE_TYPE = 'people';

/**
 * Types an object can't be moved in or out of: a daily note is keyed by its
 * date, a tag is only a label, and a person backs the address book. The main
 * process refuses these too — this is the same rule, so the UI doesn't offer a
 * move that would only come back as an error.
 */
export const canChangeType = (typeId: string) => typeId !== 'daily' && typeId !== 'tag' && typeId !== PEOPLE_TYPE;

/**
 * Properties that describe a link to someone else, so they never appear on the
 * user's own card — there is no relationship between me and me. The main
 * process strips them on write; this is the same list for the editor.
 */
export const SELF_HIDDEN_PROPS = ['relationship'];

/** The properties a person's page shows: the self card is its own, shorter, entity. */
export const personProps = <T extends { id: string }>(defs: T[], isSelf: boolean): T[] =>
  isSelf ? defs.filter((p) => !SELF_HIDDEN_PROPS.includes(p.id)) : defs;

/** Relationship is a multi-select — one person can be a colleague and a friend. */
export function relationships(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  return value ? [String(value)] : [];
}

/** Up to two letters for an avatar: first letters of the first and last words. */
export function initials(name: string): string {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = [...words[0]][0] ?? '';
  const last = words.length > 1 ? [...words[words.length - 1]][0] ?? '' : '';
  return (first + last).toUpperCase();
}

/** A stable colour per person, so the same face keeps the same badge everywhere. */
export const avatarColor = (name: string, theme: string) => optionColor(name || '?', theme);

/** "Today", "Tomorrow", "in 12 days", "in 3 months" — how a countdown reads best. */
export function birthdayCountdown(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 21) return `in ${days} days`;
  if (days < 45) return 'in a month';
  return `in ${Math.round(days / 30)} months`;
}

/** "14 March" — a birthday without the year, which is rarely the interesting part. */
export function fmtBirthday(month: number, day: number): string {
  return new Date(2001, month - 1, day).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
