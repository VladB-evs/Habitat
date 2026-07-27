import type { DashWidget, ObjType } from '../types';
import { BUILTIN_WIDGETS } from './builtins';
import { CLOCK_WIDGET } from './Clock';
import { CUSTOM_WIDGET } from './Custom';
import { TIMER_WIDGET } from './Timer';
import type { WidgetDef } from './kit';
import { COLS, MAX_H, clamp, makeWidget } from './kit';

export const WIDGETS: WidgetDef[] = [...BUILTIN_WIDGETS, CLOCK_WIDGET, TIMER_WIDGET, CUSTOM_WIDGET];

export const widgetDef = (kind: string): WidgetDef | undefined => WIDGETS.find((w) => w.kind === kind);

/** Widths the pre-grid layout format used. */
const LEGACY_W: Record<string, number> = { small: 2, medium: 3, large: 6 };

/** Bring a stored widget up to the current shape, and keep w/h inside the grid. */
export function normalize(w: DashWidget): DashWidget {
  const def = widgetDef(w.kind);
  const width = w.w ?? (w.size ? LEGACY_W[w.size] : undefined) ?? def?.defaultW ?? 3;
  const height = w.h ?? def?.defaultH ?? 2;
  return {
    id: w.id,
    kind: w.kind,
    w: clamp(Math.round(width), def?.minW ?? 1, COLS),
    h: clamp(Math.round(height), def?.minH ?? 1, MAX_H),
    config: w.config || {},
  };
}

/** What a brand-new dashboard looks like — the layout Habitat shipped with, as widgets. */
export function defaultLayout(): DashWidget[] {
  return ['greeting', 'quick', 'tiles', 'pinned', 'tasks', 'birthdays', 'recent']
    .map((kind) => widgetDef(kind))
    .filter((d): d is WidgetDef => !!d)
    .map((d) => makeWidget(d));
}

/** A widget is unavailable when the vault lacks what it needs (e.g. no task type). */
export function isAvailable(def: WidgetDef, types: ObjType[]): boolean {
  return !def.requires || def.requires(types);
}

export * from './kit';
