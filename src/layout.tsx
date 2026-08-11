/**
 * How much room there is, and what kind of pointer is asking.
 *
 * These are two separate questions and they disagree on real hardware: an iPad
 * is wide with a coarse pointer, a phone in landscape is short and wide, a
 * touchscreen laptop is a desktop that you sometimes poke. One `isMobile` flag
 * gets all three wrong, so nothing here collapses them.
 *
 *   narrow — drives layout: drawer vs pinned sidebar, cards vs table, stacked
 *            splits only. Below every iPad, including the 744pt mini, so a
 *            tablet keeps the desktop layout.
 *   coarse — drives affordance: hit targets, no hover-only reveals, sheets in
 *            place of anchored popovers.
 *   short  — the on-screen keyboard is usually why, so it gates the vertical
 *            trimming that only matters while typing.
 *
 * The flags are mirrored onto <html> as data attributes so CSS can branch on
 * its own; `useLayout()` is for the cases where the *structure* has to change,
 * not just the styling.
 */
import { useSyncExternalStore } from 'react';

export interface Layout {
  narrow: boolean;
  coarse: boolean;
  short: boolean;
  /** A soft keyboard is up, so the app has far less room than the window says. */
  keyboard: boolean;
}

/** Only the flags a media query can answer; `keyboard` is measured instead. */
const QUERIES = {
  // A phone in landscape is 844×390: wide enough to miss the width test, so the
  // short-and-coarse clause catches it.
  narrow: '(max-width: 700px), (pointer: coarse) and (max-height: 500px)',
  coarse: '(pointer: coarse)',
  short: '(max-height: 500px)',
} satisfies Record<string, string>;

/** The media-query-backed flags. `keyboard` is measured, not queried. */
const KEYS = Object.keys(QUERIES) as (keyof typeof QUERIES)[];

/**
 * How much shorter the visible viewport has to be than the window before we
 * call it a keyboard. Comfortably above the few dozen pixels a collapsing
 * address bar accounts for, comfortably below any real keyboard.
 */
const KEYBOARD_MIN = 120;

const listeners = new Set<() => void>();
let lists: MediaQueryList[] | null = null;
/** Cached because useSyncExternalStore compares snapshots by identity: a fresh
 *  object every read is an infinite render loop. */
let snapshot: Layout = { narrow: false, coarse: false, short: false, keyboard: false };

function read(): Layout {
  const l = lists!;
  const vv = typeof visualViewport !== 'undefined' ? visualViewport : null;
  return {
    narrow: l[0].matches,
    coarse: l[1].matches,
    short: l[2].matches,
    keyboard: !!vv && window.innerHeight - vv.height > KEYBOARD_MIN,
  };
}

/**
 * Presence attributes — `[data-narrow]` matches, and the value is never read —
 * plus the one value CSS genuinely needs a number for.
 *
 * `--vvh` is the height actually visible. `100dvh` does not do this job: it
 * accounts for browser chrome that comes and goes, not for a keyboard, so a
 * shell sized in dvh keeps its full height and puts its lower half behind the
 * keyboard. Everything anchored to the bottom of the app — the action pill, the
 * lower pane of a split — depends on this being the real number.
 */
function mirror(state: Layout) {
  const el = document.documentElement;
  for (const key of KEYS) {
    if (state[key]) el.dataset[key] = '';
    else delete el.dataset[key];
  }
  if (state.keyboard) el.dataset.keyboard = '';
  else delete el.dataset.keyboard;

  const vv = typeof visualViewport !== 'undefined' ? visualViewport : null;
  const height = vv ? vv.height : window.innerHeight;
  el.style.setProperty('--vvh', height + 'px');
  // How much of the window the keyboard is covering. Anything positioned
  // against the *layout* viewport — a fixed bottom sheet — has to add this or
  // it renders underneath the keyboard: `position: fixed` does not know the
  // keyboard exists.
  el.style.setProperty('--kb', Math.max(0, window.innerHeight - height) + 'px');
}

function start() {
  if (lists) return;
  lists = KEYS.map((k) => matchMedia(QUERIES[k]));

  const onChange = () => {
    const next = read();
    // The height always has to be republished — the keyboard can grow or shrink
    // (predictive text, an emoji panel) without crossing the open/closed line.
    mirror(next);
    // Rotating a phone crosses several thresholds at once; only tell React when
    // something actually moved.
    if ((Object.keys(next) as (keyof Layout)[]).every((k) => next[k] === snapshot[k])) return;
    snapshot = next;
    for (const fn of listeners) fn();
  };

  for (const list of lists) list.addEventListener('change', onChange);

  // The keyboard opening never fires a media query or a window resize on iOS;
  // the visual viewport is the only thing that reports it.
  visualViewport?.addEventListener('resize', onChange);
  visualViewport?.addEventListener('scroll', onChange);

  // `change` alone is not enough. A media query fires it when the query's own
  // result flips, but a webview can change size without that ever happening
  // reliably — an Electron window being dragged, iPad split view, the keyboard
  // pushing the viewport up. Resize is the belt to that pair of braces, and it
  // costs one matchMedia read per frame at most.
  let frame = 0;
  const onResize = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      onChange();
    });
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  snapshot = read();
  mirror(snapshot);
}

/**
 * Called from the entry point before React mounts, so the first paint already
 * has the right attributes and the layout doesn't visibly switch under you.
 */
export function initLayout() {
  start();
}

const subscribe = (fn: () => void) => {
  start();
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

const getSnapshot = () => snapshot;

export function useLayout(): Layout {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
