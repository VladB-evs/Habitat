import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { DashWidget, ObjType, Stats } from '../types';
import type { WidgetDef } from '../widgets';
import {
  COLS,
  DashDataCtx,
  GAP,
  MAX_H,
  ROW_H,
  WIDGETS,
  WidgetFrameCtx,
  clamp,
  defaultLayout,
  isAvailable,
  makeWidget,
  normalize,
  widgetDef,
} from '../widgets';
import { typeColor } from '../util';
import { Icon } from './Icons';
import { SplitControls } from './SplitControls';

/* ---------- one placed widget ---------- */

interface FrameProps {
  w: DashWidget;
  edit: boolean;
  types: ObjType[];
  settingsOpen: boolean;
  dragging: boolean;
  resizing: boolean;
  onRemove: () => void;
  onToggleSettings: () => void;
  onConfig: (patch: Record<string, any>) => void;
  onResizeStart: (e: React.MouseEvent) => void;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
}

function WidgetFrame({
  w,
  edit,
  types,
  settingsOpen,
  dragging,
  resizing,
  onRemove,
  onToggleSettings,
  onConfig,
  onResizeStart,
  onDragStart,
  onDragEnter,
  onDragEnd,
}: FrameProps) {
  const def = widgetDef(w.kind);
  const [empty, setEmpty] = useState(false);
  const frame = useMemo(() => ({ setEmpty }), []);

  const available = def ? isAvailable(def, types) : false;
  // Nothing to show: stay mounted (so the body keeps watching its data) but drop out of the grid.
  const hidden = !edit && (empty || !available);
  const title = def?.title?.(w.config) ?? null;

  const cls = [
    'w-wrap',
    def?.card ? 'w-boxed' : '',
    def?.center ? 'w-center' : '',
    edit ? 'w-editing' : '',
    dragging ? 'w-dragging' : '',
    resizing ? 'w-resizing' : '',
    hidden ? 'w-hidden' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cls}
      data-h={w.h}
      style={{ gridColumn: `span ${w.w}`, gridRow: `span ${w.h}` }}
      onDragEnter={onDragEnter}
      onDragOver={(e) => edit && e.preventDefault()}
    >
      {title && <div className="w-title">{title}</div>}

      <div className="w-body">
        <WidgetFrameCtx.Provider value={frame}>
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
              carries the drag itself — keeping `draggable` off the wrapper means selecting
              text in the settings popover can't start a widget drag. */}
          <div
            className="w-shield"
            draggable={!resizing}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          />
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
          <div className="w-resize" onMouseDown={onResizeStart} title="Drag to resize" />
          {resizing && (
            <div className="w-size">
              {w.w} × {w.h}
            </div>
          )}
        </>
      )}

      {edit && settingsOpen && def?.Settings && (
        <div className="w-settings" onMouseDown={(e) => e.stopPropagation()}>
          <def.Settings config={w.config} set={onConfig} />
        </div>
      )}
    </div>
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
            <div className="picker-sub">It lands at the end — drag it where you want, then pull its corner to size it.</div>
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

interface Resize {
  id: string;
  startW: number;
  startH: number;
  x: number;
  y: number;
  minW: number;
  minH: number;
}

export function Dashboard() {
  const { types } = useApp();
  const [widgets, setWidgets] = useState<DashWidget[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [edit, setEdit] = useState(false);
  const [picking, setPicking] = useState(false);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [resize, setResize] = useState<Resize | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const latest = useRef<DashWidget[]>([]);
  const moved = useRef(false);

  latest.current = widgets ?? [];

  const reloadStats = useCallback(() => {
    api.stats().then(setStats);
  }, []);

  useEffect(() => {
    api.dashboard.get().then((l) => setWidgets(l?.widgets?.length ? l.widgets.map(normalize) : defaultLayout()));
    reloadStats();
  }, [reloadStats]);

  const persist = useCallback(() => {
    api.dashboard.save({ widgets: latest.current });
  }, []);

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
    setPicking(false);
    const w = makeWidget(def);
    commit([...(widgets ?? []), w]);
    if (def.Settings && def.defaultConfig) setSettingsFor(w.id);
  };

  const remove = (id: string) => {
    commit((widgets ?? []).filter((w) => w.id !== id));
    if (settingsFor === id) setSettingsFor(null);
  };

  const reset = async () => {
    if (!confirm('Reset the dashboard to its default widgets? Any widgets you added will be removed.')) return;
    await api.dashboard.reset();
    setWidgets(defaultLayout());
    setSettingsFor(null);
  };

  /* --- drag to reorder --- */

  const dragOver = (overId: string) => {
    if (!dragId || dragId === overId) return;
    setWidgets((list) => {
      if (!list) return list;
      const from = list.findIndex((w) => w.id === dragId);
      const to = list.findIndex((w) => w.id === overId);
      if (from < 0 || to < 0) return list;
      const next = [...list];
      next.splice(to, 0, next.splice(from, 1)[0]);
      moved.current = true;
      return next;
    });
  };

  const dragEnd = () => {
    setDragId(null);
    if (moved.current) {
      moved.current = false;
      persist();
    }
  };

  /* --- drag the corner to resize, in whole grid units --- */

  const startResize = (w: DashWidget, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const def = widgetDef(w.kind);
    setSettingsFor(null);
    setResize({
      id: w.id,
      startW: w.w,
      startH: w.h,
      x: e.clientX,
      y: e.clientY,
      minW: def?.minW ?? 1,
      minH: def?.minH ?? 1,
    });
  };

  useEffect(() => {
    if (!resize) return;
    // One column step is the track width plus a gap, which works out to (gridWidth + gap) / columns.
    const colUnit = ((gridRef.current?.clientWidth ?? 900) + GAP) / COLS;
    const rowUnit = ROW_H + GAP;

    const move = (e: MouseEvent) => {
      const w = clamp(Math.round(resize.startW + (e.clientX - resize.x) / colUnit), resize.minW, COLS);
      const h = clamp(Math.round(resize.startH + (e.clientY - resize.y) / rowUnit), resize.minH, MAX_H);
      setWidgets((list) =>
        list ? list.map((x) => (x.id === resize.id && (x.w !== w || x.h !== h) ? { ...x, w, h } : x)) : list
      );
    };
    const up = () => {
      setResize(null);
      persist();
    };

    document.body.style.cursor = 'nwse-resize';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [resize, persist]);

  const dash = useMemo(() => ({ stats, reloadStats, edit }), [stats, reloadStats, edit]);

  if (!widgets) return <div className="dash" />;

  const used = new Set(widgets.map((w) => w.kind));

  return (
    <div className={'dash' + (edit ? ' editing' : '')}>
      <div className="dash-bar">
        {edit ? (
          <>
            <span className="dash-tip">Drag to reorder · pull a corner to resize</span>
            <button className="btn" onClick={() => setPicking(true)}>
              <Icon name="plus" size={13} /> Add widget
            </button>
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
      </div>

      <DashDataCtx.Provider value={dash}>
        <div className="dash-grid" ref={gridRef}>
          {widgets.map((w) => (
            <WidgetFrame
              key={w.id}
              w={w}
              edit={edit}
              types={types}
              dragging={dragId === w.id}
              resizing={resize?.id === w.id}
              settingsOpen={settingsFor === w.id}
              onRemove={() => remove(w.id)}
              onToggleSettings={() => setSettingsFor((id) => (id === w.id ? null : w.id))}
              onConfig={(p) => patch(w.id, (x) => ({ ...x, config: { ...x.config, ...p } }))}
              onResizeStart={(e) => startResize(w, e)}
              onDragStart={() => setDragId(w.id)}
              onDragEnter={() => dragOver(w.id)}
              onDragEnd={dragEnd}
            />
          ))}
        </div>
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

      {picking && <WidgetPicker types={types} used={used} onPick={add} onClose={() => setPicking(false)} />}
    </div>
  );
}
