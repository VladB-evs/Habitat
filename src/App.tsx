import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  AnimatePresence,
  MotionConfig,
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
  useSpring,
  useTransform,
} from 'motion/react';
import { api } from './api';
import { AppProvider, useApp, getViewInfo } from './store';
import { getObject } from './objects';
import { openLink } from './links';
import type { View } from './store';
import { Onboarding, NewHabitatModal } from './components/Habitats';
const SettingsModal = lazy(() => import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal })));
import { Sidebar } from './components/Sidebar';
import { SidebarDrawer } from './components/SidebarDrawer';
import { BottomNav } from './components/BottomNav';
import { EdgeSwipe } from './components/EdgeSwipe';
import { PaneSlot } from './components/PageActions';
import { ConfirmHost } from './confirm';
import { useLayout } from './layout';
import { Dashboard } from './components/Dashboard';
import { DailyNotes } from './components/DailyNotes';
import { TasksPage } from './components/TasksPage';
import { TypeTable } from './components/TypeTable';
import { ObjectPage } from './components/ObjectPage';
import { TemplatePage } from './components/TemplatePage';
const CanvasHome = lazy(() => import('./components/canvas/CanvasHome').then((m) => ({ default: m.CanvasHome })));
const CanvasView = lazy(() => import('./components/canvas/CanvasView').then((m) => ({ default: m.CanvasView })));
const StudyView = lazy(() => import('./components/study/StudyView').then((m) => ({ default: m.StudyView })));
const DeckPage = lazy(() => import('./components/study/DeckPage').then((m) => ({ default: m.DeckPage })));
const StudyNotePage = lazy(() => import('./components/study/StudyNotePage').then((m) => ({ default: m.StudyNotePage })));
import { TagsView } from './components/TagsView';
import { People } from './components/People';
import { Media } from './components/Media';
import { SearchPalette } from './components/SearchPalette';
import { AskPanel } from './components/AskPanel';
import { Icon, TypeIcon } from './components/Icons';
import { pageIn, snap, softSpring, spring } from './motion';
import { MEDIA_TYPE, PEOPLE_TYPE, viewport } from './util';

const viewKey = (v: View) =>
  v.kind === 'type'
    ? `type:${v.typeId}`
    : v.kind === 'object'
      ? `object:${v.id}`
      : v.kind === 'template'
        ? `tpl:${v.id}`
        : v.kind === 'canvas'
          ? `canvas:${v.id ?? 'all'}`
          : v.kind === 'deck'
            ? `deck:${v.id}`
            : v.kind === 'studyNote'
              ? `note:${v.id}`
              : v.kind;

function PaneView({ view }: { view: View }) {
  const { narrow } = useLayout();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={viewKey(view)} className="pane-page" variants={pageIn} initial="hidden" animate="shown" exit="gone">
        {view.kind === 'dashboard' && <Dashboard />}
        {view.kind === 'daily' && <DailyNotes />}
        {view.kind === 'tasks' && <TasksPage />}
        {/* Boards are a pointer-and-space interaction — panning a graph, dragging
            connections between cards — and they do not survive the trip down to
            390px. The entry is hidden there, but a link or a restored URL can
            still land here, so it says so rather than showing a broken board. */}
        {view.kind === 'canvas' &&
          (narrow ? (
            <div className="page-note">
              <h2>Canvas is desktop-only</h2>
              <p>Boards need room to pan and a pointer to draw connections. Open this one on your computer.</p>
            </div>
          ) : (
            <Suspense fallback={null}>
              {view.id ? <CanvasView key={view.id} id={view.id} /> : <CanvasHome />}
            </Suspense>
          ))}
        {view.kind === 'study' && (
          <Suspense fallback={null}>
            <StudyView />
          </Suspense>
        )}
        {view.kind === 'deck' && (
          <Suspense fallback={null}>
            <DeckPage key={view.id} id={view.id} />
          </Suspense>
        )}
        {view.kind === 'studyNote' && (
          <Suspense fallback={null}>
            <StudyNotePage key={view.id} id={view.id} />
          </Suspense>
        )}
        {view.kind === 'tags' && <TagsView />}
        {view.kind === 'people' && <People />}
        {view.kind === 'media' && <Media />}
        {/* People and Media have their own views rather than the generic table. */}
        {view.kind === 'type' &&
          (view.typeId === PEOPLE_TYPE ? (
            <People />
          ) : view.typeId === MEDIA_TYPE ? (
            <Media />
          ) : (
            <TypeTable key={view.typeId} typeId={view.typeId} />
          ))}
        {view.kind === 'object' && <ObjectPage key={view.id} id={view.id} occurrence={view.occurrence} />}
        {view.kind === 'template' && <TemplatePage key={view.id} id={view.id} />}
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * A pane's scrolling content, plus the slot its page may put an action bar in.
 *
 * The slot is a sibling of the scroller rather than inside it, so the bar stays
 * put while the page scrolls, and — because the pane is a flex column — an
 * occupied slot takes its own height instead of covering the last row of
 * content. Empty, it collapses to nothing.
 *
 * The callback ref is what makes the portal work: it lands the element in state,
 * which re-renders and gives PageActions somewhere real to render into.
 */
function PaneBody({ view }: { view: View }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <>
      <div className="pane-scroll">
        <PaneSlot.Provider value={slot}>
          <PaneView view={view} />
        </PaneSlot.Provider>
      </div>
      <div className="pane-action-slot" ref={setSlot} />
    </>
  );
}

function PaneTitle({ view, prefix }: { view: View; prefix?: string }) {
  const { types } = useApp();
  const info = getViewInfo(view, types);
  const [title, setTitle] = useState(info.title);

  useEffect(() => {
    if (view?.kind === 'object') {
      let alive = true;
      getObject(view.id).then((o) => {
        if (alive && o?.title) setTitle(o.title);
      });
      return () => {
        alive = false;
      };
    } else {
      setTitle(info.title);
    }
  }, [view, info.title]);

  return (
    <span className="pane-name">
      {view.kind === 'type' ? (
        <TypeIcon icon={info.icon} size={13} />
      ) : (
        <Icon name={info.icon} size={13} />
      )}
      <span className="pane-name-label">
        {prefix && <span className="pane-prefix">{prefix}</span>}
        {title}
      </span>
    </span>
  );
}

function Shell() {
  const {
    panes,
    dir,
    active,
    setActive,
    split,
    toggleSplitDir,
    swapPanes,
    closing,
    requestClose,
    endClose,
    view,
    back,
    canBack,
    types,
    settingsOpen,
    closeSettings,
    newHabitatOpen,
    closeNewHabitat,
  } = useApp();
  const { narrow, keyboard } = useLayout();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  /** No Apple Intelligence, no Ask — the button and the shortcut both stay away. */
  const [askReady, setAskReady] = useState(false);
  /**
   * The drawer is its own state, deliberately separate from `sidebarHidden`.
   * That one is a remembered desktop preference — whether the sidebar is pinned
   * — and it persists. Whether the drawer happens to be open right now is
   * neither remembered nor meaningful on the desktop.
   */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(() => localStorage.getItem('habitat:sidebar') === 'hidden');
  /** A hidden sidebar peeks over the content while the pointer is on it. */
  const [peeking, setPeeking] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * A tell that lives entirely outside React state: how close the pointer is to
   * the left edge while the sidebar is put away, so the edge itself can lean
   * toward the cursor before it ever reaches the 14px hit-target. Plain motion
   * values rather than `useState` — this updates on every `mousemove`, and
   * routing that through a render would make dragging your mouse across the
   * window redraw the whole shell.
   */
  const edgeY = useMotionValue(0);
  const edgeYSpring = useSpring(edgeY, { stiffness: 300, damping: 32 });
  const edgeNear = useMotionValue(0);
  const edgeNearSpring = useSpring(edgeNear, { stiffness: 220, damping: 24 });
  const edgeWidth = useTransform(edgeNearSpring, [0, 1], [3, 9]);
  const edgeHeight = useTransform(edgeNearSpring, [0, 1], [34, 84]);
  const edgeOpacity = useTransform(edgeNearSpring, [0, 1], [0, 0.85]);
  /** A split is down the middle until the divider says otherwise. */
  const [ratio, setRatio] = useState(1 / 2);
  const mainRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const isSplit = panes.length > 1;

  // The main pane's size is a motion value: it springs when the side view opens
  // or closes, and follows the pointer 1:1 while the divider is being dragged.
  const mainSize = useMotionValue(isSplit ? ratio * 100 : 100);
  const mainBasis = useMotionTemplate`calc(${mainSize}% - 3px)`;

  useEffect(() => {
    if (!isSplit) setRatio(1 / 2);
  }, [isSplit]);

  /**
   * Every link in the app, wherever it's rendered, hands off to the OS browser.
   * One delegated listener rather than a handler per link — and it always cancels
   * the default: a renderer that follows a link in place has navigated away from
   * the app itself, with no way back.
   */
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || e.defaultPrevented) return;
      const href = a.getAttribute('href') ?? '';
      if (href.startsWith('#')) return;
      e.preventDefault();
      openLink(href);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  /**
   * Closing is animated first and committed after, rather than removing the
   * pane and animating what's left. Whichever one is going collapses to nothing
   * while the other grows into the space it leaves — so the survivor slides
   * over from where it actually was instead of reappearing at the edge.
   */
  /**
   * With a keyboard up, a stacked split has perhaps 350px to share and an even
   * ratio gives the pane being typed into about a hundred of them — you cannot
   * see what you are writing. So the focused pane takes the room for as long as
   * the keyboard is there, and the ratio returns to whatever it was when the
   * keyboard goes away. `ratio` itself is never touched, so nothing is lost.
   */
  const squeezed = narrow && keyboard && isSplit && closing === null;
  const target = closing === 0
    ? 0
    : closing === 1 || !isSplit
      ? 100
      : squeezed
        ? active === 1
          ? 22
          : 78
        : ratio * 100;

  useEffect(() => {
    if (dragging.current) return void mainSize.set(target);
    const controls = animate(mainSize, target, softSpring);
    if (closing !== null) {
      // Either way it commits: an interrupted animation must not leave a pane
      // collapsed to nothing and still on screen.
      controls.finished.then(endClose, endClose);
    }
    return () => controls.stop();
  }, [target, closing, endClose, mainSize]);

  /**
   * Pointer events rather than mouse events: one code path covers the trackpad
   * and the fingertip. The divider captures the pointer, so the drag survives
   * the finger straying off a 6px target — which it always does — and every
   * event comes back to the divider itself instead of the window.
   */
  const startDivider = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    const id = e.pointerId;
    el.setPointerCapture(id);
    dragging.current = true;

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      const r = mainRef.current?.getBoundingClientRect();
      if (!r) return;
      const v = dir === 'row' ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
      setRatio(Math.min(0.85, Math.max(0.25, v)));
    };
    // `pointercancel` matters on touch: the system can take the gesture away
    // mid-drag, and without this the divider would stay stuck to the finger.
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      dragging.current = false;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      document.body.style.cursor = '';
    };

    document.body.style.cursor = dir === 'row' ? 'col-resize' : 'row-resize';
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const toggleSidebar = () => {
    setPeeking(false);
    setSidebarHidden((v) => {
      localStorage.setItem('habitat:sidebar', v ? 'shown' : 'hidden');
      return !v;
    });
  };

  // The traffic lights belong to the sidebar's header, peeking included. There
  // are none to move on a phone, and the call is a no-op off Electron anyway.
  useEffect(() => {
    if (narrow) return;
    api.window.trafficLights(!sidebarHidden || peeking);
  }, [sidebarHidden, peeking, narrow]);

  // Going somewhere is the end of the drawer's job. Driven by the view rather
  // than by wrapping every nav item, so anything that navigates closes it.
  useEffect(() => {
    setDrawerOpen(false);
  }, [view]);

  /**
   * Being inside the visible half of the app is not the same as being visible:
   * the line you are typing can still sit below the fold of its own pane. Once
   * the shell has resized around the keyboard, whatever has focus is nudged up
   * into view — by the caret's own position where there is one, since in a long
   * note the element is the whole editor and its top is nowhere near the cursor.
   */
  useEffect(() => {
    if (!keyboard) return;
    const id = setTimeout(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return;
      const sel = window.getSelection();
      let box = el.getBoundingClientRect();
      if (el.isContentEditable && sel?.rangeCount) {
        const caret = sel.getRangeAt(0).getBoundingClientRect();
        // A collapsed range at the start of an empty line reports all zeroes.
        if (caret.height) box = caret;
      }
      const v = viewport();
      const below = box.bottom - (v.top + v.height - 16);
      if (below > 0) el.closest('.pane-scroll')?.scrollBy({ top: below, behavior: 'smooth' });
    }, 160);
    return () => clearTimeout(id);
  }, [keyboard]);

  /** A short dwell before the sidebar slides out, so brushing the edge doesn't trigger it. */
  const armPeek = () => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setPeeking(true), 260);
  };

  const cancelPeek = () => {
    if (peekTimer.current) clearTimeout(peekTimer.current);
    peekTimer.current = null;
  };

  /** Same dwell on the way out, so overshooting toward the collapse button
   *  (or catching the slide-in animation mid-flight) doesn't yank the sidebar
   *  away before the click lands. Cancelable if the pointer comes back. */
  const armUnpeek = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => setPeeking(false), 260);
  };

  const cancelUnpeek = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  };

  useEffect(() => () => {
    cancelPeek();
    cancelUnpeek();
  }, []);

  /**
   * The nub only has something to say while the sidebar is actually put away —
   * once it's pinned or already peeking, there's nowhere left to invite the
   * pointer toward. `EDGE_RANGE` is well past the 14px hit-target on purpose:
   * the whole point is to lean out before you've arrived, not once you're
   * already there.
   */
  useEffect(() => {
    if (narrow || !sidebarHidden || peeking) {
      edgeNear.set(0);
      return;
    }
    const EDGE_RANGE = 260;
    let frame = 0;
    const onMove = (e: MouseEvent) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        edgeY.set(e.clientY);
        const raw = Math.max(0, Math.min(1, 1 - e.clientX / EDGE_RANGE));
        // A gentler curve than a straight square: it's already noticeable a
        // third of the way into the range, then keeps gathering itself in as
        // you get closer — closer still reads as more eager, just from a
        // head start instead of from a standing stop.
        edgeNear.set(raw ** 1.3);
      });
    };
    const onLeaveWindow = () => edgeNear.set(0);
    window.addEventListener('mousemove', onMove);
    document.addEventListener('mouseleave', onLeaveWindow);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeaveWindow);
      if (frame) cancelAnimationFrame(frame);
      edgeNear.set(0);
    };
  }, [narrow, sidebarHidden, peeking, edgeY, edgeNear]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j' && askReadyRef.current) {
        e.preventDefault();
        setAskOpen((o) => !o);
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

  // Read inside the key handler, which is bound once and would otherwise close
  // over the value from the first render.
  const askReadyRef = useRef(false);
  askReadyRef.current = askReady;

  useEffect(() => {
    let alive = true;
    api.ai
      .availability()
      .then((state) => alive && setAskReady(state.available))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className={'app' + (sidebarHidden ? ' no-sidebar' : '')}>
      <div className="drag-strip" />

      {/* On a phone (or an Electron window pinched thin) the sidebar is a drawer
          off the right edge and navigation is a customizable bottom bar, rather
          than the desktop arrangement below — pinning, hover-peeking, the
          reveal strip — which is simply not mounted. */}
      {narrow ? (
        <>
          <SidebarDrawer
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            onSearch={() => setPaletteOpen(true)}
            onAsk={askReady ? () => setAskOpen(true) : undefined}
          />
          {!drawerOpen && <EdgeSwipe side="right" onTrigger={() => setDrawerOpen(true)} />}
          {!drawerOpen && canBack && <EdgeSwipe side="left" onTrigger={back} />}
          <BottomNav onSearch={() => setPaletteOpen(true)} onAsk={askReady ? () => setAskOpen(true) : undefined} />
        </>
      ) : (
        <>
          {sidebarHidden && !peeking && (
            <>
              <div className="edge-reveal" onMouseEnter={armPeek} onMouseLeave={cancelPeek} />
              <motion.div
                className="edge-hint"
                aria-hidden
                style={{ top: edgeYSpring, width: edgeWidth, height: edgeHeight, opacity: edgeOpacity }}
              />
            </>
          )}
          <AnimatePresence initial={false}>
            {(!sidebarHidden || peeking) && (
          <motion.div
            key="sidebar"
            className={'sidebar-slot' + (sidebarHidden ? ' peeking' : '')}
            onMouseEnter={cancelUnpeek}
            onMouseLeave={() => {
              cancelPeek();
              armUnpeek();
            }}
            initial={sidebarHidden ? { x: -248 } : { marginLeft: -240, opacity: 0 }}
            animate={sidebarHidden ? { x: 0 } : { marginLeft: 0, opacity: 1 }}
            exit={sidebarHidden ? { x: -248 } : { marginLeft: -240, opacity: 0 }}
            transition={softSpring}
          >
            <Sidebar
              pinned={!sidebarHidden}
              onSearch={() => setPaletteOpen(true)}
              onAsk={askReady ? () => setAskOpen(true) : undefined}
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
        </>
      )}

      {narrow && isSplit && (
        <div className="mobile-pane-bar">
          <div className="mobile-pane-tabs">
            {panes.map((p, i) => {
              const topView = p.stack[p.stack.length - 1];
              return (
                <button
                  key={p.id}
                  className={'mobile-pane-tab' + (i === active ? ' active' : '')}
                  onClick={() => setActive(i)}
                >
                  <PaneTitle view={topView} prefix={i === 0 ? 'Main: ' : 'Side: '} />
                  {i === 1 && (
                    <span
                      className="mobile-pane-tab-close"
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        requestClose(1);
                      }}
                      aria-label="Close side pane"
                    >
                      <Icon name="x" size={11} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div ref={mainRef} className={'main-area ' + (narrow ? 'mobile-area' : (dir === 'row' ? 'dir-row' : 'dir-col'))}>
        {narrow && isSplit ? (
          <motion.section
            key={panes[active].id}
            className="pane focused mobile-active-pane"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={softSpring}
          >
            <PaneBody view={panes[active].stack[panes[active].stack.length - 1]} />
          </motion.section>
        ) : (
          <AnimatePresence initial={false}>
            {panes.flatMap((p, i) => [
              ...(i === 1 && !narrow
                ? [
                    <motion.div
                      key="divider"
                      className="split-divider"
                      onPointerDown={startDivider}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: closing === null ? 1 : 0 }}
                      exit={{ opacity: 0 }}
                      transition={snap}
                    />,
                  ]
                : []),
              <motion.section
                key={p.id}
                className={'pane' + (isSplit ? (i === active ? ' focused' : ' dimmed') : '')}
                style={isSplit && i === 0 && !narrow ? { flexBasis: mainBasis, flexGrow: 0, flexShrink: 0 } : undefined}
                initial={i === 0 ? false : { opacity: 0, x: dir === 'row' ? 44 : 0, y: dir === 'col' ? 44 : 0 }}
                animate={{ opacity: closing === i ? 0 : 1, x: 0, y: 0 }}
                transition={softSpring}
                onMouseDownCapture={() => setActive(i)}
              >
                {/* Desktop split pane-bar */}
                {isSplit && !narrow && (
                  <div className="pane-bar">
                    <motion.span className="pane-dot" animate={{ scale: i === active ? 1 : 0.8 }} transition={spring} />
                    <PaneTitle view={p.stack[p.stack.length - 1]} prefix={i === 0 ? 'Main: ' : 'Side: '} />
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
                    <motion.button
                      className="icon-btn"
                      onClick={swapPanes}
                      aria-label="Swap panes"
                      title="Swap panes (⇄)"
                      whileHover={{ scale: 1.12 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <Icon name="arrow-left-right" size={12} />
                    </motion.button>
                    <motion.button
                      className={'icon-btn' + (dir === 'row' ? ' active' : '')}
                      onClick={toggleSplitDir}
                      aria-label={dir === 'row' ? 'Stack panes vertically' : 'Place panes side by side'}
                      title={dir === 'row' ? 'Stack vertically' : 'Side by side'}
                      whileHover={{ scale: 1.12 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <Icon name={dir === 'row' ? 'rows' : 'columns'} size={12} />
                    </motion.button>
                    <motion.button
                      className="icon-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        requestClose(i);
                      }}
                      aria-label="Close pane"
                      title="Close this pane"
                      whileHover={{ scale: 1.12, rotate: 90 }}
                      whileTap={{ scale: 0.9 }}
                    >
                      <Icon name="x" size={13} />
                    </motion.button>
                  </div>
                )}
                <PaneBody view={p.stack[p.stack.length - 1]} />
              </motion.section>,
            ])}
          </AnimatePresence>
        )}
      </div>

      {paletteOpen && <SearchPalette onClose={() => setPaletteOpen(false)} />}
      {askOpen && <AskPanel onClose={() => setAskOpen(false)} />}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsModal onClose={closeSettings} />
        </Suspense>
      )}
      {newHabitatOpen && <NewHabitatModal onClose={closeNewHabitat} />}
      {/* One host for every "are you sure?" in the app — see src/confirm.tsx. */}
      <ConfirmHost />
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
