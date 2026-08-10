import type { CanvasEdge, CanvasItem, Side } from '../../types';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The viewport: world → screen is `p * k + offset`. */
export interface View {
  x: number;
  y: number;
  k: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

/** Cards land on an 8px lattice, so edges line up without anyone aiming. */
export const GRID = 8;

/** How near two edges must be before they snap together, in world units. */
const MAGNET = 7;

export const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

export const toWorld = (p: Point, view: View): Point => ({ x: (p.x - view.x) / view.k, y: (p.y - view.y) / view.k });

export const toScreen = (p: Point, view: View): Point => ({ x: p.x * view.k + view.x, y: p.y * view.k + view.y });

export const centerOf = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export const rectsOverlap = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const pointInRect = (p: Point, r: Rect) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/** The smallest rect containing all of them, or null when there are none. */
export function bounds(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The point on a card where a connector meets it. */
export function anchor(r: Rect, side: Side): Point {
  switch (side) {
    case 'top':
      return { x: r.x + r.w / 2, y: r.y };
    case 'bottom':
      return { x: r.x + r.w / 2, y: r.y + r.h };
    case 'left':
      return { x: r.x, y: r.y + r.h / 2 };
    default:
      return { x: r.x + r.w, y: r.y + r.h / 2 };
  }
}

/** Which way a connector leaves a side — the control points push along it. */
export function normal(side: Side): Point {
  switch (side) {
    case 'top':
      return { x: 0, y: -1 };
    case 'bottom':
      return { x: 0, y: 1 };
    case 'left':
      return { x: -1, y: 0 };
    default:
      return { x: 1, y: 0 };
  }
}

export const opposite = (side: Side): Side =>
  side === 'top' ? 'bottom' : side === 'bottom' ? 'top' : side === 'left' ? 'right' : 'left';

/**
 * Pick the pair of sides that gives the shortest, least tangled connector: the
 * dominant axis between the two centres decides, so cards side by side join
 * left-to-right and stacked ones join top-to-bottom. Recomputed as things move,
 * which is why a connector never ends up looping around a card you dragged past.
 */
export function routeSides(a: Rect, b: Rect): [Side, Side] {
  const ca = centerOf(a);
  const cb = centerOf(b);
  const dx = cb.x - ca.x;
  const dy = cb.y - ca.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const from: Side = dx >= 0 ? 'right' : 'left';
    return [from, opposite(from)];
  }
  const from: Side = dy >= 0 ? 'bottom' : 'top';
  return [from, opposite(from)];
}

/** The sides a connector actually uses: the stored pair when pinned, else routed. */
export function sidesFor(edge: CanvasEdge, a: Rect, b: Rect): [Side, Side] {
  if (edge.data?.pin) return [edge.fromSide, edge.toSide];
  return routeSides(a, b);
}

/** How far the control points reach — enough to curve, never enough to loop. */
const reach = (from: Point, to: Point) => {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.min(160, Math.max(32, d * 0.42));
};

/** The cubic through both anchors, leaving each card square to its own side. */
export function edgePath(from: Point, fromSide: Side, to: Point, toSide: Side): string {
  const r = reach(from, to);
  const n0 = normal(fromSide);
  const n1 = normal(toSide);
  const c0 = { x: from.x + n0.x * r, y: from.y + n0.y * r };
  const c1 = { x: to.x + n1.x * r, y: to.y + n1.y * r };
  return `M ${from.x} ${from.y} C ${c0.x} ${c0.y}, ${c1.x} ${c1.y}, ${to.x} ${to.y}`;
}

/**
 * The arrowhead, as a triangle rather than an SVG marker: a marker inherits one
 * fill for the whole layer, and connectors are individually coloured.
 */
export function arrowHead(tip: Point, side: Side, size = 9): string {
  // It points *into* the card, so it comes from the far side of the anchor.
  const n = normal(side);
  const base = { x: tip.x + n.x * size, y: tip.y + n.y * size };
  const perp = { x: -n.y, y: n.x };
  const half = size * 0.52;
  const a = { x: base.x + perp.x * half, y: base.y + perp.y * half };
  const b = { x: base.x - perp.x * half, y: base.y - perp.y * half };
  return `M ${tip.x} ${tip.y} L ${a.x} ${a.y} L ${b.x} ${b.y} Z`;
}

/** Where a connector's label sits: the curve's midpoint, near enough. */
export function edgeMidpoint(from: Point, fromSide: Side, to: Point, toSide: Side): Point {
  const r = reach(from, to);
  const n0 = normal(fromSide);
  const n1 = normal(toSide);
  const c0 = { x: from.x + n0.x * r, y: from.y + n0.y * r };
  const c1 = { x: to.x + n1.x * r, y: to.y + n1.y * r };
  // De Casteljau at t = 0.5, which is just the average of the eight-point stencil.
  return {
    x: (from.x + 3 * c0.x + 3 * c1.x + to.x) / 8,
    y: (from.y + 3 * c0.y + 3 * c1.y + to.y) / 8,
  };
}

export const rectOf = (i: Pick<CanvasItem, 'x' | 'y' | 'w' | 'h'>): Rect => ({ x: i.x, y: i.y, w: i.w, h: i.h });

export interface Guide {
  axis: 'x' | 'y';
  /** World coordinate of the line to draw. */
  at: number;
  /** How far the guide extends, so it reaches both the mover and its partner. */
  from: number;
  to: number;
}

/**
 * Alignment while dragging: the moving bounds are compared against every other
 * card on three lines each — near edge, centre, far edge — and the closest match
 * within the magnet wins per axis. Returns the correction to apply plus the
 * guides to draw, so the snap and the line the user sees always agree.
 */
export function alignSnap(moving: Rect, others: Rect[]): { dx: number; dy: number; guides: Guide[] } {
  const lines = (r: Rect) => ({ x: [r.x, r.x + r.w / 2, r.x + r.w], y: [r.y, r.y + r.h / 2, r.y + r.h] });
  const mine = lines(moving);
  let best: { dx: number; d: number; at: number; other: Rect } | null = null;
  let bestY: { dy: number; d: number; at: number; other: Rect } | null = null;

  for (const o of others) {
    const theirs = lines(o);
    for (const a of mine.x) {
      for (const b of theirs.x) {
        const d = Math.abs(a - b);
        if (d <= MAGNET && (!best || d < best.d)) best = { dx: b - a, d, at: b, other: o };
      }
    }
    for (const a of mine.y) {
      for (const b of theirs.y) {
        const d = Math.abs(a - b);
        if (d <= MAGNET && (!bestY || d < bestY.d)) bestY = { dy: b - a, d, at: b, other: o };
      }
    }
  }

  const guides: Guide[] = [];
  if (best) {
    const snapped = { ...moving, x: moving.x + best.dx };
    guides.push({
      axis: 'x',
      at: best.at,
      from: Math.min(snapped.y, best.other.y),
      to: Math.max(snapped.y + snapped.h, best.other.y + best.other.h),
    });
  }
  if (bestY) {
    const snapped = { ...moving, y: moving.y + bestY.dy };
    guides.push({
      axis: 'y',
      at: bestY.at,
      from: Math.min(snapped.x, bestY.other.x),
      to: Math.max(snapped.x + snapped.w, bestY.other.x + bestY.other.w),
    });
  }
  return { dx: best?.dx ?? 0, dy: bestY?.dy ?? 0, guides };
}

export const snapToGrid = (v: number) => Math.round(v / GRID) * GRID;

/**
 * The viewport that frames a set of cards with room to breathe. Zoom is capped
 * at 1 so a board with one card on it opens at normal size rather than filling
 * the pane with a single enormous tile.
 */
export function fitView(rects: Rect[], width: number, height: number, pad = 96): View {
  const b = bounds(rects);
  if (!b || width <= 0 || height <= 0) return { x: width / 2, y: height / 2, k: 1 };
  const k = clampZoom(Math.min(1, Math.min(width / (b.w + pad * 2), height / (b.h + pad * 2))));
  const c = centerOf(b);
  return { x: width / 2 - c.x * k, y: height / 2 - c.y * k, k };
}

/** Zoom about a fixed screen point, so the spot under the cursor stays put. */
export function zoomAt(view: View, screen: Point, k: number): View {
  const next = clampZoom(k);
  return {
    k: next,
    x: screen.x - ((screen.x - view.x) / view.k) * next,
    y: screen.y - ((screen.y - view.y) / view.k) * next,
  };
}

/**
 * Somewhere free near a point, for a card dropped without a position of its own.
 * Walks outward in a widening spiral rather than stacking everything at once
 * spot, which is what makes "add five objects" land as five readable cards.
 */
export function freeSpot(want: Rect, taken: Rect[]): Point {
  const step = 24;
  for (let ring = 0; ring < 40; ring++) {
    for (let i = 0; i <= ring * 2; i++) {
      const candidates =
        ring === 0
          ? [{ x: want.x, y: want.y }]
          : [
              { x: want.x + (i - ring) * step * 2, y: want.y - ring * step },
              { x: want.x + (i - ring) * step * 2, y: want.y + ring * step },
              { x: want.x - ring * step * 2, y: want.y + (i - ring) * step },
              { x: want.x + ring * step * 2, y: want.y + (i - ring) * step },
            ];
      for (const c of candidates) {
        const probe = { x: c.x, y: c.y, w: want.w, h: want.h };
        if (!taken.some((t) => rectsOverlap(probe, t))) return { x: snapToGrid(c.x), y: snapToGrid(c.y) };
      }
    }
  }
  return { x: want.x, y: want.y };
}
