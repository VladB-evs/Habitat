import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';
import type { ObjType } from './types';

export type View =
  | { kind: 'dashboard' }
  | { kind: 'daily' }
  | { kind: 'graph' }
  | { kind: 'tags' }
  | { kind: 'type'; typeId: string }
  | { kind: 'object'; id: string }
  | { kind: 'template'; id: string };

export type SplitDir = 'row' | 'col';

interface Pane {
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
  closePane: (i: number) => void;
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
  if (h.startsWith('/graph')) return { kind: 'graph' };
  if (h.startsWith('/tags')) return { kind: 'tags' };
  if (h.startsWith('/type/')) return { kind: 'type', typeId: h.slice(6) };
  if (h.startsWith('/object/')) return { kind: 'object', id: h.slice(8) };
  return { kind: 'dashboard' };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [types, setTypes] = useState<ObjType[]>([]);
  const [panes, setPanes] = useState<Pane[]>([{ stack: [initialView()] }]);
  const [dir, setDir] = useState<SplitDir>('row');
  const [active, setActive] = useState(0);
  const [theme, setThemeState] = useState<string>(() => localStorage.getItem('habitat:theme') || 'dark');

  const pane = panes[Math.min(active, panes.length - 1)];
  const view = pane.stack[pane.stack.length - 1];

  const navigate = useCallback(
    (v: View) =>
      setPanes((ps) => ps.map((p, i) => (i === Math.min(active, ps.length - 1) ? { stack: [...p.stack.slice(-40), v] } : p))),
    [active]
  );

  const back = useCallback(
    () =>
      setPanes((ps) =>
        ps.map((p, i) => (i === Math.min(active, ps.length - 1) && p.stack.length > 1 ? { stack: p.stack.slice(0, -1) } : p))
      ),
    [active]
  );

  const openObject = useCallback((id: string) => navigate({ kind: 'object', id }), [navigate]);

  /**
   * The side view is always pane 1: opening something there creates it if needed
   * and keeps it as the target, so links clicked in the side view stay in the
   * side view instead of bouncing back to the main pane.
   */
  const openBeside = useCallback((id: string) => {
    const view: View = { kind: 'object', id };
    setPanes((ps) => (ps.length === 1 ? [ps[0], { stack: [view] }] : ps.map((p, i) => (i === 1 ? { stack: [...p.stack.slice(-40), view] } : p))));
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
        return [ps[0], { stack: [top] }];
      });
      setActive(1);
    },
    []
  );

  const closePane = useCallback((i: number) => {
    setPanes((ps) => (ps.length === 2 ? [ps[1 - i]] : ps));
    setActive(0);
  }, []);

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
        closePane,
        view,
        navigate,
        back,
        canBack: pane.stack.length > 1,
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
