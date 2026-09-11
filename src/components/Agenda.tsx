import { useState } from 'react';
import { motion } from 'motion/react';
import { api } from '../api';
import { dealtIn, spring } from '../motion';
import { objectChanged } from '../objects';
import { useApp } from '../store';
import type { AgendaDay, AgendaEvent, AgendaTask } from '../types';
import { addDays, todayKey, typeColor } from '../util';
import { Icon } from './Icons';

const clock = (m: number) =>
  new Date(2000, 0, 1, Math.floor(m / 60), m % 60).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** How an event says when it is: a span of hours, a stretch of days, or all day. */
function whenLabel(e: AgendaEvent): string {
  if (e.spanDay) return e.startMinute !== null ? `${clock(e.startMinute)} · day ${e.spanDay}/${e.spanOf}` : `Day ${e.spanDay} of ${e.spanOf}`;
  if (e.startMinute === null) return 'All day';
  return e.endMinute !== null ? `${clock(e.startMinute)} – ${clock(e.endMinute)}` : clock(e.startMinute);
}

/** Today and tomorrow by name; the rest of this week by weekday; then by date. */
export function dayHeading(key: string): { label: string; sub: string } {
  const today = todayKey();
  const d = new Date(key + 'T12:00:00');
  const sub = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (key === today) return { label: 'Today', sub };
  if (key === addDays(today, 1)) return { label: 'Tomorrow', sub };
  if (key <= addDays(today, 6)) return { label: d.toLocaleDateString(undefined, { weekday: 'long' }), sub };
  return { label: d.toLocaleDateString(undefined, { weekday: 'long' }), sub };
}

export function TaskLine({
  task,
  onToggle,
  showEvent = true,
  moveAction,
  actions,
  onDragStart,
}: {
  task: AgendaTask;
  onToggle: (t: AgendaTask) => void;
  showEvent?: boolean;
  /** A touch-friendly stand-in for the drag that normally moves a task between
   *  the backlog and a day — dragging never reaches a touch screen at all, so
   *  without this the backlog has no way in from a phone. */
  moveAction?: { icon: string; label: string; onClick: () => void };
  actions?: { icon: string; label: string; onClick: () => void }[];
  /** Fired the moment a real drag begins (not the `moveAction` guard below) —
   *  the backlog sheet uses this to get itself out of the way, since the days
   *  it's meant to be dropped onto sit right behind it and a drag can't reach
   *  what a fixed overlay is covering. */
  onDragStart?: () => void;
}) {
  const { openFrom } = useApp();
  const rolled = task.rolled && !task.done;
  return (
    <div
      className={'ag-task' + (task.done ? ' done' : '') + (task.overdue ? ' overdue' : '') + (rolled ? ' rolled' : '')}
      draggable
      onDragStart={(e) => {
        // A native drag grabs the whole row, `moveAction` button included —
        // without this, starting the drag gesture there could swallow what
        // was meant to be a tap on the button, and reliably firing the row's
        // own click (open the task) instead of the button's is the exact
        // symptom that made the button feel broken.
        if ((e.target as HTMLElement).closest('.ag-task-move')) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData('text/habitat-task', task.id);
        e.dataTransfer.setData('text/habitat-minute', String(task.startMinute ?? ''));
        if (task.due) e.dataTransfer.setData('text/habitat-due', task.due);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart?.();
      }}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('button')) openFrom(e, task.id, task.when ?? undefined);
      }}
    >
      <button className={'tick' + (task.done ? ' on' : '')} onClick={() => onToggle(task)} aria-label="Toggle done">
        {task.done && <Icon name="check" size={11} />}
      </button>
      <span className="ag-task-title">{task.title}</span>
      {task.due && (
        <span
          className={'ag-task-due' + (task.due < todayKey() && !task.done ? ' overdue' : '')}
          title={`Due ${task.due}`}
        >
          <Icon name="calendar-clock" size={11} /> Due {task.due}
        </span>
      )}
      {task.startMinute !== null && <span className="ag-task-time">{clock(task.startMinute)}</span>}
      {task.repeats && (
        <span className="repeat-mark" title="Repeats">
          <Icon name="redo" size={10} />
        </span>
      )}
      {showEvent && task.eventName && (
        <span className="ag-in-event" title={`Part of ${task.eventName}`}>
          <Icon name="calendar-days" size={9} /> {task.eventName}
        </span>
      )}
      {rolled && (
        <span className="rolled-badge" title="Wasn't finished on the day it was due — moved forward to today">
          <Icon name="history" size={11} /> Carried over
        </span>
      )}
      {actions?.map((act) => (
        <button
          key={act.label}
          className="ag-task-move"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            act.onClick();
          }}
          aria-label={act.label}
          title={act.label}
        >
          <Icon name={act.icon} size={12} />
          {act.label}
        </button>
      ))}
      {!actions && moveAction && (
        <button
          className="ag-task-move"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            moveAction.onClick();
          }}
          aria-label={moveAction.label}
          title={moveAction.label}
        >
          <Icon name={moveAction.icon} size={12} />
          {moveAction.label}
        </button>
      )}
    </div>
  );
}

/**
 * An event, drawn as a block rather than a line: it is a thing that happens, not
 * something to tick off, and the tasks it carries sit inside it.
 */
export function EventBlock({ event, onToggle }: { event: AgendaEvent; onToggle: (t: AgendaTask) => void }) {
  const { openFrom, types, theme } = useApp();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const color = typeColor(types.find((t) => t.id === event.typeId)?.color, theme);
  const done = event.tasks.filter((t) => t.done).length;
  // Only the first day of a run carries the detail; the rest are a quiet reminder.
  const trailing = !!event.spanDay && event.spanDay > 1;

  const addTask = async () => {
    const title = draft.trim();
    if (!title) return;
    setDraft('');
    const made = await api.objects.create({ typeId: 'task', title, props: { status: 'Todo', partOf: [event.id] } });
    objectChanged(made.id);
  };

  return (
    <motion.div
      variants={dealtIn}
      initial="hidden"
      animate="shown"
      transition={spring}
      className={'ag-event' + (trailing ? ' trailing' : '')}
      style={{ ['--c' as any]: color }}
    >
      <div className="ag-event-head" onClick={(e) => !(e.target as HTMLElement).closest('button') && openFrom(e, event.id, event.dayKey)}>
        <span className="ag-event-when">{whenLabel(event)}</span>
        <span className="ag-event-title">{event.title}</span>
        {event.repeats && (
          <span className="repeat-mark" title="Repeats">
            <Icon name="redo" size={10} />
          </span>
        )}
        {!!event.tasks.length && (
          <span className="ag-event-count">
            {done}/{event.tasks.length}
          </span>
        )}
      </div>

      {!trailing && (event.location || event.people.length > 0) && (
        <div className="ag-event-meta">
          {event.location && (
            <span>
              <Icon name="pin" size={10} /> {event.location}
            </span>
          )}
          {event.people.length > 0 && (
            <span title={event.people.join(', ')}>
              <Icon name="people" size={10} /> {event.people.slice(0, 3).join(', ')}
              {event.people.length > 3 ? ` +${event.people.length - 3}` : ''}
            </span>
          )}
        </div>
      )}

      {!trailing && (
        <div className="ag-event-tasks">
          {event.tasks.map((t) => (
            <TaskLine key={t.id} task={t} onToggle={onToggle} showEvent={false} />
          ))}
          {adding ? (
            <div className="ag-task add">
              <span className="tick ghost">
                <Icon name="plus" size={11} />
              </span>
              <input
                className="ag-add-input"
                autoFocus
                spellCheck
                placeholder="Something to do for this…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => !draft.trim() && setAdding(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addTask();
                  if (e.key === 'Escape') setAdding(false);
                }}
              />
            </div>
          ) : (
            <button className="ag-add-btn" onClick={() => setAdding(true)}>
              <Icon name="plus" size={11} /> Add a task
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}

/**
 * One day: what happens on it, then what to do that day. A drop target too —
 * planning is mostly dragging something out of the backlog onto a day.
 */
export function DaySection({
  day,
  onToggle,
  onDrop,
  onAdd,
  onUnschedule,
}: {
  day: AgendaDay;
  onToggle: (t: AgendaTask) => void;
  onDrop: (taskId: string, dayKey: string, minute: number | null) => void;
  onAdd: (dayKey: string, title: string) => void;
  /** The touch-friendly way back to the backlog — see TaskLine's `moveAction`. */
  onUnschedule: (taskId: string) => void;
}) {
  const [over, setOver] = useState(false);
  const [draft, setDraft] = useState('');
  const { label, sub } = dayHeading(day.dayKey);
  const isToday = day.dayKey === todayKey();
  const empty = !day.events.length && !day.tasks.length;

  return (
    <section
      className={'ag-day' + (isToday ? ' today' : '') + (over ? ' over' : '') + (empty ? ' empty' : '')}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('text/habitat-task')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData('text/habitat-task');
        const raw = e.dataTransfer.getData('text/habitat-minute');
        if (id) onDrop(id, day.dayKey, raw ? Number(raw) : null);
      }}
    >
      <header className="ag-day-head">
        <h3>{label}</h3>
        <span className="ag-day-date">{sub}</span>
      </header>

      <div className="ag-day-body">
        {day.events.map((e) => (
          <EventBlock key={e.id + e.dayKey} event={e} onToggle={onToggle} />
        ))}
        {day.tasks.map((t) => (
          <TaskLine
            key={t.id}
            task={t}
            onToggle={onToggle}
            moveAction={{ icon: 'list', label: 'Move to backlog', onClick: () => onUnschedule(t.id) }}
          />
        ))}

        <div className="ag-task add quiet">
          <span className="tick ghost">
            <Icon name="plus" size={11} />
          </span>
          <input
            className="ag-add-input"
            spellCheck
            placeholder="Add for this day…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !draft.trim()) return;
              onAdd(day.dayKey, draft.trim());
              setDraft('');
            }}
          />
        </div>
      </div>
    </section>
  );
}

/** The pile with no day yet, and the place new things land before they're planned. */
export function Backlog({
  tasks,
  onToggle,
  onAdd,
  onClear,
  onSchedule,
  onMoveToToday,
  onDragStart,
}: {
  tasks: AgendaTask[];
  onToggle: (t: AgendaTask) => void;
  onAdd: (title: string) => void;
  onClear: (taskId: string) => void;
  /** The touch-friendly way onto a day — opens a "Schedule for" prompt instead
   *  of needing a drag onto a day section. See TaskLine's `moveAction`. */
  onSchedule: (taskId: string) => void;
  /** Fast 1-click move to today */
  onMoveToToday?: (taskId: string) => void;
  /** Passed straight through to each TaskLine — see its own `onDragStart`. */
  onDragStart?: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [over, setOver] = useState(false);

  return (
    <aside
      className={'ag-backlog' + (over ? ' over' : '')}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('text/habitat-task')) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData('text/habitat-task');
        if (id) onClear(id);
      }}
    >
      <header className="ag-backlog-head">
        <Icon name="list" size={13} />
        <h2>Backlog</h2>
        <span className="count-badge">{tasks.length}</span>
      </header>

      <div className="ag-backlog-body">
        {tasks.map((t) => {
          const taskActions = [
            ...(onMoveToToday ? [{ icon: 'sun', label: 'Today', onClick: () => onMoveToToday(t.id) }] : []),
            { icon: 'calendar-days', label: 'Schedule', onClick: () => onSchedule(t.id) },
          ];
          return (
            <TaskLine
              key={t.id}
              task={t}
              onToggle={onToggle}
              actions={taskActions}
              onDragStart={onDragStart}
            />
          );
        })}
        <div className="ag-task add">
          <span className="tick ghost">
            <Icon name="plus" size={11} />
          </span>
          <input
            className="ag-add-input"
            spellCheck
            placeholder="Anything, no date needed…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !draft.trim()) return;
              onAdd(draft.trim());
              setDraft('');
            }}
          />
        </div>
        {!tasks.length && (
          <p className="ag-hint">Drag anything here — or use its "Move to backlog" button — to take its day away again.</p>
        )}
      </div>
    </aside>
  );
}
