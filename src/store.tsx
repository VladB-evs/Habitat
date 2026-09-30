import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';
import type { NavKey } from './bottomnav';
import { loadNav, saveNav } from './bottomnav';
import { useLayout } from './layout';
import type { ObjType } from './types';
import { clientUid } from './util';
import { applyHabitatAccent } from './components/Habitats';

export type View =
  | { kind: 'dashboard' }
  | { kind: 'daily' }
  | { kind: 'tasks'; tab?: 'schedule' | 'calendar' | 'board' }
  /** No id is the gallery of boards; an id is one board, open. */
  | { kind: 'canvas'; id?: string }
  | { kind: 'study' }
  | { kind: 'map'; placeId?: string }
  | { kind: 'deck'; id: string }
  | { kind: 'studyNote'; id: string }
  | { kind: 'tags' }
  | { kind: 'people' }
  | { kind: 'media' }
  | { kind: 'type'; typeId: string }
  /** `occurrence` is set when this was opened from one day of a repeating series
   *  on the calendar, so notes taken here can fork just that day instead of
   *  rewriting every occurrence. */
  | { kind: 'object'; id: string; occurrence?: string }
  | { kind: 'template'; id: string };

export type SplitDir = 'row' | 'col';
export type LinkTarget = 'current' | 'side';

export function getViewInfo(v: View | undefined, types?: ObjType[]): { title: string; icon: string } {
  if (!v) return { title: 'Home', icon: 'grid' };
  switch (v.kind) {
    case 'dashboard': return { title: 'Dashboard', icon: 'grid' };
    case 'daily': return { title: 'Daily Notes', icon: 'calendar' };
    case 'tasks': return { title: v.tab === 'calendar' ? 'Calendar' : 'Tasks', icon: v.tab === 'calendar' ? 'calendar-clock' : 'circle-check' };
    case 'people': return { title: 'People', icon: 'people' };
    case 'media': return { title: 'Media', icon: 'film' };
    case 'tags': return { title: 'Tags', icon: 'hash' };
    case 'canvas': return { title: 'Canvas', icon: 'canvas' };
    case 'study': return { title: 'Study', icon: 'study' };
    case 'map': return { title: 'Map', icon: 'map' };
    case 'deck': return { title: 'Deck', icon: 'deck' };
    case 'studyNote': return { title: 'Study Note', icon: 'doc' };
    case 'type': {
      if (v.typeId === 'event') return { title: 'Calendar', icon: 'calendar-clock' };
      const t = types?.find((x) => x.id === v.typeId);
      return { title: t?.name || 'Type', icon: t?.icon || 'table' };
    }
    case 'template': return { title: 'Template', icon: 'doc' };
    case 'object': return { title: 'Note', icon: 'doc' };
    default: return { title: 'Page', icon: 'doc' };
  }
}

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
  toggleSplitDir: () => void;
  swapPanes: () => void;
  openPageBeside: (v: View) => void;
  linkTarget: LinkTarget;
  setLinkTarget: (t: LinkTarget) => void;
  /** Which pane is on its way out, so the shell can animate it before it goes. */
  closing: number | null;
  requestClose: (i: number) => void;
  endClose: () => void;
  view: View;
  navigate: (v: View) => void;
  back: () => void;
  canBack: boolean;
  openObject: (id: string, occurrence?: string) => void;
  /** Click handler for anything that opens an object: opens in-place or beside based on linkTarget/modifiers */
  openFrom: (e: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }, id: string, occurrence?: string) => void;
  openBeside: (id: string, occurrence?: string) => void;
  /** Swaps the current object view onto another id in place, without pushing
   *  history — for when notes taken on a repeating occurrence fork it into a
   *  new object and the page needs to keep editing that one. */
  retarget: (id: string) => void;
  theme: string;
  setTheme: (t: string) => void;
  /** What appears in the bottom bar on a narrow window, in order. Persisted, and
   *  edited from Settings' Navigation tab rather than from the bar itself. */
  bottomNav: NavKey[];
  setBottomNav: (keys: NavKey[]) => void;
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  newHabitatOpen: boolean;
  openNewHabitat: () => void;
  closeNewHabitat: () => void;
}

const Ctx = createContext<AppCtx>(null!);

export const useApp = () => useContext(Ctx);

function initialView(): View {
  const h = window.location.hash.replace(/^#/, '');
  if (h.startsWith('/daily')) return { kind: 'daily' };
  if (h.startsWith('/tasks/calendar') || h.startsWith('/calendar') || h.startsWith('/events') || h === '/type/event')
    return { kind: 'tasks', tab: 'calendar' };
  if (h.startsWith('/tasks')) return { kind: 'tasks' };
  if (h.startsWith('/canvas/')) return { kind: 'canvas', id: h.slice(8) };
  if (h.startsWith('/canvas')) return { kind: 'canvas' };
  if (h.startsWith('/deck/')) return { kind: 'deck', id: h.slice(6) };
  if (h.startsWith('/note/')) return { kind: 'studyNote', id: h.slice(6) };
  if (h.startsWith('/study')) return { kind: 'study' };
  if (h.startsWith('/map')) return { kind: 'map' };
  if (h.startsWith('/tags')) return { kind: 'tags' };
  if (h.startsWith('/people')) return { kind: 'people' };
  if (h.startsWith('/media')) return { kind: 'media' };
  if (h.startsWith('/type/event')) return { kind: 'tasks', tab: 'calendar' };
  if (h.startsWith('/type/')) return { kind: 'type', typeId: h.slice(6) };
  if (h.startsWith('/object/')) return { kind: 'object', id: h.slice(8) };
  return { kind: 'dashboard' };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const { narrow } = useLayout();
  const [types, setTypes] = useState<ObjType[]>([]);
  const [panes, setPanes] = useState<Pane[]>([{ id: clientUid(), stack: [initialView()] }]);
  const [dir, setDir] = useState<SplitDir>('row');
  const [active, setActive] = useState(0);
  const [theme, setThemeState] = useState<string>(() => localStorage.getItem('habitat:theme') || 'dark');
  const [bottomNav, setBottomNavState] = useState<NavKey[]>(loadNav);

  const pane = panes[Math.min(active, panes.length - 1)];
  const view = pane.stack[pane.stack.length - 1];

  const normalizeView = (v: View): View =>
    v.kind === 'type' && v.typeId === 'event' ? { kind: 'tasks', tab: 'calendar' } : v;

  const navigate = useCallback(
    (v: View) => {
      const target = normalizeView(v);
      setPanes((ps) =>
        ps.map((p, i) => (i === Math.min(active, ps.length - 1) ? { ...p, stack: [...p.stack.slice(-40), target] } : p))
      );
    },
    [active]
  );

  const [linkTarget, setLinkTargetState] = useState<LinkTarget>(() => {
    return (localStorage.getItem('habitat:link-target') as LinkTarget) || 'current';
  });

  const setLinkTarget = useCallback((target: LinkTarget) => {
    setLinkTargetState(target);
    localStorage.setItem('habitat:link-target', target);
  }, []);

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

  const openObject = useCallback(
    (id: string, occurrence?: string) => navigate({ kind: 'object', id, occurrence }),
    [navigate]
  );

  /**
   * The side view is always pane 1: opening something there creates it if needed
   * and keeps it as the target, so links clicked in the side view stay in the
   * side view instead of bouncing back to the main pane.
   */
  const openBeside = useCallback((id: string, occurrence?: string) => {
    const view: View = { kind: 'object', id, occurrence };
    setPanes((ps) =>
      ps.length === 1
        ? [ps[0], { id: clientUid(), stack: [view] }]
        : ps.map((p, i) => (i === 1 ? { ...p, stack: [...p.stack.slice(-40), view] } : p))
    );
    setActive(1);
  }, []);

  const openPageBeside = useCallback((v: View) => {
    const target = normalizeView(v);
    setPanes((ps) =>
      ps.length === 1
        ? [ps[0], { id: clientUid(), stack: [target] }]
        : ps.map((p, i) => (i === 1 ? { ...p, stack: [...p.stack.slice(-40), target] } : p))
    );
    setActive(1);
  }, []);

  const swapPanes = useCallback(() => {
    setPanes((ps) => {
      if (ps.length !== 2) return ps;
      return [ps[1], ps[0]];
    });
    setActive((a) => (a === 0 ? 1 : 0));
  }, []);

  /**
   * By default, items open in place in the current pane.
   * If linkTarget is set to 'side', or the user holds Alt/Option (or Cmd/Ctrl),
   * the item opens beside in the secondary pane.
   */
  const openFrom = useCallback(
    (e: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }, id: string, occurrence?: string) => {
      const modifier = !!(e.altKey || e.metaKey || e.ctrlKey);
      const wantBeside = linkTarget === 'side' ? !modifier : modifier;
      if (wantBeside) openBeside(id, occurrence);
      else openObject(id, occurrence);
    },
    [linkTarget, openBeside, openObject]
  );

  const retarget = useCallback(
    (id: string) =>
      setPanes((ps) =>
        ps.map((p, i) => {
          if (i !== Math.min(active, ps.length - 1)) return p;
          const stack = p.stack.slice();
          const top = stack[stack.length - 1];
          if (top.kind !== 'object') return p;
          stack[stack.length - 1] = { kind: 'object', id };
          return { ...p, stack };
        })
      ),
    [active]
  );

  /**
   * Side by side is a desktop luxury: two columns of a 390px screen are two
   * slivers, so a narrow window only ever stacks. The pane model is otherwise
   * untouched — the side view is still pane 1, it just sits below rather than
   * beside.
   */
  const split = useCallback(
    (d: SplitDir) => {
      setDir(narrow ? 'col' : d);
      setPanes((ps) => {
        if (ps.length > 1) return ps;
        const top = ps[0].stack[ps[0].stack.length - 1];
        return [ps[0], { id: clientUid(), stack: [top] }];
      });
      setActive(1);
    },
    [narrow]
  );

  const toggleSplitDir = useCallback(() => {
    setDir((d) => (d === 'row' ? 'col' : 'row'));
  }, []);

  // Splitting side by side and *then* narrowing the window has to end up stacked
  // too, or the panes are left as two unusable columns.
  useEffect(() => {
    if (narrow) setDir((d) => (d === 'row' ? 'col' : d));
  }, [narrow]);

  const reloadTypes = useCallback(async () => {
    setTypes(await api.types.list());
  }, []);

  useEffect(() => {
    reloadTypes();
  }, [reloadTypes]);

  useEffect(() => {
    api.settings.get().then((s) => {
      const activeHab = s?.habitats?.find((h) => h.id === s?.activeId);
      if (activeHab?.aura) {
        applyHabitatAccent(activeHab.aura);
        try {
          localStorage.setItem('habitat:aura', activeHab.aura);
        } catch {}
      }
    });

    const onHabChange = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail?.aura) {
        applyHabitatAccent(detail.aura);
      }
    };
    window.addEventListener('habitat:change', onHabChange);
    return () => window.removeEventListener('habitat:change', onHabChange);
  }, []);

  const setTheme = useCallback((t: string) => {
    setThemeState(t);
    localStorage.setItem('habitat:theme', t);
    document.documentElement.dataset.theme = t;
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setBottomNav = useCallback((keys: NavKey[]) => {
    setBottomNavState(keys);
    saveNav(keys);
  }, []);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newHabitatOpen, setNewHabitatOpen] = useState(false);

  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const openNewHabitat = useCallback(() => setNewHabitatOpen(true), []);
  const closeNewHabitat = useCallback(() => setNewHabitatOpen(false), []);

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
        toggleSplitDir,
        swapPanes,
        openPageBeside,
        linkTarget,
        setLinkTarget,
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
        retarget,
        theme,
        setTheme,
        bottomNav,
        setBottomNav,
        settingsOpen,
        openSettings,
        closeSettings,
        newHabitatOpen,
        openNewHabitat,
        closeNewHabitat,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
