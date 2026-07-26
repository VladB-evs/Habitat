import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, animate, motion, useMotionTemplate, useMotionValue } from 'motion/react';
import { api } from './api';
import { AppProvider, useApp } from './store';
import type { View } from './store';
import { Onboarding } from './components/Habitats';
import { Sidebar } from './components/Sidebar';
import { Dashboard } from './components/Dashboard';
import { DailyNotes } from './components/DailyNotes';
import { TypeTable } from './components/TypeTable';
import { ObjectPage } from './components/ObjectPage';
import { TemplatePage } from './components/TemplatePage';
const GraphView = lazy(() => import('./components/GraphView').then((m) => ({ default: m.GraphView })));
import { TagsView } from './components/TagsView';
import { SearchPalette } from './components/SearchPalette';
import { Icon } from './components/Icons';
import { pageIn, snap, softSpring, spring } from './motion';

const viewKey = (v: View) =>
  v.kind === 'type' ? `type:${v.typeId}` : v.kind === 'object' ? `object:${v.id}` : v.kind === 'template' ? `tpl:${v.id}` : v.kind;

function PaneView({ view }: { view: View }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={viewKey(view)} className="pane-page" variants={pageIn} initial="hidden" animate="shown" exit="gone">
        {view.kind === 'dashboard' && <Dashboard />}
        {view.kind === 'daily' && <DailyNotes />}
        {view.kind === 'graph' && (
          <Suspense fallback={null}>
            <GraphView />
          </Suspense>
        )}
        {view.kind === 'tags' && <TagsView />}
        {view.kind === 'type' && <TypeTable key={view.typeId} typeId={view.typeId} />}
        {view.kind === 'object' && <ObjectPage key={view.id} id={view.id} />}
        {view.kind === 'template' && <TemplatePage key={view.id} id={view.id} />}
      </motion.div>
    </AnimatePresence>
  );
}

function Shell() {
  const { panes, dir, active, setActive, split, closePane } = useApp();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(() => localStorage.getItem('habitat:sidebar') === 'hidden');
  /** A hidden sidebar peeks over the content while the pointer is on it. */
  const [peeking, setPeeking] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The side view takes a third; the main pane keeps two thirds. */
  const [ratio, setRatio] = useState(2 / 3);
  const mainRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const isSplit = panes.length > 1;

  // The main pane's size is a motion value: it springs when the side view opens
  // or closes, and follows the pointer 1:1 while the divider is being dragged.
  const mainSize = useMotionValue(isSplit ? ratio * 100 : 100);
  const mainBasis = useMotionTemplate`calc(${mainSize}% - 3px)`;

  useEffect(() => {
    if (!isSplit) setRatio(2 / 3);
  }, [isSplit]);

  useEffect(() => {
    const target = isSplit ? ratio * 100 : 100;
    if (dragging.current) return void mainSize.set(target);
    const controls = animate(mainSize, target, softSpring);
    return () => controls.stop();
  }, [isSplit, ratio, mainSize]);

  const startDivider = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const move = (ev: MouseEvent) => {
      const r = mainRef.current?.getBoundingClientRect();
      if (!r) return;
      const v = dir === 'row' ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
      setRatio(Math.min(0.85, Math.max(0.25, v)));
    };
    const up = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = dir === 'row' ? 'col-resize' : 'row-resize';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const toggleSidebar = () => {
    setPeeking(false);
    setSidebarHidden((v) => {
      localStorage.setItem('habitat:sidebar', v ? 'shown' : 'hidden');
      return !v;
    });
  };

  // The traffic lights belong to the sidebar's header, peeking included.
  useEffect(() => {
    api.window.trafficLights(!sidebarHidden || peeking);
  }, [sidebarHidden, peeking]);

  /** A short dwell before the sidebar slides out, so brushing the edge doesn't trigger it. */
  const armPeek = () => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeeking(true), 260);
  };

  const cancelPeek = () => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = null;
  };

  useEffect(() => cancelPeek, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        setSidebarHidden((v) => {
          localStorage.setItem('habitat:sidebar', v ? 'shown' : 'hidden');
          return !v;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={'app' + (sidebarHidden ? ' no-sidebar' : '')}>
      <div className="drag-strip" />
      {sidebarHidden && !peeking && <div className="edge-reveal" onMouseEnter={armPeek} onMouseLeave={cancelPeek} />}
      <AnimatePresence initial={false}>
        {(!sidebarHidden || peeking) && (
          <motion.div
            key="sidebar"
            className={'sidebar-slot' + (sidebarHidden ? ' peeking' : '')}
            onMouseLeave={() => {
              cancelPeek();
              setPeeking(false);
            }}
            initial={sidebarHidden ? { x: -248 } : { marginLeft: -240, opacity: 0 }}
            animate={sidebarHidden ? { x: 0 } : { marginLeft: 0, opacity: 1 }}
            exit={sidebarHidden ? { x: -248 } : { marginLeft: -240, opacity: 0 }}
            transition={softSpring}
          >
            <Sidebar
              pinned={!sidebarHidden}
              onSearch={() => setPaletteOpen(true)}
              onCollapse={() => {
                // While peeking the same button pins the sidebar open instead.
                if (sidebarHidden) {
                  setPeeking(false);
                  setSidebarHidden(false);
                  localStorage.setItem('habitat:sidebar', 'shown');
                } else toggleSidebar();
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div ref={mainRef} className={'main-area ' + (dir === 'row' ? 'dir-row' : 'dir-col')}>
        <AnimatePresence initial={false}>
          {panes.flatMap((p, i) => [
            ...(i === 1
              ? [
                  <motion.div
                    key="divider"
                    className="split-divider"
                    onMouseDown={startDivider}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={snap}
                  />,
                ]
              : []),
            <motion.section
              key={i}
              className={'pane' + (isSplit ? (i === active ? ' focused' : ' dimmed') : '')}
              style={i === 0 ? { flexBasis: mainBasis, flexGrow: 0, flexShrink: 0 } : undefined}
              initial={i === 0 ? false : { opacity: 0, x: dir === 'row' ? 44 : 0, y: dir === 'col' ? 44 : 0 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, x: dir === 'row' ? 44 : 0, y: dir === 'col' ? 44 : 0 }}
              transition={softSpring}
              onMouseDownCapture={() => setActive(i)}
            >
              <div className={'pane-bar' + (isSplit ? '' : ' floating')}>
                {isSplit && (
                  <>
                    <motion.span className="pane-dot" animate={{ scale: i === active ? 1 : 0.8 }} transition={spring} />
                    <span className="pane-name">{i === 0 ? 'Main' : 'Side view'}</span>
                    <AnimatePresence>
                      {i === active && (
                        <motion.span
                          className="pane-active-tag"
                          initial={{ opacity: 0, scale: 0.8 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          transition={spring}
                        >
                          active
                        </motion.span>
                      )}
                    </AnimatePresence>
                    <span className="spacer" />
                  </>
                )}
                <motion.button
                  className={'icon-btn' + (isSplit && dir === 'row' ? ' active' : '')}
                  onClick={() => split('row')}
                  aria-label={isSplit ? 'Split side by side' : 'Split right'}
                  title={isSplit ? 'Side by side' : 'Split right'}
                  whileHover={{ scale: 1.12 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <Icon name="columns" size={isSplit ? 13 : 15} />
                </motion.button>
                <motion.button
                  className={'icon-btn' + (isSplit && dir === 'col' ? ' active' : '')}
                  onClick={() => split('col')}
                  aria-label={isSplit ? 'Split stacked' : 'Split down'}
                  title={isSplit ? 'Stacked' : 'Split down'}
                  whileHover={{ scale: 1.12 }}
                  whileTap={{ scale: 0.9 }}
                >
                  <Icon name="rows" size={isSplit ? 13 : 15} />
                </motion.button>
                {isSplit && (
                  <motion.button
                    className="icon-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      closePane(i);
                    }}
                    aria-label="Close pane"
                    title="Close this pane"
                    whileHover={{ scale: 1.12, rotate: 90 }}
                    whileTap={{ scale: 0.9 }}
                  >
                    <Icon name="x" size={13} />
                  </motion.button>
                )}
              </div>
              <div className="pane-scroll">
                <PaneView view={p.stack[p.stack.length - 1]} />
              </div>
            </motion.section>,
          ])}
        </AnimatePresence>
      </div>

      {paletteOpen && <SearchPalette onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}

export default function App() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    api.settings.get().then((s) => setOnboarded(s.onboarded));
  }, []);

  if (onboarded === null) return null;
  if (!onboarded) return <Onboarding />;

  return (
    <MotionConfig reducedMotion="user">
      <AppProvider>
        <Shell />
      </AppProvider>
    </MotionConfig>
  );
}
