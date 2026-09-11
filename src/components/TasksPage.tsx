import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { api } from '../api';
import { objectChanged, onObjectChanged } from '../objects';
import { useLayout } from '../layout';
import { dialogIn, snap } from '../motion';
import { useApp } from '../store';
import type { Agenda, AgendaTask } from '../types';
import { fmtMonthYear, todayKey } from '../util';
import { Backlog, EventBlock, TaskLine, dayHeading } from './Agenda';
import { CalendarView, useCalendarNav } from './CalendarView';
import { DateField } from './DateField';
import { Icon } from './Icons';
import { PageActions } from './PageActions';
import { SplitControls } from './SplitControls';
import { TypeTable } from './TypeTable';

type Mode = 'schedule' | 'calendar' | 'board';

const MODES: [Mode, string, string][] = [
  ['schedule', 'Tasks', 'circle-check'],
  ['calendar', 'Calendar', 'calendar-clock'],
  ['board', 'Board', 'columns'],
];

const isMode = (v: string | null): v is Mode =>
  v === 'schedule' || v === 'calendar' || v === 'board';

/** Two weeks ahead for upcoming planning. */
const HORIZON = 14;

const nothing: Agenda = { days: [], overdue: [], backlog: [] };

function DayCard({
  day,
  isToday,
  expanded,
  onToggleExpand,
  draft,
  onDraftChange,
  onAdd,
  onToggleTask,
  onUnscheduleTask,
  onDropTask,
  isDragOver,
  onDragOverChange,
  overdueTasks,
  overdueExpanded,
  onToggleOverdue,
  onRescheduleAllOverdue,
  onMoveAllOverdueToBacklog,
  showCompleted,
  onToggleCompleted,
}: {
  day: Agenda['days'][0];
  isToday: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  draft: string;
  onDraftChange: (v: string) => void;
  onAdd: (title: string) => void;
  onToggleTask: (t: AgendaTask) => void;
  onUnscheduleTask: (id: string) => void;
  onDropTask: (id: string, dayKey: string, minute: number | null) => void;
  isDragOver: boolean;
  onDragOverChange: (over: boolean) => void;
  overdueTasks: AgendaTask[];
  overdueExpanded: boolean;
  onToggleOverdue: () => void;
  onRescheduleAllOverdue: () => void;
  onMoveAllOverdueToBacklog: () => void;
  showCompleted: boolean;
  onToggleCompleted: () => void;
}) {
  const { label, sub } = dayHeading(day.dayKey);
  const fullDate = new Date(day.dayKey + 'T12:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
  const activeTasks = day.tasks.filter((t) => !t.done);
  const doneTasks = day.tasks.filter((t) => t.done);
  const totalTasks = day.tasks.length;
  const pct = totalTasks > 0 ? Math.round((doneTasks.length / totalTasks) * 100) : 0;

  if (expanded) {
    return (
      <div
        className={'tasks-day-card expanded' + (isToday ? ' today' : '') + (isDragOver ? ' over' : '')}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('text/habitat-task')) return;
          e.preventDefault();
          onDragOverChange(true);
        }}
        onDragLeave={() => onDragOverChange(false)}
        onDrop={(e) => {
          e.preventDefault();
          onDragOverChange(false);
          const id = e.dataTransfer.getData('text/habitat-task');
          const raw = e.dataTransfer.getData('text/habitat-minute');
          const due = e.dataTransfer.getData('text/habitat-due');
          if (!id) return;
          if (due && day.dayKey > due) {
            alert(`Cannot schedule task past its due date (${due})`);
            return;
          }
          if (day.dayKey < todayKey()) {
            alert(`Cannot schedule in the past (${day.dayKey})`);
            return;
          }
          onDropTask(id, day.dayKey, raw ? Number(raw) : null);
        }}
      >
        <div className="tasks-day-head" onClick={onToggleExpand}>
          <div className="tasks-day-title-group">
            <button
              className="tasks-day-chevron"
              aria-label="Collapse day"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand();
              }}
            >
              <Icon name="chevron-down" size={13} />
            </button>
            <h3 className="tasks-day-label">{label}</h3>
            <span className="tasks-day-full-date">{fullDate}</span>
          </div>

          <div className="tasks-day-head-right" onClick={(e) => e.stopPropagation()}>
            {totalTasks > 0 && (
              <div className="tasks-today-progress" title={`${doneTasks.length} of ${totalTasks} tasks done (${pct}%)`}>
                <span className="tasks-progress-text">
                  {doneTasks.length}/{totalTasks} done
                </span>
                <div className="tasks-progress-bar">
                  <div className="tasks-progress-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>

        {isToday && overdueTasks.length > 0 && (
          <div className="tasks-overdue-banner">
            <div className="tasks-overdue-head" onClick={onToggleOverdue}>
              <div className="tasks-overdue-label">
                <Icon name="history" size={14} />
                <span>
                  {overdueTasks.length} overdue task{overdueTasks.length > 1 ? 's' : ''}
                </span>
              </div>
              <div className="tasks-overdue-actions" onClick={(e) => e.stopPropagation()}>
                <button className="btn subtle mini" onClick={onRescheduleAllOverdue}>
                  To Today
                </button>
                <button className="btn subtle mini" onClick={onMoveAllOverdueToBacklog}>
                  To Backlog
                </button>
                <button className="icon-btn mini" onClick={onToggleOverdue} aria-label="Toggle overdue">
                  <Icon name={overdueExpanded ? 'chevron-down' : 'chevron-right'} size={12} />
                </button>
              </div>
            </div>

            {overdueExpanded && (
              <div className="tasks-overdue-list">
                {overdueTasks.map((t) => (
                  <TaskLine
                    key={t.id}
                    task={t}
                    onToggle={onToggleTask}
                    actions={[
                      { icon: 'sun', label: 'Today', onClick: () => onDropTask(t.id, day.dayKey, null) },
                      { icon: 'list', label: 'Backlog', onClick: () => onUnscheduleTask(t.id) },
                    ]}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        <div className="tasks-quick-add">
          <span className="tick ghost">
            <Icon name="plus" size={12} />
          </span>
          <input
            className="tasks-quick-input"
            placeholder={`Add task for ${label.toLowerCase()}… (press Enter)`}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && draft.trim()) {
                onAdd(draft.trim());
              }
            }}
          />
        </div>

        {day.events.length > 0 && (
          <div className="tasks-today-events">
            <div className="tasks-section-label">
              <Icon name="calendar-clock" size={12} />
              <span>{isToday ? "Today's Events" : 'Scheduled Events'}</span>
            </div>
            {day.events.map((ev) => (
              <EventBlock key={ev.id + ev.dayKey} event={ev} onToggle={onToggleTask} />
            ))}
          </div>
        )}

        <div className="tasks-list">
          {activeTasks.length === 0 && day.events.length === 0 && (!isToday || overdueTasks.length === 0) && (
            <div className="tasks-empty-hint small">
              <p>No tasks scheduled for {isToday ? 'today' : label.toLowerCase()}.</p>
            </div>
          )}

          {activeTasks.map((t) => (
            <TaskLine
              key={t.id}
              task={t}
              onToggle={onToggleTask}
              moveAction={{ icon: 'list', label: 'Backlog', onClick: () => onUnscheduleTask(t.id) }}
            />
          ))}

          {doneTasks.length > 0 && (
            <div className="tasks-done-section">
              <button className="tasks-done-toggle" onClick={onToggleCompleted}>
                <Icon name={showCompleted ? 'chevron-down' : 'chevron-right'} size={11} />
                <span>Completed ({doneTasks.length})</span>
              </button>
              {showCompleted && (
                <div className="tasks-done-list">
                  {doneTasks.map((t) => (
                    <TaskLine key={t.id} task={t} onToggle={onToggleTask} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={'tasks-day-card collapsed' + (isToday ? ' today' : '') + (isDragOver ? ' over' : '')}
      onClick={onToggleExpand}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('text/habitat-task')) return;
        e.preventDefault();
        onDragOverChange(true);
      }}
      onDragLeave={() => onDragOverChange(false)}
      onDrop={(e) => {
        e.preventDefault();
        onDragOverChange(false);
        const id = e.dataTransfer.getData('text/habitat-task');
        const raw = e.dataTransfer.getData('text/habitat-minute');
        const due = e.dataTransfer.getData('text/habitat-due');
        if (!id) return;
        if (due && day.dayKey > due) {
          alert(`Cannot schedule task past its due date (${due})`);
          return;
        }
        if (day.dayKey < todayKey()) {
          alert(`Cannot schedule in the past (${day.dayKey})`);
          return;
        }
        if (id) onDropTask(id, day.dayKey, raw ? Number(raw) : null);
      }}
    >
      <div className="tasks-day-head collapsed">
        <div className="tasks-day-title-group">
          <span className="tasks-day-chevron">
            <Icon name="chevron-right" size={13} />
          </span>
          <h3 className="tasks-day-label">{label}</h3>
          <span className="tasks-day-sub-date">{sub}</span>
        </div>

        <div className="tasks-day-summary">
          {day.events.length > 0 && (
            <span className="tasks-badge event">
              <Icon name="calendar-clock" size={11} />
              {day.events.length} {day.events.length === 1 ? 'event' : 'events'}
            </span>
          )}
          {activeTasks.length > 0 && (
            <span className="tasks-badge task">
              {activeTasks.length} {activeTasks.length === 1 ? 'task' : 'tasks'}
            </span>
          )}
          {totalTasks > 0 && activeTasks.length === 0 && (
            <span className="tasks-badge done">
              <Icon name="check" size={11} /> all done
            </span>
          )}
          {totalTasks === 0 && day.events.length === 0 && (
            <span className="tasks-day-empty-label">empty</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function TasksPage() {
  const { navigate } = useApp();
  const { narrow } = useLayout();

  const [mode, setMode] = useState<Mode>(() => {
    const saved = localStorage.getItem('habitat:tasks-mode');
    if (saved === 'focus' || saved === 'upcoming') return 'schedule';
    return isMode(saved) ? saved : 'schedule';
  });

  const [mobileTab, setMobileTab] = useState<'schedule' | 'backlog' | 'calendar'>('schedule');
  const calNav = useCalendarNav();
  const [agenda, setAgenda] = useState<Agenda>(nothing);
  const [scheduling, setScheduling] = useState<{ id: string; value: string; due?: string | null } | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(() => new Set([todayKey()]));
  const [dayDrafts, setDayDrafts] = useState<Record<string, string>>({});
  const [backlogDraft, setBacklogDraft] = useState('');
  const [backlogOver, setBacklogOver] = useState(false);
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);
  const [overdueExpanded, setOverdueExpanded] = useState(true);
  const [completedOpen, setCompletedOpen] = useState<Set<string>>(() => new Set());

  const pick = (m: Mode) => {
    setMode(m);
    localStorage.setItem('habitat:tasks-mode', m);
    if (m === 'calendar') {
      calNav.setMode('month');
    }
  };

  const load = useCallback(() => api.tasks.agenda(todayKey(), HORIZON).then(setAgenda), []);

  useEffect(() => {
    load();
    return onObjectChanged(load);
  }, [load]);

  const toggle = (t: AgendaTask) => {
    api.tasks.setDone({ id: t.id, dayKey: t.when, done: !t.done }).then(() => objectChanged(t.id));
  };

  const drop = (id: string, dayKey: string, minute: number | null) => {
    const today = todayKey();
    if (dayKey < today) {
      alert(`Cannot schedule in the past (${dayKey})`);
      return;
    }
    if (dayKey === today && minute !== null) {
      const now = new Date();
      const nowMinute = now.getHours() * 60 + now.getMinutes();
      if (minute < nowMinute) {
        alert('Cannot schedule before current time today');
        return;
      }
    }
    const allTasks = [...agenda.backlog, ...agenda.overdue, ...agenda.days.flatMap((d) => d.tasks)];
    const t = allTasks.find((x) => x.id === id);
    if (t?.due && dayKey > t.due) {
      alert(`Cannot schedule task past its due date (${t.due})`);
      return;
    }
    api.reschedule({ id, dayKey, startMinute: minute })
      .then((made) => objectChanged(made?.id ?? id))
      .catch((err) => alert(err?.message || 'Failed to schedule'));
  };

  const unschedule = async (id: string) => {
    const obj = await api.objects.get(id);
    if (!obj) return;
    const props = { ...obj.props };
    delete props.doing;
    delete props.startsAt;
    delete props.endsAt;
    delete props.duration;
    delete props.rolled;
    // NOTE: props.due is preserved!
    await api.objects.update(id, { props });
    objectChanged(id);
  };

  const addTask = async (title: string, props: Record<string, any> = {}) => {
    if (!title.trim()) return;
    const made = await api.objects.create({ typeId: 'task', title: title.trim(), props: { status: 'Todo', ...props } });
    objectChanged(made.id);
  };

  const newTimedTask = async () => {
    const day = todayKey();
    const made = await api.objects.create({
      typeId: 'task',
      title: 'New task',
      props: { status: 'Todo', startsAt: `${day}T09:00`, endsAt: `${day}T10:00` },
    });
    objectChanged(made.id);
    navigate({ kind: 'object', id: made.id });
  };

  const rescheduleAllOverdueToToday = async () => {
    const today = todayKey();
    for (const t of agenda.overdue) {
      if (t.due && today > t.due) {
        continue;
      }
      try {
        await api.reschedule({ id: t.id, dayKey: today, startMinute: null });
        objectChanged(t.id);
      } catch {
        // skip if deadline was exceeded
      }
    }
  };

  const moveAllOverdueToBacklog = async () => {
    for (const t of agenda.overdue) {
      await unschedule(t.id);
    }
  };

  const toggleDayExpanded = (dayKey: string) => {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(dayKey)) next.delete(dayKey);
      else next.add(dayKey);
      return next;
    });
  };

  const toggleCompleted = (dayKey: string) => {
    setCompletedOpen((prev) => {
      const next = new Set(prev);
      if (next.has(dayKey)) next.delete(dayKey);
      else next.add(dayKey);
      return next;
    });
  };

  const setDayDraft = (dayKey: string, text: string) =>
    setDayDrafts((prev) => ({ ...prev, [dayKey]: text }));

  // Today's day data
  const today = todayKey();
  const todayDay = agenda.days.find((d) => d.dayKey === today) || { dayKey: today, events: [], tasks: [] };
  const todayActiveTasks = todayDay.tasks.filter((t) => !t.done);
  const backlogTasks = agenda.backlog.filter((t) => !t.done);
  const overdueTasks = agenda.overdue;
  const totalActive = todayActiveTasks.length + overdueTasks.length + backlogTasks.length;

  const calNavControls = (
    <>
      <span className="month-label cal-when">
        {calNav.mode === 'day'
          ? new Date(calNav.anchor + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
          : fmtMonthYear(calNav.anchor)}
      </span>
      <div className="seg mini">
        <button className={calNav.mode === 'month' ? 'on' : ''} onClick={() => calNav.setMode('month')}>
          Month
        </button>
        <button className={calNav.mode === 'day' ? 'on' : ''} onClick={() => calNav.setMode('day')}>
          Day
        </button>
      </div>
      <button className="icon-btn" onClick={() => calNav.step(-1)} aria-label="Previous">
        <Icon name="chevron-left" />
      </button>
      <button className="today-btn" onClick={() => calNav.setAnchor(todayKey())}>
        Today
      </button>
      <button className="icon-btn" onClick={() => calNav.step(1)} aria-label="Next">
        <Icon name="chevron-right" />
      </button>
    </>
  );

  const renderSchedulePanel = () => (
    <div className="tasks-upcoming-schedule">
      <div className="tasks-col-head">
        <div className="tasks-col-title-group">
          <h2>Schedule</h2>
          <span className="tasks-col-sub">Today & next 14 days</span>
        </div>
        <div className="tasks-schedule-actions">
          <button
            className="btn subtle mini"
            onClick={() => {
              if (expandedDays.size === agenda.days.length) {
                setExpandedDays(new Set([todayKey()]));
              } else {
                setExpandedDays(new Set(agenda.days.map((d) => d.dayKey)));
              }
            }}
            title={expandedDays.size === agenda.days.length ? 'Collapse all except today' : 'Expand all days'}
          >
            {expandedDays.size === agenda.days.length ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      </div>
      <div className="tasks-upcoming-days">
        {agenda.days.map((day) => (
          <DayCard
            key={day.dayKey}
            day={day}
            isToday={day.dayKey === today}
            expanded={expandedDays.has(day.dayKey)}
            onToggleExpand={() => toggleDayExpanded(day.dayKey)}
            draft={dayDrafts[day.dayKey] || ''}
            onDraftChange={(v) => setDayDraft(day.dayKey, v)}
            onAdd={(title) => {
              addTask(title, { doing: day.dayKey });
              setDayDraft(day.dayKey, '');
            }}
            onToggleTask={toggle}
            onUnscheduleTask={unschedule}
            onDropTask={drop}
            isDragOver={dragOverDay === day.dayKey}
            onDragOverChange={(over) => setDragOverDay(over ? day.dayKey : null)}
            overdueTasks={overdueTasks}
            overdueExpanded={overdueExpanded}
            onToggleOverdue={() => setOverdueExpanded(!overdueExpanded)}
            onRescheduleAllOverdue={rescheduleAllOverdueToToday}
            onMoveAllOverdueToBacklog={moveAllOverdueToBacklog}
            showCompleted={completedOpen.has(day.dayKey)}
            onToggleCompleted={() => toggleCompleted(day.dayKey)}
          />
        ))}
      </div>
    </div>
  );

  const renderBacklogPanel = () => (
    <div
      className={'tasks-backlog-panel' + (backlogOver ? ' over' : '')}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('text/habitat-task')) return;
        e.preventDefault();
        setBacklogOver(true);
      }}
      onDragLeave={() => setBacklogOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setBacklogOver(false);
        const id = e.dataTransfer.getData('text/habitat-task');
        if (id) unschedule(id);
      }}
    >
      <div className="tasks-col-head">
        <div className="tasks-col-title-group">
          <h2>Backlog</h2>
          <span className="tasks-col-sub">{backlogTasks.length} unscheduled</span>
        </div>
      </div>

      <div className="tasks-quick-add">
        <span className="tick ghost">
          <Icon name="plus" size={12} />
        </span>
        <input
          className="tasks-quick-input"
          placeholder="Add task to backlog… (press Enter)"
          value={backlogDraft}
          onChange={(e) => setBacklogDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && backlogDraft.trim()) {
              addTask(backlogDraft);
              setBacklogDraft('');
            }
          }}
        />
      </div>

      <div className="tasks-list">
        {backlogTasks.length === 0 && (
          <div className="tasks-empty-hint">
            <Icon name="list" size={20} />
            <p>Backlog is clear.</p>
            <span>Add ideas and tasks here to schedule later.</span>
          </div>
        )}

        {backlogTasks.map((t) => (
          <TaskLine
            key={t.id}
            task={t}
            onToggle={toggle}
            actions={[
              {
                icon: 'sun',
                label: 'Today',
                onClick: () => {
                  if (t.due && today > t.due) {
                    alert(`Cannot schedule for today: the due date (${t.due}) has already passed.`);
                    return;
                  }
                  drop(t.id, today, null);
                },
              },
              {
                icon: 'calendar-days',
                label: 'Schedule',
                onClick: () => setScheduling({ id: t.id, value: today, due: t.due }),
              },
            ]}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div className="page tasks-page">
      <header className="page-head">
        <div className="page-title">
          <span className="type-emoji big">
            <Icon name="circle-check" size={22} />
          </span>
          <h1>Tasks</h1>
          <span className="count-badge">{totalActive}</span>
        </div>

        <PageActions>
          <div className="page-actions">
            {!narrow && mode === 'calendar' && calNavControls}

            {!narrow && (
              <div className="seg mini">
                {MODES.map(([m, label, icon]) => (
                  <button key={m} className={mode === m ? 'on' : ''} onClick={() => pick(m)} title={label}>
                    <Icon name={icon} size={13} />
                    <span className="seg-label">{label}</span>
                  </button>
                ))}
              </div>
            )}

            <button className="btn primary" onClick={newTimedTask}>
              <Icon name="plus" size={14} /> Task
            </button>
            <SplitControls />
          </div>
        </PageActions>
      </header>

      {/* Mobile segmented navigation bar */}
      {narrow && (
        <div className="tasks-mobile-tabs">
          <div className="seg wide">
            <button className={mobileTab === 'schedule' ? 'on' : ''} onClick={() => setMobileTab('schedule')}>
              <Icon name="circle-check" size={13} />
              <span>Tasks</span>
              {(todayActiveTasks.length > 0 || overdueTasks.length > 0) && (
                <span className="count-badge">{todayActiveTasks.length + overdueTasks.length}</span>
              )}
            </button>
            <button className={mobileTab === 'backlog' ? 'on' : ''} onClick={() => setMobileTab('backlog')}>
              <Icon name="list" size={13} />
              <span>Backlog</span>
              {backlogTasks.length > 0 && <span className="count-badge">{backlogTasks.length}</span>}
            </button>
            <button
              className={mobileTab === 'calendar' ? 'on' : ''}
              onClick={() => {
                setMobileTab('calendar');
                calNav.setMode('month');
              }}
            >
              <Icon name="calendar-clock" size={13} />
              <span>Calendar</span>
            </button>
          </div>
        </div>
      )}

      {narrow && mobileTab === 'calendar' && <div className="tasks-cal-nav">{calNavControls}</div>}

      {/* Main content body */}
      {!narrow ? (
        <>
          {mode === 'schedule' && (
            <div className="tasks-upcoming-layout">
              {renderSchedulePanel()}
              {renderBacklogPanel()}
            </div>
          )}

          {mode === 'calendar' && <CalendarView chrome={false} nav={calNav} />}

          {mode === 'board' && <TypeTable typeId="task" embedded embeddedMode="board" />}
        </>
      ) : (
        <div className="tasks-mobile-layout">
          {mobileTab === 'schedule' && renderSchedulePanel()}
          {mobileTab === 'backlog' && renderBacklogPanel()}
          {mobileTab === 'calendar' && <CalendarView chrome={false} nav={calNav} />}
        </div>
      )}

      {/* Scheduling prompt modal */}
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
            {scheduling.due && (
              <p style={{ fontSize: '12px', color: 'var(--text-3)', margin: '-4px 0 10px' }}>
                Deadline: <strong>{scheduling.due}</strong>
              </p>
            )}
            <DateField
              value={scheduling.value}
              placeholder="Pick a day…"
              onChange={(v) => setScheduling({ ...scheduling, value: v ?? '' })}
            />
            {scheduling.value && scheduling.value < today && (
              <p style={{ fontSize: '11px', color: 'var(--danger, #d9584a)', margin: '6px 0 0' }}>
                Cannot schedule in the past.
              </p>
            )}
            {scheduling.due && scheduling.value && scheduling.value > scheduling.due && (
              <p style={{ fontSize: '11px', color: 'var(--danger, #d9584a)', margin: '6px 0 0' }}>
                Cannot schedule past deadline ({scheduling.due}).
              </p>
            )}
            <div className="popover-actions">
              <button className="btn subtle" onClick={() => setScheduling(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={
                  !scheduling.value ||
                  scheduling.value < today ||
                  Boolean(scheduling.due && scheduling.value > scheduling.due)
                }
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
