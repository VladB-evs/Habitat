import { useEffect, useState } from 'react';
import type { WidgetDef, WidgetProps, WidgetSettingsProps } from './kit';

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "4d 7h 12m", dropping to minutes-and-seconds once it's under an hour. */
function span(ms: number): string {
  const t = Math.max(0, ms);
  if (t < MIN) return `${Math.floor(t / 1000)}s`;
  if (t < HOUR) return `${Math.floor(t / MIN)}m ${String(Math.floor((t % MIN) / 1000)).padStart(2, '0')}s`;
  if (t < DAY) return `${Math.floor(t / HOUR)}h ${Math.floor((t % HOUR) / MIN)}m`;
  const d = Math.floor(t / DAY);
  const h = Math.floor((t % DAY) / HOUR);
  const m = Math.floor((t % HOUR) / MIN);
  return d >= 7 ? `${d}d ${h}h` : `${d}d ${h}h ${m}m`;
}

/** datetime-local strings are naive local time — `new Date()` reads them that way. */
function stamp(v: string | undefined): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

const fmtWhen = (ts: number) =>
  new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function TimerBody({ config }: WidgetProps) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const from = stamp(config.from);
  const to = stamp(config.to);
  const label = config.label || 'Event';

  if (from == null && to == null) {
    return (
      <div className="w-timer">
        <div className="w-label">{label}</div>
        <div className="w-empty">Set a date in this widget's settings.</div>
      </div>
    );
  }

  // Counting down to `to` while it's still ahead; otherwise counting up from whichever anchor applies.
  const counting = to != null && to > now ? to : null;
  const since = counting == null ? (to != null ? to : (from as number)) : 0;

  const pct =
    config.showProgress !== false && from != null && to != null && to > from
      ? Math.min(100, Math.max(0, ((now - from) / (to - from)) * 100))
      : null;

  return (
    <div className="w-timer">
      <div className="w-label">{label}</div>
      <div className="w-big">{counting != null ? span(counting - now) : span(now - since)}</div>
      <div className="w-sub">{counting != null ? `until ${fmtWhen(counting)}` : `since ${fmtWhen(since)}`}</div>
      {pct != null && (
        <div className="w-bar" title={`${Math.round(pct)}%`}>
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      {pct != null && <div className="w-sub">{Math.round(pct)}% elapsed</div>}
    </div>
  );
}

function TimerSettings({ config, set }: WidgetSettingsProps) {
  return (
    <>
      <label className="w-field">
        <span>Label</span>
        <input
          className="field"
          placeholder="Trip to Lisbon"
          value={config.label || ''}
          onChange={(e) => set({ label: e.target.value })}
        />
      </label>
      <label className="w-field">
        <span>From</span>
        <input
          className="field"
          type="datetime-local"
          value={config.from || ''}
          onChange={(e) => set({ from: e.target.value })}
        />
      </label>
      <label className="w-field">
        <span>To</span>
        <input
          className="field"
          type="datetime-local"
          value={config.to || ''}
          onChange={(e) => set({ to: e.target.value })}
        />
      </label>
      <div className="w-hint">
        Fill in <b>To</b> alone to count down to it (it counts up once the date passes), <b>From</b> alone to count up
        since it, or both for a progress bar between them.
      </div>
      <label className="w-check">
        <input
          type="checkbox"
          checked={config.showProgress !== false}
          onChange={(e) => set({ showProgress: e.target.checked })}
        />
        Show progress bar when both dates are set
      </label>
    </>
  );
}

export const TIMER_WIDGET: WidgetDef = {
  kind: 'timer',
  name: 'Event timer',
  desc: 'Count down to a date, or up since one — with progress between two.',
  icon: 'hash',
  group: 'Time',
  card: true,
  center: true,
  defaultW: 2,
  defaultH: 1,
  defaultConfig: { label: '', from: '', to: '', showProgress: true },
  Body: TimerBody,
  Settings: TimerSettings,
};
