import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icons';
import { AsyncFunction, scriptApi } from '../script';
import { useApp } from '../store';
import type { WidgetDef, WidgetProps, WidgetSettingsProps } from './kit';

const SAMPLE = `const tasks = await habitat.tasks();
const left = tasks.filter(t => t.props.status !== 'Done');
el.innerHTML = \`
  <div style="font-size:30px;font-weight:700">\${left.length}</div>
  <div style="opacity:.6;font-size:13px">tasks left today</div>\`;`;

/** Base rules inside the shadow root. Font and colour inherit through the boundary on their own. */
const SHADOW_CSS = `:host{display:block}*{box-sizing:border-box}a{color:inherit}
img,svg,canvas{max-width:100%}table{border-collapse:collapse}`;

const REFRESH_CHOICES: [number, string][] = [
  [0, 'Never'],
  [1000, 'Every second'],
  [10000, 'Every 10 seconds'],
  [60000, 'Every minute'],
  [300000, 'Every 5 minutes'],
];

function CustomBody({ config }: WidgetProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { openObject, navigate } = useApp();
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);
  const [code, setCode] = useState<string>(config.code ?? '');

  // Editing the code re-runs the script, but only once typing settles.
  useEffect(() => {
    const t = setTimeout(() => setCode(config.code ?? ''), 600);
    return () => clearTimeout(t);
  }, [config.code]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    let alive = true;
    const timers: number[] = [];

    const habitat = {
      ...scriptApi(),
      /** Open an object in the current pane. */
      open: (id: string) => openObject(id),
      /** Jump to a view, e.g. go({ kind: 'daily' }). */
      go: (view: any) => navigate(view),
      /** Repeat something on an interval — cleared automatically when the widget re-runs. */
      every: (ms: number, fn: () => void) => {
        const id = window.setInterval(() => alive && fn(), Math.max(250, ms));
        timers.push(id);
        return id;
      },
    };

    const run = async () => {
      root.innerHTML = '';
      const style = document.createElement('style');
      style.textContent = SHADOW_CSS;
      const el = document.createElement('div');
      root.append(style, el);
      try {
        const out = await new AsyncFunction('habitat', 'el', code)(habitat, el);
        if (!alive) return;
        // A returned value is a convenience for one-liners; anything written to `el` wins.
        if (out !== undefined && out !== null && !el.childNodes.length) {
          if (out instanceof Node) el.appendChild(out);
          else el.textContent = String(out);
        }
        setErr('');
      } catch (e: any) {
        if (alive) setErr(e?.message || 'Script error');
      }
    };

    run();
    const every = Number(config.refresh) || 0;
    if (every > 0) timers.push(window.setInterval(run, Math.max(1000, every)));

    return () => {
      alive = false;
      timers.forEach(clearInterval);
      root.innerHTML = '';
    };
  }, [code, config.refresh, tick, openObject, navigate]);

  return (
    <div className="w-custom">
      {config.label && <div className="w-label">{config.label}</div>}
      {!code.trim() && <div className="w-empty">Empty widget — open its settings and write some JavaScript.</div>}
      <div ref={hostRef} />
      {err && (
        <div className="w-err">
          <Icon name="x" size={12} /> {err}
          <button className="w-rerun" onClick={() => setTick((n) => n + 1)}>
            Run again
          </button>
        </div>
      )}
    </div>
  );
}

function CustomSettings({ config, set }: WidgetSettingsProps) {
  return (
    <>
      <label className="w-field">
        <span>Title</span>
        <input
          className="field"
          placeholder="Optional heading"
          value={config.label || ''}
          onChange={(e) => set({ label: e.target.value })}
        />
      </label>
      <label className="w-field col">
        <span>JavaScript</span>
        <textarea
          className="field w-code"
          spellCheck={false}
          rows={10}
          placeholder={SAMPLE}
          value={config.code || ''}
          onChange={(e) => set({ code: e.target.value })}
        />
      </label>
      <div className="w-hint">
        Your script runs with <code>el</code> (this widget's element — write to <code>el.innerHTML</code>) and{' '}
        <code>habitat</code> (the same data API as slash variables: <code>tasks()</code>, <code>objects(type)</code>,{' '}
        <code>counts()</code>, <code>recent()</code>, <code>pinned()</code>, <code>tags()</code>, <code>search(q)</code>,{' '}
        <code>me()</code>, <code>today()</code> — all async except <code>today()</code>). Also{' '}
        <code>habitat.open(id)</code> to open an object and <code>habitat.every(ms, fn)</code> for a self-clearing
        interval. Styles are sandboxed in a shadow root, so nothing you write can leak into the rest of Habitat.
      </div>
      {!config.code && (
        <button className="btn subtle" onClick={() => set({ code: SAMPLE })}>
          Insert example
        </button>
      )}
      <label className="w-field">
        <span>Re-run</span>
        <select className="field" value={config.refresh ?? 0} onChange={(e) => set({ refresh: Number(e.target.value) })}>
          {REFRESH_CHOICES.map(([ms, label]) => (
            <option key={ms} value={ms}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

export const CUSTOM_WIDGET: WidgetDef = {
  kind: 'custom',
  name: 'Custom script',
  desc: 'Write JavaScript that renders anything you like.',
  icon: 'code',
  group: 'Custom',
  card: true,
  defaultW: 2,
  defaultH: 2,
  defaultConfig: { label: '', code: '', refresh: 0 },
  Body: CustomBody,
  Settings: CustomSettings,
};
