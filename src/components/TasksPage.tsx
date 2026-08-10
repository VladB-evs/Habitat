import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { objectChanged, onObjectChanged } from '../objects';
import { useApp } from '../store';
import type { Agenda, AgendaTask } from '../types';
import { fmtMonthYear, todayKey } from '../util';
import { Backlog, DaySection, TaskLine } from './Agenda';
import { CalendarView, useCalendarNav } from './CalendarView';
import { Icon } from './Icons';
import { SplitControls } from './SplitControls';
import { TypeTable } from './TypeTable';

type Mode = 'agenda' | 'calendar' | 'table';

const MODES: [Mode, string, string][] = [
  ['agenda', 'Agenda', 'list'],
  ['calendar', 'Calendar', 'clock'],
  ['table', 'Table', 'table'],
];

/** Three weeks ahead: far enough to plan around, short enough to scroll. */
const HORIZON = 21;

const nothing: Agenda = { days: [], overdue: [], backlog: [] };

/**
 * Everything with a time to it, in one place: the agenda you plan in, the grid
 * you place things on, and the table you sift them in.
 *
 * The agenda is the point. Days run down the page, each with the events that
 * happen on it — a meeting, a flight, a week away, drawn as blocks and holding
 * whatever tasks belong to them — then the loose tasks for that day. What is
 * late sits at the top where it can't be scrolled past, and what has no day yet
 * waits in the backlog, to be dragged onto one.
 */
export function TasksPage() {
  const { navigate } = useApp();
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('habitat:tasks-mode') as Mode) || 'agenda');
  const [agenda, setAgenda] = useState<Agenda>(nothing);
  const [showDone, setShowDone] = useState(false);
  const nav = useCalendarNav();

  const pick = (m: Mode) => {
    setMode(m);
    localStorage.setItem('habitat:tasks-mode', m);
  };

  const load = useCallback(() => api.tasks.agenda(todayKey(), HORIZON).then(setAgenda), []);

  useEffect(() => {
    load();
    // Ticking something on the grid, or on its own page, re-plans this one too.
    return onObjectChanged(load);
  }, [load]);

  const toggle = (t: AgendaTask) => {
    api.tasks.setDone({ id: t.id, dayKey: t.when, done: !t.done }).then(() => objectChanged(t.id));
  };

  /** Dropping a task on a day gives it that day, keeping the hour it already had. */
  const drop = (id: string, dayKey: string, minute: number | null) => {
    api.reschedule({ id, dayKey, startMinute: minute }).then((made) => objectChanged(made?.id ?? id));
  };

  /** Dropped back in the backlog: it loses its day and waits to be planned again. */
  const unschedule = async (id: string) => {
    const obj = await api.objects.get(id);
    if (!obj) return;
    const props = { ...obj.props };
    delete props.due;
    delete props.startsAt;
    delete props.rolled;
    await api.objects.update(id, { props });
    objectChanged(id);
  };

  const addTask = async (title: string, props: Record<string, any> = {}) => {
    const made = await api.objects.create({ typeId: 'task', title, props: { status: 'Todo', ...props } });
    objectChanged(made.id);
  };

  /** A new event opens straight away: only you know when it is and who's coming. */
  const newEvent = async () => {
    const day = mode === 'calendar' ? nav.anchor : todayKey();
    const made = await api.objects.create({
      typeId: 'event',
      title: 'New event',
      props: { startsAt: `${day}T09:00`, endsAt: `${day}T10:00` },
    });
    objectChanged(made.id);
    navigate({ kind: 'object', id: made.id });
  };

  const visible = (list: AgendaTask[]) => list.filter((t) => showDone || !t.done);
  const days = agenda.days.map((d) => ({
    ...d,
    tasks: visible(d.tasks),
    events: d.events.map((e) => ({ ...e, tasks: visible(e.tasks) })),
  }));
  const left = agenda.days.reduce((n, d) => n + d.tasks.filter((t) => !t.done).length, 0) + agenda.overdue.length;

  return (
    <div className="page tasks-page">
      <header className="page-head">
        <div className="page-title">
          <span className="type-emoji big">
            <Icon name="circle-check" size={22} />
          </span>
          <h1>Tasks</h1>
          <span className="count-badge">{left}</span>
        </div>

        <div className="page-actions">
          {mode === 'calendar' && (
            <>
              <span className="month-label cal-when">
                {nav.mode === 'day'
                  ? new Date(nav.anchor + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
                  : fmtMonthYear(nav.anchor)}
              </span>
              <div className="seg mini">
                <button className={nav.mode === 'day' ? 'on' : ''} onClick={() => nav.setMode('day')}>
                  Day
                </button>
                <button className={nav.mode === 'week' ? 'on' : ''} onClick={() => nav.setMode('week')}>
                  Week
                </button>
              </div>
              <button className="icon-btn" onClick={() => nav.step(-1)} aria-label="Previous">
                <Icon name="chevron-left" />
              </button>
              <button className="today-btn" onClick={() => nav.setAnchor(todayKey())}>
                Today
              </button>
              <button className="icon-btn" onClick={() => nav.step(1)} aria-label="Next">
                <Icon name="chevron-right" />
              </button>
            </>
          )}

          {mode === 'agenda' && (
            <button
              className={'btn subtle' + (showDone ? ' on' : '')}
              onClick={() => setShowDone((v) => !v)}
              title={showDone ? 'Hide what is done' : 'Show what is done'}
            >
              <Icon name="check" size={13} /> Done
            </button>
          )}

          <div className="seg mini">
            {MODES.map(([m, label, icon]) => (
              <button key={m} className={mode === m ? 'on' : ''} onClick={() => pick(m)} title={label}>
                <Icon name={icon} size={13} />
                <span className="seg-label">{label}</span>
              </button>
            ))}
          </div>

          <button className="btn primary" onClick={newEvent}>
            <Icon name="plus" size={14} /> Event
          </button>
          <SplitControls />
        </div>
      </header>

      {mode === 'agenda' && (
        <div className="ag-layout">
          <div className="ag-days">
            {agenda.overdue.length > 0 && (
              <section className="ag-day overdue-pile">
                <header className="ag-day-head">
                  <h3>Overdue</h3>
                  <span className="ag-day-date">{agenda.overdue.length} to deal with</span>
                </header>
                <div className="ag-day-body">
                  {agenda.overdue.map((t) => (
                    <TaskLine key={t.id} task={t} onToggle={toggle} />
                  ))}
                </div>
              </section>
            )}

            {days.map((day) => (
              <DaySection
                key={day.dayKey}
                day={day}
                onToggle={toggle}
                onDrop={drop}
                onAdd={(dayKey, title) => addTask(title, { due: dayKey })}
              />
            ))}
          </div>

          <Backlog
            tasks={visible(agenda.backlog)}
            onToggle={toggle}
            onAdd={(title) => addTask(title)}
            onClear={unschedule}
          />
        </div>
      )}

      {mode === 'calendar' && <CalendarView chrome={false} nav={nav} />}
      {mode === 'table' && <TypeTable typeId="task" embedded />}
    </div>
  );
}
