import { useRef, useState } from 'react';
import { DAY_CODES, DAY_LABELS, codeFor, describeRule, formatRule, parseRule, type Freq, type Rule } from '../repeat';
import { popPos, todayKey } from '../util';
import { DateField } from './DateField';
import { Icon } from './Icons';

/** The four presets that cover almost every real schedule, offered before the dials. */
const PRESETS: { label: string; rule: (anchor: string) => Rule | null }[] = [
  { label: 'Doesn’t repeat', rule: () => null },
  { label: 'Every day', rule: () => ({ freq: 'DAILY', interval: 1 }) },
  { label: 'Every week', rule: (a) => ({ freq: 'WEEKLY', interval: 1, byDay: [codeFor(a)] }) },
  { label: 'Every weekday', rule: () => ({ freq: 'WEEKLY', interval: 1, byDay: ['MO', 'TU', 'WE', 'TH', 'FR'] }) },
  { label: 'Every month', rule: () => ({ freq: 'MONTHLY', interval: 1 }) },
  { label: 'Every year', rule: () => ({ freq: 'YEARLY', interval: 1 }) },
];

const FREQ_LABELS: [Freq, string][] = [
  ['DAILY', 'days'],
  ['WEEKLY', 'weeks'],
  ['MONTHLY', 'months'],
  ['YEARLY', 'years'],
];

type Ending = 'never' | 'on' | 'after';

/**
 * How often something comes back. Writes the same rule string the calendar
 * expands, so what this picker says and what the grid draws are one thing.
 *
 * `anchor` is the object's own date: a weekly rule with no weekday chosen means
 * "the day it starts on", and monthly and yearly are counted from it, so the
 * summary can only be honest with it in hand.
 */
export function RepeatField({
  value,
  onChange,
  anchor,
  className = '',
}: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  anchor?: string | null;
  className?: string;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const rule = parseRule(value);
  const start = (anchor || todayKey()).slice(0, 10);

  const commit = (next: Rule | null, close = false) => {
    onChange(next ? formatRule(next) : null);
    if (close) setPos(null);
  };

  /** Editing a dial when nothing repeats yet starts from the plainest weekly rule. */
  const edit = (patch: Partial<Rule>) =>
    commit({ ...(rule ?? { freq: 'WEEKLY', interval: 1, byDay: [codeFor(start)] }), ...patch });

  const ending: Ending = rule?.until ? 'on' : rule?.count ? 'after' : 'never';

  const setEnding = (kind: Ending) => {
    if (!rule) return;
    const { until, count, ...rest } = rule;
    if (kind === 'never') return commit(rest);
    if (kind === 'on') return commit({ ...rest, until: until ?? start });
    commit({ ...rest, count: count ?? 5 });
  };

  const toggleDay = (code: string) => {
    if (!rule) return;
    const on = rule.byDay?.length ? rule.byDay : [codeFor(start)];
    const next = on.includes(code) ? on.filter((d) => d !== code) : DAY_CODES.filter((d) => on.includes(d) || d === code);
    // Never leave a weekly rule with no day at all: it would repeat nothing.
    commit({ ...rule, byDay: next.length ? next : [code] });
  };

  const days = rule?.byDay?.length ? rule.byDay : [codeFor(start)];

  return (
    <>
      <button
        ref={btnRef}
        className={`date-btn repeat-btn ${className}` + (rule ? '' : ' empty')}
        onClick={() => setPos(popPos(btnRef.current!, 288, 400))}
      >
        <Icon name="redo" size={12} />
        <span className="date-btn-val">{describeRule(rule, start)}</span>
      </button>

      {pos && (
        <>
          <div className="backdrop repeat-backdrop" onClick={() => setPos(null)} />
          <div className="popover repeat-pop" style={pos}>
            <div className="repeat-presets">
              {PRESETS.map((p) => {
                const asRule = p.rule(start);
                const on = formatRule(asRule) === formatRule(rule);
                return (
                  <button
                    key={p.label}
                    className={'repeat-preset' + (on ? ' on' : '')}
                    onClick={() => commit(asRule, true)}
                  >
                    {p.label}
                    {on && <Icon name="check" size={12} />}
                  </button>
                );
              })}
            </div>

            {rule && (
              <div className="repeat-custom">
                <div className="repeat-row">
                  <span className="repeat-label">Every</span>
                  <input
                    className="cell-input repeat-num"
                    type="number"
                    min={1}
                    max={99}
                    value={rule.interval}
                    onChange={(e) => edit({ interval: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })}
                  />
                  <select
                    className="cell-input repeat-freq"
                    value={rule.freq}
                    onChange={(e) => edit({ freq: e.target.value as Freq })}
                  >
                    {FREQ_LABELS.map(([f, label]) => (
                      <option key={f} value={f}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                {rule.freq === 'WEEKLY' && (
                  <div className="repeat-days">
                    {DAY_CODES.map((code, i) => (
                      <button
                        key={code}
                        className={'repeat-day' + (days.includes(code) ? ' on' : '')}
                        onClick={() => toggleDay(code)}
                        aria-label={code}
                        aria-pressed={days.includes(code)}
                      >
                        {DAY_LABELS[i]}
                      </button>
                    ))}
                  </div>
                )}

                <div className="repeat-row">
                  <span className="repeat-label">Ends</span>
                  <select
                    className="cell-input repeat-freq"
                    value={ending}
                    onChange={(e) => setEnding(e.target.value as Ending)}
                  >
                    <option value="never">never</option>
                    <option value="on">on a date</option>
                    <option value="after">after…</option>
                  </select>
                </div>

                {ending === 'on' && (
                  <DateField
                    value={rule.until ?? start}
                    onChange={(v) => commit({ ...rule, until: v ?? undefined, count: undefined })}
                  />
                )}
                {ending === 'after' && (
                  <div className="repeat-row">
                    <input
                      className="cell-input repeat-num"
                      type="number"
                      min={1}
                      max={999}
                      value={rule.count ?? 5}
                      onChange={(e) =>
                        commit({ ...rule, count: Math.max(1, Math.min(999, Number(e.target.value) || 1)), until: undefined })
                      }
                    />
                    <span className="repeat-label">times</span>
                  </div>
                )}

                <div className="repeat-summary">{describeRule(rule, start)}</div>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
