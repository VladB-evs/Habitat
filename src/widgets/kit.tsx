import { createContext, useContext, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { DashWidget, ObjType, Stats } from '../types';

/** Height in row units (92px base) + 16px gap. */
export const ROW_H = 92;
export const GAP = 16;
export const MIN_H = 1;
export const MAX_H = 14;
export const COLS = 6;

export interface WidgetProps {
  /** Instance id — unique per placed widget, stable across renders. */
  id: string;
  config: Record<string, any>;
  /** Optional function to directly update this widget's config. */
  set?: (patch: Record<string, any>) => void;
  /** Width in columns (1 to 6). */
  w?: number;
  /** Height in row units (1 to 14). */
  h?: number;
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
  /** Default width in columns: 1 = half width (1 col), 2 = full width (2 cols). */
  defaultW?: number;
  /** Default height in row units. */
  defaultH: number;
  minW?: number;
  minH?: number;
  maxH?: number;
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

export function makeWidget(def: WidgetDef, col = 0): DashWidget {
  return {
    id: uid(),
    kind: def.kind,
    col,
    w: def.defaultW ?? 3,
    h: def.defaultH ?? 2,
    config: { ...(def.defaultConfig || {}) },
  };
}

/** A widget's pixel height, computed from its row units `h`. */
export const widgetHeight = (h: number) => Math.max(1, h) * ROW_H + (Math.max(1, h) - 1) * GAP;
