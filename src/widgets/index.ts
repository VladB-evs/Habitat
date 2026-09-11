import type { DashWidget, ObjType } from '../types';
import { BUILTIN_WIDGETS } from './builtins';
import { CLOCK_WIDGET } from './Clock';
import { CUSTOM_WIDGET } from './Custom';
import { TIMER_WIDGET } from './Timer';
import type { WidgetDef } from './kit';
import { COLS, MAX_H, MIN_H, clamp, makeWidget } from './kit';

export const WIDGETS: WidgetDef[] = [...BUILTIN_WIDGETS, CLOCK_WIDGET, TIMER_WIDGET, CUSTOM_WIDGET];

export const widgetDef = (kind: string): WidgetDef | undefined => WIDGETS.find((w) => w.kind === kind);

/**
 * Bring a stored widget up to the current shape, preserving its custom width and height.
 */
export function normalize(w: DashWidget, index: number): DashWidget {
  const def = widgetDef(w.kind);
  const defaultW = def?.defaultW ?? 3;
  const defaultH = def?.defaultH ?? 2;
  const minW = def?.minW ?? 1;
  const minH = def?.minH ?? MIN_H;
  const maxH = def?.maxH ?? MAX_H;

  let width = w.w;
  // Upgrade from 2-column era if encountered:
  // In 2-col era: 1 was half-width (3 in 6-col), 2 was full-width (6 in 6-col for full-width widgets)
  if (width === 1 && (def?.minW ?? 1) > 1) {
    width = defaultW;
  } else if (width === 2 && defaultW >= 4) {
    width = 6;
  } else if (typeof width !== 'number' || !Number.isFinite(width)) {
    width = defaultW;
  }

  let height = typeof w.h === 'number' && Number.isFinite(w.h) ? Math.round(w.h) : defaultH;
  height = clamp(height, minH, maxH);
  width = clamp(Math.round(width), minW, COLS);

  return {
    id: w.id,
    kind: w.kind,
    col: w.col === 1 ? 1 : 0,
    w: width,
    h: height,
    config: w.config || {},
  };
}

/** What a brand-new dashboard looks like — an engaging, useful default setup. */
export function defaultLayout(): DashWidget[] {
  const kinds = ['greeting', 'quick', 'habits', 'agenda', 'tasks', 'scratchpad', 'tiles', 'pinned', 'recent', 'quote'];
  return kinds
    .map((kind) => widgetDef(kind))
    .filter((d): d is WidgetDef => !!d)
    .map((d, i) => makeWidget(d, i % 2));
}

/** A widget is unavailable when the vault lacks what it needs (e.g. no task type). */
export function isAvailable(def: WidgetDef, types: ObjType[]): boolean {
  return !def.requires || def.requires(types);
}

export * from './kit';
