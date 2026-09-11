import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../api';
import { ask } from '../confirm';
import type { DailyMeta, Obj } from '../types';
import { addDays, ago, fmtMonthYear, monthCells, monthStartKey, relBadge, todayKey, weekOf } from '../util';
import { dealtIn, snap, spring, stagger } from '../motion';
import { DayTasks } from './DayTasks';
import { Editor } from './Editor';
import { Icon } from './Icons';
import { MoodPicker, moodMeta } from './MoodPicker';
import { SplitControls } from './SplitControls';
import { PageActions } from './PageActions';

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

  /**
   * Simpler than `saveJournal`'s create-then-flush-the-pending-write dance —
   * a mood pick is one deliberate tap, never a stream of autosaves racing each
   * other, so there's nothing to queue. Gated on `loaded` at the call site:
   * creating the row here before `daily:get` has resolved could otherwise
   * stomp genuinely existing content with `daily:create`'s empty default.
   */
  const saveMood = async (score: number | null) => {
    let target = noteRef.current;
    if (!target) {
      if (score === null) return;
      target = await api.daily.create(dateKey, null);
    }
    const props = { ...target.props };
    if (score === null) delete props.mood;
    else props.mood = score;
    target = { ...target, props };
    noteRef.current = target;
    setNote(target);
    await api.objects.update(target.id, { props });
    api.daily.list().then(setMetas);
  };

  const deleteDaily = async (m: DailyMeta) => {
    if (!(await ask(`Delete the journal entry for ${new Date(m.dateKey + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}? This also removes its links.`)))
      return;
    await api.objects.remove(m.id);
    if (m.dateKey === dateKey) {
      setNote(null);
      noteRef.current = null;
    }
    setMetas((list) => list.filter((x) => x.id !== m.id));
  };

  const today = todayKey();
  const week = weekOf(dateKey);
  const [weekDir, setWeekDir] = useState(0);
  const prevWeekRef = useRef(week[0]);

  const changeDate = (newKey: string) => {
    const newWeekStart = weekOf(newKey)[0];
    if (newWeekStart !== prevWeekRef.current) {
      setWeekDir(newWeekStart > prevWeekRef.current ? 1 : -1);
      prevWeekRef.current = newWeekStart;
    }
    setDateKey(newKey);
  };

  const metaMap = new Map(metas.map((m) => [m.dateKey, m.snippet]));
  const moodMap = new Map(metas.map((m) => [m.dateKey, m.mood]));
  const hasEntry = (k: string) => !!metaMap.get(k) || moodMap.has(k);
  const badge = relBadge(dateKey);

  const step = (n: number) => {
    if (mode === 'day') {
      changeDate(addDays(dateKey, n));
    } else {
      setDateKey(monthStartKey(dateKey, n));
    }
  };

  const wheelLockRef = useRef(0);
  const onCarouselWheel = (e: React.WheelEvent) => {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(delta) < 20) return;
    const now = Date.now();
    if (now - wheelLockRef.current < 160) return;
    wheelLockRef.current = now;
    step(delta > 0 ? 1 : -1);
  };

  return (
    <div className="daily-page">
      <div className="daily-head">
        <span className="month-label">{fmtMonthYear(dateKey)}</span>
        <PageActions>
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
              <button className="today-btn" onClick={() => changeDate(today)}>
                Today
              </button>
              <button className="icon-btn" onClick={() => step(1)} aria-label="Next">
                <Icon name="chevron-right" />
              </button>
            </>
          )}
          <SplitControls />
        </div>
        </PageActions>
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
                    changeDate(m.dateKey);
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
                (hasEntry(c.key) ? ' has' : '')
              }
              onClick={() => {
                changeDate(c.key);
                setMode('day');
              }}
            >
              <span className="cal-num">{c.day}</span>
              {moodMap.get(c.key) != null && (
                <span className="cal-mood" style={{ background: moodMeta(moodMap.get(c.key))?.color }} />
              )}
              {metaMap.get(c.key) && <span className="cal-snippet">{metaMap.get(c.key)}</span>}
            </motion.button>
          ))}
        </motion.div>
      ) : (
        <>
          <div className="day-strip-wrap" onWheel={onCarouselWheel}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={week[0]}
                className="day-strip"
                initial={{ opacity: 0, x: weekDir > 0 ? 18 : -18 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: weekDir > 0 ? -18 : 18 }}
                transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
              >
                {week.map((k) => {
                  const d = new Date(k + 'T12:00:00');
                  const isSel = k === dateKey;
                  return (
                    <motion.button
                      key={k}
                      className={
                        'day-pill' +
                        (isSel ? ' sel' : '') +
                        (k === today ? ' today' : '') +
                        (hasEntry(k) ? ' has' : '')
                      }
                      whileHover={{ y: -2 }}
                      whileTap={{ scale: 0.96 }}
                      onClick={() => changeDate(k)}
                    >
                      {/* One highlight shared by every pill, so it glides to the day you pick. */}
                      {isSel && <motion.span layoutId="day-sel" className="day-sel" transition={spring} />}
                      <span className="dow">{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                      <span className="num">{d.getDate()}</span>
                      <span
                        className="dot"
                        style={moodMap.get(k) != null ? { background: moodMeta(moodMap.get(k))?.color } : undefined}
                      />
                    </motion.button>
                  );
                })}
              </motion.div>
            </AnimatePresence>
          </div>

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
              {/* Gated on `loaded` — creating the daily row from a mood pick before
                  the fetch for this date resolves risks overwriting real content
                  with `daily:create`'s empty default. See saveMood. */}
              {loaded && <MoodPicker value={note?.props.mood} onPick={saveMood} />}
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
