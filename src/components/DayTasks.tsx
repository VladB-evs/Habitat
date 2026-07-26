import { useEffect, useState } from 'react';
import { api } from '../api';
import { objectChanged, onObjectChanged } from '../objects';
import { useApp } from '../store';
import type { Obj } from '../types';
import { Icon } from './Icons';

/** Tickable task list for one day, with quick-add. Used by Daily Notes and the Dashboard. */
export function DayTasks({ dateKey }: { dateKey: string }) {
  const { openFrom, types } = useApp();
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
    const status = t.props.status === 'Done' ? 'Todo' : 'Done';
    const props = { ...t.props, status };
    setTasks((list) => sortTasks(list.map((x) => (x.id === t.id ? { ...x, props } : x))));
    api.objects.update(t.id, { props }).then(() => objectChanged(t.id));
  };

  const add = async () => {
    const title = newTask.trim();
    if (!title) return;
    setNewTask('');
    await api.objects.create({ typeId: 'task', title, props: { status: 'Todo', due: dateKey } });
    setTasks(await api.tasks.forDay(dateKey));
  };

  if (!hasTaskType) return null;

  return (
    <div className="day-tasks">
      {tasks.map((t) => {
        const done = t.props.status === 'Done';
        return (
          <div
            key={t.id}
            className={'day-task clickable' + (done ? ' done' : '')}
            onClick={(e) => {
              if (!(e.target as HTMLElement).closest('button, input, select, textarea, a, [contenteditable]'))
                openFrom(e, t.id);
            }}
          >
            <button className={'tick' + (done ? ' on' : '')} onClick={() => toggle(t)} aria-label="Toggle done">
              {done && <Icon name="check" size={11} />}
            </button>
            <button className="day-task-title" onClick={(e) => openFrom(e, t.id)}>
              {t.title || 'Untitled'}
            </button>
            {t.props.rolled && !done && <span className="rolled-badge">carried over</span>}
          </div>
        );
      })}
      <div className="day-task add">
        <span className="tick ghost">
          <Icon name="plus" size={11} />
        </span>
        <input
          className="day-task-input"
          placeholder="Add a task…"
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
      </div>
    </div>
  );
}
