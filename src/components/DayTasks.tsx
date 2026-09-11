import { useEffect, useState } from 'react';
import { api } from '../api';
import { objectChanged, onObjectChanged } from '../objects';
import { useApp } from '../store';
import type { Obj } from '../types';
import { Icon } from './Icons';

/** Tickable task list for one day, with quick-add. Used by Daily Notes and the Dashboard. */
export function DayTasks({ dateKey, maxTasks }: { dateKey: string; maxTasks?: number }) {
  const { openFrom, navigate, types } = useApp();
  const [tasks, setTasks] = useState<Obj[]>([]);
  const [newTask, setNewTask] = useState('');
  const hasTaskType = types.some((t) => t.id === 'task');

  useEffect(() => {
    let alive = true;
    const load = () => api.tasks.forDay(dateKey).then((t) => alive && setTasks(t));
    load();
    // A task ticked from a mention chip (or anywhere else) shows up here too.
    const off = onObjectChanged(load);
    return () => {
      alive = false;
      off();
    };
  }, [dateKey]);

  const sortTasks = (list: Obj[]) =>
    [...list].sort(
      (a, b) => (a.props.status === 'Done' ? 1 : 0) - (b.props.status === 'Done' ? 1 : 0) || a.createdAt - b.createdAt
    );

  const toggle = (t: Obj) => {
    const done = t.props.status !== 'Done';
    const props = { ...t.props, status: done ? 'Done' : 'Todo' };
    setTasks((list) => sortTasks(list.map((x) => (x.id === t.id ? { ...x, props } : x))));
    // Through the main process rather than a plain prop write: for a repeating
    // task only this day is ticked, and only it knows which days those are.
    api.tasks.setDone({ id: t.id, dayKey: t.occurrence ?? dateKey, done }).then(() => objectChanged(t.id));
  };

  const add = async () => {
    const title = newTask.trim();
    if (!title) return;
    setNewTask('');
    await api.objects.create({ typeId: 'task', title, props: { status: 'Todo', due: dateKey } });
    setTasks(await api.tasks.forDay(dateKey));
  };

  if (!hasTaskType) return null;

  const hasMax = typeof maxTasks === 'number' && maxTasks > 0;
  // If maxTasks is set and tasks exceed maxTasks, reserve 1 slot for the 'more' button
  const limit = hasMax ? (tasks.length > maxTasks ? Math.max(1, maxTasks - 1) : maxTasks) : tasks.length;
  const visibleTasks = hasMax ? tasks.slice(0, limit) : tasks;
  const remaining = tasks.length - visibleTasks.length;

  return (
    <div className="day-tasks">
      {visibleTasks.map((t) => {
        const done = t.props.status === 'Done';
        const rolled = !!t.props.rolled && !done;
        return (
          <div
            key={t.id}
            className={'day-task clickable' + (done ? ' done' : '') + (rolled ? ' rolled' : '')}
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest('button, input, select, textarea, a, [contenteditable]'))
                openFrom(e, t.id, t.occurrence);
            }}
          >
            <button className={'tick' + (done ? ' on' : '')} onClick={() => toggle(t)} aria-label="Toggle done">
              {done && <Icon name="check" size={11} />}
            </button>
            <button className="day-task-title" onClick={(e) => openFrom(e, t.id, t.occurrence)}>
              {t.title || 'Untitled'}
            </button>
            {t.occurrence && (
              <span className="repeat-mark" title="Repeats">
                <Icon name="redo" size={10} />
              </span>
            )}
            {rolled && (
              <span className="rolled-badge" title="Wasn't finished on the day it was due — moved forward to today">
                <Icon name="history" size={11} /> Carried over
              </span>
            )}
          </div>
        );
      })}

      {remaining > 0 && (
        <button
          type="button"
          className="day-tasks-more"
          onClick={() => navigate({ kind: 'tasks' })}
        >
          +{remaining} more in Tasks →
        </button>
      )}

      {(!hasMax || (tasks.length < maxTasks && remaining === 0)) && (
        <div className="day-task add">
          <span className="tick ghost">
            <Icon name="plus" size={11} />
          </span>
          <input
            className="day-task-input"
            spellCheck
            placeholder="Add a task…"
            value={newTask}
            onChange={(e) => setNewTask(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
        </div>
      )}
    </div>
  );
}
