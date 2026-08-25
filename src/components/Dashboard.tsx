import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { api } from '../api';
import { ask } from '../confirm';
import { useLayout } from '../layout';
import { useApp } from '../store';
import type { DashWidget, ObjType, Stats } from '../types';
import type { WidgetDef } from '../widgets';
import {
  DashDataCtx,
  GAP,
  WIDGETS,
  WidgetFrameCtx,
  defaultLayout,
  isAvailable,
  makeWidget,
  normalize,
  widgetDef,
  widgetHeight,
} from '../widgets';
import { typeColor } from '../util';
import { Icon } from './Icons';
import { SplitControls } from './SplitControls';
import { PageActions } from './PageActions';

/* ---------- reordering / moving widgets between columns ----------

   Deliberately plain pointer events rather than a drag-and-drop library or
   Framer's Reorder: Reorder locks a dragged item's own motion to a single
   axis (it has to, to compute in-list order), so it can visually move up and
   down but never sideways — there is no way to drag one into the other
   column, only to fake it by reading the pointer's position separately from
   where the tile appears to be. That produced a real capability but a
   confusing gesture. Raw pointer events don't have that constraint: the
   dragged tile can go anywhere, because nothing but this code is deciding
   where it goes. This is the same window-listener + pointer-capture shape
   already used for the sidebar divider and (formerly) the resize corner. */

/** Where a drop would land: which column, and which position within it,
 *  counting only the *other* widgets already there. `top` is precomputed in
 *  the same pass since it needs the same DOM measurements. */
interface DropTarget {
  col: number;
  index: number;
  top: number;
}

/** Splits `dragged` out of `list` and reinserts it as the `index`-th widget of
 *  `col`, preserving every other widget's relative order (including the other
 *  column's, which never moves). */
function commitDrop(list: DashWidget[], draggedId: string, col: number, index: number): DashWidget[] {
  const dragged = list.find((w) => w.id === draggedId);
  if (!dragged) return list;
  const rest = list.filter((w) => w.id !== draggedId);
  const colSlots: number[] = [];
  rest.forEach((w, i) => {
    if (w.col === col) colSlots.push(i);
  });
  const at = Math.max(0, Math.min(index, colSlots.length));
  const insertAt = at < colSlots.length ? colSlots[at] : colSlots.length ? colSlots[colSlots.length - 1] + 1 : rest.length;
  const next = [...rest];
  next.splice(insertAt, 0, dragged.col === col ? dragged : { ...dragged, col });
  return next;
}

/** The narrow-window version: one merged list, so there's no column to slot
 *  into — just a new position in the same flat array. `col` on the moved
 *  widget is left exactly as it was, for whenever the window widens again. */
function commitDropNarrow(list: DashWidget[], draggedId: string, index: number): DashWidget[] {
  const dragged = list.find((w) => w.id === draggedId);
  if (!dragged) return list;
  const rest = list.filter((w) => w.id !== draggedId);
  const at = Math.max(0, Math.min(index, rest.length));
  const next = [...rest];
  next.splice(at, 0, dragged);
  return next;
}

/* ---------- one placed widget ---------- */

interface FrameProps {
  w: DashWidget;
  edit: boolean;
  dragging: boolean;
  types: ObjType[];
  settingsOpen: boolean;
  onRemove: () => void;
  onToggleSettings: () => void;
  onConfig: (patch: Record<string, any>) => void;
  onDragStart: (e: React.PointerEvent) => void;
}

function WidgetFrame({ w, edit, dragging, types, settingsOpen, onRemove, onToggleSettings, onConfig, onDragStart }: FrameProps) {
  const def = widgetDef(w.kind);
  const [empty, setEmpty] = useState(false);
  const frame = useMemo(() => ({ setEmpty }), []);

  const available = def ? isAvailable(def, types) : false;
  // Nothing to show: stay mounted (so the body keeps watching its data) but drop out of the list.
  const hidden = !edit && (empty || !available);
  const title = def?.title?.(w.config) ?? null;
  const h = def?.defaultH ?? 2;

  const cls = [
    'w-wrap',
    def?.card ? 'w-boxed' : '',
    def?.center ? 'w-center' : '',
    edit ? 'w-editing' : '',
    dragging ? 'w-dragging' : '',
    hidden ? 'w-hidden' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <motion.div layout="position" className={cls} data-wid={w.id} data-h={h} style={{ height: widgetHeight(h) }}>
      <div className="w-body">
        <WidgetFrameCtx.Provider value={frame}>
          {title && <div className="w-title">{title}</div>}
          {!def ? (
            <div className="w-empty">Unknown widget “{w.kind}”.</div>
          ) : !available ? (
            <div className="w-empty">Not available here — this habitat has no matching object type.</div>
          ) : (
            <def.Body id={w.id} config={w.config} />
          )}
        </WidgetFrameCtx.Provider>
      </div>

      {edit && (
        <>
          {/* Swallows clicks so dragging a widget never fires the controls inside it, and
              carries the drag itself — keeping the pointer listener off the tile means
              selecting text in the settings popover can't start a widget drag. */}
          <div className="w-shield" onPointerDown={onDragStart} />
          <div className="w-tools">
            <span className="w-kind">{def?.name ?? w.kind}</span>
            {def?.Settings && (
              <button
                className={'w-tool' + (settingsOpen ? ' on' : '')}
                onClick={onToggleSettings}
                aria-label="Widget settings"
              >
                <Icon name="settings" size={13} />
              </button>
            )}
            <button className="w-tool" onClick={onRemove} aria-label="Remove widget">
              <Icon name="trash" size={13} />
            </button>
          </div>
        </>
      )}

      {edit && settingsOpen && def?.Settings && (
        <div className="w-settings" onMouseDown={(e) => e.stopPropagation()}>
          <def.Settings config={w.config} set={onConfig} />
        </div>
      )}
    </motion.div>
  );
}

/* ---------- add-widget picker ---------- */

const GROUP_COLOR: Record<string, string> = { Habitat: '#2a78d6', Time: '#1baf7a', Custom: '#4a3aa7' };

function WidgetPicker({
  types,
  used,
  onPick,
  onClose,
}: {
  types: ObjType[];
  used: Set<string>;
  onPick: (def: WidgetDef) => void;
  onClose: () => void;
}) {
  const { theme } = useApp();
  const [tab, setTab] = useState('All');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const groups = [...new Set(WIDGETS.map((d) => d.group))];
  const shown = WIDGETS.filter((d) => tab === 'All' || d.group === tab);

  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="picker">
        <div className="picker-head">
          <div>
            <h2>Add a widget</h2>
            <div className="picker-sub">It's added to this column — drag it wherever you'd rather have it.</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={15} />
          </button>
        </div>

        <div className="picker-tabs">
          {['All', ...groups].map((g) => (
            <button key={g} className={tab === g ? 'on' : ''} onClick={() => setTab(g)}>
              {g}
            </button>
          ))}
        </div>

        <div className="picker-body">
          <div className="picker-grid">
            {shown.map((d) => {
              const taken = !!d.singleton && used.has(d.kind);
              const missing = !isAvailable(d, types);
              const color = typeColor(GROUP_COLOR[d.group] || '#2a78d6', theme);
              return (
                <button key={d.kind} className="pk" disabled={taken || missing} onClick={() => onPick(d)}>
                  <span
                    className="pk-icon"
                    style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)` }}
                  >
                    <Icon name={d.icon} size={17} />
                  </span>
                  <span className="pk-text">
                    <span className="pk-name">
                      {d.name}
                      {taken && <span className="pk-chip">Added</span>}
                      {missing && <span className="pk-chip">Unavailable</span>}
                    </span>
                    <span className="pk-desc">{missing ? 'This habitat has no matching object type.' : d.desc}</span>
                  </span>
                  <span className="pk-plus">
                    <Icon name="plus" size={15} />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- the dashboard ---------- */

export function Dashboard() {
  const { types } = useApp();
  const { narrow } = useLayout();
  const [widgets, setWidgets] = useState<DashWidget[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [edit, setEdit] = useState(false);
  /** Which column "Add widget" is targeting — null while the picker is closed.
   *  On a narrow window there's only one list, so this is always 0 there. */
  const [pickingCol, setPickingCol] = useState<number | null>(null);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);

  const [dragId, setDragId] = useState<string | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);
  const dragPointerId = useRef<number | null>(null);

  const reloadStats = useCallback(() => {
    api.stats().then(setStats);
  }, []);

  useEffect(() => {
    api.dashboard.get().then((l) => setWidgets(l?.widgets?.length ? l.widgets.map(normalize) : defaultLayout()));
    reloadStats();
  }, [reloadStats]);

  /** Every layout change is persisted immediately — there's no separate save step. */
  const commit = useCallback((next: DashWidget[]) => {
    setWidgets(next);
    api.dashboard.save({ widgets: next });
  }, []);

  const patch = useCallback((id: string, fn: (w: DashWidget) => DashWidget) => {
    setWidgets((list) => {
      if (!list) return list;
      const next = list.map((w) => (w.id === id ? fn(w) : w));
      api.dashboard.save({ widgets: next });
      return next;
    });
  }, []);

  const add = (def: WidgetDef) => {
    if (pickingCol === null) return;
    const w = makeWidget(def, pickingCol);
    setPickingCol(null);
    commit([...(widgets ?? []), w]);
    if (def.Settings && def.defaultConfig) setSettingsFor(w.id);
  };

  const remove = (id: string) => {
    commit((widgets ?? []).filter((w) => w.id !== id));
    if (settingsFor === id) setSettingsFor(null);
  };

  const reset = async () => {
    if (!(await ask('Reset the dashboard to its default widgets? Any widgets you added will be removed.'))) return;
    await api.dashboard.reset();
    setWidgets(defaultLayout());
    setSettingsFor(null);
  };

  /**
   * Which column and position the pointer is over right now — read from the
   * live DOM (not from React state) because it has to reflect wherever the
   * *other* widgets currently sit, and re-deriving that from scratch on every
   * pointer move is simpler and cheaper than keeping a parallel model in sync
   * with it. `excludeId` is always the widget being dragged, so it can't
   * measure or target itself.
   */
  const computeDrop = useCallback(
    (clientX: number, clientY: number, excludeId: string): DropTarget | null => {
      let col = 0;
      if (!narrow) {
        let bestDist = Infinity;
        colRefs.current.forEach((el, i) => {
          if (!el) return;
          const r = el.getBoundingClientRect();
          const d = clientX < r.left ? r.left - clientX : clientX > r.right ? clientX - r.right : 0;
          if (d < bestDist) {
            bestDist = d;
            col = i;
          }
        });
      }
      const container = colRefs.current[col];
      if (!container) return null;
      const kids = Array.from(container.querySelectorAll<HTMLElement>('[data-wid]')).filter(
        (el) => el.dataset.wid !== excludeId
      );
      const containerRect = container.getBoundingClientRect();
      let index = kids.length;
      for (let i = 0; i < kids.length; i++) {
        if (clientY < kids[i].getBoundingClientRect().top + kids[i].getBoundingClientRect().height / 2) {
          index = i;
          break;
        }
      }
      let top: number;
      if (kids.length === 0) top = 0;
      else if (index === 0) top = kids[0].getBoundingClientRect().top - containerRect.top - GAP / 2;
      else if (index >= kids.length)
        top = kids[kids.length - 1].getBoundingClientRect().bottom - containerRect.top + GAP / 2;
      else {
        const prevBottom = kids[index - 1].getBoundingClientRect().bottom - containerRect.top;
        const nextTop = kids[index].getBoundingClientRect().top - containerRect.top;
        top = (prevBottom + nextTop) / 2;
      }
      return { col, index, top };
    },
    [narrow]
  );

  const startDrag = (w: DashWidget, e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragPointerId.current = e.pointerId;
    setDragId(w.id);
    setGhostPos({ x: e.clientX, y: e.clientY });
    setDropTarget(computeDrop(e.clientX, e.clientY, w.id));
  };

  useEffect(() => {
    if (!dragId) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== dragPointerId.current) return;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setGhostPos({ x: e.clientX, y: e.clientY });
        setDropTarget(computeDrop(e.clientX, e.clientY, dragId));
      });
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== dragPointerId.current) return;
      const target = computeDrop(e.clientX, e.clientY, dragId);
      if (target) {
        setWidgets((list) => {
          if (!list) return list;
          const next = narrow
            ? commitDropNarrow(list, dragId, target.index)
            : commitDrop(list, dragId, target.col, target.index);
          api.dashboard.save({ widgets: next });
          return next;
        });
      }
      dragPointerId.current = null;
      setDragId(null);
      setGhostPos(null);
      setDropTarget(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [dragId, narrow, computeDrop]);

  const dash = useMemo(() => ({ stats, reloadStats, edit }), [stats, reloadStats, edit]);

  if (!widgets) return <div className="dash" />;

  const used = new Set(widgets.map((w) => w.kind));
  const draggedDef = dragId ? widgetDef(widgets.find((w) => w.id === dragId)?.kind ?? '') : null;

  const renderColumn = (col: number, list: DashWidget[]) => (
    <div className="dash-col" ref={(el) => (colRefs.current[col] = el)}>
      {list.map((w) => (
        <WidgetFrame
          key={w.id}
          w={w}
          edit={edit}
          dragging={dragId === w.id}
          types={types}
          settingsOpen={settingsFor === w.id}
          onRemove={() => remove(w.id)}
          onToggleSettings={() => setSettingsFor((id) => (id === w.id ? null : w.id))}
          onConfig={(p) => patch(w.id, (x) => ({ ...x, config: { ...x.config, ...p } }))}
          onDragStart={(e) => startDrag(w, e)}
        />
      ))}
      {dropTarget?.col === col && <div className="drop-line" style={{ top: dropTarget.top }} />}
      {edit && (
        <button className="dash-add" onClick={() => setPickingCol(col)}>
          <Icon name="plus" size={14} /> Add widget
        </button>
      )}
    </div>
  );

  return (
    <div className={'dash' + (edit ? ' editing' : '')}>
      <div className="dash-bar">
        <PageActions>
        {edit ? (
          <>
            <span className="dash-tip">Drag to reorder, or move it into the other column</span>
            <button className="btn subtle" onClick={reset}>
              Reset
            </button>
            <button className="btn primary" onClick={() => setEdit(false)}>
              Done
            </button>
          </>
        ) : (
          <button className="btn subtle dash-edit" onClick={() => setEdit(true)}>
            <Icon name="pencil" size={13} /> Edit dashboard
          </button>
        )}
        <SplitControls />
        </PageActions>
      </div>

      <DashDataCtx.Provider value={dash}>
        {narrow ? (
          renderColumn(0, widgets)
        ) : (
          <div className="dash-cols">
            {renderColumn(0, widgets.filter((w) => w.col !== 1))}
            {renderColumn(1, widgets.filter((w) => w.col === 1))}
          </div>
        )}
      </DashDataCtx.Provider>

      {!widgets.length && !edit && (
        <div className="dash-blank">
          Your dashboard is empty.{' '}
          <button className="link-btn" onClick={() => setEdit(true)}>
            Add some widgets
          </button>
          .
        </div>
      )}

      {dragId && ghostPos && draggedDef && (
        <div className="drag-ghost" style={{ left: ghostPos.x, top: ghostPos.y }}>
          <Icon name={draggedDef.icon} size={14} />
          {draggedDef.name}
        </div>
      )}

      {pickingCol !== null && <WidgetPicker types={types} used={used} onPick={add} onClose={() => setPickingCol(null)} />}
    </div>
  );
}
