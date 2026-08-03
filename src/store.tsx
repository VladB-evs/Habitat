import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';
import type { ObjType } from './types';
import { clientUid } from './util';

export type View =
  | { kind: 'dashboard' }
  | { kind: 'daily' }
  | { kind: 'calendar' }
  | { kind: 'graph' }
  | { kind: 'tags' }
  | { kind: 'people' }
  | { kind: 'type'; typeId: string }
  | { kind: 'object'; id: string }
  | { kind: 'template'; id: string };

export type SplitDir = 'row' | 'col';

interface Pane {
  /**
   * Identity that survives the other pane closing. Without it a pane is only
   * known by its position, and closing the left one looks to React like the
   * right one going away — so the wrong pane plays the exit animation and the
   * survivor jumps across the window.
   */
  id: string;
  stack: View[];
}

interface AppCtx {
  types: ObjType[];
  reloadTypes: () => Promise<void>;
  panes: Pane[];
  dir: SplitDir;
  active: number;
  setActive: (i: number) => void;
  split: (dir: SplitDir) => void;
  /** Which pane is on its way out, so the shell can animate it before it goes. */
  closing: number | null;
  requestClose: (i: number) => void;
  endClose: () => void;
  view: View;
  navigate: (v: View) => void;
  back: () => void;
  canBack: boolean;
  openObject: (id: string) => void;
  /** Click handler for anything that opens an object: ⌘/⌃/⇧-click sends it to the other pane. */
  openFrom: (e: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }, id: string) => void;
  openBeside: (id: string) => void;
  theme: string;
  setTheme: (t: string) => void;
}

const Ctx = createContext<AppCtx>(null!);

export const useApp = () => useContext(Ctx);

function initialView(): View {
  const h = window.location.hash.replace(/^#/, '');
  if (h.startsWith('/daily')) return { kind: 'daily' };
  if (h.startsWith('/calendar')) return { kind: 'calendar' };
  if (h.startsWith('/graph')) return { kind: 'graph' };
  if (h.startsWith('/tags')) return { kind: 'tags' };
  if (h.startsWith('/people')) return { kind: 'people' };
  if (h.startsWith('/type/')) return { kind: 'type', typeId: h.slice(6) };
  if (h.startsWith('/object/')) return { kind: 'object', id: h.slice(8) };
  return { kind: 'dashboard' };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [types, setTypes] = useState<ObjType[]>([]);
  const [panes, setPanes] = useState<Pane[]>([{ id: clientUid(), stack: [initialView()] }]);
  const [dir, setDir] = useState<SplitDir>('row');
  const [active, setActive] = useState(0);
  const [theme, setThemeState] = useState<string>(() => localStorage.getItem('habitat:theme') || 'dark');

  const pane = panes[Math.min(active, panes.length - 1)];
  const view = pane.stack[pane.stack.length - 1];

  const navigate = useCallback(
    (v: View) =>
      setPanes((ps) => ps.map((p, i) => (i === Math.min(active, ps.length - 1) ? { ...p, stack: [...p.stack.slice(-40), v] } : p))),
    [active]
  );

  const [closing, setClosing] = useState<number | null>(null);

  const requestClose = useCallback((i: number) => setClosing((c) => (c === null ? i : c)), []);

  /** Called once the shell has finished animating the pane away. */
  const endClose = useCallback(() => {
    setPanes((ps) => (ps.length === 2 && closing !== null ? [ps[1 - closing]] : ps));
    setActive(0);
    setClosing(null);
  }, [closing]);

  const here = Math.min(active, panes.length - 1);
  /**
   * Back walks the pane's own history, and when there is none left in the side
   * view it closes it — that history is the pane you opened it from, so going
   * back means putting it away rather than sitting on a dead button.
   */
  const canBack = panes[here].stack.length > 1 || (panes.length > 1 && here === 1);

  const back = useCallback(() => {
    if (panes[here].stack.length > 1) {
      setPanes((ps) => ps.map((p, i) => (i === here && p.stack.length > 1 ? { ...p, stack: p.stack.slice(0, -1) } : p)));
    } else if (panes.length > 1 && here === 1) {
      requestClose(1);
    }
  }, [panes, here, requestClose]);

  const openObject = useCallback((id: string) => navigate({ kind: 'object', id }), [navigate]);

  /**
   * The side view is always pane 1: opening something there creates it if needed
   * and keeps it as the target, so links clicked in the side view stay in the
   * side view instead of bouncing back to the main pane.
   */
  const openBeside = useCallback((id: string) => {
    const view: View = { kind: 'object', id };
    setPanes((ps) =>
      ps.length === 1
        ? [ps[0], { id: clientUid(), stack: [view] }]
        : ps.map((p, i) => (i === 1 ? { ...p, stack: [...p.stack.slice(-40), view] } : p))
    );
    setActive(1);
  }, []);

  /**
   * Everything opens in the side view. ⌘/⌃ (or ⇧) is the escape hatch: it opens
   * the object full-width in the pane you clicked from.
   */
  const openFrom = useCallback(
    (e: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }, id: string) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) openObject(id);
      else openBeside(id);
    },
    [openBeside, openObject]
  );

  const split = useCallback(
    (d: SplitDir) => {
      setDir(d);
      setPanes((ps) => {
        if (ps.length > 1) return ps;
        const top = ps[0].stack[ps[0].stack.length - 1];
        return [ps[0], { id: clientUid(), stack: [top] }];
      });
      setActive(1);
    },
    []
  );

  const reloadTypes = useCallback(async () => {
    setTypes(await api.types.list());
  }, []);

  useEffect(() => {
    reloadTypes();
  }, [reloadTypes]);

  const setTheme = useCallback((t: string) => {
    setThemeState(t);
    localStorage.setItem('habitat:theme', t);
    document.documentElement.dataset.theme = t;
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <Ctx.Provider
      value={{
        types,
        reloadTypes,
        panes,
        dir,
        active,
        setActive,
        split,
        closing,
        requestClose,
        endClose,
        view,
        navigate,
        back,
        canBack,
        openObject,
        openFrom,
        openBeside,
        theme,
        setTheme,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
