import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { api } from '../api';
import { objectChanged, onObjectChanged } from '../objects';
import { useLayout } from '../layout';
import { dialogIn, snap } from '../motion';
import { useApp } from '../store';
import type { Agenda, AgendaTask } from '../types';
import { fmtMonthYear, todayKey } from '../util';
import { Backlog, DaySection, TaskLine } from './Agenda';
import { CalendarView, useCalendarNav } from './CalendarView';
import { DateField } from './DateField';
import { Icon } from './Icons';
import { SplitControls } from './SplitControls';
import { PageActions } from './PageActions';
import { Sheet } from './Sheet';
import { TypeTable } from './TypeTable';

type Mode = 'agenda' | 'calendar' | 'board';

const MODES: [Mode, string, string][] = [
  ['agenda', 'Agenda', 'list'],
  ['calendar', 'Calendar', 'clock'],
  ['board', 'Board', 'columns'],
];

const isMode = (v: string | null): v is Mode => v === 'agenda' || v === 'calendar' || v === 'board';

/** Three weeks ahead: far enough to plan around, short enough to scroll. */
const HORIZON = 21;

const nothing: Agenda = { days: [], overdue: [], backlog: [] };

/**
 * Everything with a time to it, in one place: the agenda you plan in, the grid
 * you place things on, and the table you sift them in.
 *
 * The agenda is the point. Days run down the page, each with that day's tasks
 * — a meeting, a flight, a plain to-do, all one type, ticked off the same way
 * — then anything else that type happens to hold (like a Meeting) drawn as a
 * block above them. What is late sits at the top where it can't be scrolled
 * past, and what has no day yet waits in the backlog, to be dragged onto one.
 */
export function TasksPage() {
  const { navigate } = useApp();
  const { narrow } = useLayout();
  // A stale 'table' from before Board replaced it (or anything else unrecognised)
  // falls back to Agenda rather than rendering nothing.
  const [mode, setMode] = useState<Mode>(() => {
    const saved = localStorage.getItem('habitat:tasks-mode');
    return isMode(saved) ? saved : 'agenda';
  });
  const [agenda, setAgenda] = useState<Agenda>(nothing);
  /** The touch-friendly "Schedule for" dialog a backlog task's own button
   *  opens — see Agenda.tsx's Backlog and TaskLine `moveAction`. */
  const [scheduling, setScheduling] = useState<{ id: string; value: string } | null>(null);
  /** On a narrow window the backlog moves into its own sheet instead of
   *  stacking under the days — stacked, it sat right where the bottom nav and
   *  the floating action pill both cover, so its own last rows and the
   *  "add" input were physically unreachable no matter how the page scrolled. */
  const [backlogOpen, setBacklogOpen] = useState(false);
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

  /** A new timed task opens straight away: only you know when it is and who's coming. */
  const newTimedTask = async () => {
    const day = mode === 'calendar' ? nav.anchor : todayKey();
    const made = await api.objects.create({
      typeId: 'task',
      title: 'New task',
      props: { status: 'Todo', startsAt: `${day}T09:00`, endsAt: `${day}T10:00` },
    });
    objectChanged(made.id);
    navigate({ kind: 'object', id: made.id });
  };

  const visible = (list: AgendaTask[]) => list.filter((t) => !t.done);
  const days = agenda.days.map((d) => ({
    ...d,
    tasks: visible(d.tasks),
    events: d.events.map((e) => ({ ...e, tasks: visible(e.tasks) })),
  }));
  const left = agenda.days.reduce((n, d) => n + d.tasks.filter((t) => !t.done).length, 0) + agenda.overdue.length;
  const backlogTasks = visible(agenda.backlog);
  const backlogCount = backlogTasks.length;

  /**
   * Split out so it can render in two different places: inline in the
   * floating action pill on a wide window, or in its own row under the title
   * on a narrow one. Calendar mode alone was crowding that pill with a month
   * label, a Day/Week/Month switch, three step buttons, *and* the page's own
   * Agenda/Calendar/Board switch and Add button all fighting for one
   * horizontally-scrolling strip — this is the half of it that isn't really
   * an "action" so much as it's telling you which day you're looking at.
   */
  const calNav = mode === 'calendar' && (
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
        {/* A phone only ever gets the day view in place of the week — seven
            50px columns are narrower than the text of a single event — but
            month has no such problem, so it stays. */}
        {!narrow && (
          <button className={nav.mode === 'week' ? 'on' : ''} onClick={() => nav.setMode('week')}>
            Week
          </button>
        )}
        <button className={nav.mode === 'month' ? 'on' : ''} onClick={() => nav.setMode('month')}>
          Month
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
  );

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

        <PageActions>
        <div className="page-actions">
          {!narrow && calNav}

          {/* On a wide window the backlog sits beside the days, always visible.
              Narrow has no room for that, and stacking it below the days put its
              own last rows behind the bottom nav and this very pill with no way
              to scroll past them — a sheet gives it the room instead. */}
          {narrow && mode === 'agenda' && (
            <button className="btn subtle" onClick={() => setBacklogOpen(true)}>
              <Icon name="list" size={13} /> Backlog
              {backlogCount > 0 && <span className="count-badge">{backlogCount}</span>}
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

          <button className="btn primary" onClick={newTimedTask}>
            <Icon name="plus" size={14} /> Task
          </button>
          <SplitControls />
        </div>
        </PageActions>
      </header>

      {narrow && calNav && <div className="tasks-cal-nav">{calNav}</div>}

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
                    <TaskLine
                      key={t.id}
                      task={t}
                      onToggle={toggle}
                      moveAction={{ icon: 'list', label: 'Move to backlog', onClick: () => unschedule(t.id) }}
                    />
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
                onUnschedule={unschedule}
              />
            ))}
          </div>

          {!narrow && (
            <Backlog
              tasks={backlogTasks}
              onToggle={toggle}
              onAdd={(title) => addTask(title)}
              onClear={unschedule}
              onSchedule={(id) => setScheduling({ id, value: todayKey() })}
            />
          )}
        </div>
      )}

      {mode === 'calendar' && <CalendarView chrome={false} nav={nav} />}
      {mode === 'board' && <TypeTable typeId="task" embedded embeddedMode="board" />}

      {narrow && (
        <Sheet open={backlogOpen} onClose={() => setBacklogOpen(false)}>
          <Backlog
            tasks={backlogTasks}
            onToggle={toggle}
            onAdd={(title) => addTask(title)}
            onClear={unschedule}
            onSchedule={(id) => {
              setBacklogOpen(false);
              setScheduling({ id, value: todayKey() });
            }}
            // Picking a task up to drag it is the same signal as picking
            // "Schedule" — either way you're about to give it a day, and the
            // days themselves are sitting right behind this sheet, covered by
            // it. Closing on pickup (rather than on drop) is what makes them
            // droppable at all instead of just visible once you let go.
            onDragStart={() => setBacklogOpen(false)}
          />
        </Sheet>
      )}

      {scheduling && (
        <motion.div
          className="palette-backdrop date-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && setScheduling(null)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={snap}
        >
          <motion.div className="date-prompt" variants={dialogIn} initial="hidden" animate="shown">
            <h3>Schedule for</h3>
            <DateField
              value={scheduling.value}
              placeholder="Pick a day…"
              onChange={(v) => setScheduling({ ...scheduling, value: v ?? '' })}
            />
            <div className="popover-actions">
              <button className="btn subtle" onClick={() => setScheduling(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={!scheduling.value}
                onClick={() => {
                  drop(scheduling.id, scheduling.value, null);
                  setScheduling(null);
                }}
              >
                Schedule
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}
