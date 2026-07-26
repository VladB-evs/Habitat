import { useEffect, useState } from 'react';
import type { WidgetDef, WidgetProps, WidgetSettingsProps } from './kit';

/** Ticks once a second and re-renders whatever reads it. */
function useNow(everyMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

function format(now: Date, config: Record<string, any>): { time: string; date: string; error: boolean } {
  const timeOpts: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !!config.hour12,
    ...(config.seconds ? { second: '2-digit' } : {}),
    ...(config.tz ? { timeZone: config.tz } : {}),
  };
  const dateOpts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(config.tz ? { timeZone: config.tz } : {}),
  };
  try {
    return {
      time: new Intl.DateTimeFormat(undefined, timeOpts).format(now),
      date: new Intl.DateTimeFormat(undefined, dateOpts).format(now),
      error: false,
    };
  } catch {
    // Unknown time zone — fall back to local rather than blanking the widget.
    return { time: now.toLocaleTimeString(), date: now.toDateString(), error: true };
  }
}

function ClockBody({ config }: WidgetProps) {
  const now = useNow(config.seconds ? 1000 : 15000);
  const { time, date, error } = format(now, config);
  const label = config.label || (config.tz ? config.tz.split('/').pop()!.replace(/_/g, ' ') : '');

  return (
    <div className="w-clock">
      {label && <div className="w-label">{label}</div>}
      <div className="w-big">{time}</div>
      {config.showDate !== false && <div className="w-sub">{date}</div>}
      {error && <div className="w-err">Unknown time zone “{config.tz}” — showing local time.</div>}
    </div>
  );
}

/** The full IANA list where the runtime offers it, otherwise a usable handful. */
function zones(): string[] {
  const anyIntl = Intl as any;
  if (typeof anyIntl.supportedValuesOf === 'function') {
    try {
      return anyIntl.supportedValuesOf('timeZone');
    } catch {
      /* fall through */
    }
  }
  return [
    'UTC',
    'Europe/London',
    'Europe/Bucharest',
    'Europe/Berlin',
    'America/New_York',
    'America/Los_Angeles',
    'Asia/Tokyo',
    'Australia/Sydney',
  ];
}

function ClockSettings({ config, set }: WidgetSettingsProps) {
  return (
    <>
      <label className="w-field">
        <span>Label</span>
        <input
          className="field"
          placeholder="Optional — defaults to the city"
          value={config.label || ''}
          onChange={(e) => set({ label: e.target.value })}
        />
      </label>
      <label className="w-field">
        <span>Time zone</span>
        <select className="field" value={config.tz || ''} onChange={(e) => set({ tz: e.target.value })}>
          <option value="">Local time</option>
          {zones().map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </label>
      <label className="w-check">
        <input type="checkbox" checked={!!config.hour12} onChange={(e) => set({ hour12: e.target.checked })} />
        12-hour clock
      </label>
      <label className="w-check">
        <input type="checkbox" checked={!!config.seconds} onChange={(e) => set({ seconds: e.target.checked })} />
        Show seconds
      </label>
      <label className="w-check">
        <input
          type="checkbox"
          checked={config.showDate !== false}
          onChange={(e) => set({ showDate: e.target.checked })}
        />
        Show the date
      </label>
    </>
  );
}

export const CLOCK_WIDGET: WidgetDef = {
  kind: 'clock',
  name: 'Clock',
  desc: 'Local time, or any time zone — add one per city.',
  icon: 'clock',
  group: 'Time',
  card: true,
  center: true,
  defaultW: 2,
  defaultH: 1,
  defaultConfig: { hour12: false, seconds: false, showDate: true, tz: '' },
  Body: ClockBody,
  Settings: ClockSettings,
};
