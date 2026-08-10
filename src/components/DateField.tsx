import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fmtClock, fmtWhen, fromValue, parseWhen, toValue, type When } from '../dateParse';
import { addDays, monthCells, monthStartKey, popPos, todayKey } from '../util';
import { Icon } from './Icons';

/** Quarter-hour steps: fine enough to schedule with, short enough to scan. */
const STEP = 15;
const SLOTS = Array.from({ length: (24 * 60) / STEP }, (_, i) => i * STEP);
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
/** Where a time field lands when the day came from a click rather than typed text. */
const DEFAULT_MINUTES = 9 * 60;

const PRESETS: [string, (t: string) => string][] = [
  ['Today', (t) => t],
  ['Tomorrow', (t) => addDays(t, 1)],
  ['Next week', (t) => addDays(t, 7)],
  ['Weekend', (t) => addDays(t, (6 - new Date(t + 'T12:00:00').getDay() + 7) % 7)],
];

/**
 * One date or datetime, picked however suits: type it in words, click the grid, or
 * take a preset. Replaces the native `date`/`datetime-local` inputs, which make you
 * tab through `mm/dd/yyyy` segments and can't understand "next friday".
 *
 * `value` is what the property stores — `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` when
 * `time` is set — and null when empty.
 */
export function DateField({
  value,
  onChange,
  time = false,
  className = '',
  placeholder = '—',
}: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  time?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [text, setText] = useState('');
  const current = fromValue(value);
  const [cursor, setCursor] = useState(() => current?.key ?? todayKey());
  const [month, setMonth] = useState(() => monthStartKey(current?.key ?? todayKey(), 0));
  const [minutes, setMinutes] = useState<number | null>(current?.minutes ?? null);

  const parsed = useMemo(() => (text.trim() ? parseWhen(text) : null), [text]);

  // Typing steers the grid, so you can see what "next friday" resolved to before committing.
  useEffect(() => {
    if (!parsed) return;
    setCursor(parsed.key);
    setMonth(monthStartKey(parsed.key, 0));
    if (parsed.minutes !== null) setMinutes(parsed.minutes);
  }, [parsed]);

  const open = () => {
    const at = fromValue(value);
    setText('');
    setCursor(at?.key ?? todayKey());
    setMonth(monthStartKey(at?.key ?? todayKey(), 0));
    setMinutes(at?.minutes ?? null);
    setPos(popPos(btnRef.current!, time ? 340 : 268, time ? 400 : 366));
  };

  const commit = (when: When, close = true) => {
    const mins = time ? when.minutes ?? minutes ?? DEFAULT_MINUTES : null;
    setMinutes(mins);
    setCursor(when.key);
    onChange(toValue(when.key, mins));
    if (close) setPos(null);
  };

  const clear = () => {
    onChange(null);
    setPos(null);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return setPos(null);
    if (e.key === 'Enter') {
      e.preventDefault();
      return commit(parsed ?? { key: cursor, minutes });
    }
    // Arrows walk the grid, but only while the box is empty — otherwise they
    // belong to the text caret.
    if (text) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    const next = addDays(cursor, step);
    setCursor(next);
    setMonth(monthStartKey(next, 0));
  };

  const shown = current ? fmtWhen(current.key, time ? current.minutes : null) : '';

  return (
    <>
      <button ref={btnRef} className={`date-btn ${className}` + (shown ? '' : ' empty')} onClick={open}>
        <Icon name="calendar-days" size={12} />
        <span className="date-btn-val">{shown || placeholder}</span>
      </button>

      {pos && (
        <>
          <div className="backdrop date-backdrop" onClick={() => setPos(null)} />
          <div className={'popover date-pop' + (time ? ' with-time' : '')} style={pos}>
            <input
              className="popover-search"
              placeholder={time ? 'tomorrow 3pm…' : 'next friday…'}
              value={text}
              autoFocus
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
            />
            {text.trim() && (
              <div className={'date-preview' + (parsed ? '' : ' bad')}>
                {parsed ? fmtWhen(parsed.key, time ? parsed.minutes ?? minutes ?? DEFAULT_MINUTES : null) : "Can't read that"}
              </div>
            )}

            <div className="date-presets">
              {PRESETS.map(([label, of]) => (
                <button key={label} className="date-preset" onClick={() => commit({ key: of(todayKey()), minutes })}>
                  {label}
                </button>
              ))}
            </div>

            <div className="date-cols">
              <div className="date-cal">
                <div className="date-monthbar">
                  <button className="icon-btn" onClick={() => setMonth(monthStartKey(month, -1))} aria-label="Previous month">
                    <Icon name="chevron-left" size={14} />
                  </button>
                  <span>{new Date(month + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
                  <button className="icon-btn" onClick={() => setMonth(monthStartKey(month, 1))} aria-label="Next month">
                    <Icon name="chevron-right" size={14} />
                  </button>
                </div>
                <div className="date-grid">
                  {DOW.map((d, i) => (
                    <span key={i} className="date-dow">
                      {d}
                    </span>
                  ))}
                  {monthCells(month).map((c) => (
                    <button
                      key={c.key}
                      className={
                        'date-cell' +
                        (c.inMonth ? '' : ' out') +
                        (c.key === todayKey() ? ' today' : '') +
                        (c.key === current?.key ? ' picked' : '') +
                        (c.key === cursor ? ' cursor' : '')
                      }
                      onClick={() => commit({ key: c.key, minutes }, !time)}
                    >
                      {c.day}
                    </button>
                  ))}
                </div>
              </div>

              {time && (
                <TimeList
                  minutes={minutes ?? DEFAULT_MINUTES}
                  onPick={(m) => {
                    setMinutes(m);
                    commit({ key: cursor, minutes: m });
                  }}
                />
              )}
            </div>

            <div className="date-foot">
              <button className="date-clear" onClick={clear}>
                Clear
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/** The hours, as a list you point at rather than four segments you type into. */
function TimeList({ minutes, onPick }: { minutes: number; onPick: (m: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const nearest = Math.round(minutes / STEP) * STEP;

  // Follow the selection rather than only landing on it once: typing "8:45" has to
  // bring that slot into view, not leave the list parked where it opened. Layout
  // effect so it's in place on the first paint instead of jumping afterwards.
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('.on');
    if (el && ref.current) ref.current.scrollTop = el.offsetTop - 64;
  }, [nearest]);

  return (
    <div className="date-times" ref={ref}>
      {SLOTS.map((m) => (
        <button key={m} className={'date-time' + (m === nearest ? ' on' : '')} onClick={() => onPick(m)}>
          {fmtClock(m)}
        </button>
      ))}
    </div>
  );
}
