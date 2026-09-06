import { Mark, mergeAttributes } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';

/**
 * Hidden text: select a phrase, hit "Hide text" in the selection toolbar, and
 * it's redacted behind a blur until someone clicks it. A click reveals it long
 * enough to read or copy, then it covers itself back up on its own — nobody
 * has to remember to hide it again.
 *
 * The reveal is DOM state, not editor state (a class toggled on the rendered
 * span, timed by hand below), so clicking through a note never dirties the
 * document or fires a save.
 */
export const Spoiler = Mark.create({
  name: 'spoiler',
  inclusive: false,

  parseHTML() {
    return [{ tag: 'span[data-spoiler]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-spoiler': '', class: 'spoiler-mark' }), 0];
  },

  addProseMirrorPlugins() {
    return [spoilerClickPlugin()];
  },
});

/** How long a reveal lasts before the text covers itself again. */
const REVEAL_MS = 4000;

const hideTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

function hide(el: HTMLElement) {
  el.classList.remove('is-revealed');
  const t = hideTimers.get(el);
  if (t) {
    clearTimeout(t);
    hideTimers.delete(el);
  }
}

function reveal(el: HTMLElement) {
  el.classList.add('is-revealed');
  const t = hideTimers.get(el);
  if (t) clearTimeout(t);
  hideTimers.set(
    el,
    setTimeout(() => hide(el), REVEAL_MS)
  );
}

/** How far the pointer may drift between press and release and still count
 *  as "a click" rather than the start of a text-selection drag. */
const CLICK_SLOP = 4;

/**
 * A plain `handleDOMEvents` pair rather than a node view: the mark still
 * renders as ordinary inline text (so copy, search and export all see the
 * real content), and only the click-to-reveal behaviour is layered on top.
 *
 * Hidden text reveals on press, immediately and without waiting for release,
 * so the gesture reads as "uncover" rather than "click a button". Revealed
 * text is left alone on press — that's what lets a drag starting on it
 * become an ordinary text selection, for copying. Only a *plain* press-then-
 * release with no drag re-hides it early; otherwise the timeout above does
 * that on its own.
 */
function spoilerClickPlugin() {
  let down: { x: number; y: number; el: HTMLElement } | null = null;

  return new Plugin({
    props: {
      handleDOMEvents: {
        mousedown(_view, event) {
          down = null;
          if (event.button !== 0 || event.shiftKey) return false;
          const el = (event.target as HTMLElement).closest?.('[data-spoiler]') as HTMLElement | null;
          if (!el) return false;
          if (!el.classList.contains('is-revealed')) {
            event.preventDefault();
            reveal(el);
            return true;
          }
          // Already showing: remember where the press landed, and decide on
          // release whether it was a click (re-hide) or a drag (leave it be).
          down = { x: event.clientX, y: event.clientY, el };
          return false;
        },
        mouseup(_view, event) {
          if (!down) return false;
          const { x, y, el } = down;
          down = null;
          const moved = Math.hypot(event.clientX - x, event.clientY - y) > CLICK_SLOP;
          if (!moved) hide(el);
          return false;
        },
      },
    },
  });
}
