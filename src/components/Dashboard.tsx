import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { api } from '../api';
import { ask } from '../confirm';
import { useApp } from '../store';
import type { DashWidget, ObjType, Stats } from '../types';
import type { WidgetDef } from '../widgets';
import {
  COLS,
  DashDataCtx,
  GAP,
  MAX_H,
  MIN_H,
  ROW_H,
  WIDGETS,
  WidgetFrameCtx,
  clamp,
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

/* ---------- reordering widgets in grid ---------- */

function commitDrop(list: DashWidget[], draggedId: string, index: number): DashWidget[] {
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
  dropIndicator: 'before' | 'after' | null;
  resizing: boolean;
  types: ObjType[];
  settingsOpen: boolean;
  onRemove: () => void;
  onToggleSettings: () => void;
  onToggleWidth: () => void;
  onSetWidth: (width: number) => void;
  onSetHeight: (height: number) => void;
  onConfig: (patch: Record<string, any>) => void;
  onDragStart: (e: React.PointerEvent) => void;
  onResizeStart: (mode: 'corner' | 'bottom', e: React.PointerEvent) => void;
}

function WidgetFrame({
  w,
  edit,
  dragging,
  dropIndicator,
  resizing,
  types,
  settingsOpen,
  onRemove,
  onToggleSettings,
  onToggleWidth,
  onSetWidth,
  onSetHeight,
  onConfig,
  onDragStart,
  onResizeStart,
}: FrameProps) {
  const def = widgetDef(w.kind);
  const [empty, setEmpty] = useState(false);
  const frame = useMemo(() => ({ setEmpty }), []);

  const available = def ? isAvailable(def, types) : false;
  // Nothing to show: stay mounted (so the body keeps watching its data) but drop out of the list.
  const hidden = !edit && (empty || !available);
  const title = def?.title?.(w.config) ?? null;

  const minW = def?.minW ?? 1;
  const maxW = COLS;
  const minH = def?.minH ?? MIN_H;
  const maxH = def?.maxH ?? MAX_H;

  const wWidth = clamp(w.w ?? def?.defaultW ?? 3, minW, maxW);
  const h = clamp(w.h ?? def?.defaultH ?? 2, minH, maxH);
  const isFull = wWidth >= 5;

  const frameRef = useRef<HTMLDivElement>(null);
  const [alignRight, setAlignRight] = useState(false);

  useEffect(() => {
    if (settingsOpen && frameRef.current) {
      const rect = frameRef.current.getBoundingClientRect();
      setAlignRight(rect.left + 310 > window.innerWidth);
    }
  }, [settingsOpen]);

  const cls = [
    'w-wrap',
    `w-kind-${w.kind}`,
    isFull ? 'w-full' : 'w-partial',
    def?.card ? 'w-boxed' : '',
    def?.center ? 'w-center' : '',
    edit ? 'w-editing' : '',
    settingsOpen ? 'w-settings-open' : '',
    alignRight ? 'align-right' : '',
    dragging ? 'w-dragging' : '',
    dropIndicator === 'before' ? 'drop-before' : '',
    dropIndicator === 'after' ? 'drop-after' : '',
    resizing ? 'w-resizing' : '',
    hidden ? 'w-hidden' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <motion.div
      ref={frameRef}
      layout="position"
      className={cls}
      data-wid={w.id}
      data-kind={w.kind}
      data-w={wWidth}
      data-h={h}
      style={{
        gridColumn: `span ${wWidth}`,
        gridRow: `span ${h}`,
      }}
    >
      {title && <div className="w-title">{title}</div>}

      <div className="w-body">
        <WidgetFrameCtx.Provider value={frame}>
          {!def ? (
            <div className="w-empty">Unknown widget “{w.kind}”.</div>
          ) : !available ? (
            <div className="w-empty">Not available here — this habitat has no matching object type.</div>
          ) : (
            <def.Body id={w.id} config={w.config} set={onConfig} w={wWidth} h={h} />
          )}
        </WidgetFrameCtx.Provider>
      </div>

      {edit && (
        <>
          {/* Swallows clicks so dragging a widget never fires the controls inside it */}
          <div className="w-shield" onPointerDown={onDragStart} />

          <div className="w-tools" onPointerDown={(e) => e.stopPropagation()}>
            {wWidth >= 4 && <span className="w-kind">{def?.name ?? w.kind}</span>}
            <button
              className={'w-tool' + (isFull ? ' on' : '')}
              onClick={onToggleWidth}
              title={isFull ? 'Collapse to half width (3 columns)' : 'Expand to full width (6 columns)'}
              aria-label="Toggle widget width"
            >
              <Icon name="columns" size={13} />
            </button>
            <button
              className="w-tool"
              disabled={h <= minH}
              onClick={() => onSetHeight(h - 1)}
              title="Decrease height"
              aria-label="Decrease height"
            >
              <Icon name="minus" size={11} />
            </button>
            <button
              className="w-tool"
              disabled={h >= maxH}
              onClick={() => onSetHeight(h + 1)}
              title="Increase height"
              aria-label="Increase height"
            >
              <Icon name="plus" size={11} />
            </button>
            {def?.Settings && (
              <button
                className={'w-tool' + (settingsOpen ? ' on' : '')}
                onClick={onToggleSettings}
                title="Widget settings"
                aria-label="Widget settings"
              >
                <Icon name="settings" size={13} />
              </button>
            )}
            <button className="w-tool danger" onClick={onRemove} title="Remove widget" aria-label="Remove widget">
              <Icon name="trash" size={13} />
            </button>
          </div>

          {/* Corner resize grip for 2D width & height dragging */}
          <div
            className="w-resize"
            onPointerDown={(e) => onResizeStart('corner', e)}
            title="Drag corner to resize width and height"
          />

          {/* Bottom resize handle for pure height dragging */}
          <div
            className="w-resize-bottom"
            onPointerDown={(e) => onResizeStart('bottom', e)}
            title="Drag down or up to resize widget height"
          >
            <div className="w-resize-bottom-grip" />
          </div>

          {resizing && (
            <div className="w-size-badge">
              {wWidth} × {h}
              <span className="w-size-detail">
                ({wWidth} {wWidth === 1 ? 'col' : 'cols'} × {h} {h === 1 ? 'row' : 'rows'})
              </span>
            </div>
          )}
        </>
      )}

      {edit && settingsOpen && (
        <div className="w-settings" onMouseDown={(e) => e.stopPropagation()}>
          <div className="w-settings-header">
            <span className="w-settings-title">{def?.name ?? w.kind} settings</span>
            <button className="w-settings-close" onClick={onToggleSettings} aria-label="Close settings">
              <Icon name="x" size={13} />
            </button>
          </div>
          <div className="w-layout-row">
            <label className="w-field">
              <span>Width ({wWidth} columns)</span>
              <div className="w-col-picker">
                {[1, 2, 3, 4, 5, 6].map((num) => (
                  <button
                    key={num}
                    type="button"
                    className={'col-pill' + (wWidth === num ? ' on' : '')}
                    disabled={num < minW}
                    onClick={() => onSetWidth(num)}
                  >
                    {num} {num === 1 ? 'col' : 'cols'}
                  </button>
                ))}
              </div>
            </label>
            <label className="w-field">
              <span>Height ({h} rows)</span>
              <div className="h-picker">
                {[1, 2, 3, 4, 5, 6, 8, 10, 12, 14]
                  .filter((num) => num >= minH && num <= maxH)
                  .map((num) => (
                    <button
                      key={num}
                      type="button"
                      className={'h-pill' + (h === num ? ' on' : '')}
                      onClick={() => onSetHeight(num)}
                    >
                      {num}R
                    </button>
                  ))}
              </div>
            </label>
          </div>
          {def?.Settings && <def.Settings config={w.config} set={onConfig} />}
          <div className="w-settings-footer">
            <button type="button" className="w-settings-delete-btn" onClick={onRemove}>
              <Icon name="trash" size={12} /> Remove from dashboard
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

/* ---------- add-widget picker ---------- */

const GROUP_COLOR: Record<string, string> = {
  Productivity: '#e07a5f',
  Habitat: '#2a78d6',
  Time: '#1baf7a',
  Custom: '#4a3aa7',
};

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

  const groups = ['Productivity', 'Habitat', 'Time', 'Custom'];
  const shown = WIDGETS.filter((d) => tab === 'All' || d.group === tab);

  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="picker">
        <div className="picker-head">
          <div>
            <h2>Add a widget</h2>
            <div className="picker-sub">Choose a widget to add to your dashboard. You can resize and arrange it anytime.</div>
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

interface ResizeState {
  id: string;
  mode: 'corner' | 'bottom';
  startW: number;
  startH: number;
  startX: number;
  startY: number;
  minW: number;
  maxW: number;
  minH: number;
  maxH: number;
  pointerId: number;
}

export function Dashboard() {
  const { types } = useApp();
  const [widgets, setWidgets] = useState<DashWidget[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [edit, setEdit] = useState(false);
  const [picking, setPicking] = useState(false);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);

  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null);
  const [ghostPos, setGhostPos] = useState<{ x: number; y: number } | null>(null);
  const [resize, setResize] = useState<ResizeState | null>(null);

  const gridRef = useRef<HTMLDivElement | null>(null);
  const dragPointerId = useRef<number | null>(null);

  const reloadStats = useCallback(() => {
    api.stats().then(setStats);
  }, []);

  useEffect(() => {
    api.dashboard.get().then((l) => setWidgets(l?.widgets?.length ? l.widgets.map(normalize) : defaultLayout()));
    reloadStats();
  }, [reloadStats]);

  // Click outside closes open widget settings
  useEffect(() => {
    if (!settingsFor) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.w-settings, .w-tool')) {
        setSettingsFor(null);
      }
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [settingsFor]);

  /** Every layout change is persisted immediately. */
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

  const toggleWidth = (id: string) => {
    patch(id, (w) => {
      const currentW = w.w ?? 3;
      return {
        ...w,
        w: currentW >= 5 ? 3 : 6,
      };
    });
  };

  const setWidth = (id: string, width: number) => {
    const def = widgetDef(widgets?.find((w) => w.id === id)?.kind ?? '');
    const minW = def?.minW ?? 1;
    patch(id, (w) => ({
      ...w,
      w: clamp(width, minW, COLS),
    }));
  };

  const setHeight = (id: string, height: number) => {
    const def = widgetDef(widgets?.find((w) => w.id === id)?.kind ?? '');
    const minH = def?.minH ?? MIN_H;
    const maxH = def?.maxH ?? MAX_H;
    patch(id, (w) => ({
      ...w,
      h: clamp(height, minH, maxH),
    }));
  };

  const reset = async () => {
    if (!(await ask('Reset the dashboard to its default widgets? Any custom layout will be restored.'))) return;
    await api.dashboard.reset();
    setWidgets(defaultLayout());
    setSettingsFor(null);
  };

  /**
   * Determine drop target in the grid based on DOM bounding rects.
   * Does NOT mutate state or layout while dragging, preventing jumpy oscillations.
   */
  const computeDropTarget = useCallback(
    (clientX: number, clientY: number, excludeId: string): { id: string; position: 'before' | 'after' } | null => {
      const container = gridRef.current;
      if (!container) return null;
      const kids = Array.from(container.querySelectorAll<HTMLElement>('[data-wid]')).filter(
        (el) => el.dataset.wid !== excludeId
      );

      if (kids.length === 0) return null;

      let closestId: string | null = null;
      let closestDist = Infinity;
      let position: 'before' | 'after' = 'after';

      for (let i = 0; i < kids.length; i++) {
        const el = kids[i];
        const id = el.dataset.wid;
        if (!id) continue;

        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;

        if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
          return {
            id,
            position: clientX < cx ? 'before' : 'after',
          };
        }

        const dx = clientX - cx;
        const dy = (clientY - cy) * 1.5;
        const dist = dx * dx + dy * dy;

        if (dist < closestDist) {
          closestDist = dist;
          closestId = id;
          position = clientX < cx ? 'before' : 'after';
        }
      }

      if (!closestId) return null;
      return { id: closestId, position };
    },
    []
  );

  /* --- Dragging logic --- */

  const startDrag = (w: DashWidget, e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragPointerId.current = e.pointerId;
    setDragId(w.id);
    setGhostPos({ x: e.clientX, y: e.clientY });
    setDropTarget(computeDropTarget(e.clientX, e.clientY, w.id));
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
        setDropTarget(computeDropTarget(e.clientX, e.clientY, dragId));
      });
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== dragPointerId.current) return;
      const target = dropTarget;
      if (target && dragId) {
        setWidgets((list) => {
          if (!list) return list;
          const fromIndex = list.findIndex((w) => w.id === dragId);
          const toIndex = list.findIndex((w) => w.id === target.id);
          if (fromIndex === -1 || toIndex === -1) return list;

          const item = list[fromIndex];
          const without = list.filter((w) => w.id !== dragId);
          let targetIndex = without.findIndex((w) => w.id === target.id);
          if (targetIndex !== -1) {
            if (target.position === 'after') {
              targetIndex += 1;
            }
            const next = [...without];
            next.splice(targetIndex, 0, item);
            api.dashboard.save({ widgets: next });
            return next;
          }
          return list;
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
  }, [dragId, dropTarget, computeDropTarget]);

  /* --- Resizing logic (2D corner width + height & bottom height) --- */

  const startResize = (w: DashWidget, mode: 'corner' | 'bottom', e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const def = widgetDef(w.kind);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setSettingsFor(null);
    const currentW = w.w ?? def?.defaultW ?? 3;
    const currentH = w.h ?? def?.defaultH ?? 2;
    setResize({
      id: w.id,
      mode,
      startW: currentW,
      startH: currentH,
      startX: e.clientX,
      startY: e.clientY,
      minW: def?.minW ?? 1,
      maxW: COLS,
      minH: def?.minH ?? MIN_H,
      maxH: def?.maxH ?? MAX_H,
      pointerId: e.pointerId,
    });
  };

  useEffect(() => {
    if (!resize) return;
    const colUnit = ((gridRef.current?.clientWidth ?? 900) + GAP) / COLS;
    const rowUnit = ROW_H + GAP;

    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== resize.pointerId) return;
      const deltaX = e.clientX - resize.startX;
      const deltaY = e.clientY - resize.startY;

      let newW = resize.startW;
      if (resize.mode === 'corner') {
        const deltaW = Math.round(deltaX / colUnit);
        newW = clamp(resize.startW + deltaW, resize.minW, resize.maxW);
      }

      const deltaH = Math.round(deltaY / rowUnit);
      const newH = clamp(resize.startH + deltaH, resize.minH, resize.maxH);

      setWidgets((list) =>
        list ? list.map((x) => (x.id === resize.id && (x.w !== newW || x.h !== newH) ? { ...x, w: newW, h: newH } : x)) : list
      );
    };

    const onEnd = (e: PointerEvent) => {
      if (e.pointerId !== resize.pointerId) return;
      setResize(null);
      setWidgets((list) => {
        if (list) api.dashboard.save({ widgets: list });
        return list;
      });
    };

    document.body.style.cursor = resize.mode === 'corner' ? 'nwse-resize' : 'ns-resize';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    return () => {
      document.body.style.cursor = '';
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
  }, [resize]);

  const dash = useMemo(() => ({ stats, reloadStats, edit }), [stats, reloadStats, edit]);

  if (!widgets) return <div className="dash" />;

  const used = new Set(widgets.map((w) => w.kind));
  const draggedDef = dragId ? widgetDef(widgets.find((w) => w.id === dragId)?.kind ?? '') : null;

  return (
    <div className={'dash' + (edit ? ' editing' : '')}>
      <div className="dash-bar">
        <PageActions>
          {edit ? (
            <>
              <span className="dash-tip">Drag to place anywhere · pull corner or bottom to resize</span>
              <button className="btn subtle" onClick={() => setPicking(true)}>
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
        </PageActions>
      </div>

      <DashDataCtx.Provider value={dash}>
        <div className="dash-grid" ref={gridRef}>
          {widgets.map((w) => (
            <WidgetFrame
              key={w.id}
              w={w}
              edit={edit}
              dragging={dragId === w.id}
              dropIndicator={dropTarget?.id === w.id ? dropTarget.position : null}
              resizing={resize?.id === w.id}
              types={types}
              settingsOpen={settingsFor === w.id}
              onRemove={() => remove(w.id)}
              onToggleSettings={() => setSettingsFor((id) => (id === w.id ? null : w.id))}
              onToggleWidth={() => toggleWidth(w.id)}
              onSetWidth={(width) => setWidth(w.id, width)}
              onSetHeight={(height) => setHeight(w.id, height)}
              onConfig={(p) => patch(w.id, (x) => ({ ...x, config: { ...x.config, ...p } }))}
              onDragStart={(e) => startDrag(w, e)}
              onResizeStart={(mode, e) => startResize(w, mode, e)}
            />
          ))}
        </div>

        {edit && (
          <button className="dash-add-bar" onClick={() => setPicking(true)}>
            <Icon name="plus" size={15} /> Add widget to dashboard
          </button>
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

      {picking && <WidgetPicker types={types} used={used} onPick={add} onClose={() => setPicking(false)} />}
    </div>
  );
}

