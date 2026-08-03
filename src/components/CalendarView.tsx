import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { onObjectChanged } from '../objects';
import { useApp } from '../store';
import type { CalEntry } from '../types';
import { addDays, fmtMonthYear, keyOf, todayKey, typeColor } from '../util';
import { Icon } from './Icons';
import { SplitControls } from './SplitControls';

/** One row per hour. 56px is enough for a title and a time on one line. */
const HOUR_H = 56;
const DAY_MINUTES = 24 * 60;

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

export function CalendarView() {
  const { openFrom, types, theme } = useApp();
  const [mode, setMode] = useState<'day' | 'week'>(
    () => (localStorage.getItem('habitat:cal-mode') as 'day' | 'week') || 'week'
  );
  const [anchor, setAnchor] = useState(todayKey());
  const [entries, setEntries] = useState<CalEntry[]>([]);
  const gridRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  const days = useMemo(() => (mode === 'week' ? weekDays(anchor) : [anchor]), [mode, anchor]);
  const colorOf = (typeId: string) => typeColor(types.find((t) => t.id === typeId)?.color, theme);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api.calendar(days[0], days[days.length - 1]).then((r) => alive && setEntries(r));
    load();
    // Ticking a task or moving a meeting elsewhere shows up here too.
    const off = onObjectChanged(load);
    return () => {
      alive = false;
      off();
    };
  }, [days]);

  // Open near the current hour rather than at midnight. Deferred a frame on
  // purpose: on the first commit the grid still has no height, so setting
  // scrollTop then does nothing at all. Once only — paging between weeks must
  // not yank the scroll back.
  useEffect(() => {
    if (scrolled.current) return;
    scrolled.current = true;
    const id = requestAnimationFrame(() => {
      const el = gridRef.current;
      if (!el) return;
      const at = new Date();
      el.scrollTop = Math.max(0, ((at.getHours() * 60 + at.getMinutes() - 60) / 60) * HOUR_H);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const setModeSaved = (m: 'day' | 'week') => {
    setMode(m);
    localStorage.setItem('habitat:cal-mode', m);
  };

  const step = (n: number) => setAnchor(addDays(anchor, mode === 'week' ? n * 7 : n));

  const allDay = days.map((d) => entries.filter((e) => e.dayKey === d && e.allDay));
  const hasAllDay = allDay.some((list) => list.length > 0);
  const now = new Date();
  const nowMinute = now.getHours() * 60 + now.getMinutes();

  return (
    <div className="cal-page">
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

      <div className="cal-head" style={{ ['--cal-days' as any]: days.length }}>
        <div className="cal-gutter-head" />
        {days.map((d) => {
          const date = new Date(d + 'T12:00:00');
          return (
            <div key={d} className={'cal-day-head' + (d === todayKey() ? ' today' : '')}>
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
            <div key={d} className="cal-allday-cell">
              {allDay[i].map((e) => (
                <button
                  key={e.id}
                  className={'cal-chip' + (e.done ? ' done' : '')}
                  style={{ ['--c' as any]: colorOf(e.typeId) }}
                  title={`${e.title} · ${e.typeName}`}
                  onClick={(ev) => openFrom(ev, e.id)}
                >
                  {e.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="cal-scroll" ref={gridRef}>
        <div className="cal-body" style={{ ['--cal-days' as any]: days.length, ['--hour-h' as any]: `${HOUR_H}px` }}>
          <div className="cal-gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="cal-hour-label">
                {h > 0 && <span>{hourLabel(h)}</span>}
              </div>
            ))}
          </div>

          {days.map((d) => {
            const timed = entries.filter((e) => e.dayKey === d && !e.allDay);
            const isToday = d === todayKey();
            return (
              <div key={d} className={'cal-col' + (isToday ? ' today' : '')}>
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="cal-hour" />
                ))}

                {isToday && (
                  <div className="cal-now" style={{ top: `calc(${nowMinute / DAY_MINUTES} * 100%)` }} />
                )}

                {layout(timed).map(({ entry, col, of }) => {
                  const start = entry.startMinute ?? 0;
                  const mins = entry.minutes ?? 60;
                  return (
                    <button
                      key={entry.id}
                      className={'cal-event' + (entry.done ? ' done' : '') + (mins <= 30 ? ' tight' : '')}
                      style={{
                        top: `calc(${start / DAY_MINUTES} * 100%)`,
                        height: `calc(${Math.min(mins, DAY_MINUTES - start) / DAY_MINUTES} * 100%)`,
                        left: `calc(${(col / of) * 100}% + 2px)`,
                        width: `calc(${100 / of}% - 4px)`,
                        ['--c' as any]: colorOf(entry.typeId),
                      }}
                      title={`${entry.title} · ${entry.typeName} · ${hhmm(start)}`}
                      onClick={(ev) => openFrom(ev, entry.id)}
                    >
                      <span className="cal-event-time">{hhmm(start)}</span>
                      <span className="cal-event-title">{entry.title}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {entries.length === 0 && (
        <div className="empty cal-empty">
          Nothing scheduled. Give a Task or Meeting a <b>Starts</b> time and it appears here.
        </div>
      )}
    </div>
  );
}
