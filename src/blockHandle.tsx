import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { popPos } from './components/cells';
import { Icon } from './components/Icons';
import { useLayout } from './layout';

/**
 * The grip in the left margin, Notion-style: hover a block and it appears
 * beside it, drag it to move the block, click it for what else you can do.
 * Shift-click a second row's grip to extend the selection to every row
 * between the two — drag, Duplicate, Delete and Turn into then all act on
 * the whole run of rows, not just the one the grip happens to sit beside.
 *
 * Top-level blocks get one, and so does each list item — a bullet, task, or
 * ordered-list row is a block in its own right and drags on its own, however
 * deep it's nested. Anything else nested (a paragraph inside a table cell, say)
 * is found by walking up to the direct child of the editor instead, so dragging
 * that moves the whole enclosing structure rather than tearing a piece out of it.
 */

/** Height of the grip, in CSS pixels — it centres itself on a line of text. */
const GRIP = 24;

/** How far into the left margin still counts as hovering the block. */
const MARGIN = 56;

interface Hover {
  /** Where to put the grip, relative to the editor's own box. */
  top: number;
  /** The block's element. Its document position is read from it when acted on,
   *  so typing above the block can't leave the grip pointing at stale text. */
  el: HTMLElement;
}

/**
 * The row at a point: the direct child of the editor that contains it, or the
 * nearest enclosing list item — whichever is nearer — so a bullet a few levels
 * deep still moves by itself instead of dragging its whole list.
 *
 * This goes through ProseMirror's own coordinate mapping rather than
 * `document.elementFromPoint`, because a list's indent is padding on the
 * `<ul>` itself, not on its `<li>`s — so a point in the left margin, which is
 * exactly where this is called from, lands back on the `<ul>` for anything
 * indented, undoing the "each row drags on its own" fix below it.
 * `posAtCoords` instead resolves to a document position from a line's actual
 * rendered box, however far left of it the point sits, so it always names the
 * right row; walking its node ancestry (not the DOM's) then finds the block.
 */
function rowAt(editor: Editor, x: number, y: number): HTMLElement | null {
  const found = editor.view.posAtCoords({ left: x, top: y });
  if (!found) return null;
  const $pos = editor.state.doc.resolve(found.pos);
  let depth = $pos.depth;
  while (depth > 1 && $pos.node(depth).type.name !== 'listItem' && $pos.node(depth).type.name !== 'taskItem') depth--;
  if (depth < 1) return null;
  const dom = editor.view.nodeDOM($pos.before(depth));
  return dom instanceof HTMLElement ? dom : null;
}

/**
 * The bounding box of a row's own first line of text — a native `Range`
 * around its first character, so it reports exactly the line box the browser
 * actually drew rather than one ProseMirror had to map a position back to.
 * A row with no text of its own on that line (an empty paragraph, a bullet
 * holding only an image) falls back to the row's own box.
 */
function firstLineRect(el: HTMLElement): DOMRect | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (!node.textContent) continue;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 1);
    const rect = range.getBoundingClientRect();
    if (rect.height) return rect;
  }
  const box = el.getBoundingClientRect();
  return box.height ? box : null;
}

/** The document range spanned by one row's own node — not its content, the node itself. */
function blockRangeOf(editor: Editor, el: HTMLElement): { from: number; to: number } | null {
  try {
    const $pos = editor.state.doc.resolve(editor.view.posAtDOM(el, 0));
    if (!$pos.depth) return null;
    return { from: $pos.before($pos.depth), to: $pos.after($pos.depth) };
  } catch {
    // Nothing there — the document moved under us.
    return null;
  }
}

/**
 * Select a whole block. Lifted out of the component because both ways in need
 * it — the grip, which knows its block from the hover state, and the long
 * press, which has only just found one under a finger.
 */
function selectBlockIn(editor: Editor, el: HTMLElement) {
  const range = blockRangeOf(editor, el);
  if (!range) return null;
  const { state, view } = editor;
  const selection = NodeSelection.create(state.doc, range.from);
  view.dispatch(state.tr.setSelection(selection));
  return { from: range.from, to: range.to, selection };
}

/**
 * Select every row between two, however different their nesting — a run of
 * top-level paragraphs, a stretch of sibling bullets, even a paragraph down
 * to a bullet below it. `blockRange` finds their lowest shared list (or the
 * doc itself) and gives back the full run of its children in between, so a
 * plain `TextSelection` across that span always lands on clean row edges.
 */
function selectRowRange(editor: Editor, fromEl: HTMLElement, toEl: HTMLElement) {
  const a = blockRangeOf(editor, fromEl);
  const b = blockRangeOf(editor, toEl);
  if (!a || !b) return null;
  const { state, view } = editor;
  const lo = Math.min(a.from, b.from);
  const hi = Math.max(a.to, b.to);
  const range = state.doc.resolve(lo).blockRange(state.doc.resolve(hi));
  const from = range ? range.start : lo;
  const to = range ? range.end : hi;
  const selection = TextSelection.create(state.doc, from, to);
  view.dispatch(state.tr.setSelection(selection));
  return { from, to, selection };
}

/** Is this row already covered by the current selection? Hovering it again then
 *  keeps dragging or acting on the whole run instead of collapsing it to one row. */
function rowInSelection(editor: Editor, el: HTMLElement): boolean {
  const range = blockRangeOf(editor, el);
  if (!range) return false;
  const { from, to } = editor.state.selection;
  return range.from >= from && range.to <= to;
}

const TURN_INTO = [
  { id: 'text', label: 'Text', icon: 'doc', run: (c: any) => c.setParagraph() },
  { id: 'h1', label: 'Heading 1', icon: 'h1', run: (c: any) => c.setNode('heading', { level: 1 }) },
  { id: 'h2', label: 'Heading 2', icon: 'h2', run: (c: any) => c.setNode('heading', { level: 2 }) },
  { id: 'h3', label: 'Heading 3', icon: 'h3', run: (c: any) => c.setNode('heading', { level: 3 }) },
  { id: 'bullet', label: 'Bullet list', icon: 'list', run: (c: any) => c.toggleBulletList() },
  { id: 'todo', label: 'To-do list', icon: 'list-todo', run: (c: any) => c.toggleTaskList() },
  { id: 'quote', label: 'Quote', icon: 'quote', run: (c: any) => c.toggleBlockquote() },
  { id: 'code', label: 'Code block', icon: 'code-block', run: (c: any) => c.toggleCodeBlock() },
];

export function BlockHandle({ editor, container }: { editor: Editor | null; container: HTMLElement | null }) {
  // The grip is a hover affordance, and a touch device has no hover to give it:
  // a webview synthesises a mouse move on tap, which would make the grip flash
  // beside whatever you just touched. It stays off there, and a long-press on
  // the block opens the same menu instead.
  const { coarse } = useLayout();
  const [hover, setHover] = useState<Hover | null>(null);
  const [menu, setMenu] = useState<{ left: number; top: number; from: number; to: number } | null>(null);
  const hoverRef = useRef<Hover | null>(null);
  hoverRef.current = hover;
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const menuOpen = menu !== null;
  // The row a plain click last landed on — where a shift-click range starts from.
  const anchorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!editor || !container || coarse) return;
    const dom = editor.view.dom as HTMLElement;

    /**
     * Where the grip goes for a block: level with the middle of its *first
     * line*, not the middle of its box. A heading's box carries margins and a
     * long paragraph is several lines tall — either would leave the grip
     * floating above or below the text it belongs to.
     *
     * This used to ask ProseMirror to map a document position back to
     * screen coordinates (`posAtDOM` + `coordsAtPos`), which sounds right but
     * isn't: at a plain block boundary that round trip can land on the
     * *previous* row's line instead of this one's, depending on bias — and
     * that showed up as the grip floating between two rows rather than on
     * either. There's a simpler source of truth sitting right there in the
     * DOM: a `Range` around the row's own first character reports exactly
     * the line box the browser actually drew, no position mapping involved.
     */
    const measure = (el: HTMLElement): number | null => {
      const outer = container.getBoundingClientRect();
      const line = firstLineRect(el);
      if (!line || !line.height) return null;
      return (line.top + line.bottom) / 2 - outer.top - GRIP / 2;
    };

    /**
     * The margin beside the text belongs to the page, not to the editor, so
     * there is no element there to listen on — the pointer is followed on the
     * document and the work is done by geometry instead.
     */
    const check = (x: number, y: number) => {
      // While the menu is open the grip stays put — otherwise moving the mouse
      // towards the menu would retarget it.
      if (menuOpen) return;
      const box = dom.getBoundingClientRect();
      // The margin counts as being on the block, so the grip is there before
      // you arrive rather than appearing only over the text itself.
      const near = x > box.left - MARGIN && x < box.right + 24 && y > box.top - 4 && y < box.bottom + 4;
      if (!near) {
        clearTimeout(leaving.current);
        leaving.current = setTimeout(() => setHover(null), 250);
        return;
      }
      clearTimeout(leaving.current);
      // Whatever the pointer's own x, the row is found at its height —
      // `rowAt` maps through ProseMirror, not the DOM, so the empty margin
      // resolves to the same row as the text itself would.
      const probeX = Math.min(Math.max(x, box.left + 1), box.right - 1);
      const found = rowAt(editor, probeX, y);
      if (!found) return;
      // Hovering anywhere inside an active multi-row selection shows one grip
      // for the whole run, pinned to its first row — not one that jumps to
      // whichever row within it the pointer happens to be over.
      let el = found;
      if (rowInSelection(editor, found)) {
        const first = editor.view.nodeDOM(editor.state.selection.from);
        if (first instanceof HTMLElement) el = first;
      }
      // Same block as last time: nothing to move, and no re-render per pixel.
      if (el === hoverRef.current?.el) return;
      // An attachment brings its own grip and its own toolbar — two grips in
      // the same margin would just be in each other's way.
      if (el.querySelector('[data-drag-handle]')) return setHover(null);
      const top = measure(el);
      if (top !== null) setHover({ top, el });
    };

    // One test per frame: several notes can be on screen at once (the daily
    // list), and each of them is watching the same pointer.
    let frame = 0;
    const onMove = (e: MouseEvent) => {
      if (frame) return;
      const { clientX, clientY } = e;
      frame = requestAnimationFrame(() => {
        frame = 0;
        check(clientX, clientY);
      });
    };

    // Typing above a block moves it; the grip has to follow rather than sit
    // where the block used to be.
    const onChange = () => {
      const at = hoverRef.current;
      if (!at) return;
      if (!dom.contains(at.el)) return setHover(null);
      const top = measure(at.el);
      if (top !== null && Math.abs(top - at.top) > 0.5) setHover({ ...at, top });
    };

    document.addEventListener('mousemove', onMove);
    editor.on('transaction', onChange);
    return () => {
      clearTimeout(leaving.current);
      cancelAnimationFrame(frame);
      document.removeEventListener('mousemove', onMove);
      editor.off('transaction', onChange);
    };
  }, [editor, container, menuOpen, coarse]);

  /**
   * The touch way in. With no hover there is nothing to reveal the grip, so the
   * block's own menu is opened by holding the block itself — the same menu, the
   * same actions, reached by the gesture a phone already uses for "tell me more
   * about this thing".
   */
  useEffect(() => {
    if (!editor || !container || !coarse) return;
    const dom = editor.view.dom as HTMLElement;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let from: { x: number; y: number } | null = null;

    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      from = null;
    };

    const down = (e: PointerEvent) => {
      // A mouse has the grip already; this is only for fingers and pens.
      if (e.pointerType === 'mouse') return;
      const at = { x: e.clientX, y: e.clientY };
      from = at;
      timer = setTimeout(() => {
        timer = null;
        const el = rowAt(editor, at.x, at.y);
        if (!el) return;
        // Holding a row already covered by a selection made elsewhere (e.g. a
        // shift-click on a paired mouse) opens the menu for the whole thing.
        let picked;
        if (rowInSelection(editor, el)) {
          const selection = editor.state.selection;
          picked = { from: selection.from, to: selection.to };
        } else {
          picked = selectBlockIn(editor, el);
          if (picked) anchorRef.current = el;
        }
        if (!picked) return;
        setMenu({ ...popPos(el, 230, 380), from: picked.from, to: picked.to });
      }, 480);
    };

    // Scrolling has to win. Any real travel means the finger is panning the
    // page, not holding a block.
    const move = (e: PointerEvent) => {
      if (!from) return;
      if (Math.abs(e.clientX - from.x) > 8 || Math.abs(e.clientY - from.y) > 8) cancel();
    };

    // Otherwise the press raises the system's own text-selection callout over
    // our menu.
    const noCallout = (e: Event) => e.preventDefault();

    dom.addEventListener('pointerdown', down);
    dom.addEventListener('pointermove', move);
    dom.addEventListener('pointerup', cancel);
    dom.addEventListener('pointercancel', cancel);
    dom.addEventListener('contextmenu', noCallout);
    return () => {
      cancel();
      dom.removeEventListener('pointerdown', down);
      dom.removeEventListener('pointermove', move);
      dom.removeEventListener('pointerup', cancel);
      dom.removeEventListener('pointercancel', cancel);
      dom.removeEventListener('contextmenu', noCallout);
    };
  }, [editor, container, coarse]);

  // The menu outlives the hover: on touch there is no hover to have opened it.
  if (!editor || (!hover && !menu)) return null;

  /**
   * What a grip interaction (drag or click) should act on: the row under the
   * pointer alone, unless it's already part of the current selection — in
   * which case every row in that selection comes along, so a run picked with
   * shift-click stays intact instead of collapsing to whichever one the
   * pointer happens to be over.
   */
  const pickTarget = () => {
    if (!hover) return null;
    if (rowInSelection(editor, hover.el)) {
      const selection = editor.state.selection;
      return { from: selection.from, to: selection.to, selection };
    }
    anchorRef.current = hover.el;
    return selectBlockIn(editor, hover.el);
  };

  const onDragStart = (e: React.DragEvent) => {
    const picked = pickTarget();
    if (!picked || !hover) return e.preventDefault();
    // Hand ProseMirror the slice it is about to move; its own drop handling
    // does the rest, including where the drop marker goes.
    editor.view.dragging = { slice: picked.selection.content(), move: true };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', hover.el.outerHTML);
    e.dataTransfer.setDragImage(hover.el, 0, 0);
  };

  const onDragEnd = () => {
    // The drag started outside the editor's DOM, so its own cleanup never runs.
    editor.view.dragging = null;
    setHover(null);
  };

  const onGripClick = (e: React.MouseEvent) => {
    if (!hover) return;
    if (e.shiftKey && anchorRef.current && anchorRef.current !== hover.el) {
      // Extending a range is a selection gesture on its own — it doesn't also
      // pop the menu, the same way shift-clicking a file list doesn't.
      selectRowRange(editor, anchorRef.current, hover.el);
      return;
    }
    const picked = pickTarget();
    if (!picked) return;
    setMenu({ ...popPos(e.currentTarget as HTMLElement, 230, 380), from: picked.from, to: picked.to });
  };

  const act = (run: (chain: any) => any) => {
    run(editor.chain().focus());
    setMenu(null);
    setHover(null);
  };

  return (
    <>
      {hover && (
        <button
          className="block-grip"
          style={{ top: hover.top }}
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onClick={onGripClick}
          title="Drag to move · click for options · shift-click to select a range"
          aria-label="Block options"
        >
          <Icon name="grip" size={15} />
        </button>
      )}

      {menu && (
        <>
          <div className="backdrop" onClick={() => setMenu(null)} />
          <div className="popover block-menu" style={{ left: menu.left, top: menu.top }}>
            <button
              className="menu-item"
              onClick={() =>
                act((c) => {
                  const slice = editor.state.doc.slice(menu.from, menu.to);
                  return c.insertContentAt(menu.to, slice.content.toJSON()).run();
                })
              }
            >
              <Icon name="copy" size={13} /> Duplicate
            </button>
            <button className="menu-item danger" onClick={() => act((c) => c.deleteSelection().run())}>
              <Icon name="trash" size={13} /> Delete
            </button>
            <div className="menu-sep" />
            <div className="picker-group">Turn into</div>
            {TURN_INTO.map((t) => (
              <button
                key={t.id}
                className="menu-item"
                onClick={() => {
                  // One row: the existing single-block path. A run of rows: the
                  // shared list (or the doc itself) found again from the stored
                  // range, then the same transform applied to each of its direct
                  // children — right to left, so resizing a later row can't move
                  // the position an earlier one is still waiting to be turned at.
                  const range = editor.state.doc.resolve(menu.from).blockRange(editor.state.doc.resolve(menu.to));
                  if (!range) return act((c) => t.run(c.setTextSelection(menu.from + 1)).run());
                  const positions: number[] = [];
                  editor.state.doc.nodesBetween(range.start, range.end, (_node, pos, parent) => {
                    if (parent === range.parent) {
                      positions.push(pos);
                      return false;
                    }
                    return true;
                  });
                  for (let i = positions.length - 1; i >= 0; i--) {
                    t.run(editor.chain().focus().setTextSelection(positions[i] + 1)).run();
                  }
                  setMenu(null);
                  setHover(null);
                }}
              >
                <Icon name={t.icon} size={13} /> {t.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
