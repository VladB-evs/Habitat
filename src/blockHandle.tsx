import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state';
import { Fragment, type Node as ProseMirrorNode, type Slice } from '@tiptap/pm/model';
import { dropPoint, canJoin } from '@tiptap/pm/transform';
import type { EditorView } from '@tiptap/pm/view';
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
 * deep it's nested.
 */

/** Height of the grip, in CSS pixels — it centres itself on a line of text. */
const GRIP = 24;

/** How far into the left margin still counts as hovering near the block. */
const MARGIN = 64;

/** Currently active block being dragged across the document. */
let activeBlockDrag: { from: number; to: number } | null = null;

export function getActiveBlockDrag() {
  return activeBlockDrag;
}

interface Hover {
  /** Where to put the grip, relative to the editor's own box. */
  top: number;
  /** The block's element. */
  el: HTMLElement;
}

interface DropLine {
  top: number;
  left: number;
  width: number;
  pos: number;
}

/**
 * Find the most specific block HTMLElement corresponding to a DOM node inside the editor.
 * - For a taskItem: returns that taskItem's <li>
 * - For a nested taskItem: returns THAT nested taskItem's <li>
 * - For a normal listItem: returns that listItem's <li>
 * - For a paragraph with soft breaks (Shift+Enter): returns that <p>
 * - For a heading, blockquote, code block: returns that block
 */
function findBlockElement(node: Node | null, editorDom: HTMLElement): HTMLElement | null {
  let el = node instanceof HTMLElement ? node : node?.parentElement;
  if (!el || !editorDom.contains(el)) return null;

  while (el && el !== editorDom) {
    if (el.getAttribute('data-type') === 'taskItem' || el.tagName === 'LI') {
      return el;
    }
    if (el.parentElement === editorDom) {
      if (el.tagName === 'UL' || el.tagName === 'OL') {
        return null;
      }
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * The vertical center of a row's first line of text, in viewport coordinates.
 * Measuring the line box of the row's primary text container keeps the grip
 * rock-solid and level with the text line across every block type.
 */
function firstLineCenter(el: HTMLElement): number | null {
  let target: HTMLElement = el;
  if (el.getAttribute('data-type') === 'taskItem') {
    target = el.querySelector(':scope > div > p') || el.querySelector('div > p') || el.querySelector('p') || el;
  } else if (el.tagName === 'LI' || el.tagName === 'BLOCKQUOTE') {
    target = el.querySelector(':scope > p') || el.querySelector('p') || el;
  } else if (el.tagName === 'PRE') {
    target = el.querySelector('code') || el;
  }

  const box = target.getBoundingClientRect();
  if (!box.height) return null;

  const style = window.getComputedStyle(target);
  const paddingTop = parseFloat(style.paddingTop) || 0;
  const borderTop = parseFloat(style.borderTopWidth) || 0;
  const fontSize = parseFloat(style.fontSize) || 15;
  const parsedLineHeight = parseFloat(style.lineHeight);
  const lineHeight = !isNaN(parsedLineHeight) && parsedLineHeight > 0
    ? parsedLineHeight
    : fontSize * 1.65;

  const effectiveHeight = Math.min(lineHeight, box.height);
  return box.top + paddingTop + borderTop + effectiveHeight / 2;
}

/**
 * Find candidate block at vertical coordinate y.
 * Inspects all top-level blocks and list items (including nested items) in the editor DOM.
 */
function findBlockAtY(editor: Editor, y: number): HTMLElement | null {
  const dom = editor.view.dom as HTMLElement;
  if (!dom) return null;

  const blocks: HTMLElement[] = [];

  function collectBlocks(container: HTMLElement) {
    for (let i = 0; i < container.children.length; i++) {
      const child = container.children[i];
      if (!(child instanceof HTMLElement)) continue;

      const isList = child.tagName === 'UL' || child.tagName === 'OL';
      if (isList) {
        for (let j = 0; j < child.children.length; j++) {
          const item = child.children[j];
          if (item instanceof HTMLElement && (item.tagName === 'LI' || item.getAttribute('data-type') === 'taskItem')) {
            blocks.push(item);
            const nestedList = item.querySelector(':scope > div > ul, :scope > div > ol, :scope > ul, :scope > ol');
            if (nestedList instanceof HTMLElement) {
              collectBlocks(nestedList);
            }
          }
        }
      } else {
        blocks.push(child);
      }
    }
  }

  collectBlocks(dom);
  if (!blocks.length) return null;

  let bestMatch: HTMLElement | null = null;
  let minDistance = Infinity;

  for (const block of blocks) {
    const center = firstLineCenter(block);
    if (center === null) continue;

    const textTarget = block.getAttribute('data-type') === 'taskItem'
      ? (block.querySelector(':scope > div > p') || block.querySelector('p') || block)
      : block;
    const rect = textTarget.getBoundingClientRect();

    if (y >= rect.top - 4 && y <= rect.bottom + 4) {
      return block;
    }

    const dist = Math.abs(y - center);
    if (dist < minDistance) {
      minDistance = dist;
      bestMatch = block;
    }
  }

  return bestMatch;
}

/**
 * Resolves the block element at the given coordinates.
 */
function rowAt(editor: Editor, x: number, y: number): HTMLElement | null {
  const dom = editor.view.dom as HTMLElement;
  if (!dom) return null;

  const elAtPoint = document.elementFromPoint(x, y);
  const found = findBlockElement(elAtPoint, dom);
  if (found) return found;

  return findBlockAtY(editor, y);
}

/**
 * The document range spanned by one row's own node.
 * Correctly resolves single taskItems vs taskLists, and multi-line soft break blocks.
 */
function blockRangeOf(editor: Editor, el: HTMLElement): { from: number; to: number } | null {
  try {
    const { doc } = editor.state;
    const inner = el.querySelector(':scope > div > p') ||
      el.querySelector(':scope > p') ||
      el.querySelector('p, pre, code, blockquote, [contenteditable="true"]') ||
      el;

    let pos: number;
    try {
      pos = editor.view.posAtDOM(inner, 0);
    } catch {
      pos = editor.view.posAtDOM(el, 0);
    }
    const $pos = doc.resolve(pos);

    // 1. Direct match with editor.view.nodeDOM
    for (let d = $pos.depth; d >= 1; d--) {
      const nodeDom = editor.view.nodeDOM($pos.before(d));
      if (nodeDom === el) {
        return { from: $pos.before(d), to: $pos.after(d) };
      }
    }

    // 2. If el is a taskItem or listItem
    const isTask = el.getAttribute('data-type') === 'taskItem';
    const isList = el.tagName === 'LI';
    if (isTask || isList) {
      for (let d = $pos.depth; d >= 1; d--) {
        const typeName = $pos.node(d).type.name;
        if ((isTask && typeName === 'taskItem') || (isList && (typeName === 'listItem' || typeName === 'taskItem'))) {
          return { from: $pos.before(d), to: $pos.after(d) };
        }
      }
    }

    // 3. Fallback to depth 1 (top-level block)
    if ($pos.depth >= 1) {
      return { from: $pos.before(1), to: $pos.after(1) };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Select a whole block.
 */
function selectBlockIn(editor: Editor, el: HTMLElement) {
  const range = blockRangeOf(editor, el);
  if (!range) return null;
  const { state, view } = editor;
  let selection: Selection;
  try {
    selection = NodeSelection.create(state.doc, range.from);
  } catch {
    selection = TextSelection.create(state.doc, range.from, range.to);
  }
  view.dispatch(state.tr.setSelection(selection));
  return { from: range.from, to: range.to, selection };
}

/**
 * Select every row between two elements.
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

/**
 * Is this row already covered by the current selection?
 */
function rowInSelection(editor: Editor, el: HTMLElement): boolean {
  const range = blockRangeOf(editor, el);
  if (!range) return false;
  const { from, to } = editor.state.selection;
  return range.from >= from && range.to <= to;
}

/**
 * Calculates drop position at block boundary when moving blocks.
 */
function findBlockDropTarget(view: EditorView, event: DragEvent, slice: Slice): number | null {
  const coords = { left: event.clientX, top: event.clientY };
  const eventPos = view.posAtCoords(coords);
  if (!eventPos) {
    const rect = view.dom.getBoundingClientRect();
    if (event.clientY > rect.bottom) return view.state.doc.content.size;
    if (event.clientY < rect.top) return 0;
    return view.state.doc.content.size;
  }

  if (slice && slice.content.size > 0) {
    const point = dropPoint(view.state.doc, eventPos.pos, slice);
    if (point !== null) return point;
  }

  const $pos = view.state.doc.resolve(eventPos.pos);
  let depth = $pos.depth;
  while (depth > 1 && $pos.node(depth).type.name !== 'listItem' && $pos.node(depth).type.name !== 'taskItem') {
    depth--;
  }
  if (depth < 1) return eventPos.pos;

  const dom = view.nodeDOM($pos.before(depth));
  if (dom instanceof HTMLElement) {
    const box = dom.getBoundingClientRect();
    const isTopHalf = event.clientY < box.top + box.height / 2;
    return isTopHalf ? $pos.before(depth) : $pos.after(depth);
  }
  return $pos.after(depth);
}

/**
 * Executes moving a block to a new position atomically and safely.
 */
export function executeBlockMove(
  editor: Editor,
  source: { from: number; to: number },
  targetPos: number
): boolean {
  const { view } = editor;
  const { doc, schema } = view.state;

  if (source.from < 0 || source.to > doc.content.size || source.from >= source.to) {
    return false;
  }

  // Dropped inside itself: no-op
  if (targetPos >= source.from && targetPos <= source.to) {
    return true;
  }

  const $from = doc.resolve(source.from);
  const sourceSlice = doc.slice(source.from, source.to);
  if (!sourceSlice.content.size) {
    return false;
  }

  // Check if source parent is a list that will become empty
  const sourceParentDepth = $from.depth;
  const sourceParent = $from.parent;
  const isSourceParentList = ['taskList', 'bulletList', 'orderedList'].includes(sourceParent.type.name);
  const willSourceParentBeEmpty =
    isSourceParentList &&
    sourceParent.childCount === 1 &&
    source.from <= $from.start(sourceParentDepth) &&
    source.to >= $from.end(sourceParentDepth);

  const deleteFrom = willSourceParentBeEmpty ? $from.before(sourceParentDepth) : source.from;
  const deleteTo = willSourceParentBeEmpty ? $from.after(sourceParentDepth) : source.to;

  if (targetPos >= deleteFrom && targetPos <= deleteTo) {
    return true;
  }

  const $target = doc.resolve(Math.min(targetPos, doc.content.size));
  const targetParent = $target.parent;
  const targetParentName = targetParent.type.name;

  const firstChild = sourceSlice.content.firstChild;
  const isMovingTaskItem = sourceSlice.content.childCount === 1 && firstChild?.type.name === 'taskItem';
  const isMovingListItem = sourceSlice.content.childCount === 1 && firstChild?.type.name === 'listItem';
  const isMovingParagraph = sourceSlice.content.childCount === 1 && firstChild?.type.name === 'paragraph';
  const isMovingHeading = sourceSlice.content.childCount === 1 && firstChild?.type.name === 'heading';

  let contentToInsert: ProseMirrorNode | Fragment;

  if (isMovingTaskItem && firstChild) {
    if (targetParentName === 'taskList') {
      contentToInsert = firstChild;
    } else {
      contentToInsert = schema.nodes.taskList ? schema.nodes.taskList.create(null, firstChild) : firstChild;
    }
  } else if (isMovingListItem && firstChild) {
    if (targetParentName === 'bulletList' || targetParentName === 'orderedList') {
      contentToInsert = firstChild;
    } else {
      contentToInsert = schema.nodes.bulletList ? schema.nodes.bulletList.create(null, firstChild) : firstChild;
    }
  } else if (targetParentName === 'taskList' && (isMovingParagraph || isMovingHeading) && firstChild) {
    const pNode = firstChild.isTextblock && firstChild.type.name === 'paragraph'
      ? firstChild
      : (schema.nodes.paragraph ? schema.nodes.paragraph.create(null, firstChild.content) : firstChild);
    contentToInsert = schema.nodes.taskItem ? schema.nodes.taskItem.create({ checked: false }, pNode) : pNode;
  } else if (targetParentName === 'bulletList' && (isMovingParagraph || isMovingHeading) && firstChild) {
    const pNode = firstChild.isTextblock && firstChild.type.name === 'paragraph'
      ? firstChild
      : (schema.nodes.paragraph ? schema.nodes.paragraph.create(null, firstChild.content) : firstChild);
    contentToInsert = schema.nodes.listItem ? schema.nodes.listItem.create(null, pNode) : pNode;
  } else {
    contentToInsert = sourceSlice.content;
  }

  const tr = view.state.tr;

  // 1. Delete source
  tr.delete(deleteFrom, deleteTo);

  // 2. Map target position
  const insertPos = tr.mapping.map(targetPos);
  const safeInsertPos = Math.min(Math.max(0, insertPos), tr.doc.content.size);

  // 3. Insert content
  tr.insert(safeInsertPos, contentToInsert);

  // 4. Optionally merge adjacent lists
  if (isMovingTaskItem && targetParentName !== 'taskList') {
    try {
      if (safeInsertPos > 0 && canJoin(tr.doc, safeInsertPos)) {
        tr.join(safeInsertPos);
      }
    } catch {}
  }

  // 5. Update selection
  try {
    const $inserted = tr.doc.resolve(Math.min(safeInsertPos, tr.doc.content.size));
    tr.setSelection(Selection.near($inserted));
  } catch {}

  tr.setMeta('uiEvent', 'drop');
  view.dispatch(tr);
  view.focus();
  return true;
}

/**
 * Handles drop of a dragged block handle.
 * Ensures schema validity across checklists, nested lists, and paragraphs.
 */
export function handleBlockDrop(view: EditorView, event: DragEvent, slice: Slice, _move: boolean): boolean {
  const isBlockDrag = !!activeBlockDrag || event.dataTransfer?.types?.includes('application/x-habitat-block');
  if (!isBlockDrag) return false;

  let source = activeBlockDrag;
  if (!source) {
    try {
      const raw = event.dataTransfer?.getData('application/x-habitat-block');
      if (raw) source = JSON.parse(raw);
    } catch {}
  }
  if (!source) {
    const sel = view.state.selection;
    if (sel && !sel.empty) {
      source = { from: sel.from, to: sel.to };
    }
  }
  if (!source || typeof source.from !== 'number' || typeof source.to !== 'number') {
    return false;
  }

  const targetPos = findBlockDropTarget(view, event, slice);
  if (targetPos === null) return false;

  event.preventDefault();
  activeBlockDrag = null;

  // We can construct an Editor-like wrapper for executeBlockMove or use view directly
  const dummyEditor: any = { view };
  return executeBlockMove(dummyEditor, source, targetPos);
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
  const { coarse } = useLayout();
  const [hover, setHover] = useState<Hover | null>(null);
  const [menu, setMenu] = useState<{ left: number; top: number; from: number; to: number } | null>(null);
  const [dropLine, setDropLine] = useState<DropLine | null>(null);
  const dropLineRef = useRef<DropLine | null>(null);
  dropLineRef.current = dropLine;
  const computeDropTargetRef = useRef<((x: number, y: number) => DropLine | null) | null>(null);

  const hoverRef = useRef<Hover | null>(null);
  hoverRef.current = hover;
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const menuOpen = menu !== null;
  const anchorRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!editor || !container || coarse) return;
    const dom = editor.view.dom as HTMLElement;

    const measure = (el: HTMLElement): number | null => {
      const outer = container.getBoundingClientRect();
      const center = firstLineCenter(el);
      if (center === null) return null;
      return center - outer.top - GRIP / 2;
    };

    const computeDropTarget = (clientX: number, clientY: number): DropLine | null => {
      const editorDom = editor.view.dom as HTMLElement;
      if (!editorDom || !container) return null;

      const editorBox = editorDom.getBoundingClientRect();
      const outer = container.getBoundingClientRect();

      // Check if above all content
      if (clientY < editorBox.top + 6) {
        return {
          top: editorBox.top - outer.top,
          left: editorBox.left - outer.left,
          width: editorBox.width,
          pos: 0,
        };
      }

      // Check if below all content
      if (clientY > editorBox.bottom - 6) {
        return {
          top: editorBox.bottom - outer.top,
          left: editorBox.left - outer.left,
          width: editorBox.width,
          pos: editor.state.doc.content.size,
        };
      }

      let found: HTMLElement | null = null;
      if (clientX >= editorBox.left) {
        const elAtPoint = document.elementFromPoint(clientX, clientY);
        found = findBlockElement(elAtPoint, editorDom);
      }
      if (!found) {
        found = findBlockAtY(editor, clientY);
      }
      if (!found) return null;

      const range = blockRangeOf(editor, found);
      if (!range) return null;

      const isTask = found.getAttribute('data-type') === 'taskItem';
      const textTarget = isTask
        ? (found.querySelector(':scope > div > p') || found.querySelector('p') || found)
        : found;
      const targetBox = textTarget.getBoundingClientRect();
      const foundBox = found.getBoundingClientRect();

      const midY = targetBox.top + targetBox.height / 2;
      const isTop = clientY < midY;

      let lineY = isTop ? foundBox.top : foundBox.bottom;
      if (isTop && found.previousElementSibling instanceof HTMLElement) {
        const prevBox = found.previousElementSibling.getBoundingClientRect();
        lineY = (prevBox.bottom + foundBox.top) / 2;
      } else if (!isTop && found.nextElementSibling instanceof HTMLElement) {
        const nextBox = found.nextElementSibling.getBoundingClientRect();
        lineY = (foundBox.bottom + nextBox.top) / 2;
      }

      const pos = isTop ? range.from : range.to;

      const lineLeft = foundBox.left - outer.left;
      const lineWidth = (editorBox.right - outer.left) - lineLeft;

      return {
        top: lineY - outer.top,
        left: Math.max(editorBox.left - outer.left, lineLeft),
        width: Math.min(editorBox.width, lineWidth),
        pos,
      };
    };
    computeDropTargetRef.current = computeDropTarget;

    const check = (x: number, y: number) => {
      if (menuOpen || activeBlockDrag) return;
      const box = dom.getBoundingClientRect();
      const near = x > box.left - MARGIN && x < box.right + 24 && y > box.top - 12 && y < box.bottom + 24;
      if (!near) {
        clearTimeout(leaving.current);
        leaving.current = setTimeout(() => setHover(null), 250);
        return;
      }
      clearTimeout(leaving.current);

      const current = hoverRef.current;

      // 1. Hover hysteresis / lock-on:
      // Keep grip locked when moving mouse across margin towards grip or within block's vertical span
      if (current && dom.contains(current.el)) {
        const blockRect = current.el.getBoundingClientRect();
        const center = firstLineCenter(current.el);
        const gripTop = center !== null ? center - GRIP / 2 : blockRect.top;
        const gripBottom = gripTop + GRIP;

        const inMarginArea = x <= box.left + 24;
        const inVerticalReach =
          (y >= blockRect.top - 6 && y <= blockRect.bottom + 6) ||
          (y >= gripTop - 8 && y <= gripBottom + 8);

        if (inMarginArea && inVerticalReach) {
          return;
        }

        if (x > box.left && y >= blockRect.top && y <= blockRect.bottom) {
          const elAtPoint = document.elementFromPoint(x, y);
          const blockAtPoint = findBlockElement(elAtPoint, dom);
          if (blockAtPoint === current.el || !blockAtPoint) {
            return;
          }
        }
      }

      // 2. Find the block for the current pointer position:
      let found: HTMLElement | null = null;
      if (x >= box.left) {
        const elAtPoint = document.elementFromPoint(x, y);
        found = findBlockElement(elAtPoint, dom);
      }
      if (!found) {
        found = findBlockAtY(editor, y);
      }
      if (!found) return;

      let el = found;
      if (rowInSelection(editor, found)) {
        const first = editor.view.nodeDOM(editor.state.selection.from);
        if (first instanceof HTMLElement) el = first;
      }

      if (el === hoverRef.current?.el) return;
      if (el.querySelector('[data-drag-handle]')) return setHover(null);

      const top = measure(el);
      if (top !== null) setHover({ top, el });
    };

    let frame = 0;
    const onMove = (e: MouseEvent) => {
      if (frame || activeBlockDrag) return;
      const { clientX, clientY } = e;
      frame = requestAnimationFrame(() => {
        frame = 0;
        check(clientX, clientY);
      });
    };

    const onChange = () => {
      const at = hoverRef.current;
      if (!at) return;
      if (!dom.contains(at.el)) return setHover(null);
      const top = measure(at.el);
      if (top !== null && Math.abs(top - at.top) > 0.5) setHover({ ...at, top });
    };

    const onScroll = () => {
      const at = hoverRef.current;
      if (!at) return;
      if (!dom.contains(at.el)) return setHover(null);
      const top = measure(at.el);
      if (top !== null && Math.abs(top - at.top) > 0.5) setHover({ ...at, top });
    };

    const onDragOver = (e: DragEvent) => {
      if (!activeBlockDrag) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'move';
      }
      const target = computeDropTarget(e.clientX, e.clientY);
      if (target) {
        setDropLine(target);
      }
    };

    const onDrop = (e: DragEvent) => {
      if (!activeBlockDrag) return;
      e.preventDefault();
      e.stopPropagation();

      const target = dropLineRef.current || computeDropTarget(e.clientX, e.clientY);
      setDropLine(null);

      if (target) {
        executeBlockMove(editor, activeBlockDrag, target.pos);
      }
      activeBlockDrag = null;
      if (editor.view) editor.view.dragging = null;
      setHover(null);
    };

    const onDragEnd = () => {
      setDropLine(null);
      activeBlockDrag = null;
      if (editor.view) editor.view.dragging = null;
      setHover(null);
    };

    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop, { capture: true });
    window.addEventListener('dragend', onDragEnd);
    document.addEventListener('mousemove', onMove);
    editor.on('transaction', onChange);
    return () => {
      clearTimeout(leaving.current);
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop, { capture: true });
      window.removeEventListener('dragend', onDragEnd);
      document.removeEventListener('mousemove', onMove);
      editor.off('transaction', onChange);
    };
  }, [editor, container, menuOpen, coarse]);

  // Touch support: long press on the block opens options menu
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
      if (e.pointerType === 'mouse') return;
      const at = { x: e.clientX, y: e.clientY };
      from = at;
      timer = setTimeout(() => {
        timer = null;
        const el = rowAt(editor, at.x, at.y);
        if (!el) return;

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

    const move = (e: PointerEvent) => {
      if (!from) return;
      if (Math.abs(e.clientX - from.x) > 8 || Math.abs(e.clientY - from.y) > 8) cancel();
    };

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

  if (!editor || (!hover && !menu && !dropLine)) return null;

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

    activeBlockDrag = {
      from: picked.from,
      to: picked.to,
    };

    const slice = picked.selection.content();
    editor.view.dragging = { slice, move: true };
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('application/x-habitat-block', JSON.stringify(activeBlockDrag));
    } catch {}
    e.dataTransfer.setData('text/html', hover.el.outerHTML);
    e.dataTransfer.setData('text/plain', hover.el.innerText || '');
    if (e.dataTransfer.setDragImage) {
      e.dataTransfer.setDragImage(hover.el, 0, 0);
    }

    // Instantly calculate and show the drop line at the pickup location!
    const initialTarget = computeDropTargetRef.current?.(e.clientX, e.clientY);
    if (initialTarget) {
      setDropLine(initialTarget);
    }
  };

  const onDragEnd = () => {
    setDropLine(null);
    editor.view.dragging = null;
    activeBlockDrag = null;
    setHover(null);
  };

  const onGripClick = (e: React.MouseEvent) => {
    if (!hover) return;
    if (e.shiftKey && anchorRef.current && anchorRef.current !== hover.el) {
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
      {dropLine && (
        <div
          className="block-drop-line"
          style={{
            top: dropLine.top,
            left: dropLine.left,
            width: dropLine.width,
          }}
        />
      )}

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
