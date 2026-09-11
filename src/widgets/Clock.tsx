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

/** Extracts the precise decimal hour (0.0 to 23.999) in the configured timezone. */
function getTzDecimalHour(now: Date, tz?: string): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || undefined,
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    });
    const parts = fmt.formatToParts(now);
    let hour = 0;
    let minute = 0;
    let second = 0;
    for (const p of parts) {
      if (p.type === 'hour') hour = parseInt(p.value, 10) || 0;
      if (p.type === 'minute') minute = parseInt(p.value, 10) || 0;
      if (p.type === 'second') second = parseInt(p.value, 10) || 0;
    }
    return hour + minute / 60 + second / 3600;
  } catch {
    return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  }
}

interface SkyKeyframe {
  hour: number;
  top: [number, number, number];
  mid: [number, number, number];
  bottom: [number, number, number];
  stars: number;
  period: string;
  glow?: string;
}

/** 24-hour realistic celestial sky gradient keyframes. */
const SKY_KEYFRAMES: SkyKeyframe[] = [
  {
    hour: 0.0,
    top: [3, 7, 20],
    mid: [8, 16, 38],
    bottom: [13, 27, 56],
    stars: 1.0,
    period: 'Night',
    glow: 'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 40%, rgba(0, 0, 0, 0.25) 100%)',
  },
  {
    hour: 3.5,
    top: [4, 8, 22],
    mid: [9, 18, 42],
    bottom: [15, 30, 62],
    stars: 1.0,
    period: 'Deep night',
    glow: 'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 40%, rgba(0, 0, 0, 0.25) 100%)',
  },
  {
    hour: 4.8,
    top: [7, 14, 32],
    mid: [18, 24, 52],
    bottom: [42, 28, 62],
    stars: 0.85,
    period: 'First light',
    glow: 'radial-gradient(ellipse 80% 40% at 50% 105%, rgba(120, 60, 100, 0.2) 0%, transparent 70%)',
  },
  {
    hour: 5.7,
    top: [15, 28, 58],
    mid: [48, 42, 78],
    bottom: [120, 60, 80],
    stars: 0.45,
    period: 'Dawn',
    glow: 'radial-gradient(ellipse 80% 50% at 50% 105%, rgba(220, 90, 80, 0.3) 0%, transparent 75%)',
  },
  {
    hour: 6.4,
    top: [28, 55, 98],
    mid: [88, 70, 115],
    bottom: [230, 120, 75],
    stars: 0.05,
    period: 'Sunrise',
    glow: 'radial-gradient(ellipse 90% 60% at 50% 105%, rgba(255, 150, 70, 0.45) 0%, transparent 80%)',
  },
  {
    hour: 7.3,
    top: [35, 90, 155],
    mid: [75, 145, 205],
    bottom: [185, 215, 235],
    stars: 0.0,
    period: 'Early morning',
    glow: 'radial-gradient(ellipse 90% 50% at 50% 105%, rgba(255, 210, 120, 0.25) 0%, transparent 70%)',
  },
  {
    hour: 9.0,
    top: [24, 105, 185],
    mid: [50, 155, 225],
    bottom: [120, 200, 245],
    stars: 0.0,
    period: 'Morning',
    glow: 'radial-gradient(ellipse 90% 50% at 50% -10%, rgba(255, 255, 255, 0.18) 0%, transparent 70%)',
  },
  {
    hour: 12.5,
    top: [15, 115, 215],
    mid: [45, 160, 238],
    bottom: [115, 208, 252],
    stars: 0.0,
    period: 'Midday',
    glow: 'radial-gradient(ellipse 90% 60% at 50% -10%, rgba(255, 255, 255, 0.24) 0%, transparent 75%)',
  },
  {
    hour: 15.5,
    top: [20, 110, 198],
    mid: [55, 152, 228],
    bottom: [125, 202, 248],
    stars: 0.0,
    period: 'Afternoon',
    glow: 'radial-gradient(ellipse 90% 50% at 50% -10%, rgba(255, 255, 255, 0.18) 0%, transparent 70%)',
  },
  {
    hour: 17.5,
    top: [25, 85, 160],
    mid: [85, 125, 185],
    bottom: [210, 165, 110],
    stars: 0.0,
    period: 'Golden hour',
    glow: 'radial-gradient(ellipse 90% 60% at 50% 105%, rgba(255, 180, 80, 0.35) 0%, transparent 80%)',
  },
  {
    hour: 18.5,
    top: [22, 50, 95],
    mid: [120, 65, 105],
    bottom: [235, 95, 55],
    stars: 0.08,
    period: 'Sunset',
    glow: 'radial-gradient(ellipse 90% 60% at 50% 105%, rgba(255, 110, 50, 0.45) 0%, transparent 80%)',
  },
  {
    hour: 19.3,
    top: [16, 32, 68],
    mid: [65, 42, 85],
    bottom: [145, 60, 85],
    stars: 0.35,
    period: 'Dusk',
    glow: 'radial-gradient(ellipse 80% 50% at 50% 105%, rgba(180, 60, 80, 0.25) 0%, transparent 75%)',
  },
  {
    hour: 20.3,
    top: [8, 18, 42],
    mid: [22, 28, 62],
    bottom: [48, 30, 58],
    stars: 0.75,
    period: 'Nightfall',
    glow: 'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 40%, rgba(0, 0, 0, 0.25) 100%)',
  },
  {
    hour: 21.5,
    top: [4, 10, 26],
    mid: [10, 20, 48],
    bottom: [16, 32, 66],
    stars: 1.0,
    period: 'Night',
    glow: 'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 40%, rgba(0, 0, 0, 0.25) 100%)',
  },
  {
    hour: 24.0,
    top: [3, 7, 20],
    mid: [8, 16, 38],
    bottom: [13, 27, 56],
    stars: 1.0,
    period: 'Night',
    glow: 'radial-gradient(ellipse 100% 100% at 50% 50%, transparent 40%, rgba(0, 0, 0, 0.25) 100%)',
  },
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerp3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}

function computeSky(decimalHour: number): {
  background: string;
  glow?: string;
  stars: number;
  period: string;
} {
  const h = ((decimalHour % 24) + 24) % 24;
  let prev = SKY_KEYFRAMES[0];
  let next = SKY_KEYFRAMES[1];

  for (let i = 0; i < SKY_KEYFRAMES.length - 1; i++) {
    if (h >= SKY_KEYFRAMES[i].hour && h <= SKY_KEYFRAMES[i + 1].hour) {
      prev = SKY_KEYFRAMES[i];
      next = SKY_KEYFRAMES[i + 1];
      break;
    }
  }

  const range = next.hour - prev.hour || 1;
  const t = Math.max(0, Math.min(1, (h - prev.hour) / range));

  const top = lerp3(prev.top, next.top, t);
  const mid = lerp3(prev.mid, next.mid, t);
  const bottom = lerp3(prev.bottom, next.bottom, t);
  const stars = +(lerp(prev.stars, next.stars, t).toFixed(3));

  const background = `linear-gradient(180deg, rgb(${top[0]}, ${top[1]}, ${top[2]}) 0%, rgb(${mid[0]}, ${mid[1]}, ${mid[2]}) 52%, rgb(${bottom[0]}, ${bottom[1]}, ${bottom[2]}) 100%)`;

  return {
    background,
    glow: t > 0.5 ? next.glow : prev.glow,
    stars,
    period: t > 0.5 ? next.period : prev.period,
  };
}

/** 24 organically distributed night-sky stars. */
const SKY_STARS = [
  { x: 10, y: 15, size: 1.5, dur: 3.2, delay: 0 },
  { x: 22, y: 32, size: 2.0, dur: 4.1, delay: 1.2 },
  { x: 35, y: 18, size: 1.2, dur: 2.8, delay: 0.5 },
  { x: 48, y: 28, size: 1.8, dur: 3.6, delay: 1.8 },
  { x: 62, y: 14, size: 1.4, dur: 4.5, delay: 2.3 },
  { x: 74, y: 38, size: 2.2, dur: 3.0, delay: 0.8 },
  { x: 86, y: 22, size: 1.3, dur: 3.9, delay: 1.4 },
  { x: 94, y: 35, size: 1.6, dur: 3.3, delay: 0.6 },
  { x: 16, y: 62, size: 1.0, dur: 2.5, delay: 1.5 },
  { x: 28, y: 78, size: 1.6, dur: 3.8, delay: 0.2 },
  { x: 42, y: 65, size: 1.2, dur: 4.2, delay: 2.7 },
  { x: 56, y: 82, size: 1.7, dur: 3.4, delay: 1.0 },
  { x: 68, y: 70, size: 1.3, dur: 2.9, delay: 1.9 },
  { x: 82, y: 84, size: 1.5, dur: 4.0, delay: 0.4 },
  { x: 90, y: 60, size: 1.1, dur: 3.1, delay: 2.1 },
  { x: 6, y: 44, size: 1.4, dur: 3.7, delay: 1.1 },
  { x: 30, y: 10, size: 1.5, dur: 2.7, delay: 0.9 },
  { x: 52, y: 46, size: 1.9, dur: 4.3, delay: 2.5 },
  { x: 78, y: 52, size: 1.4, dur: 3.5, delay: 0.7 },
  { x: 12, y: 85, size: 1.2, dur: 3.9, delay: 1.6 },
  { x: 96, y: 75, size: 1.5, dur: 2.6, delay: 2.0 },
  { x: 64, y: 32, size: 2.4, dur: 4.4, delay: 0.3 },
  { x: 40, y: 88, size: 1.2, dur: 3.3, delay: 1.7 },
  { x: 84, y: 16, size: 1.8, dur: 3.8, delay: 2.2 },
];

function ClockBody({ config, w = 2, h = 1 }: WidgetProps) {
  const now = useNow(config.seconds ? 1000 : 15000);
  const { time, date, error } = format(now, config);
  const label = config.label || (config.tz ? config.tz.split('/').pop()!.replace(/_/g, ' ') : '');

  const useSky = config.skyTheme !== false;
  const decimalHour = getTzDecimalHour(now, config.tz);
  const sky = computeSky(decimalHour);

  return (
    <div
      className={'w-clock' + (h === 1 ? ' compact' : '') + (useSky ? ' sky-theme' : '')}
      style={useSky ? { background: sky.background } : undefined}
      title={useSky ? `${label || time} · ${sky.period}` : undefined}
    >
      {useSky && sky.glow && <div className="w-clock-glow" style={{ background: sky.glow }} />}

      {useSky && sky.stars > 0.01 && (
        <div className="w-clock-stars" style={{ opacity: sky.stars }}>
          {SKY_STARS.map((s, i) => (
            <span
              key={i}
              className="w-clock-star"
              style={{
                left: `${s.x}%`,
                top: `${s.y}%`,
                width: `${s.size}px`,
                height: `${s.size}px`,
                animationDuration: `${s.dur}s`,
                animationDelay: `${s.delay}s`,
              }}
            />
          ))}
        </div>
      )}

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
        <input
          type="checkbox"
          checked={config.skyTheme !== false}
          onChange={(e) => set({ skyTheme: e.target.checked })}
        />
        Dynamic sky background (day / night / stars)
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
  minW: 1,
  minH: 1,
  maxH: 4,
  defaultConfig: { hour12: false, seconds: false, showDate: true, tz: '', skyTheme: true },
  Body: ClockBody,
  Settings: ClockSettings,
};

