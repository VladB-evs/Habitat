import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { api } from '../api';
import { ask } from '../confirm';
import { dealtIn, stagger } from '../motion';
import { onObjectChanged } from '../objects';
import { parseRule, shortRule } from '../repeat';
import { useApp } from '../store';
import type { Obj } from '../types';
import { fmtMonthYear, monthCells, monthStartKey, todayKey } from '../util';
import { dayHeading } from './Agenda';
import { DateField } from './DateField';
import { Icon } from './Icons';
import { PageActions } from './PageActions';
import { RepeatField } from './RepeatField';
import { SplitControls } from './SplitControls';

type Mode = 'list' | 'month';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/**
 * Recurrence is chosen once, here, and nowhere else — the object itself has
 * no `repeat` property to edit afterward (see events:create in db.js), since
 * every occurrence is already its own real row by the time this closes.
 */
function NewEventModal({
  initialDate,
  onClose,
  onCreated,
}: {
  /** Prefilled when opened by clicking a day in the month grid. */
  initialDate?: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState<string | null>(`${initialDate || todayKey()}T09:00`);
  const [endsAt, setEndsAt] = useState<string | null>(null);
  const [location, setLocation] = useState('');
  const [link, setLink] = useState('');
  const [repeat, setRepeat] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    if (!title.trim() || !startsAt || busy) return;
    setBusy(true);
    setError('');
    let made;
    try {
      made = await api.events.create({
        title: title.trim(),
        startsAt,
        endsAt: endsAt || undefined,
        location: location.trim() || undefined,
        link: link.trim() || undefined,
        repeat,
      });
    } catch (err) {
      // A rejected invoke (an unregistered channel, a main-process throw) used
      // to leave `busy` stuck true forever — the button looked broken with
      // nothing to say why. Now it resets and says so.
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Could not create the event.');
      return;
    }
    setBusy(false);
    onCreated(made.id);
  };

  return (
    <div className="palette-backdrop date-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ev-modal">
        <h3>New event</h3>
        <input
          className="field"
          placeholder="Title"
          autoFocus
          spellCheck
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()}
        />
        <div className="ev-modal-row">
          <label>Starts</label>
          <DateField value={startsAt} onChange={setStartsAt} time />
        </div>
        <div className="ev-modal-row">
          <label>Ends</label>
          <DateField value={endsAt} onChange={setEndsAt} time placeholder="Optional" />
        </div>
        <div className="ev-modal-row">
          <label>Repeats</label>
          <RepeatField value={repeat} onChange={setRepeat} anchor={startsAt} />
        </div>
        <input
          className="field"
          placeholder="Where (optional)"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        <input className="field" placeholder="Link (optional)" value={link} onChange={(e) => setLink(e.target.value)} />
        {error && <div className="s-notice">{error}</div>}
        <div className="popover-actions">
          <button className="btn subtle" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!title.trim() || !startsAt || busy} onClick={create}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Meetings, flights, anything you need to go to or join — its own page, kept
 * off the Tasks calendar/agenda entirely (see the `type_id === 'event'`
 * exclusions in db.js). A recurring one is already every occurrence as its
 * own object by the time it lands here; opening one is the generic object
 * page, unmodified — the body, props and everything else were already
 * generic, all that was missing was somewhere to land.
 */
export function EventsPage() {
  const { openFrom, navigate } = useApp();
  const [events, setEvents] = useState<Obj[] | null>(null);
  const [creating, setCreating] = useState<{ date?: string } | null>(null);
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('habitat:events-mode') as Mode) || 'list');
  const [monthAnchor, setMonthAnchor] = useState(todayKey());

  const pick = (m: Mode) => {
    setMode(m);
    localStorage.setItem('habitat:events-mode', m);
  };

  const reload = () => api.events.list().then(setEvents);

  useEffect(() => {
    reload();
    return onObjectChanged(reload);
  }, []);

  const remove = async (e: Obj) => {
    const partOfSeries = !!e.props.seriesId;
    const msg = partOfSeries
      ? `Delete "${e.title || 'Untitled'}" and every later occurrence in its series? Earlier ones are kept.`
      : `Delete "${e.title || 'Untitled'}"?`;
    if (!(await ask(msg))) return;
    await api.events.deleteSeries(e.id);
    reload();
  };

  /** Every event, by the day its `startsAt` falls on — the month grid needs
   *  past months too, so unlike `upcoming` below this isn't cut off at today. */
  const byDay = useMemo(() => {
    const map = new Map<string, Obj[]>();
    for (const e of events ?? []) {
      const key = String(e.props.startsAt || '').slice(0, 10);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    for (const list of map.values()) list.sort((a, b) => String(a.props.startsAt).localeCompare(String(b.props.startsAt)));
    return map;
  }, [events]);

  const upcoming = useMemo(() => {
    const today = todayKey();
    return [...byDay.entries()].filter(([key]) => key >= today).sort(([a], [b]) => a.localeCompare(b));
  }, [byDay]);

  const total = upcoming.reduce((n, [, list]) => n + list.length, 0);
  const today = todayKey();

  return (
    <div className="page events-page">
      <header className="page-head">
        <div className="page-title">
          <span className="type-emoji big">
            <Icon name="calendar-clock" size={22} />
          </span>
          <h1>Events</h1>
          <span className="count-badge">{total}</span>
        </div>
        <PageActions>
          <div className="page-actions">
            {mode === 'month' && (
              <>
                <span className="month-label">{fmtMonthYear(monthAnchor)}</span>
                <button className="icon-btn" onClick={() => setMonthAnchor(monthStartKey(monthAnchor, -1))} aria-label="Previous month">
                  <Icon name="chevron-left" />
                </button>
                <button className="today-btn" onClick={() => setMonthAnchor(today)}>
                  Today
                </button>
                <button className="icon-btn" onClick={() => setMonthAnchor(monthStartKey(monthAnchor, 1))} aria-label="Next month">
                  <Icon name="chevron-right" />
                </button>
              </>
            )}
            <div className="seg mini">
              <button className={mode === 'list' ? 'on' : ''} onClick={() => pick('list')}>
                <Icon name="list" size={13} />
                <span className="seg-label">List</span>
              </button>
              <button className={mode === 'month' ? 'on' : ''} onClick={() => pick('month')}>
                <Icon name="calendar" size={13} />
                <span className="seg-label">Month</span>
              </button>
            </div>
            <button className="btn primary" onClick={() => setCreating({})}>
              <Icon name="plus" size={14} /> Event
            </button>
            <SplitControls />
          </div>
        </PageActions>
      </header>

      <div className="ev-body">
      {mode === 'list' ? (
        <div className="ev-list">
          {events && upcoming.length === 0 && (
            <div className="empty">
              Nothing coming up.{' '}
              <button className="link-btn" onClick={() => setCreating({})}>
                Add one
              </button>
              .
            </div>
          )}

          {upcoming.map(([dayKey, list]) => {
            const { label, sub } = dayHeading(dayKey);
            return (
              <section key={dayKey} className="ev-day">
                <header className="ev-day-head">
                  <h3>{label}</h3>
                  <span className="ev-day-date">{sub}</span>
                </header>
                <motion.div className="ev-day-body" variants={stagger} initial="hidden" animate="shown">
                  {list.map((e) => {
                    const rule = parseRule(e.props.seriesRule);
                    return (
                      <motion.div key={e.id} className="ev-row" variants={dealtIn} onClick={(ev) => openFrom(ev, e.id)}>
                        <span className="ev-row-time">{e.props.startsAt ? clock(e.props.startsAt) : 'All day'}</span>
                        <span className="ev-row-title">{e.title || 'Untitled'}</span>
                        {e.props.location && (
                          <span className="ev-row-loc">
                            <Icon name="map-pin" size={11} /> {e.props.location}
                          </span>
                        )}
                        {rule && (
                          <span className="ev-row-repeat" title={shortRule(rule, e.props.startsAt)}>
                            <Icon name="history" size={11} />
                          </span>
                        )}
                        <button
                          className="row-del"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            remove(e);
                          }}
                          aria-label="Delete event"
                        >
                          <Icon name="trash" size={13} />
                        </button>
                      </motion.div>
                    );
                  })}
                </motion.div>
              </section>
            );
          })}
        </div>
      ) : (
        <motion.div className="cal-grid" variants={stagger} initial="hidden" animate="shown">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="cal-dow">
              {d}
            </div>
          ))}
          {monthCells(monthAnchor).map((c) => {
            const list = byDay.get(c.key) ?? [];
            const shown = list.slice(0, 3);
            return (
              <motion.div
                variants={dealtIn}
                key={c.key}
                className={'cal-cell' + (c.inMonth ? '' : ' out') + (c.key === today ? ' today' : '')}
                onClick={() => setCreating({ date: c.key })}
              >
                <span className="cal-num">{c.day}</span>
                {/* Same chip the Tasks page's own month view draws its entries with —
                    `--c` is normally per-type, but Events is one type, so one colour. */}
                <div className="cal-cell-chips">
                  {shown.map((e) => (
                    <button
                      key={e.id}
                      className="cal-chip clickable"
                      style={{ ['--c' as any]: '#4a3aa7' }}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        openFrom(ev, e.id);
                      }}
                    >
                      {e.title || 'Untitled'}
                    </button>
                  ))}
                  {list.length > shown.length && <span className="cal-more">+{list.length - shown.length} more</span>}
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      )}
      </div>

      {creating && (
        <NewEventModal
          initialDate={creating.date}
          onClose={() => setCreating(null)}
          onCreated={(id) => {
            setCreating(null);
            reload();
            navigate({ kind: 'object', id });
          }}
        />
      )}
    </div>
  );
}
