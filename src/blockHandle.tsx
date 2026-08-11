import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { popPos } from './components/cells';
import { Icon } from './components/Icons';
import { useLayout } from './layout';

/**
 * The grip in the left margin, Notion-style: hover a block and it appears
 * beside it, drag it to move the block, click it for what else you can do.
 *
 * Only top-level blocks get one. A paragraph inside a table cell or a list item
 * is found by walking up to the direct child of the editor, so dragging always
 * moves the whole thing rather than tearing a row out of its structure.
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

/** The direct child of the editor that contains this element, if any. */
function topLevel(el: Element | null, root: HTMLElement): HTMLElement | null {
  let node: Element | null = el;
  while (node && node.parentElement !== root) node = node.parentElement;
  return (node as HTMLElement) ?? null;
}

/**
 * Select a whole block. Lifted out of the component because both ways in need
 * it — the grip, which knows its block from the hover state, and the long
 * press, which has only just found one under a finger.
 */
function selectBlockIn(editor: Editor, el: HTMLElement) {
  const { state, view } = editor;
  try {
    const inside = view.posAtDOM(el, 0);
    const $pos = state.doc.resolve(inside);
    const at = $pos.depth ? $pos.before(1) : inside;
    const selection = NodeSelection.create(state.doc, at);
    view.dispatch(state.tr.setSelection(selection));
    return { at, selection };
  } catch {
    // Nothing selectable there — the document moved under us.
    return null;
  }
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
  const [menu, setMenu] = useState<{ left: number; top: number; pos: number } | null>(null);
  const hoverRef = useRef<Hover | null>(null);
  hoverRef.current = hover;
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const menuOpen = menu !== null;

  useEffect(() => {
    if (!editor || !container || coarse) return;
    const dom = editor.view.dom as HTMLElement;

    /**
     * Where the grip goes for a block: level with the middle of its *first
     * line*, not the middle of its box. A heading's box carries margins and a
     * long paragraph is several lines tall — either would leave the grip
     * floating above or below the text it belongs to.
     */
    const measure = (el: HTMLElement): number | null => {
      const outer = container.getBoundingClientRect();
      try {
        const line = editor.view.coordsAtPos(editor.view.posAtDOM(el, 0));
        return (line.top + line.bottom) / 2 - outer.top - GRIP / 2;
      } catch {
        const box = el.getBoundingClientRect();
        return box.height ? box.top - outer.top : null;
      }
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
      // Whatever the pointer's own x, the block is found by looking into the
      // text column at the pointer's height.
      const probeX = Math.min(Math.max(x, box.left + 6), box.right - 6);
      const el = topLevel(document.elementFromPoint(probeX, y), dom);
      // Same block as last time: nothing to move, and no re-render per pixel.
      if (!el || el === hoverRef.current?.el) return;
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
        const el = topLevel(document.elementFromPoint(at.x, at.y), dom);
        if (!el) return;
        const picked = selectBlockIn(editor, el);
        if (!picked) return;
        setMenu({ ...popPos(el, 230, 380), pos: picked.at });
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

  const selectBlock = () => (hover ? selectBlockIn(editor, hover.el) : null);

  const onDragStart = (e: React.DragEvent) => {
    const picked = selectBlock();
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

  const openMenu = (e: React.MouseEvent) => {
    const picked = selectBlock();
    if (!picked) return;
    setMenu({ ...popPos(e.currentTarget as HTMLElement, 230, 380), pos: picked.at });
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
          onClick={openMenu}
          title="Drag to move · click for options"
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
                  const node = editor.state.doc.nodeAt(menu.pos);
                  return node ? c.insertContentAt(menu.pos + node.nodeSize, node.toJSON()).run() : c.run();
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
              <button key={t.id} className="menu-item" onClick={() => act((c) => t.run(c.setTextSelection(menu.pos + 1)).run())}>
                <Icon name={t.icon} size={13} /> {t.label}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
