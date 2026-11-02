import { useEffect, useState } from 'react';
import { api } from '../api';
import { onObjectChanged } from '../objects';
import { useApp } from '../store';
import { typeColor } from '../util';
import { TypeIcon } from './Icons';

const clockOf = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/**
 * What else happened that day. A note you wrote, a film you added, a person you
 * met — each sits on the day it happened, so the journal doubles as the way
 * back to anything you only remember by when.
 */
export function DayThings({ dateKey }: { dateKey: string }) {
  const { types, openFrom, theme } = useApp();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.dayTouched>>>([]);

  useEffect(() => {
    let alive = true;
    const load = () => api.dayTouched(dateKey).then((r) => alive && setRows(r));
    load();
    const off = onObjectChanged(load);
    return () => {
      alive = false;
      off();
    };
  }, [dateKey]);

  if (!rows.length) return null;
  const byId = new Map(types.map((t) => [t.id, t]));

  return (
    <>
      <div className="sect">That day</div>
      <div className="day-things">
        {rows.map((o) => {
          const t = byId.get(o.typeId);
          return (
            <button key={o.id} className="day-thing" onClick={(e) => openFrom(e, o.id)}>
              <TypeIcon icon={t?.icon} color={typeColor(t?.color, theme)} size={14} />
              <span className="day-thing-title">{o.title || 'Untitled'}</span>
              <span className="day-thing-meta">
                {o.kind === 'made' ? 'made' : 'edited'} · {clockOf(o.at)}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}
