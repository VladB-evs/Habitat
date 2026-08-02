import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { GraphData } from '../types';
import { typeColor } from '../util';
import { Icon } from './Icons';
import { SplitControls } from './SplitControls';

interface SimNode {
  id: string;
  title: string;
  typeId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  deg: number;
}

/** Repulsion only reaches this far, which is what keeps the layout O(n)-ish. */
const CELL = 130;
/** Below this the simulation is done and the loop stops touching positions. */
const ALPHA_MIN = 0.01;

const ORIGIN = { x: 0, y: 0 };

/**
 * Sunflower placement: an even spread with no rings or seams, so the first
 * frame already looks like a graph instead of a firework.
 */
function seed(i: number): { x: number; y: number } {
  const a = i * 2.399963;
  const r = 14 * Math.sqrt(i);
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

export function GraphView() {
  const { types, openObject, theme } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<GraphData | null>(null);
  /** Types switched off in the legend. */
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  /** Unlinked objects are most of the noise, so they start out of the picture. */
  const [onlyLinked, setOnlyLinked] = useState(true);
  /** Each type gets its own patch of the canvas instead of everything mixing. */
  const [grouped, setGrouped] = useState(true);
  const [q, setQ] = useState('');
  /** Positions survive a filter change — toggling a type shouldn't reshuffle everything. */
  const places = useRef(new Map<string, { x: number; y: number; vx: number; vy: number }>());
  /** Set by the simulation so the controls can talk to it without restarting it. */
  const searchRef = useRef('');
  const wake = useRef<(() => void) | null>(null);
  const fit = useRef<(() => void) | null>(null);
  /** The graph frames itself once, on the first layout it settles into. */
  const framed = useRef(false);

  useEffect(() => {
    api.graph().then(setData);
  }, []);

  const degrees = useMemo(() => {
    const deg = new Map<string, number>();
    for (const e of data?.edges ?? []) {
      deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
      deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
    }
    return deg;
  }, [data]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const ctx = canvas.getContext('2d')!;
    const css = getComputedStyle(document.documentElement);
    const colEdge = css.getPropertyValue('--border-2').trim() || '#555';
    const colLabel = css.getPropertyValue('--text-2').trim() || '#999';
    const colRing = css.getPropertyValue('--accent').trim() || '#eda100';
    const colorOf = new Map(types.map((t) => [t.id, typeColor(t.color, theme)]));

    const shown = data.nodes.filter(
      (n) => !hidden.has(n.typeId) && (!onlyLinked || (degrees.get(n.id) ?? 0) > 0)
    );
    const keep = new Set(shown.map((n) => n.id));

    /**
     * One anchor per type, spread around a circle wide enough that the biggest
     * group doesn't spill into its neighbours. Nodes are pulled towards their
     * own anchor, so a type reads as a patch of the canvas while links still
     * pull related things together across the gaps.
     */
    const kinds = [...new Set(shown.map((n) => n.typeId))];
    const sizes = new Map(kinds.map((t) => [t, shown.filter((n) => n.typeId === t).length]));
    const spread =
      kinds.length < 2
        ? 0
        : Math.min(1400, Math.max(220, (Math.sqrt(Math.max(...sizes.values())) * 40) / Math.sin(Math.PI / kinds.length)));
    const anchors = new Map(
      kinds.map((t, i) => {
        const a = (i / kinds.length) * Math.PI * 2 - Math.PI / 2;
        return [t, { x: Math.cos(a) * spread, y: Math.sin(a) * spread }];
      })
    );

    const clustering = grouped && spread > 0;

    const nodes: SimNode[] = shown.map((n, i) => {
      const was = places.current.get(n.id);
      const home = clustering ? anchors.get(n.typeId)! : ORIGIN;
      // A node with no remembered position starts near its own group, so the
      // layout begins sorted instead of sorting itself out on screen.
      const start = seed(i);
      const at = was ?? { x: home.x + start.x * 0.5, y: home.y + start.y * 0.5, vx: 0, vy: 0 };
      return { ...n, ...at, deg: degrees.get(n.id) ?? 0 };
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges = data.edges
      .filter((e) => keep.has(e.from) && keep.has(e.to))
      .map((e) => ({ a: byId.get(e.from)!, b: byId.get(e.to)! }));

    /** Who is next to whom, for the focus ring when something is hovered. */
    const near = new Map<string, Set<string>>();
    for (const e of edges) {
      if (!near.has(e.a.id)) near.set(e.a.id, new Set());
      if (!near.has(e.b.id)) near.set(e.b.id, new Set());
      near.get(e.a.id)!.add(e.b.id);
      near.get(e.b.id)!.add(e.a.id);
    }

    let w = 0;
    let h = 0;
    let dpr = window.devicePixelRatio || 1;
    let k = 1;
    let ox = 0;
    let oy = 0;
    let alpha = 1;
    let raf = 0;
    let dirty = true;
    let hovered: SimNode | null = null;
    let dragNode: SimNode | null = null;
    let panning = false;
    let moved = 0;
    let lastX = 0;
    let lastY = 0;

    let centred = false;
    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      // The canvas has no size until it is laid out, so the origin is claimed
      // the first time there is a real one to centre on.
      if (!centred && w > 0 && h > 0) {
        ox = w / 2;
        oy = h / 2;
        centred = true;
      }
      dirty = true;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const radius = (n: SimNode) => 4.5 + Math.sqrt(n.deg) * 2.2;

    /** Frame the whole graph, with a margin. */
    const fitView = () => {
      if (!nodes.length) return;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const n of nodes) {
        x0 = Math.min(x0, n.x);
        y0 = Math.min(y0, n.y);
        x1 = Math.max(x1, n.x);
        y1 = Math.max(y1, n.y);
      }
      const pad = 70;
      k = Math.min(2, Math.max(0.2, Math.min(w / (x1 - x0 + pad * 2), h / (y1 - y0 + pad * 2))));
      ox = w / 2 - ((x0 + x1) / 2) * k;
      oy = h / 2 - ((y0 + y1) / 2) * k;
      dirty = true;
    };
    fit.current = fitView;

    const stir = (to = 0.5) => {
      alpha = Math.max(alpha, to);
      dirty = true;
    };
    wake.current = () => {
      dirty = true;
    };

    const toWorld = (sx: number, sy: number) => ({ x: (sx - ox) / k, y: (sy - oy) / k });

    const hit = (sx: number, sy: number): SimNode | null => {
      const p = toWorld(sx, sy);
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        const dx = n.x - p.x;
        const dy = n.y - p.y;
        const r = radius(n) + 5 / k;
        if (dx * dx + dy * dy < r * r) return n;
      }
      return null;
    };

    /**
     * Repulsion through a grid: a node is only pushed by the ones in its own
     * cell and the eight around it. Everything further away is too weak to see,
     * and skipping it is what lets the whole vault sit in one view.
     */
    const repel = () => {
      const grid = new Map<string, SimNode[]>();
      for (const n of nodes) {
        const key = `${Math.floor(n.x / CELL)},${Math.floor(n.y / CELL)}`;
        const bucket = grid.get(key);
        if (bucket) bucket.push(n);
        else grid.set(key, [n]);
      }
      for (const n of nodes) {
        const cx = Math.floor(n.x / CELL);
        const cy = Math.floor(n.y / CELL);
        for (let gx = cx - 1; gx <= cx + 1; gx++) {
          for (let gy = cy - 1; gy <= cy + 1; gy++) {
            const bucket = grid.get(`${gx},${gy}`);
            if (!bucket) continue;
            for (const m of bucket) {
              if (m === n) continue;
              let dx = n.x - m.x;
              let dy = n.y - m.y;
              let d2 = dx * dx + dy * dy;
              if (d2 > CELL * CELL) continue;
              if (d2 < 0.5) {
                dx = Math.random() - 0.5;
                dy = Math.random() - 0.5;
                d2 = 0.5;
              }
              const d = Math.sqrt(d2);
              const push = Math.min((520 + (n.deg + m.deg) * 40) / d2, 8) * alpha;
              n.vx += (dx / d) * push;
              n.vy += (dy / d) * push;
            }
          }
        }
      }
    };

    const physics = () => {
      repel();
      for (const e of edges) {
        const dx = e.b.x - e.a.x;
        const dy = e.b.y - e.a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        // Busy nodes sit further apart, which stops hubs from becoming a blob.
        const rest = 62 + Math.sqrt(Math.min(e.a.deg, e.b.deg)) * 14;
        const f = (d - rest) * 0.035 * alpha;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        e.a.vx += fx;
        e.a.vy += fy;
        e.b.vx -= fx;
        e.b.vy -= fy;
      }
      for (const n of nodes) {
        if (n === dragNode) {
          n.vx = 0;
          n.vy = 0;
          continue;
        }
        // Held by its own group when grouping is on, by the middle when it
        // isn't — and gently, since one type on its own has nothing to sort out.
        const home = clustering ? anchors.get(n.typeId)! : ORIGIN;
        const pull = clustering ? 0.02 : 0.0022;
        n.vx -= (n.x - home.x) * pull * alpha;
        n.vy -= (n.y - home.y) * pull * alpha;
        n.vx *= 0.82;
        n.vy *= 0.82;
        n.x += n.vx;
        n.y += n.vy;
      }
      alpha *= 0.982;
    };

    const draw = () => {
      const needle = searchRef.current;
      const focus = hovered;
      const ring = focus ? near.get(focus.id) ?? new Set<string>() : null;
      const lit = (n: SimNode) =>
        !focus || n === focus || ring!.has(n.id) ? 1 : 0.12;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(ox, oy);
      ctx.scale(k, k);

      // Edges first, and only the focused node's edges keep full strength.
      ctx.lineWidth = 1 / k;
      for (const e of edges) {
        const on = !focus || e.a === focus || e.b === focus;
        ctx.strokeStyle = on && focus ? colRing : colEdge;
        ctx.globalAlpha = focus ? (on ? 0.75 : 0.07) : 0.4;
        ctx.beginPath();
        ctx.moveTo(e.a.x, e.a.y);
        ctx.lineTo(e.b.x, e.b.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      for (const n of nodes) {
        const r = radius(n);
        const match = needle ? n.title.toLowerCase().includes(needle) : false;
        ctx.globalAlpha = needle && !match ? 0.1 : lit(n);
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = colorOf.get(n.typeId) ?? '#888';
        ctx.fill();
        if (n === hovered || match) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 3.5 / k, 0, Math.PI * 2);
          ctx.strokeStyle = colRing;
          ctx.lineWidth = 1.6 / k;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      /**
       * Labels are the difference between a graph and a mess: the ones worth
       * reading go first — what's hovered, what matched a search, then the
       * busiest — and anything that would land on top of one already drawn is
       * left out.
       */
      const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
      const rank = (n: SimNode) =>
        (n === hovered ? 1000 : 0) +
        (ring?.has(n.id) ? 500 : 0) +
        (needle && n.title.toLowerCase().includes(needle) ? 400 : 0) +
        n.deg;
      const worth = k >= 1.4 ? 0 : k >= 0.8 ? 2 : 4;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.font = `${11 / k}px -apple-system, system-ui, sans-serif`;
      for (const n of [...nodes].sort((a, b) => rank(b) - rank(a))) {
        const score = rank(n);
        if (score < worth && score < 400) continue;
        if (focus && score < 400) continue;
        const label = n.title.length > 24 ? n.title.slice(0, 23) + '…' : n.title;
        const half = ctx.measureText(label).width / 2;
        const y = n.y + radius(n) + 5 / k;
        const box = { x0: n.x - half, y0: y, x1: n.x + half, y1: y + 12 / k };
        if (boxes.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;
        boxes.push(box);
        ctx.globalAlpha = lit(n);
        ctx.fillStyle = n === hovered ? colRing : colLabel;
        ctx.fillText(label, n.x, y);
      }
      ctx.globalAlpha = 1;
    };

    const tick = () => {
      const settling = alpha > ALPHA_MIN || dragNode;
      if (settling) physics();
      // Frame it once, when it first comes to rest — after that the view is
      // yours, and a filter toggle won't yank it back.
      if (!settling && !framed.current && nodes.length) {
        framed.current = true;
        fitView();
      }
      // Once it has come to rest nothing is redrawn until something happens —
      // no perpetual jitter, and no fan spinning up on an idle graph.
      if (settling || dirty) {
        draw();
        dirty = false;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      moved = 0;
      lastX = sx;
      lastY = sy;
      const n = hit(sx, sy);
      if (n) {
        dragNode = n;
        stir(0.35);
      } else {
        panning = true;
        canvas.classList.add('dragging');
      }
    };

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const dx = sx - lastX;
      const dy = sy - lastY;
      if (dragNode || panning) moved += Math.abs(dx) + Math.abs(dy);
      if (dragNode) {
        dragNode.x += dx / k;
        dragNode.y += dy / k;
        stir(0.25);
      } else if (panning) {
        ox += dx;
        oy += dy;
        dirty = true;
      } else {
        const was = hovered;
        hovered = hit(sx, sy);
        if (hovered !== was) dirty = true;
        canvas.style.cursor = hovered ? 'pointer' : 'grab';
      }
      lastX = sx;
      lastY = sy;
    };

    const onUp = () => {
      if (dragNode && moved < 5) openObject(dragNode.id);
      dragNode = null;
      panning = false;
      canvas.classList.remove('dragging');
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0016);
      const nk = Math.min(3.5, Math.max(0.15, k * factor));
      ox = sx - ((sx - ox) / k) * nk;
      oy = sy - ((sy - oy) / k) * nk;
      k = nk;
      dirty = true;
    };

    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      // Hand the positions to the next run, so a filter toggle picks up where
      // this left off instead of throwing the layout in the air.
      for (const n of nodes) places.current.set(n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy });
      wake.current = null;
      fit.current = null;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [data, types, theme, openObject, degrees, hidden, onlyLinked, grouped]);

  const counts = useMemo(() => {
    const n = new Map<string, number>();
    for (const node of data?.nodes ?? []) n.set(node.typeId, (n.get(node.typeId) ?? 0) + 1);
    return n;
  }, [data]);

  const legendTypes = types.filter((t) => counts.has(t.id));
  const linked = data?.nodes.filter((n) => (degrees.get(n.id) ?? 0) > 0).length ?? 0;
  const loose = (data?.nodes.length ?? 0) - linked;

  const toggleType = (id: string) =>
    setHidden((was) => {
      const next = new Set(was);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="graph-page">
      <canvas ref={canvasRef} />

      <div className="graph-tools">
        <div className="graph-search">
          <Icon name="search" size={13} />
          <input
            placeholder="Find in graph…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              searchRef.current = e.target.value.trim().toLowerCase();
              wake.current?.();
            }}
          />
          {q && (
            <button
              className="icon-btn"
              aria-label="Clear"
              onClick={() => {
                setQ('');
                searchRef.current = '';
                wake.current?.();
              }}
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
        <button
          className={'graph-chip' + (onlyLinked ? ' on' : '')}
          onClick={() => setOnlyLinked((v) => !v)}
          title={`${loose} object${loose === 1 ? '' : 's'} with no links`}
        >
          <Icon name="link" size={12} /> Linked only
        </button>
        <button
          className={'graph-chip' + (grouped ? ' on' : '')}
          onClick={() => setGrouped((v) => !v)}
          title="Keep each type in its own area"
        >
          <Icon name="grid" size={12} /> Group by type
        </button>
        <button className="graph-chip" onClick={() => fit.current?.()} title="Frame everything">
          <Icon name="layout" size={12} /> Fit
        </button>
        <SplitControls />
      </div>

      {legendTypes.length > 0 && (
        <div className="graph-legend bottom">
          {legendTypes.map((t) => (
            <button
              key={t.id}
              className={'legend-row' + (hidden.has(t.id) ? ' off' : '')}
              onClick={() => toggleType(t.id)}
              title={hidden.has(t.id) ? 'Show these' : 'Hide these'}
            >
              <span className="legend-dot" style={{ background: typeColor(t.color, theme) }} />
              {t.name}
              <span className="legend-n">{counts.get(t.id)}</span>
            </button>
          ))}
        </div>
      )}

      {data && data.nodes.length === 0 && <div className="graph-empty">Create a few objects and links to grow your graph</div>}
      {data && data.nodes.length > 0 && linked === 0 && onlyLinked && (
        <div className="graph-empty">Nothing is linked yet — mention an object with @ to draw the first edge</div>
      )}
    </div>
  );
}
