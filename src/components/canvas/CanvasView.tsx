import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../../api';
import { withScheme } from '../../links';
import { storeFiles } from '../../media';
import { spring } from '../../motion';
import { useApp } from '../../store';
import type { CanvasItem, NewCanvasItem, Obj, Side } from '../../types';
import { typeColor } from '../../util';
import { Icon } from '../Icons';
import { SplitControls } from '../SplitControls';
import { AddFromVault } from './AddFromVault';
import { CanvasEdgeLayer } from './CanvasEdgeLayer';
import type { DraftEdge } from './CanvasEdgeLayer';
import { CARD_COLORS, CanvasItemView } from './CanvasItemView';
import {
  GRID,
  alignSnap,
  bounds,
  fitView,
  freeSpot,
  pointInRect,
  rectOf,
  rectsOverlap,
  snapToGrid,
  toWorld,
  zoomAt,
} from './geometry';
import type { Guide, Point, Rect, View } from './geometry';
import { useBoard } from './useBoard';

/** Live geometry while something is being dragged or resized. */
interface Drag {
  kind: 'move' | 'resize';
  ids: Set<string>;
  corner?: string;
  dx: number;
  dy: number;
  /** The rect being resized, in world units. */
  rect?: Rect;
  /** Whether the pointer has travelled far enough to count as a drag at all. */
  moved: boolean;
}

const DEFAULT_SIZE: Record<string, { w: number; h: number }> = {
  object: { w: 240, h: 132 },
  note: { w: 220, h: 160 },
  text: { w: 260, h: 56 },
  image: { w: 300, h: 220 },
  file: { w: 240, h: 92 },
  link: { w: 260, h: 108 },
  frame: { w: 520, h: 400 },
};

const isTypingIn = (el: EventTarget | null) => {
  const node = el as HTMLElement | null;
  return !!node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.isContentEditable);
};

export function CanvasView({ id }: { id: string }) {
  const { theme, openObject, navigate } = useApp();
  const board = useBoard(id);
  const { items, edges, itemsRef } = board;

  const paneRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;

  const [sel, setSel] = useState<Set<string>>(new Set());
  const selRef = useRef(sel);
  selRef.current = sel;
  const [selEdge, setSelEdge] = useState<string | null>(null);

  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [draftEdge, setDraftEdge] = useState<DraftEdge | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftText, setDraftText] = useState('');
  /** The height the card being typed into currently needs. Committed on blur. */
  const [editH, setEditH] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkDraft, setLinkDraft] = useState('');
  const [dropping, setDropping] = useState(false);
  const [renaming, setRenaming] = useState(false);
  /** The colour swatches, opened from the selection toolbar. */
  const [palette, setPalette] = useState(false);
  /** Held while space is down: the board pans instead of selecting. */
  const spaceRef = useRef(false);
  const framed = useRef(false);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // ---------- viewport ----------

  const size = () => {
    const r = paneRef.current?.getBoundingClientRect();
    return { w: r?.width ?? 0, h: r?.height ?? 0 };
  };

  /** The middle of what's on screen, in world units — where new cards land. */
  const centerWorld = useCallback((): Point => {
    const { w, h } = size();
    return toWorld({ x: w / 2, y: h / 2 }, viewRef.current);
  }, []);

  const fit = useCallback(() => {
    const { w, h } = size();
    setView(fitView(itemsRef.current.map(rectOf), w, h));
  }, [itemsRef]);

  // Open where the board was left; frame everything the first time instead, so a
  // board made on another window size still opens with its contents in sight.
  useEffect(() => {
    if (board.loading || framed.current) return;
    framed.current = true;
    const saved = board.meta?.view;
    if (saved && Number.isFinite(saved.k) && saved.k > 0) setView({ x: saved.x, y: saved.y, k: saved.k });
    else fit();
  }, [board.loading, board.meta, fit]);

  // Remember the viewport, but not on every frame of a pan.
  useEffect(() => {
    if (board.loading) return;
    const t = setTimeout(() => board.saveView(viewRef.current), 600);
    return () => clearTimeout(t);
  }, [view, board.loading, board.saveView]);

  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const at = { x: e.clientX - r.left, y: e.clientY - r.top };
      // Pinch on a trackpad arrives as a wheel with ctrlKey — the same gesture
      // Chromium gives a browser to zoom with.
      if (e.ctrlKey || e.metaKey) {
        setView((v) => zoomAt(v, at, v.k * Math.exp(-e.deltaY * 0.01)));
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ---------- adding ----------

  const dropAt = useCallback(
    async (list: NewCanvasItem[], select = true) => {
      const made = await board.addItems(list);
      if (select && made.length) {
        setSel(new Set(made.map((m) => m.id)));
        setSelEdge(null);
      }
      return made;
    },
    [board]
  );

  /** A card of the given kind, placed clear of whatever is already there. */
  const spawn = useCallback(
    (kind: NewCanvasItem['kind'], extra: Partial<NewCanvasItem> = {}, at?: Point) => {
      const size = DEFAULT_SIZE[kind];
      const want = at ?? centerWorld();
      const box = { x: want.x - size.w / 2, y: want.y - size.h / 2, w: size.w, h: size.h };
      const spot = at
        ? { x: snapToGrid(box.x), y: snapToGrid(box.y) }
        : freeSpot(box, itemsRef.current.filter((i) => i.kind !== 'frame').map(rectOf));
      return dropAt([{ kind, x: spot.x, y: spot.y, ...size, ...extra }]);
    },
    [centerWorld, dropAt, itemsRef]
  );

  const addObject = useCallback(
    async (obj: Obj) => {
      const made = await spawn('object', { refId: obj.id });
      return made;
    },
    [spawn]
  );

  /**
   * A card you make in order to write in it opens ready to be written in — the
   * caret is already inside, so a new note is one gesture rather than "make it,
   * then find it, then double-click it".
   *
   * `startEditing` is deliberately called after the await: the card has to exist
   * before it can be the one being edited.
   */
  const writeRef = useRef<(item: CanvasItem) => void>(() => {});
  const write = useCallback(
    async (kind: 'note' | 'text' | 'frame', at?: Point) => {
      const made = await spawn(kind, {}, at);
      if (made[0]) writeRef.current(made[0]);
    },
    [spawn]
  );

  // ---------- selection helpers ----------

  const selectedItems = useMemo(() => items.filter((i) => sel.has(i.id)), [items, sel]);

  const selectionBox = useMemo(() => bounds(selectedItems.map(rectOf)), [selectedItems]);

  const clearSelection = () => {
    setSel(new Set());
    setSelEdge(null);
    setPalette(false);
  };

  const finishEditing = useCallback(() => {
    const target = editing;
    if (!target) return;
    const item = itemsRef.current.find((i) => i.id === target);
    setEditing(null);
    setEditH(null);
    if (!item) return;
    const field = item.kind === 'frame' ? 'title' : 'text';
    const was = (item.kind === 'frame' ? item.data.title : item.data.text) ?? '';
    // The height it grew to while being typed into is part of the edit, and is
    // written with it rather than as a second undo step.
    const height = editH && Math.abs(editH - item.h) > 1 ? { h: editH } : {};
    if (was === draftText && !height.h) return;
    board.patchItem(target, { ...height, data: { [field]: draftText } });
  }, [board, draftText, editH, editing, itemsRef]);

  const startEditing = (item: CanvasItem) => {
    finishEditing();
    setEditing(item.id);
    setEditH(null);
    setDraftText((item.kind === 'frame' ? item.data.title : item.data.text) ?? '');
  };

  // `write` is defined above this point and needs it, so it goes through a ref.
  writeRef.current = startEditing;

  /**
   * A card being typed into keeps pace with its own contents. Only downward
   * pressure is resisted: once someone has dragged a note bigger than its text
   * needs, typing shouldn't shrink it back under them.
   */
  const growEditing = useCallback(
    (contentHeight: number) => {
      const item = itemsRef.current.find((i) => i.id === editing);
      if (!item) return;
      // The padding around the text, which scrollHeight doesn't include.
      const needed = Math.max(48, Math.round(contentHeight) + 26);
      // A text card is exactly as big as its words, deleting them included. A
      // sticky is a surface someone may have sized on purpose, so it only grows.
      setEditH(item.kind === 'text' ? needed : Math.max(needed, item.h));
    },
    [editing, itemsRef]
  );

  // ---------- pointer ----------

  /** Screen point → world point, for this pane. */
  const worldOf = useCallback((e: { clientX: number; clientY: number }): Point => {
    const r = paneRef.current?.getBoundingClientRect();
    return toWorld({ x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }, viewRef.current);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    const target = e.target as HTMLElement;
    const portEl = target.closest('[data-port]') as HTMLElement | null;
    const resizeEl = target.closest('[data-resize]') as HTMLElement | null;
    const itemEl = target.closest('[data-item]') as HTMLElement | null;
    const itemId = itemEl?.dataset.item ?? null;
    const start = worldOf(e);
    const startScreen = { x: e.clientX, y: e.clientY };

    // Panning wins over everything: middle button, or space held down.
    if (e.button === 1 || spaceRef.current) {
      const from = { ...viewRef.current };
      const move = (ev: PointerEvent) => {
        setView({ ...from, x: from.x + (ev.clientX - startScreen.x), y: from.y + (ev.clientY - startScreen.y) });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }

    if (editing && itemId !== editing) finishEditing();

    // --- drawing a connector ---
    if (portEl && itemId) {
      const side = (portEl.dataset.port ?? 'right') as Side;
      setDraftEdge({ from: itemId, fromSide: side, to: start, over: null });
      const move = (ev: PointerEvent) => {
        const p = worldOf(ev);
        const over = itemsRef.current
          .filter((i) => i.id !== itemId && i.kind !== 'frame')
          .sort((a, b) => b.z - a.z)
          .find((i) => pointInRect(p, rectOf(i)));
        setDraftEdge({ from: itemId, fromSide: side, to: p, over: over?.id ?? null });
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        const p = worldOf(ev);
        const over = itemsRef.current
          .filter((i) => i.id !== itemId && i.kind !== 'frame')
          .sort((a, b) => b.z - a.z)
          .find((i) => pointInRect(p, rectOf(i)));
        setDraftEdge(null);
        if (over) board.addEdge(itemId, over.id, side, 'left');
        else {
          // Released over nothing: make a sticky there and join it, which is how
          // a thought turns into a branch without breaking the gesture.
          spawn('note', {}, p).then((made) => {
            if (made[0]) board.addEdge(itemId, made[0].id, side, 'left');
          });
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }

    // --- resizing ---
    if (resizeEl && itemId) {
      const item = itemsRef.current.find((i) => i.id === itemId);
      if (!item) return;
      const corner = resizeEl.dataset.resize ?? 'se';
      const origin = rectOf(item);
      setDrag({ kind: 'resize', ids: new Set([itemId]), corner, dx: 0, dy: 0, rect: origin, moved: false });
      const move = (ev: PointerEvent) => {
        const p = worldOf(ev);
        const keep = !ev.altKey;
        let { x, y, w, h } = origin;
        if (corner.includes('e')) w = p.x - origin.x;
        if (corner.includes('s')) h = p.y - origin.y;
        if (corner.includes('w')) {
          w = origin.x + origin.w - p.x;
          x = p.x;
        }
        if (corner.includes('n')) {
          h = origin.y + origin.h - p.y;
          y = p.y;
        }
        if (keep) {
          w = snapToGrid(w);
          h = snapToGrid(h);
          x = snapToGrid(x);
          y = snapToGrid(y);
        }
        const rect = { x, y, w: Math.max(80, w), h: Math.max(48, h) };
        setDrag({ kind: 'resize', ids: new Set([itemId]), corner, dx: 0, dy: 0, rect, moved: true });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        const live = dragRef.current;
        setDrag(null);
        if (live?.rect && live.moved) {
          board.mark();
          board.commitGeometry([{ id: itemId, ...live.rect }]);
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }

    // --- moving cards ---
    if (itemId) {
      const item = itemsRef.current.find((i) => i.id === itemId);
      if (!item) return;
      if (item.data.locked) return;
      if (editing === itemId) return;

      const additive = e.shiftKey || e.metaKey || e.ctrlKey;
      let ids: Set<string>;
      if (additive) {
        ids = new Set(selRef.current);
        if (ids.has(itemId)) ids.delete(itemId);
        else ids.add(itemId);
      } else if (selRef.current.has(itemId)) {
        ids = new Set(selRef.current);
      } else {
        ids = new Set([itemId]);
      }
      setSel(ids);
      setSelEdge(null);
      if (additive || !ids.has(itemId)) return;

      /**
       * A frame carries what sits on it. Grabbing one has to pick up its
       * contents too, or the group falls apart the first time it is moved.
       */
      const moving = new Set(ids);
      for (const fid of ids) {
        const frame = itemsRef.current.find((i) => i.id === fid && i.kind === 'frame');
        if (!frame) continue;
        const box = rectOf(frame);
        for (const other of itemsRef.current) {
          if (other.id !== frame.id && other.kind !== 'frame' && rectsOverlap(rectOf(other), box)) moving.add(other.id);
        }
      }

      const locked = new Set(itemsRef.current.filter((i) => i.data.locked).map((i) => i.id));
      for (const l of locked) moving.delete(l);

      setDrag({ kind: 'move', ids: moving, dx: 0, dy: 0, moved: false });

      const move = (ev: PointerEvent) => {
        const p = worldOf(ev);
        let dx = p.x - start.x;
        let dy = p.y - start.y;
        const moved = Math.abs(ev.clientX - startScreen.x) + Math.abs(ev.clientY - startScreen.y) > 3;

        if (!ev.altKey) {
          // Grid first, then alignment against everything standing still — so a
          // card settles onto a neighbour's edge rather than near it.
          dx = snapToGrid(dx);
          dy = snapToGrid(dy);
          const box = bounds(itemsRef.current.filter((i) => moving.has(i.id)).map(rectOf));
          if (box) {
            const others = itemsRef.current.filter((i) => !moving.has(i.id)).map(rectOf);
            const snap = alignSnap({ ...box, x: box.x + dx, y: box.y + dy }, others);
            dx += snap.dx;
            dy += snap.dy;
            setGuides(snap.guides);
          }
        } else {
          setGuides([]);
        }
        setDrag({ kind: 'move', ids: moving, dx, dy, moved });
      };

      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        const live = dragRef.current;
        setDrag(null);
        setGuides([]);
        if (!live || !live.moved || (!live.dx && !live.dy)) return;
        board.mark();
        board.commitGeometry(
          itemsRef.current
            .filter((i) => live.ids.has(i.id))
            .map((i) => ({ id: i.id, x: i.x + live.dx, y: i.y + live.dy, w: i.w, h: i.h }))
        );
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      return;
    }

    // --- marquee over empty board ---
    if (!e.shiftKey) clearSelection();
    const base = new Set(e.shiftKey ? selRef.current : []);
    const move = (ev: PointerEvent) => {
      const p = worldOf(ev);
      const box = {
        x: Math.min(start.x, p.x),
        y: Math.min(start.y, p.y),
        w: Math.abs(p.x - start.x),
        h: Math.abs(p.y - start.y),
      };
      setMarquee(box);
      const hit = itemsRef.current.filter((i) => rectsOverlap(rectOf(i), box)).map((i) => i.id);
      setSel(new Set([...base, ...hit]));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setMarquee(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const itemEl = target.closest('[data-item]') as HTMLElement | null;
    if (!itemEl) {
      write('note', worldOf(e));
      return;
    }
    const item = itemById.get(itemEl.dataset.item ?? '');
    if (!item) return;
    if (item.kind === 'object' && item.object) openObject(item.object.id);
    else if (item.kind === 'link' && item.data.url) window.open(item.data.url, '_blank');
    else if (item.kind === 'note' || item.kind === 'text' || item.kind === 'frame') startEditing(item);
  };

  // ---------- keyboard ----------

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTypingIn(e.target)) spaceRef.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceRef.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  /**
   * The shortcut handler is rebuilt every render — it closes over the selection,
   * the board and the view — but it is registered once, through this ref. A drag
   * sets state on every pointer move, and re-binding a window listener that
   * often is work for nothing.
   */
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});

  useEffect(() => {
    const fire = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', fire);
    return () => window.removeEventListener('keydown', fire);
  }, []);

  keyRef.current = (e: KeyboardEvent) => {
    {
      if (isTypingIn(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) board.redo();
        else board.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSel(new Set(itemsRef.current.map((i) => i.id)));
        return;
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicate();
        return;
      }
      if (e.key === 'Escape') {
        finishEditing();
        clearSelection();
        setPicking(false);
        setLinking(false);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        if (selEdge) board.removeEdge(selEdge);
        else if (selRef.current.size) board.removeItems([...selRef.current]);
        clearSelection();
        return;
      }
      if (e.key.startsWith('Arrow') && selRef.current.size) {
        e.preventDefault();
        const step = e.shiftKey ? GRID * 5 : GRID;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        board.mark();
        board.commitGeometry(
          itemsRef.current
            .filter((i) => selRef.current.has(i.id))
            .map((i) => ({ id: i.id, x: i.x + dx, y: i.y + dy, w: i.w, h: i.h }))
        );
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        setView((v) => ({ ...v, k: 1 }));
        return;
      }
      if (mod && e.key === '1') {
        e.preventDefault();
        fit();
        return;
      }
      // Single-key tools, the way every board app does it.
      if (!mod && e.key.toLowerCase() === 'n') write('note');
      if (!mod && e.key.toLowerCase() === 't') write('text');
      if (!mod && e.key.toLowerCase() === 'f') write('frame');
      if (!mod && e.key.toLowerCase() === 'o') setPicking(true);
    }
  };

  // ---------- clipboard-ish ----------

  const duplicate = useCallback(async () => {
    const chosen = itemsRef.current.filter((i) => selRef.current.has(i.id));
    if (!chosen.length) return;
    const made = await board.addItems(
      chosen.map((i) => ({ kind: i.kind, refId: i.refId, x: i.x + 24, y: i.y + 24, w: i.w, h: i.h, data: i.data }))
    );
    setSel(new Set(made.map((m) => m.id)));
  }, [board, itemsRef]);

  // ---------- drops from outside ----------

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const at = worldOf(e);
    const dt = e.dataTransfer;

    if (dt.files?.length) {
      const refs = await storeFiles(dt.files);
      let x = at.x;
      await dropAt(
        refs.map((ref) => {
          const isImg = /^image\//.test(ref.mime);
          const size = isImg ? DEFAULT_SIZE.image : DEFAULT_SIZE.file;
          // Landscape or portrait, an image keeps its own shape on the board.
          const h = isImg && ref.width && ref.height ? Math.round((size.w * ref.height) / ref.width) : size.h;
          const item: NewCanvasItem = {
            kind: isImg ? 'image' : 'file',
            refId: ref.hash,
            x: snapToGrid(x),
            y: snapToGrid(at.y),
            w: size.w,
            h,
          };
          x += size.w + 20;
          return item;
        })
      );
      return;
    }

    const uri = dt.getData('text/uri-list') || '';
    const text = dt.getData('text/plain') || '';
    const url = uri || (/^https?:\/\//i.test(text.trim()) ? text.trim() : '');
    if (url) {
      await spawn('link', { data: { url, title: '' } }, at);
      return;
    }
    if (text.trim()) await spawn('note', { data: { text: text.trim() } }, at);
  };

  // ---------- render ----------

  /** Where a card actually sits right now — drag, resize and typing included. */
  const liveRect = (i: CanvasItem): Rect => {
    if (drag?.kind === 'move' && drag.ids.has(i.id)) return { x: i.x + drag.dx, y: i.y + drag.dy, w: i.w, h: i.h };
    if (drag?.kind === 'resize' && drag.ids.has(i.id) && drag.rect) return drag.rect;
    if (editH && i.id === editing) return { x: i.x, y: i.y, w: i.w, h: editH };
    return rectOf(i);
  };

  const live = useMemo(
    () => items.map((i) => ({ ...i, ...liveRect(i) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, drag, editH, editing]
  );

  const setColor = (color: string | null) => {
    board.mark();
    for (const itemId of sel) board.patchItem(itemId, { data: { color } }, false);
  };

  const toggleLock = () => {
    const anyOpen = selectedItems.some((i) => !i.data.locked);
    board.mark();
    for (const i of selectedItems) board.patchItem(i.id, { data: { locked: anyOpen } }, false);
  };

  const edge = selEdge ? edges.find((e) => e.id === selEdge) ?? null : null;

  if (board.loading) return <div className="cv-page" />;
  if (!board.meta) {
    return (
      <div className="cv-page">
        <div className="cv-empty">This board no longer exists.</div>
      </div>
    );
  }

  return (
    <div
      className={'cv-page' + (dropping ? ' dropping' : '')}
      onDragOver={(e) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false);
      }}
      onDrop={onDrop}
    >
      <div className="cv-header">
        <button className="icon-btn" onClick={() => navigate({ kind: 'canvas' })} title="All boards">
          <Icon name="arrow-left" size={15} />
        </button>
        {renaming ? (
          <input
            className="cv-name-input"
            defaultValue={board.meta.name}
            autoFocus
            onBlur={(e) => {
              board.rename({ name: e.target.value.trim() || 'Untitled board' });
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <button className="cv-name" onClick={() => setRenaming(true)} title="Rename">
            {board.meta.name}
          </button>
        )}
        <span className="cv-count">{items.length} items</span>
        <span className="spacer" />
        <SplitControls />
      </div>

      <div ref={paneRef} className="cv-surface" onPointerDown={onPointerDown} onDoubleClick={onDoubleClick}>
        {/* The dotted grid lives on the surface, scaled with the view, so zoom
            reads as moving closer rather than as the cards changing size. */}
        <div
          className="cv-grid"
          style={{
            backgroundSize: `${GRID * 4 * view.k}px ${GRID * 4 * view.k}px`,
            backgroundPosition: `${view.x}px ${view.y}px`,
            opacity: view.k < 0.35 ? 0 : 1,
          }}
        />

        {/*
          Three layers, bottom to top: frames, connectors, cards. Separate layers
          rather than one stack, because a connector has to cross a frame's
          background and pass behind the cards it joins — an ordering that z-index
          alone can't hold once anything is raised.

          Each world layer is a zero-sized transformed box: it positions its cards
          without covering the surface, so a click on empty board still reaches the
          surface underneath.
        */}
        <div
          className={'cv-world' + (drag ? ' dragging' : '')}
          style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.k})` }}
        >
          {live
            .filter((i) => i.kind === 'frame')
            .map((i) => (
              <CanvasItemView
                key={i.id}
                item={i}
                selected={sel.has(i.id)}
                editing={editing === i.id}
                theme={theme}
                draft={draftText}
                onDraft={setDraftText}
                onDoneEditing={finishEditing}
                onGrow={i.kind === 'note' || i.kind === 'text' ? growEditing : undefined}
              />
            ))}
        </div>

        <CanvasEdgeLayer
          edges={edges}
          items={live}
          selected={selEdge}
          draft={draftEdge}
          theme={theme}
          view={view}
          onSelect={(edgeId) => {
            setSelEdge(edgeId);
            setSel(new Set());
          }}
        />

        <div
          className={'cv-world' + (drag ? ' dragging' : '')}
          style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.k})` }}
        >
          {live
            .filter((i) => i.kind !== 'frame')
            .map((i) => (
              <CanvasItemView
                key={i.id}
                item={i}
                selected={sel.has(i.id)}
                editing={editing === i.id}
                theme={theme}
                draft={draftText}
                onDraft={setDraftText}
                onDoneEditing={finishEditing}
                onGrow={i.kind === 'note' || i.kind === 'text' ? growEditing : undefined}
              />
            ))}

          {guides.map((g, n) => (
            <div
              key={n}
              className={'cv-guide ' + g.axis}
              style={
                g.axis === 'x'
                  ? { left: g.at, top: g.from, height: g.to - g.from }
                  : { top: g.at, left: g.from, width: g.to - g.from }
              }
            />
          ))}

          {marquee && (
            <div
              className="cv-marquee"
              style={{ transform: `translate3d(${marquee.x}px, ${marquee.y}px, 0)`, width: marquee.w, height: marquee.h }}
            />
          )}
        </div>

        {/* --- floating selection toolbar --- */}
        <AnimatePresence>
          {selectionBox && !drag && (
            <motion.div
              className="cv-sel-anchor"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={spring}
              style={{
                left: selectionBox.x * view.k + view.x + (selectionBox.w * view.k) / 2,
                // Always above the card, never over it — and never pushed off the
                // top of the pane either, where it would be unreachable.
                top: Math.max(10, selectionBox.y * view.k + view.y - 14),
              }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <motion.div
                className="cv-sel-bar"
                initial={{ y: 6, scale: 0.96 }}
                animate={{ y: 0, scale: 1 }}
                exit={{ y: 4, scale: 0.97 }}
                transition={spring}
              >
              {/* Colours live behind one button. Ten swatches in the bar itself
                  made it wide enough to cover whatever was next to the card. */}
              <div className="cv-palette-wrap">
                <button
                  className={'icon-btn' + (palette ? ' active' : '')}
                  title="Colour"
                  onClick={() => setPalette((v) => !v)}
                >
                  <Icon name="palette" size={14} />
                </button>
                <AnimatePresence>
                  {palette && (
                    <motion.div
                      className="cv-swatches"
                      initial={{ opacity: 0, y: 4, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 2, scale: 0.97 }}
                      transition={spring}
                    >
                      {CARD_COLORS.map((c) => (
                        <button
                          key={c ?? 'plain'}
                          className={'cv-swatch' + (c === null ? ' plain' : '')}
                          style={c ? { background: typeColor(c, theme) } : undefined}
                          onClick={() => {
                            setColor(c);
                            setPalette(false);
                          }}
                          title={c ? 'Tint' : 'No tint'}
                        />
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <span className="cv-sep" />
              {selectedItems.length === 1 && selectedItems[0].kind === 'object' && selectedItems[0].object && (
                <button className="icon-btn" title="Open" onClick={() => openObject(selectedItems[0].object!.id)}>
                  <Icon name="arrow-up-right" size={14} />
                </button>
              )}
              <button className="icon-btn" title="Bring to front" onClick={() => board.raise([...sel])}>
                <Icon name="bring-forward" size={14} />
              </button>
              <button className="icon-btn" title="Duplicate" onClick={duplicate}>
                <Icon name="copy" size={14} />
              </button>
              <button className="icon-btn" title="Lock" onClick={toggleLock}>
                <Icon name={selectedItems.some((i) => !i.data.locked) ? 'unlock' : 'lock'} size={14} />
              </button>
              <button
                className="icon-btn danger"
                title="Delete"
                onClick={() => {
                  board.removeItems([...sel]);
                  clearSelection();
                }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* --- connector toolbar --- */}
        <AnimatePresence>
          {edge &&
            (() => {
              const a = itemById.get(edge.from);
              const b = itemById.get(edge.to);
              if (!a || !b) return null;
              const cx = ((a.x + a.w / 2 + b.x + b.w / 2) / 2) * view.k + view.x;
              const cy = ((a.y + a.h / 2 + b.y + b.h / 2) / 2) * view.k + view.y;
              return (
                <motion.div
                  className="cv-sel-anchor"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={spring}
                  style={{ left: cx, top: cy }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <motion.div
                    className="cv-sel-bar"
                    initial={{ scale: 0.96 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0.97 }}
                    transition={spring}
                  >
                  <input
                    className="cv-edge-input"
                    placeholder="Label…"
                    defaultValue={edge.label}
                    onBlur={(e) => board.patchEdge(edge.id, { label: e.target.value })}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                  />
                  <span className="cv-sep" />
                  <button
                    className={'icon-btn' + (edge.data?.arrow === 'none' ? '' : ' active')}
                    title="Arrow"
                    onClick={() =>
                      board.patchEdge(edge.id, {
                        data: { arrow: edge.data?.arrow === 'none' ? 'end' : edge.data?.arrow === 'end' ? 'both' : 'none' },
                      })
                    }
                  >
                    <Icon name="arrow-up-right" size={14} />
                  </button>
                  <button
                    className={'icon-btn' + (edge.data?.dashed ? ' active' : '')}
                    title="Dashed"
                    onClick={() => board.patchEdge(edge.id, { data: { dashed: !edge.data?.dashed } })}
                  >
                    <Icon name="minus" size={14} />
                  </button>
                  <button
                    className={'icon-btn' + (edge.data?.pin ? ' active' : '')}
                    title={edge.data?.pin ? 'Re-route as cards move' : 'Hold these sides'}
                    onClick={() =>
                      board.patchEdge(edge.id, {
                        // Freeze it where it is now, not where it was first drawn.
                        fromSide: edge.fromSide,
                        toSide: edge.toSide,
                        data: { pin: !edge.data?.pin },
                      })
                    }
                  >
                    <Icon name={edge.data?.pin ? 'lock' : 'waypoints'} size={14} />
                  </button>
                  <button
                    className="icon-btn danger"
                    title="Delete connector"
                    onClick={() => {
                      board.removeEdge(edge.id);
                      setSelEdge(null);
                    }}
                  >
                      <Icon name="trash" size={14} />
                    </button>
                  </motion.div>
                </motion.div>
              );
            })()}
        </AnimatePresence>
      </div>

      {/* --- bottom dock --- */}
      <div className="cv-dock">
        <div className="cv-dock-group">
          <button className="cv-tool" onClick={() => setPicking(true)} title="Add from your vault (O)">
            <Icon name="search" size={15} />
            <span>Vault</span>
          </button>
          <button className="cv-tool" onClick={() => write('note')} title="Sticky note (N)">
            <Icon name="sticky-note" size={15} />
          </button>
          <button className="cv-tool" onClick={() => write('text')} title="Text (T)">
            <Icon name="type" size={15} />
          </button>
          <button className="cv-tool" onClick={() => write('frame')} title="Frame (F)">
            <Icon name="canvas" size={15} />
          </button>
          <button
            className="cv-tool"
            title="Image or file"
            onClick={async () => {
              const refs = await api.files.pick();
              if (!refs.length) return;
              const at = centerWorld();
              let x = at.x - 150;
              await dropAt(
                refs.map((ref) => {
                  const isImg = /^image\//.test(ref.mime);
                  const size = isImg ? DEFAULT_SIZE.image : DEFAULT_SIZE.file;
                  const h = isImg && ref.width && ref.height ? Math.round((size.w * ref.height) / ref.width) : size.h;
                  const item: NewCanvasItem = {
                    kind: isImg ? 'image' : 'file',
                    refId: ref.hash,
                    x: snapToGrid(x),
                    y: snapToGrid(at.y),
                    w: size.w,
                    h,
                  };
                  x += size.w + 20;
                  return item;
                })
              );
            }}
          >
            <Icon name="image" size={15} />
          </button>
          <button className={'cv-tool' + (linking ? ' on' : '')} title="Link" onClick={() => setLinking((v) => !v)}>
            <Icon name="link" size={15} />
          </button>
        </div>

        <div className="cv-dock-group">
          <button className="cv-tool" onClick={board.undo} disabled={!board.canUndo} title="Undo (⌘Z)">
            <Icon name="undo" size={15} />
          </button>
          <button className="cv-tool" onClick={board.redo} disabled={!board.canRedo} title="Redo (⇧⌘Z)">
            <Icon name="redo" size={15} />
          </button>
        </div>

        <div className="cv-dock-group">
          <button className="cv-tool" onClick={() => setView((v) => zoomAt(v, { x: size().w / 2, y: size().h / 2 }, v.k / 1.25))}>
            <Icon name="zoom-out" size={15} />
          </button>
          <button className="cv-tool wide" onClick={() => setView((v) => ({ ...v, k: 1 }))} title="Reset zoom (⌘0)">
            {Math.round(view.k * 100)}%
          </button>
          <button className="cv-tool" onClick={() => setView((v) => zoomAt(v, { x: size().w / 2, y: size().h / 2 }, v.k * 1.25))}>
            <Icon name="zoom-in" size={15} />
          </button>
          <button className="cv-tool" onClick={fit} title="Fit to contents (⌘1)">
            <Icon name="maximize" size={15} />
          </button>
        </div>
      </div>

      {/* A real input rather than window.prompt, which Electron does not implement
          — asking that way opened nothing at all, so no link could be pasted. */}
      <AnimatePresence>
        {linking && (
          <div key="linkbar" className="cv-linkbar-layer">
            <motion.div
              className="cv-linkbar"
              initial={{ opacity: 0, y: 8, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={spring}
            >
            <Icon name="link" size={14} />
            <input
              autoFocus
              placeholder="Paste a link and press Enter"
              value={linkDraft}
              onChange={(e) => setLinkDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setLinking(false);
                  setLinkDraft('');
                }
                if (e.key !== 'Enter') return;
                const url = linkDraft.trim();
                if (!url) return;
                spawn('link', { data: { url: withScheme(url) } });
                setLinkDraft('');
                setLinking(false);
              }}
            />
            <button
              className="cv-tool"
              disabled={!linkDraft.trim()}
              onClick={() => {
                spawn('link', { data: { url: withScheme(linkDraft.trim()) } });
                setLinkDraft('');
                setLinking(false);
              }}
            >
              Add
            </button>
            <button
              className="cv-tool"
              onClick={() => {
                setLinking(false);
                setLinkDraft('');
              }}
              >
                <Icon name="x" size={14} />
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {picking && (
          <AddFromVault
            key="picker"
            onPick={(obj) => {
              addObject(obj);
              setPicking(false);
            }}
            onClose={() => setPicking(false)}
          />
        )}
      </AnimatePresence>

      {!items.length && (
        <div className="cv-empty">
          <p>Drop anything here.</p>
          <span>
            Double-click for a note · <kbd>O</kbd> to pull something in from your vault · drag files straight from Finder
          </span>
        </div>
      )}
    </div>
  );
}
