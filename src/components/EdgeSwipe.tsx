import { useRef } from 'react';

/**
 * A thin strip down one edge of the screen that turns a swipe inwards into an
 * action. Both edges are used, symmetrically and in the directions a phone user
 * already expects: drag in from the right for the drawer, in from the left to go
 * back.
 *
 * This is why there is no bottom navigation bar. The two gestures cover the two
 * things you reach for constantly, and cost no permanent screen space on the
 * smallest screen the app runs on — see decision 1 in docs/mobile-plan.md.
 *
 * The strip owns its zone outright (`touch-action: none` in the stylesheet), so
 * it is kept as narrow as a gesture allows: enough to catch a thumb coming in
 * off the bezel, little enough that it isn't in the way of the page.
 */

/** How far in the gesture has to travel before it counts, in CSS pixels. */
const THRESHOLD = 40;

export function EdgeSwipe({ side, onTrigger }: { side: 'left' | 'right'; onTrigger: () => void }) {
  const from = useRef<{ x: number; y: number; id: number } | null>(null);
  const fired = useRef(false);

  const down = (e: React.PointerEvent) => {
    from.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    fired.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const move = (e: React.PointerEvent) => {
    const start = from.current;
    if (!start || fired.current || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    // Inwards from the edge the strip is on: left edge means rightwards.
    const travel = side === 'left' ? dx : -dx;
    // A mostly-vertical drag is someone scrolling with their thumb near the
    // bezel, not reaching for the drawer.
    if (travel < THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
    fired.current = true;
    onTrigger();
  };

  const end = () => {
    from.current = null;
  };

  return (
    <div
      className={'edge-swipe ' + side}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    />
  );
}
