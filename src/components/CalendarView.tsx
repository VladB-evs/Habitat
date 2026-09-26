import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { ask } from '../confirm';
import { objectChanged, onObjectChanged } from '../objects';
import { useLayout } from '../layout';
import { useApp } from '../store';
import type { CalEntry, ObjType } from '../types';
import { addDays, fmtMonthYear, keyOf, monthCells, monthStartKey, todayKey, typeColor } from '../util';
import { Icon } from './Icons';
import { RepeatField } from './RepeatField';
import { SplitControls } from './SplitControls';

/** One row per hour. 56px is enough for a title and a time on one line. */
const HOUR_H = 56;
const DAY_MINUTES = 24 * 60;
/** Matches the hour gutter in `.cal-body`'s grid template. */
const GUTTER = 56;
/** Quarter-hour snapping: fine enough to be exact, coarse enough to hit. */
const SNAP = 15;
/** How far the pointer must travel before a press counts as a drag and not a click. */
const DRAG_SLOP = 4;
const MIN_MINUTES = 15;
const NEW_MINUTES = 60;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const snapTo = (m: number) => Math.round(m / SNAP) * SNAP;

/** Where a pointer is on the grid, in days across and minutes down. */
function gridPoint(e: { clientX: number; clientY: number }, body: HTMLElement, dayCount: number) {
  const r = body.getBoundingClientRect();
  const colW = (r.width - GUTTER) / dayCount;
  return {
    dayIndex: clamp(Math.floor((e.clientX - r.left - GUTTER) / colW), 0, dayCount - 1),
    minute: clamp(((e.clientY - r.top) / r.height) * DAY_MINUTES, 0, DAY_MINUTES),
  };
}

/** A type can be created on the grid if it has somewhere to keep the time. */
const schedulable = (types: ObjType[]) => types.filter((t) => t.properties.some((p) => p.kind === 'datetime'));

/** What a drag is provisionally doing, before it's committed. */
interface Preview {
  id: string;
  dayKey: string;
  startMinute: number | null;
  minutes: number | null;
  /**
   * The day the entry was grabbed on. Every occurrence of a series shares one
   * id, so this is what tells them apart — which one is being dragged, and which
   * day the write should take out of the series.
   */
  from: string;
  repeats: boolean;
}

/** The one entry a drag is holding: same object, same day it started on. */
const isDragged = (e: CalEntry, p: Preview | null) => !!p && p.id === e.id && p.from === e.dayKey;

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const hourLabel = (h: number) =>
  new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' }).replace(/\s/g, '');

/** Monday-start week containing `key`. */
function weekDays(key: string): string[] {
  const d = new Date(key + 'T12:00:00');
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(monday);
    x.setDate(monday.getDate() + i);
    return keyOf(x);
  });
}

/**
 * Overlapping entries share the width of their column instead of hiding each
 * other: anything whose span touches an earlier one joins its cluster, and the
 * cluster splits evenly. Enough for a normal day without a full interval-graph
 * colouring.
 */
function layout(entries: CalEntry[]) {
  const sorted = [...entries].sort((a, b) => (a.startMinute ?? 0) - (b.startMinute ?? 0));
  const placed: { entry: CalEntry; col: number; of: number }[] = [];
  let cluster: CalEntry[] = [];
  let clusterEnd = -1;

  const flush = () => {
    cluster.forEach((entry, i) => placed.push({ entry, col: i, of: cluster.length }));
    cluster = [];
    clusterEnd = -1;
  };

  for (const e of sorted) {
    const start = e.startMinute ?? 0;
    const end = start + (e.minutes ?? 60);
    if (cluster.length && start >= clusterEnd) flush();
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();
  return placed;
}

/**
 * Which days the grid is showing, and how it is stepped. Held outside the grid
 * so the Tasks page can put the controls in its own header while the grid, the
 * arrows and the Today button all still move together.
 */
export type CalMode = 'day' | 'week' | 'month';

export interface CalendarNav {
  mode: CalMode;
  setMode: (m: CalMode) => void;
  anchor: string;
  setAnchor: (key: string) => void;
  /** Forward or back by one day, one week or one month, whichever is being shown. */
  step: (n: number) => void;
}

export function useCalendarNav(): CalendarNav {
  const [mode, setMode] = useState<CalMode>('month');
  const [anchor, setAnchor] = useState(todayKey());

  const step = (n: number) =>
    setAnchor(mode === 'month' ? monthStartKey(anchor, n) : addDays(anchor, mode === 'week' ? n * 7 : n));

  return { mode, setMode, anchor, setAnchor, step };
}

/**
 * The time grid. Lives inside the Tasks page, which owns the one page header
 * both its modes share — hence `chrome`: with it off the grid draws itself and
 * nothing else, and the day/week switch and the date arrows are driven from
 * outside through `nav`.
 */
export function CalendarView({ chrome = true, nav }: { chrome?: boolean; nav?: CalendarNav }) {
  const { openFrom, types, theme } = useApp();
  const own = useCalendarNav();
  const { mode, setMode: setModeSaved, anchor, setAnchor, step } = nav ?? own;
  const [entries, setEntries] = useState<CalEntry[]>([]);
  const gridRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const prevMode = useRef<CalMode | null>(null);
  const prevAnchor = useRef<string | null>(null);

  const [preview, setPreview] = useState<Preview | null>(null);
  const [draft, setDraft] = useState<{ dayKey: string; startMinute: number; minutes: number } | null>(null);
  const [composer, setComposer] = useState<{ left: number; top: number } | null>(null);

  /** Live state of the gesture in flight. A ref, because pointermove must not re-bind. */
  const gesture = useRef<{
    kind: 'move' | 'resize' | 'allday' | 'new';
    id?: string;
    /** Minutes between the event's start and where it was grabbed, so it doesn't jump. */
    grab?: number;
    anchorMinute?: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);
  /** Read by the click handler to tell a drag apart from a tap on the same element. */
  const justDragged = useRef(false);

  const days = useMemo(() => (mode === 'week' ? weekDays(anchor) : [anchor]), [mode, anchor]);
  // The month grid always shows 42 cells, including the tail of the previous
  // month and the head of the next — entries for those need fetching too, or
  // the edge weeks would look empty even when they aren't.
  const monthCellsList = useMemo(() => (mode === 'month' ? monthCells(anchor) : []), [mode, anchor]);
  const rangeStart = mode === 'month' ? monthCellsList[0].key : days[0];
  const rangeEnd = mode === 'month' ? monthCellsList[monthCellsList.length - 1].key : days[days.length - 1];
  const colorOf = (typeId: string) => typeColor(types.find((t) => t.id === typeId)?.color, theme);

  const reload = useMemo(() => () => api.calendar(rangeStart, rangeEnd).then(setEntries), [rangeStart, rangeEnd]);

  useEffect(() => {
    let alive = true;
    const load = () => api.calendar(rangeStart, rangeEnd).then((r) => alive && setEntries(r));
    load();
    // Ticking a task or moving a meeting elsewhere shows up here too.
    const off = onObjectChanged(load);
    return () => {
      alive = false;
      off();
    };
  }, [rangeStart, rangeEnd]);

  // One set of window listeners for the whole gesture: the pointer routinely leaves
  // the element it went down on — that's the entire point of dragging.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gesture.current;
      const body = bodyRef.current;
      if (!g || !body) return;
      if (!g.moved && Math.hypot(e.clientX - g.originX, e.clientY - g.originY) < DRAG_SLOP) return;
      g.moved = true;

      const { dayIndex, minute } = gridPoint(e, body, days.length);
      const day = days[dayIndex];

      if (g.kind === 'allday') {
        setPreview((p) => (p ? { ...p, dayKey: day } : p));
      } else if (g.kind === 'new') {
        const from = Math.min(g.anchorMinute!, minute);
        const to = Math.max(g.anchorMinute!, minute);
        const startMinute = snapTo(from);
        setDraft({
          dayKey: day,
          startMinute,
          minutes: Math.max(MIN_MINUTES, snapTo(to - from)),
        });
      } else if (g.kind === 'resize') {
        setPreview((p) =>
          p ? { ...p, minutes: clamp(snapTo(minute - (p.startMinute ?? 0)), MIN_MINUTES, DAY_MINUTES - (p.startMinute ?? 0)) } : p
        );
      } else {
        setPreview((p) => {
          if (!p) return p;
          const mins = p.minutes ?? NEW_MINUTES;
          return { ...p, dayKey: day, startMinute: clamp(snapTo(minute - (g.grab ?? 0)), 0, DAY_MINUTES - mins) };
        });
      }
    };

    const onUp = (e: PointerEvent) => {
      const g = gesture.current;
      gesture.current = null;
      if (!g) return;
      justDragged.current = g.moved;
      // Let the click that follows this pointerup through, then stop suppressing.
      setTimeout(() => (justDragged.current = false), 0);

      if (g.kind === 'new') {
        const body = bodyRef.current;
        if (!body) return setDraft(null);
        const { dayIndex, minute } = gridPoint(e, body, days.length);
        const dayKey = days[dayIndex];
        const from = g.moved ? Math.min(g.anchorMinute!, minute) : minute;
        const to = g.moved ? Math.max(g.anchorMinute!, minute) : minute + NEW_MINUTES;
        const startMinute = clamp(snapTo(from), 0, DAY_MINUTES - MIN_MINUTES);
        setDraft({
          dayKey,
          startMinute,
          minutes: g.moved ? Math.max(MIN_MINUTES, snapTo(to - from)) : NEW_MINUTES,
        });
        setComposer({
          left: clamp(e.clientX + 8, 12, window.innerWidth - 272),
          top: clamp(e.clientY - 40, 12, window.innerHeight - 190),
        });
        return;
      }

      setPreview((p) => {
        if (p && g.moved) {
          const curNow = new Date();
          const curNowMinute = curNow.getHours() * 60 + curNow.getMinutes();
          const isDatePast = p.dayKey < todayKey();
          const isTimePast = p.dayKey === todayKey() && (p.startMinute ?? 0) < curNowMinute;
          const doReschedule = () => {
            // Dragging one occurrence moves only that day; the main process takes
            // it out of the series and hands back the object it became.
            api
              .reschedule({
                id: p.id,
                dayKey: p.dayKey,
                startMinute: p.startMinute,
                minutes: p.minutes,
                occurrence: p.repeats ? p.from : null,
              })
              .then((made) => objectChanged(made?.id ?? p.id))
              .catch((err) => alert(err?.message || 'Failed to reschedule'));
          };
          if (isDatePast || isTimePast) {
            ask(
              isDatePast
                ? `"${p.dayKey}" is in the past. Are you sure you want to reschedule it to the past?`
                : 'This time is in the past. Are you sure you want to reschedule it to the past?',
              {
                title: isDatePast ? 'Date in the past' : 'Time in the past',
                confirmLabel: 'Reschedule anyway',
                danger: false,
              }
            ).then((ok) => {
              if (ok) doReschedule();
            });
            return null;
          }
          doReschedule();
        }
        return null;
      });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [days]);

  const startDrag = (e: React.PointerEvent, kind: 'move' | 'resize' | 'allday', entry: CalEntry) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const body = bodyRef.current;
    if (!body) return;
    const { minute } = gridPoint(e, body, days.length);
    gesture.current = {
      kind,
      id: entry.id,
      grab: minute - (entry.startMinute ?? 0),
      originX: e.clientX,
      originY: e.clientY,
      moved: false,
    };
    setPreview({
      id: entry.id,
      dayKey: entry.dayKey,
      startMinute: entry.startMinute,
      minutes: entry.minutes,
      from: entry.dayKey,
      repeats: entry.repeats,
    });
  };

  const startNew = (e: React.PointerEvent) => {
    if (e.button !== 0 || composer) return;
    const body = bodyRef.current;
    if (!body) return;
    const { minute } = gridPoint(e, body, days.length);
    gesture.current = { kind: 'new', anchorMinute: minute, originX: e.clientX, originY: e.clientY, moved: false };
  };

  const create = async (typeId: string, title: string, repeat: string | null) => {
    if (!draft) return;
    const curNow = new Date();
    const curNowMinute = curNow.getHours() * 60 + curNow.getMinutes();
    const isDatePast = draft.dayKey < todayKey();
    const isTimePast = draft.dayKey === todayKey() && draft.startMinute < curNowMinute;
    if (isDatePast || isTimePast) {
      const ok = await ask(
        isDatePast
          ? `"${draft.dayKey}" is in the past. Are you sure you want to schedule it in the past?`
          : 'This time is in the past. Are you sure you want to schedule it in the past?',
        {
          title: isDatePast ? 'Date in the past' : 'Time in the past',
          confirmLabel: 'Schedule anyway',
          danger: false,
        }
      );
      if (!ok) return;
    }
    const made = await api.scheduleNew({ typeId, title, repeat, ...draft });
    setComposer(null);
    setDraft(null);
    if (made) objectChanged(made.id);
    else reload();
  };

  // Auto-scroll to where the red line / current hour is whenever entering day view,
  // entering week view, or clicking "Today". Paging between weeks preserves current scroll.
  useEffect(() => {
    if (mode === 'month') {
      prevMode.current = 'month';
      prevAnchor.current = anchor;
      return;
    }

    const modeChanged = prevMode.current !== mode;
    const anchorChanged = prevAnchor.current !== anchor;
    const enteredDay = mode === 'day' && (modeChanged || anchorChanged);
    const enteredWeek = mode === 'week' && modeChanged;
    const isToday = anchor === todayKey();

    prevMode.current = mode;
    prevAnchor.current = anchor;

    const shouldScroll = enteredDay || enteredWeek || (isToday && anchorChanged);
    if (!shouldScroll) return;

    let raf1 = 0;
    let raf2 = 0;

    const doScroll = () => {
      const el = gridRef.current;
      if (!el) return;
      const now = new Date();
      const nowMinute = now.getHours() * 60 + now.getMinutes();

      // If the red line (.cal-now) exists in DOM, use its actual offsetTop;
      // otherwise calculate where the current hour sits on the grid.
      const nowEl = el.querySelector('.cal-now') as HTMLElement | null;
      const targetY = nowEl ? nowEl.offsetTop : (nowMinute / 60) * HOUR_H;

      // Position the red line comfortably in the upper portion of the viewport (approx 20-25% down)
      const offset = el.clientHeight > 0 ? Math.min(el.clientHeight * 0.25, 2 * HOUR_H) : 1.5 * HOUR_H;
      const targetScroll = Math.max(0, targetY - offset);

      el.scrollTop = targetScroll;
    };

    // Double rAF ensures the time grid layout and height are computed after mode/day change
    raf1 = requestAnimationFrame(() => {
      raf1 = 0;
      raf2 = requestAnimationFrame(() => {
        raf2 = 0;
        doScroll();
      });
    });

    const timer = setTimeout(doScroll, 60);

    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      clearTimeout(timer);
    };
  }, [mode, anchor]);

  // A drag reads from the same list the server filled, with the moving entry
  // overridden — so the grid shows the new position before the write lands.
  const shown = useMemo(
    () =>
      preview
        ? entries.map((e) =>
            isDragged(e, preview)
              ? { ...e, dayKey: preview.dayKey, startMinute: preview.startMinute, minutes: preview.minutes, allDay: preview.startMinute === null }
              : e
          )
        : entries,
    [entries, preview]
  );

  const allDay = days.map((d) => shown.filter((e) => e.dayKey === d && e.allDay));
  const hasAllDay = allDay.some((list) => list.length > 0);
  const now = new Date();
  const nowMinute = now.getHours() * 60 + now.getMinutes();

  return (
    <div className={'cal-page' + (chrome ? '' : ' bare')}>
      {chrome && (
      <div className="daily-head">
        <span className="month-label">
          {mode === 'day'
            ? new Date(anchor + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
            : fmtMonthYear(anchor)}
        </span>
        <div className="daily-nav">
          <div className="seg mini">
            <button className={mode === 'day' ? 'on' : ''} onClick={() => setModeSaved('day')}>
              Day
            </button>
            <button className={mode === 'week' ? 'on' : ''} onClick={() => setModeSaved('week')}>
              Week
            </button>
            <button className={mode === 'month' ? 'on' : ''} onClick={() => setModeSaved('month')}>
              Month
            </button>
          </div>
          <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous">
            <Icon name="chevron-left" />
          </button>
          <button className="today-btn" onClick={() => setAnchor(todayKey())}>
            Today
          </button>
          <button className="icon-btn" onClick={() => step(1)} aria-label="Next">
            <Icon name="chevron-right" />
          </button>
          <SplitControls />
        </div>
      </div>
      )}

      {mode === 'month' ? (
        <div className="cal-scroll">
          <div className="cal-grid">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="cal-dow">
                {d}
              </div>
            ))}
            {monthCellsList.map((c) => {
              // Sorted so a timed entry leads and an all-day one doesn't crowd
              // out the actual schedule for the day.
              const dayEntries = entries
                .filter((e) => e.dayKey === c.key)
                .sort((a, b) => (a.startMinute ?? DAY_MINUTES) - (b.startMinute ?? DAY_MINUTES));
              const shownEntries = dayEntries.slice(0, 3);
              const more = dayEntries.length - shownEntries.length;
              return (
                <div
                  key={c.key}
                  role="button"
                  tabIndex={0}
                  className={'cal-cell' + (c.inMonth ? '' : ' out') + (c.key === todayKey() ? ' today' : '') + (c.key < todayKey() ? ' past' : '')}
                  onClick={() => {
                    setAnchor(c.key);
                    setModeSaved('day');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setAnchor(c.key);
                      setModeSaved('day');
                    }
                  }}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes('text/habitat-task')) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={async (e) => {
                    if (!e.dataTransfer.types.includes('text/habitat-task')) return;
                    e.preventDefault();
                    const id = e.dataTransfer.getData('text/habitat-task');
                    const due = e.dataTransfer.getData('text/habitat-due');
                    if (due && c.key > due) {
                      alert(`Cannot schedule task past its due date (${due})`);
                      return;
                    }
                    if (c.key < todayKey()) {
                      const ok = await ask(`"${c.key}" is in the past. Are you sure you want to schedule it in the past?`, {
                        title: 'Date in the past',
                        confirmLabel: 'Schedule anyway',
                        danger: false,
                      });
                      if (!ok) return;
                    }
                    if (id) {
                      api
                        .reschedule({ id, dayKey: c.key, startMinute: null })
                        .then((made) => objectChanged(made?.id ?? id))
                        .catch((err) => alert(err?.message || 'Failed to schedule'));
                    }
                  }}
                >
                  <span className="cal-num">{c.day}</span>
                  {dayEntries.length > 0 && (
                    <div className="cal-cell-chips">
                      {shownEntries.map((e) => (
                        <button
                          type="button"
                          key={e.id + e.dayKey}
                          className={'cal-chip clickable' + (e.done ? ' done' : '')}
                          style={{ ['--c' as any]: colorOf(e.typeId) }}
                          title={`${e.title || 'Untitled'} · ${e.typeName}` + (e.repeats ? ' · repeats' : '')}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            openFrom(ev, e.id, e.repeats ? e.dayKey : undefined);
                          }}
                        >
                          {e.title || 'Untitled'}
                        </button>
                      ))}
                      {more > 0 && <span className="cal-more">+{more} more</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {entries.length === 0 && <div className="empty cal-empty">Nothing scheduled this month.</div>}
        </div>
      ) : (
        <>
      <div className="cal-head" style={{ ['--cal-days' as any]: days.length }}>
        <div className="cal-gutter-head" />
        {days.map((d) => {
          const date = new Date(d + 'T12:00:00');
          return (
            <div
              key={d}
              className={
                'cal-day-head' +
                (d === todayKey() ? ' today' : '') +
                (d < todayKey() ? ' past' : '') +
                (mode === 'week' ? ' clickable' : '')
              }
              onClick={() => {
                if (mode === 'week') {
                  setAnchor(d);
                  setModeSaved('day');
                }
              }}
              title={mode === 'week' ? `View ${date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}` : undefined}
            >
              <span className="cal-dow-name">{date.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <span className="cal-day-num">{date.getDate()}</span>
            </div>
          );
        })}
      </div>

      {hasAllDay && (
        <div className="cal-allday" style={{ ['--cal-days' as any]: days.length }}>
          <div className="cal-gutter-head">All day</div>
          {days.map((d, i) => (
            <div
              key={d}
              className="cal-allday-cell"
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('text/habitat-task')) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }}
              onDrop={async (e) => {
                if (!e.dataTransfer.types.includes('text/habitat-task')) return;
                e.preventDefault();
                const id = e.dataTransfer.getData('text/habitat-task');
                const due = e.dataTransfer.getData('text/habitat-due');
                if (due && d > due) {
                  alert(`Cannot schedule task past its due date (${due})`);
                  return;
                }
                if (d < todayKey()) {
                  const ok = await ask(`"${d}" is in the past. Are you sure you want to schedule it in the past?`, {
                    title: 'Date in the past',
                    confirmLabel: 'Schedule anyway',
                    danger: false,
                  });
                  if (!ok) return;
                }
                if (id) {
                  api
                    .reschedule({ id, dayKey: d, startMinute: null })
                    .then((made) => objectChanged(made?.id ?? id))
                    .catch((err) => alert(err?.message || 'Failed to schedule'));
                }
              }}
            >
              {allDay[i].map((e) => (
                <button
                  key={e.id + e.dayKey}
                  className={'cal-chip' + (e.done ? ' done' : '') + (isDragged(e, preview) ? ' dragging' : '')}
                  style={{ ['--c' as any]: colorOf(e.typeId) }}
                  title={`${e.title} · ${e.typeName}` + (e.repeats ? ' · repeats' : '')}
                  onPointerDown={(ev) => startDrag(ev, 'allday', e)}
                  onClick={(ev) => !justDragged.current && openFrom(ev, e.id, e.repeats ? e.dayKey : undefined)}
                >
                  {e.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="cal-scroll" ref={gridRef}>
        <div
          className="cal-body"
          ref={bodyRef}
          style={{ ['--cal-days' as any]: days.length, ['--hour-h' as any]: `${HOUR_H}px` }}
        >
          <div className="cal-gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="cal-hour-label">
                {h > 0 && <span>{hourLabel(h)}</span>}
              </div>
            ))}
          </div>

          {days.map((d) => {
            const timed = shown.filter((e) => e.dayKey === d && !e.allDay);
            const isToday = d === todayKey();
            return (
              <div
                key={d}
                className={'cal-col' + (isToday ? ' today' : '') + (d < todayKey() ? ' past' : '')}
                onPointerDown={startNew}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes('text/habitat-task')) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={async (e) => {
                  if (!e.dataTransfer.types.includes('text/habitat-task')) return;
                  e.preventDefault();
                  const id = e.dataTransfer.getData('text/habitat-task');
                  const due = e.dataTransfer.getData('text/habitat-due');
                  if (!id) return;
                  if (due && d > due) {
                    alert(`Cannot schedule task past its due date (${due})`);
                    return;
                  }
                  const body = bodyRef.current;
                  if (!body) return;
                  const { minute } = gridPoint(e, body, days.length);
                  const startMinute = clamp(snapTo(minute), 0, DAY_MINUTES - 60);
                  const curNow = new Date();
                  const curNowMinute = curNow.getHours() * 60 + curNow.getMinutes();
                  const isDatePast = d < todayKey();
                  const isTimePast = d === todayKey() && startMinute < curNowMinute;
                  if (isDatePast || isTimePast) {
                    const ok = await ask(
                      isDatePast
                        ? `"${d}" is in the past. Are you sure you want to schedule it in the past?`
                        : 'This time is in the past. Are you sure you want to schedule it in the past?',
                      {
                        title: isDatePast ? 'Date in the past' : 'Time in the past',
                        confirmLabel: 'Schedule anyway',
                        danger: false,
                      }
                    );
                    if (!ok) return;
                  }
                  api
                    .reschedule({ id, dayKey: d, startMinute, minutes: 60 })
                    .then((made) => objectChanged(made?.id ?? id))
                    .catch((err) => alert(err?.message || 'Failed to schedule'));
                }}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="cal-hour" />
                ))}

                {isToday && (
                  <div className="cal-now" style={{ top: `calc(${nowMinute / DAY_MINUTES} * 100%)` }} />
                )}

                {draft?.dayKey === d && (
                  <div
                    className="cal-draft"
                    style={{
                      top: `calc(${draft.startMinute / DAY_MINUTES} * 100%)`,
                      height: `calc(${draft.minutes / DAY_MINUTES} * 100%)`,
                    }}
                  >
                    <span className="cal-event-time">{hhmm(draft.startMinute)}</span>
                  </div>
                )}

                {layout(timed).map(({ entry, col, of }) => {
                  const start = entry.startMinute ?? 0;
                  const mins = entry.minutes ?? 60;
                  return (
                    <button
                      key={entry.id + entry.dayKey}
                      className={
                        'cal-event' +
                        (entry.done ? ' done' : '') +
                        (mins <= 30 ? ' tight' : '') +
                        (isDragged(entry, preview) ? ' dragging' : '')
                      }
                      style={{
                        top: `calc(${start / DAY_MINUTES} * 100%)`,
                        height: `calc(${Math.min(mins, DAY_MINUTES - start) / DAY_MINUTES} * 100%)`,
                        left: `calc(${(col / of) * 100}% + 2px)`,
                        width: `calc(${100 / of}% - 4px)`,
                        ['--c' as any]: colorOf(entry.typeId),
                      }}
                      title={`${entry.title} · ${entry.typeName} · ${hhmm(start)}` + (entry.repeats ? ' · repeats' : '')}
                      onPointerDown={(ev) => startDrag(ev, 'move', entry)}
                      onClick={(ev) => !justDragged.current && openFrom(ev, entry.id, entry.repeats ? entry.dayKey : undefined)}
                    >
                      <span className="cal-event-time">
                        {hhmm(start)}
                        {entry.repeats && <Icon name="redo" size={9} />}
                      </span>
                      <span className="cal-event-title">{entry.title}</span>
                      <span
                        className="cal-resize"
                        onPointerDown={(ev) => startDrag(ev, 'resize', entry)}
                        aria-hidden
                      />
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {composer && draft && (
        <Composer
          at={composer}
          draft={draft}
          types={schedulable(types)}
          onCancel={() => {
            setComposer(null);
            setDraft(null);
          }}
          onCreate={create}
        />
      )}

      {entries.length === 0 && !draft && (
        <div className="empty cal-empty">
          Nothing scheduled yet — drag anywhere on the grid to make something, or give a Task a <b>Starts</b> time.
        </div>
      )}
        </>
      )}
    </div>
  );
}

/**
 * The little form a new event is named in. Opens where the drag ended, with the
 * span it drew already filled in — so all that's left is the title.
 */
function Composer({
  at,
  draft,
  types,
  onCancel,
  onCreate,
}: {
  at: { left: number; top: number };
  draft: { dayKey: string; startMinute: number; minutes: number };
  types: ObjType[];
  onCancel: () => void;
  onCreate: (typeId: string, title: string, repeat: string | null) => void;
}) {
  const [title, setTitle] = useState('');
  const [repeat, setRepeat] = useState<string | null>(null);
  // Whatever was scheduled last is nearly always what's being scheduled next.
  const [typeId, setTypeId] = useState(
    () => localStorage.getItem('habitat:cal-type') || types.find((t) => t.id === 'task')?.id || types[0]?.id || ''
  );

  useEffect(() => {
    if (typeId) localStorage.setItem('habitat:cal-type', typeId);
  }, [typeId]);

  if (!types.length) {
    return (
      <>
        <div className="backdrop" onClick={onCancel} />
        <div className="popover cal-composer" style={at}>
          <div className="set-note">
            No type here keeps a time yet. Give one a <b>datetime</b> property and it can be scheduled from the grid.
          </div>
        </div>
      </>
    );
  }

  const submit = () => title.trim() && onCreate(typeId, title, repeat);
  const end = draft.startMinute + draft.minutes;

  return (
    <>
      <div className="backdrop" onClick={onCancel} />
      <div className="popover cal-composer" style={at}>
        <input
          className="popover-search"
          placeholder="What's happening?"
          value={title}
          spellCheck
          autoFocus
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel();
            if (e.key === 'Enter') submit();
          }}
        />
        <div className="cal-composer-when">
          {new Date(draft.dayKey + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}{' '}
          · {hhmm(draft.startMinute)}–{hhmm(end)}
        </div>
        <div className="cal-composer-row">
          <RepeatField value={repeat} onChange={setRepeat} anchor={draft.dayKey} className="wide" />
        </div>
        <div className="cal-composer-row">
          <select className="bulk-field" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button className="btn primary" disabled={!title.trim()} onClick={submit}>
            Create
          </button>
        </div>
      </div>
    </>
  );
}
