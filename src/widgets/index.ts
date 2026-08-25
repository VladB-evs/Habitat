import type { DashWidget, ObjType } from '../types';
import { BUILTIN_WIDGETS } from './builtins';
import { CLOCK_WIDGET } from './Clock';
import { CUSTOM_WIDGET } from './Custom';
import { TIMER_WIDGET } from './Timer';
import type { WidgetDef } from './kit';
import { makeWidget } from './kit';

export const WIDGETS: WidgetDef[] = [...BUILTIN_WIDGETS, CLOCK_WIDGET, TIMER_WIDGET, CUSTOM_WIDGET];

export const widgetDef = (kind: string): WidgetDef | undefined => WIDGETS.find((w) => w.kind === kind);

/**
 * Bring a stored widget up to the current shape. `col` is the only placement
 * this era has an opinion on — a widget from before columns existed (it had a
 * grid `w`/`h`, or further back still, a `size`) gets alternated left/right by
 * its position in the stored list, which is as good a guess at "roughly what
 * this looked like" as any.
 */
export function normalize(w: DashWidget, index: number): DashWidget {
  return {
    id: w.id,
    kind: w.kind,
    col: w.col === 1 ? 1 : w.col === 0 ? 0 : index % 2,
    config: w.config || {},
  };
}

/** What a brand-new dashboard looks like — the layout Habitat shipped with, as widgets. */
export function defaultLayout(): DashWidget[] {
  return ['greeting', 'quick', 'tiles', 'pinned', 'tasks', 'birthdays', 'recent']
    .map((kind) => widgetDef(kind))
    .filter((d): d is WidgetDef => !!d)
    .map((d, i) => makeWidget(d, i % 2));
}

/** A widget is unavailable when the vault lacks what it needs (e.g. no task type). */
export function isAvailable(def: WidgetDef, types: ObjType[]): boolean {
  return !def.requires || def.requires(types);
}

export * from './kit';
