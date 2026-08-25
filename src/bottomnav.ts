/**
 * The bottom navigation bar shown when the window is narrow — a phone, or an
 * Electron window pinched thin (see `narrow` in layout.ts; both cases share
 * one code path). What lands in it is entirely up to the user: a handful of
 * builtin destinations plus `types` (a sheet listing every type) and `more`
 * (opens the full sidebar-as-drawer) sit alongside every object type, any of
 * which can be pinned into a slot directly. See BottomNav.tsx for the bar
 * itself and SettingsModal's Navigation tab for the editor.
 *
 * Slots are plain strings so they survive `JSON.stringify` untouched and a
 * pinned type only needs its id, not a lookup table: `type:<id>`.
 */
export type NavKey =
  | 'dashboard'
  | 'daily'
  | 'tasks'
  | 'events'
  | 'people'
  | 'tags'
  | 'study'
  | 'types'
  | 'more'
  | `type:${string}`;

export interface NavBuiltin {
  key: Exclude<NavKey, `type:${string}`>;
  label: string;
  icon: string;
}

export const NAV_BUILTINS: NavBuiltin[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { key: 'daily', label: 'Daily Notes', icon: 'calendar' },
  { key: 'tasks', label: 'Tasks', icon: 'circle-check' },
  { key: 'events', label: 'Events', icon: 'calendar-clock' },
  { key: 'people', label: 'People', icon: 'people' },
  { key: 'tags', label: 'Tags', icon: 'hash' },
  { key: 'study', label: 'Study', icon: 'study' },
  { key: 'types', label: 'Types…', icon: 'table' },
  { key: 'more', label: 'More', icon: 'more-horizontal' },
];

export const NAV_BUILTIN_MAP = new Map(NAV_BUILTINS.map((b) => [b.key, b]));

/** Dashboard, Daily Notes, Tasks up front, everything else behind Types / More. */
export const DEFAULT_NAV: NavKey[] = ['dashboard', 'daily', 'tasks', 'types', 'more'];

/** Five comfortably fit a 375px screen without crowding; a sixth still fits, snugly. */
export const MAX_SLOTS = 6;

const STORE_KEY = 'habitat:bottomnav';

export function loadNav(): NavKey[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length && parsed.every((k) => typeof k === 'string')) return parsed as NavKey[];
  } catch {
    // Corrupt value from a future version or manual edit — fall through to the default.
  }
  return DEFAULT_NAV;
}

export function saveNav(keys: NavKey[]) {
  localStorage.setItem(STORE_KEY, JSON.stringify(keys));
}

export const typeKey = (id: string): NavKey => `type:${id}`;

export const typeIdOf = (key: string): string | null => (key.startsWith('type:') ? key.slice(5) : null);
