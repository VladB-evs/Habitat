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
}: {
  task: AgendaTask;
  onToggle: (t: AgendaTask) => void;
  showEvent?: boolean;
}) {
  const { openFrom } = useApp();
  return (
    <div
      className={'ag-task' + (task.done ? ' done' : '') + (task.overdue ? ' overdue' : '')}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/habitat-task', task.id);
        e.dataTransfer.setData('text/habitat-minute', String(task.startMinute ?? ''));
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('button')) openFrom(e, task.id);
      }}
    >
      <button className={'tick' + (task.done ? ' on' : '')} onClick={() => onToggle(task)} aria-label="Toggle done">
        {task.done && <Icon name="check" size={11} />}
      </button>
      <span className="ag-task-title">{task.title}</span>
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
      {task.rolled && !task.done && <span className="rolled-badge">carried over</span>}
    </div>
  );
}

/**
 * An event, drawn as a block rather than a line: it is a thing that happens, not
 * something to tick off, and the tasks it carries sit inside it.
 */
function EventBlock({ event, onToggle }: { event: AgendaEvent; onToggle: (t: AgendaTask) => void }) {
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
      <div className="ag-event-head" onClick={(e) => !(e.target as HTMLElement).closest('button') && openFrom(e, event.id)}>
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
}: {
  day: AgendaDay;
  onToggle: (t: AgendaTask) => void;
  onDrop: (taskId: string, dayKey: string, minute: number | null) => void;
  onAdd: (dayKey: string, title: string) => void;
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
          <TaskLine key={t.id} task={t} onToggle={onToggle} />
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
}: {
  tasks: AgendaTask[];
  onToggle: (t: AgendaTask) => void;
  onAdd: (title: string) => void;
  onClear: (taskId: string) => void;
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
        {tasks.map((t) => (
          <TaskLine key={t.id} task={t} onToggle={onToggle} />
        ))}
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
        {!tasks.length && <p className="ag-hint">Drag anything here to take its day away again.</p>}
      </div>
    </aside>
  );
}
