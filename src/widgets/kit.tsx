import { createContext, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { DashWidget, ObjType, Stats } from '../types';

/** Grid geometry — shared by the CSS and the resize maths. */
export const COLS = 6;
export const ROW_H = 92;
export const GAP = 16;
export const MAX_H = 14;

export interface WidgetProps {
  /** Instance id — unique per placed widget, stable across renders. */
  id: string;
  config: Record<string, any>;
}

export interface WidgetSettingsProps {
  config: Record<string, any>;
  /** Merges a patch into this widget's config and saves the layout. */
  set: (patch: Record<string, any>) => void;
}

export interface WidgetDef {
  kind: string;
  name: string;
  desc: string;
  icon: string;
  group: string;
  /** Structural widgets that only make sense once. */
  singleton?: boolean;
  /** Draw the body on a raised card surface. */
  card?: boolean;
  /** Centre the body vertically in whatever height it's been given. */
  center?: boolean;
  /** Section heading above the body; `null` for none. */
  title?: (config: Record<string, any>) => string | null;
  defaultW: number;
  defaultH: number;
  minW?: number;
  minH?: number;
  defaultConfig?: Record<string, any>;
  /** Widgets that need something in the vault (a task type, say) hide themselves when it's missing. */
  requires?: (types: ObjType[]) => boolean;
  Body: (p: WidgetProps) => ReactNode;
  Settings?: (p: WidgetSettingsProps) => ReactNode;
}

/** Shared dashboard data, so tiles/pinned/recent don't each hit `stats:get`. */
interface DashCtx {
  stats: Stats | null;
  reloadStats: () => void;
  edit: boolean;
}

export const DashDataCtx = createContext<DashCtx>({ stats: null, reloadStats: () => {}, edit: false });
export const useDash = () => useContext(DashDataCtx);

/** Per-widget frame handle, used by bodies that can turn out to have nothing to show. */
interface FrameCtx {
  setEmpty: (v: boolean) => void;
}

export const WidgetFrameCtx = createContext<FrameCtx>({ setEmpty: () => {} });

/**
 * Report that this widget has nothing to show. The frame hides it outside edit mode,
 * so an empty Pinned section doesn't leave a dangling heading — but it stays visible
 * (and removable) while editing.
 */
export function useAutoHide(empty: boolean) {
  const { setEmpty } = useContext(WidgetFrameCtx);
  useEffect(() => {
    setEmpty(empty);
    return () => setEmpty(false);
  }, [empty, setEmpty]);
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export const uid = () => Math.random().toString(36).slice(2, 10);

export function makeWidget(def: WidgetDef): DashWidget {
  return { id: uid(), kind: def.kind, w: def.defaultW, h: def.defaultH, config: { ...(def.defaultConfig || {}) } };
}
