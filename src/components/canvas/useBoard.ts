import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import type { CanvasEdge, CanvasItem, CanvasItemData, CanvasMeta, NewCanvasItem, Side } from '../../types';

/** How many steps back the board remembers. */
const HISTORY = 60;

interface Snapshot {
  items: CanvasItem[];
  edges: CanvasEdge[];
}

/**
 * A board's contents, its history, and the writes that keep the two in step.
 *
 * Every edit lands in React state first and is sent on afterwards: dragging forty
 * cards must not wait on sqlite between frames. Undo is the exception — it puts
 * the whole board back in one call, because ids have to survive a delete for the
 * connectors around it to mean anything.
 */
export function useBoard(id: string) {
  const [meta, setMeta] = useState<CanvasMeta | null>(null);
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [loading, setLoading] = useState(true);

  /**
   * The interaction code runs off animation frames and pointer events, where a
   * state variable is always one render behind. These mirrors are what it reads.
   */
  const itemsRef = useRef<CanvasItem[]>([]);
  const edgesRef = useRef<CanvasEdge[]>([]);
  itemsRef.current = items;
  edgesRef.current = edges;

  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const [depth, setDepth] = useState({ undo: 0, redo: 0 });

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.canvas.get(id).then((doc) => {
      if (!alive || !doc) return setLoading(false);
      setMeta(doc.canvas);
      setItems(doc.items);
      setEdges(doc.edges);
      past.current = [];
      future.current = [];
      setDepth({ undo: 0, redo: 0 });
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  const sync = () => setDepth({ undo: past.current.length, redo: future.current.length });

  /** Freeze the board as it is now, before whatever is about to change it. */
  const mark = useCallback(() => {
    past.current.push({ items: itemsRef.current, edges: edgesRef.current });
    if (past.current.length > HISTORY) past.current.shift();
    future.current = [];
    sync();
  }, []);

  const apply = useCallback(
    (snap: Snapshot) => {
      setItems(snap.items);
      setEdges(snap.edges);
      itemsRef.current = snap.items;
      edgesRef.current = snap.edges;
      api.canvas.replace(id, snap.items, snap.edges);
    },
    [id]
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push({ items: itemsRef.current, edges: edgesRef.current });
    apply(prev);
    sync();
  }, [apply]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push({ items: itemsRef.current, edges: edgesRef.current });
    apply(next);
    sync();
  }, [apply]);

  /** Drop cards on the board. Returns them with the ids the vault gave them. */
  const addItems = useCallback(
    async (list: NewCanvasItem[]): Promise<CanvasItem[]> => {
      if (!list.length) return [];
      mark();
      const made = await api.canvas.addItems(id, list);
      setItems((was) => [...was, ...made]);
      return made;
    },
    [id, mark]
  );

  /**
   * Commit a finished drag or resize. The cards have already moved on screen —
   * this is only the write, batched into one call however many moved.
   */
  const commitGeometry = useCallback(
    (moved: { id: string; x: number; y: number; w: number; h: number }[]) => {
      if (!moved.length) return;
      const by = new Map(moved.map((m) => [m.id, m]));
      setItems((was) => was.map((i) => (by.has(i.id) ? { ...i, ...by.get(i.id)! } : i)));
      api.canvas.moveItems(id, moved);
    },
    [id]
  );

  const patchItem = useCallback(
    (itemId: string, patch: Partial<Pick<CanvasItem, 'x' | 'y' | 'w' | 'h'>> & { data?: CanvasItemData }, remember = true) => {
      if (remember) mark();
      setItems((was) =>
        was.map((i) =>
          i.id === itemId ? { ...i, ...patch, data: patch.data ? { ...i.data, ...patch.data } : i.data } : i
        )
      );
      api.canvas.patchItem(itemId, patch);
    },
    [mark]
  );

  const removeItems = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      mark();
      const gone = new Set(ids);
      setItems((was) => was.filter((i) => !gone.has(i.id)));
      setEdges((was) => was.filter((e) => !gone.has(e.from) && !gone.has(e.to)));
      api.canvas.removeItems(id, ids);
    },
    [id, mark]
  );

  /**
   * Send a selection to the front, in the order given. Frames go to the back of
   * the frame layer rather than the front of everything — the same rule the main
   * process applies, kept in step here so the board doesn't flicker before the
   * write lands.
   */
  const raise = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      const zs = itemsRef.current.map((i) => i.z);
      let top = Math.max(0, ...zs);
      let back = Math.min(0, ...zs);
      const rank = new Map<string, number>();
      for (const x of ids) {
        const item = itemsRef.current.find((i) => i.id === x);
        if (!item) continue;
        rank.set(x, item.kind === 'frame' ? --back : ++top);
      }
      setItems((was) => was.map((i) => (rank.has(i.id) ? { ...i, z: rank.get(i.id)! } : i)));
      api.canvas.order(id, ids);
    },
    [id]
  );

  const addEdge = useCallback(
    async (from: string, to: string, fromSide: Side, toSide: Side) => {
      if (from === to) return null;
      // Same pair, already joined: the backend hands back the existing connector,
      // so nothing is marked and nothing changes.
      const already = edgesRef.current.some((e) => e.from === from && e.to === to);
      if (already) return null;
      mark();
      const edge = await api.canvas.addEdge({ canvasId: id, from, to, fromSide, toSide });
      if (edge) setEdges((was) => (was.some((e) => e.id === edge.id) ? was : [...was, edge]));
      return edge;
    },
    [id, mark]
  );

  const patchEdge = useCallback(
    (edgeId: string, patch: Partial<Omit<CanvasEdge, 'id' | 'from' | 'to'>>) => {
      mark();
      setEdges((was) =>
        was.map((e) => (e.id === edgeId ? { ...e, ...patch, data: patch.data ? { ...e.data, ...patch.data } : e.data } : e))
      );
      api.canvas.patchEdge(edgeId, patch);
    },
    [mark]
  );

  const removeEdge = useCallback(
    (edgeId: string) => {
      mark();
      setEdges((was) => was.filter((e) => e.id !== edgeId));
      api.canvas.removeEdge(edgeId);
    },
    [mark]
  );

  const rename = useCallback(
    (patch: Partial<Pick<CanvasMeta, 'name' | 'icon' | 'color'>>) => {
      setMeta((m) => (m ? { ...m, ...patch } : m));
      api.canvas.patch(id, patch);
    },
    [id]
  );

  /** Remember where the board was left, without moving it up the gallery. */
  const saveView = useCallback((view: { x: number; y: number; k: number }) => api.canvas.patch(id, { view }), [id]);

  return {
    meta,
    items,
    edges,
    itemsRef,
    edgesRef,
    loading,
    mark,
    undo,
    redo,
    canUndo: depth.undo > 0,
    canRedo: depth.redo > 0,
    addItems,
    commitGeometry,
    patchItem,
    removeItems,
    raise,
    addEdge,
    patchEdge,
    removeEdge,
    rename,
    saveView,
  };
}
