import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../api';
import type { DailyMeta, Obj } from '../types';
import { addDays, ago, fmtMonthYear, monthCells, monthStartKey, relBadge, todayKey } from '../util';
import { dealtIn, snap, spring, stagger } from '../motion';
import { DayTasks } from './DayTasks';
import { Editor } from './Editor';
import { Icon } from './Icons';
import { SplitControls } from './SplitControls';

function docText(n: any): string {
  let s = typeof n?.text === 'string' ? n.text : '';
  if (Array.isArray(n?.content)) for (const c of n.content) s += docText(c);
  return s;
}

const isEmptyDoc = (d: any) => !d || docText(d).trim() === '';

export function DailyNotes() {
  const [dateKey, setDateKey] = useState(todayKey());
  const [mode, setMode] = useState<'day' | 'month' | 'list'>('day');
  const [note, setNote] = useState<Obj | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [metas, setMetas] = useState<DailyMeta[]>([]);
  const noteRef = useRef<Obj | null>(null);
  const creatingRef = useRef(false);
  const pendingRef = useRef<any>(null);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    noteRef.current = null;
    api.daily.get(dateKey).then((n) => {
      if (!alive) return;
      setNote(n);
      noteRef.current = n;
      setLoaded(true);
    });
    api.daily.list().then((m) => alive && setMetas(m));
    return () => {
      alive = false;
    };
  }, [dateKey]);

  // The daily row is only created once something is actually written.
  const saveJournal = async (json: any) => {
    if (noteRef.current) {
      api.objects.update(noteRef.current.id, { content: json });
      return;
    }
    if (isEmptyDoc(json)) return;
    if (creatingRef.current) {
      pendingRef.current = json;
      return;
    }
    creatingRef.current = true;
    const n = await api.daily.create(dateKey, json);
    noteRef.current = n;
    setNote(n);
    if (pendingRef.current) {
      api.objects.update(n.id, { content: pendingRef.current });
      pendingRef.current = null;
    }
    creatingRef.current = false;
    api.daily.list().then(setMetas);
  };

  const deleteDaily = async (m: DailyMeta) => {
    if (!confirm(`Delete the journal entry for ${new Date(m.dateKey + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}? This also removes its links.`))
      return;
    await api.objects.remove(m.id);
    if (m.dateKey === dateKey) {
      setNote(null);
      noteRef.current = null;
    }
    setMetas((list) => list.filter((x) => x.id !== m.id));
  };

  // The strip is centred on the open day rather than pinned to a calendar week,
  // so today (or whatever you picked) always sits in the middle.
  const week = Array.from({ length: 7 }, (_, i) => addDays(dateKey, i - 3));
  const today = todayKey();
  const metaMap = new Map(metas.map((m) => [m.dateKey, m.snippet]));
  const badge = relBadge(dateKey);

  const step = (n: number) => setDateKey(mode === 'day' ? addDays(dateKey, n) : monthStartKey(dateKey, n));

  return (
    <div className="daily-page">
      <div className="daily-head">
        <span className="month-label">{fmtMonthYear(dateKey)}</span>
        <div className="daily-nav">
          <div className="seg mini">
            <button className={mode === 'day' ? 'on' : ''} onClick={() => setMode('day')}>
              Day
            </button>
            <button className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>
              Month
            </button>
            <button className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')}>
              List
            </button>
          </div>
          {mode !== 'list' && (
            <>
              <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous">
                <Icon name="chevron-left" />
              </button>
              <button className="today-btn" onClick={() => setDateKey(today)}>
                Today
              </button>
              <button className="icon-btn" onClick={() => step(1)} aria-label="Next">
                <Icon name="chevron-right" />
              </button>
            </>
          )}
          <SplitControls />
        </div>
      </div>

      {mode === 'list' ? (
        <motion.div className="daily-list" variants={stagger} initial="hidden" animate="shown">
          {metas.length === 0 && <div className="empty">No journal entries yet — write in today's note to start one.</div>}
          {metas.map((m) => {
            const d = new Date(m.dateKey + 'T12:00:00');
            return (
              <motion.div key={m.id} className="daily-list-row" variants={dealtIn}>
                <button
                  className="daily-list-main"
                  onClick={() => {
                    setDateKey(m.dateKey);
                    setMode('day');
                  }}
                >
                  <div className="daily-list-date">
                    <span className="daily-list-dow">{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                    <span>{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                    {m.dateKey === today && <span className="rel-badge">Today</span>}
                  </div>
                  <div className="daily-list-snippet">{m.snippet || 'No content'}</div>
                </button>
                <span className="daily-list-meta">{ago(m.updatedAt)}</span>
                <button className="row-del" onClick={() => deleteDaily(m)} aria-label="Delete entry">
                  <Icon name="trash" size={14} />
                </button>
              </motion.div>
            );
          })}
        </motion.div>
      ) : mode === 'month' ? (
        <motion.div className="cal-grid" variants={stagger} initial="hidden" animate="shown">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
            <div key={d} className="cal-dow">
              {d}
            </div>
          ))}
          {monthCells(dateKey).map((c) => (
            <motion.button
              variants={dealtIn}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              key={c.key}
              className={
                'cal-cell' +
                (c.inMonth ? '' : ' out') +
                (c.key === today ? ' today' : '') +
                (metaMap.get(c.key) ? ' has' : '')
              }
              onClick={() => {
                setDateKey(c.key);
                setMode('day');
              }}
            >
              <span className="cal-num">{c.day}</span>
              {metaMap.get(c.key) && <span className="cal-snippet">{metaMap.get(c.key)}</span>}
            </motion.button>
          ))}
        </motion.div>
      ) : (
        <>
          <motion.div className="day-strip" layout transition={spring}>
            <AnimatePresence initial={false} mode="popLayout">
              {week.map((k) => {
                const d = new Date(k + 'T12:00:00');
                return (
                  <motion.button
                    key={k}
                    layout
                    className={
                      'day-pill' +
                      (k === dateKey ? ' sel' : '') +
                      (k === today ? ' today' : '') +
                      (metaMap.get(k) ? ' has' : '')
                    }
                    initial={{ opacity: 0, scale: 0.82 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.82 }}
                    transition={spring}
                    whileHover={{ y: -3 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setDateKey(k)}
                  >
                    {/* One highlight shared by every pill, so it glides to the day you pick. */}
                    {k === dateKey && <motion.span layoutId="day-sel" className="day-sel" transition={spring} />}
                    <span className="dow">{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                    <span className="num">{d.getDate()}</span>
                    <span className="dot" />
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </motion.div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={dateKey}
              className="daily-hero"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={snap}
            >
              <div className="hero-dow">
                {new Date(dateKey + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })}
                {badge && <span className="rel-badge">{badge}</span>}
              </div>
              <div className="hero-sub">
                {new Date(dateKey + 'T12:00:00').toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </div>
            </motion.div>
          </AnimatePresence>

          <div className="sect">Tasks</div>
          <DayTasks key={dateKey} dateKey={dateKey} />

          <div className="sect">Journal</div>
          {loaded && (
            <div className="daily-editor">
              <Editor
                key={dateKey}
                content={note?.content ?? null}
                placeholder="How was your day? Type '@' to link anything, '/' for commands…"
                onSave={saveJournal}
              />
            </div>
          )}

        </>
      )}
    </div>
  );
}
