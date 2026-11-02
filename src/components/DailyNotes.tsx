import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../api';
import { ask } from '../confirm';
import type { DailyMeta } from '../types';
import { addDays, ago, fmtMonthYear, monthCells, monthStartKey, relBadge, todayKey, weekOf } from '../util';
import { dealtIn, snap, spring, stagger } from '../motion';
import { DayTasks } from './DayTasks';
import { DayJournal } from './DayJournal';
import { DayThings } from './DayThings';
import { Icon } from './Icons';
import { moodMeta } from './MoodPicker';
import { SplitControls } from './SplitControls';
import { PageActions } from './PageActions';

export function DailyNotes() {
  const [dateKey, setDateKey] = useState(todayKey());
  const [mode, setMode] = useState<'day' | 'month' | 'list'>('day');
  const [metas, setMetas] = useState<DailyMeta[]>([]);

  useEffect(() => {
    let alive = true;
    api.daily.list().then((m) => alive && setMetas(m));
    return () => {
      alive = false;
    };
  }, [dateKey]);

  const deleteDaily = async (m: DailyMeta) => {
    if (
      !(await ask(
        `Delete every moment written on ${new Date(m.dateKey + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}? This also removes their links.`
      ))
    )
      return;
    await api.daily.remove(m.dateKey);
    setMetas((list) => list.filter((x) => x.dateKey !== m.dateKey));
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
  const countMap = new Map(metas.map((m) => [m.dateKey, m.moments]));
  const moodsMap = new Map(metas.map((m) => [m.dateKey, m.moods]));
  const hasEntry = (k: string) => !!metaMap.get(k) || !!countMap.get(k);

  /**
   * One tick per moment, up to six, each in its own mood's colour. A day's
   * weight has to be visible before you open it — two moments and nine moments
   * cannot look the same from the outside.
   */
  const weightTicks = (k: string) => {
    const n = countMap.get(k) ?? 0;
    if (!n) return null;
    const moods = moodsMap.get(k) ?? [];
    return (
      <span className="day-weight" title={n === 1 ? '1 moment' : `${n} moments`}>
        {Array.from({ length: Math.min(n, 6) }).map((_, i) => (
          <span
            key={i}
            className="day-tick"
            style={moodMeta(moods[i])?.color ? { background: moodMeta(moods[i])!.color } : undefined}
          />
        ))}
      </span>
    );
  };
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
              {weightTicks(c.key)}
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
                      {weightTicks(k) ?? <span className="dot" />}
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
            </motion.div>
          </AnimatePresence>

          <div className="sect">Tasks</div>
          <DayTasks key={'tasks-' + dateKey} dateKey={dateKey} />

          <div className="sect">Journal</div>
          <DayJournal key={'journal-' + dateKey} dateKey={dateKey} onChanged={() => api.daily.list().then(setMetas)} />

          <DayThings key={'things-' + dateKey} dateKey={dateKey} />
        </>
      )}
    </div>
  );
}
