import { memo } from 'react';
import type { CanvasEdge, CanvasItem, Side } from '../../types';
import { typeColor } from '../../util';
import { anchor, arrowHead, edgeMidpoint, edgePath, rectOf, routeSides, sidesFor } from './geometry';
import type { Point } from './geometry';

export interface DraftEdge {
  from: string;
  fromSide: Side;
  /** Where the pointer is, in world units. */
  to: Point;
  /** The card under the pointer, if the connector would land on one. */
  over: string | null;
}

/**
 * Every connector on the board, in one SVG the size of the pane.
 *
 * The world transform is carried by a `<g>` inside it rather than by the SVG
 * element, so the paths are laid out in world coordinates while the SVG itself
 * stays a plain, full-size box — no overflowing a zero-sized root, which is the
 * arrangement browsers are least willing to hit-test.
 *
 * As a layer it sits above the frames and below the cards: a curve should show
 * where it crosses a frame's background but never draw over the card it points
 * at. Hit-testing gets its own invisible fat stroke, because a 1.75px curve is
 * not a thing anyone can click.
 */
export const CanvasEdgeLayer = memo(function CanvasEdgeLayer({
  edges,
  items,
  selected,
  draft,
  theme,
  view,
  onSelect,
}: {
  edges: CanvasEdge[];
  items: CanvasItem[];
  selected: string | null;
  draft: DraftEdge | null;
  theme: string;
  view: { x: number; y: number; k: number };
  onSelect: (id: string, e: React.PointerEvent) => void;
}) {
  const by = new Map(items.map((i) => [i.id, i]));

  return (
    <svg className="cv-edges">
      <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
      {edges.map((edge) => {
        const a = by.get(edge.from);
        const b = by.get(edge.to);
        if (!a || !b) return null;

        const ra = rectOf(a);
        const rb = rectOf(b);
        const [fromSide, toSide] = sidesFor(edge, ra, rb);
        const p0 = anchor(ra, fromSide);
        const p1 = anchor(rb, toSide);
        const d = edgePath(p0, fromSide, p1, toSide);
        const on = selected === edge.id;
        const color = edge.color ? typeColor(edge.color, theme) : 'var(--cv-edge)';
        const arrow = edge.data?.arrow ?? 'end';
        const mid = edge.label ? edgeMidpoint(p0, fromSide, p1, toSide) : null;

        return (
          <g key={edge.id} className={'cv-edge' + (on ? ' selected' : '')} vectorEffect="non-scaling-stroke">
            {/* Pointer, not mouse: the board reads pointerdown, and this has to
                claim the event before the surface starts a marquee with it. */}
            <path
              className="cv-edge-hit"
              d={d}
              onPointerDown={(e) => {
                e.stopPropagation();
                onSelect(edge.id, e);
              }}
            />
            <path
              className="cv-edge-line"
              d={d}
              stroke={color}
              strokeDasharray={edge.data?.dashed ? '6 5' : undefined}
            />
            {arrow !== 'none' && <path className="cv-edge-arrow" d={arrowHead(p1, toSide)} fill={color} />}
            {arrow === 'both' && <path className="cv-edge-arrow" d={arrowHead(p0, fromSide)} fill={color} />}
            {mid && (
              // foreignObject so the label is real text that wraps and picks up
              // the theme, rather than an SVG <text> that has to be measured.
              <foreignObject x={mid.x - 80} y={mid.y - 15} width={160} height={30} className="cv-edge-label-slot">
                <div className="cv-edge-label">{edge.label}</div>
              </foreignObject>
            )}
          </g>
        );
      })}

      {draft &&
        (() => {
          const a = by.get(draft.from);
          if (!a) return null;
          const ra = rectOf(a);
          const p0 = anchor(ra, draft.fromSide);
          const target = draft.over ? by.get(draft.over) : null;
          // Once it is over a card the preview snaps to that card's own anchor,
          // so the connector you release is the connector you were shown. Loose,
          // it routes to the pointer as if it were a card with no size.
          const rb = target ? rectOf(target) : { x: draft.to.x, y: draft.to.y, w: 0, h: 0 };
          const [, toSide] = routeSides(ra, rb);
          const p1 = target ? anchor(rb, toSide) : draft.to;
          return (
            <g className="cv-edge drafting">
              <path className="cv-edge-line" d={edgePath(p0, draft.fromSide, p1, toSide)} />
              <path className="cv-edge-arrow" d={arrowHead(p1, toSide)} />
            </g>
          );
        })()}
      </g>
    </svg>
  );
});
