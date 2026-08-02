import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../api';
import { spring } from '../motion';
import { useApp } from '../store';
import type {
  AutoAction,
  AutoActionKind,
  AutoCondition,
  AutoOp,
  AutoTriggerKind,
  Automation,
  ObjType,
  PropDef,
  PropKind,
} from '../types';
import { ago, clientUid, taskProp } from '../util';
import { popPos } from './cells';
import { Icon } from './Icons';

const TRIGGERS: { kind: AutoTriggerKind; label: string; group: string }[] = [
  { kind: 'created', label: 'an object is created', group: 'Objects' },
  { kind: 'propSet', label: 'a property changes to…', group: 'Objects' },
  { kind: 'updated', label: 'an object is edited', group: 'Objects' },
  { kind: 'deleted', label: 'an object is deleted', group: 'Objects' },
  { kind: 'daily', label: 'every day at…', group: 'Time' },
  { kind: 'weekly', label: 'on chosen days at…', group: 'Time' },
  { kind: 'dueToday', label: 'a date property comes up', group: 'Time' },
  { kind: 'birthday', label: 'someone’s birthday comes up', group: 'Time' },
  { kind: 'appStart', label: 'Habitat opens', group: 'Time' },
];

const ACTIONS: { kind: AutoActionKind; label: string }[] = [
  { kind: 'setProp', label: 'Set a property' },
  { kind: 'createObject', label: 'Create an object' },
  { kind: 'appendDaily', label: "Add a line to today's daily note" },
  { kind: 'addTag', label: 'Add a tag' },
  { kind: 'link', label: 'Link to an object' },
  { kind: 'pin', label: 'Pin / unpin' },
  { kind: 'notify', label: 'Send a notification' },
  { kind: 'telegram', label: 'Message me on Telegram' },
];

const OP_LABELS: Record<AutoOp, string> = {
  eq: 'is',
  ne: 'is not',
  contains: 'contains',
  gt: 'is more than',
  lt: 'is less than',
  empty: 'is empty',
  notEmpty: 'is not empty',
  before: 'is before',
  after: 'is after',
  inLast: 'is in the last',
  notInLast: 'is not in the last',
};

/** Only offer comparisons that make sense for the field being compared. */
function opsForKind(kind?: PropKind): AutoOp[] {
  if (kind === 'date' || kind === 'datetime') return ['inLast', 'notInLast', 'before', 'after', 'eq', 'empty', 'notEmpty'];
  if (kind === 'select' || kind === 'multiselect') return ['eq', 'ne', 'empty', 'notEmpty'];
  if (kind === 'checkbox') return ['eq'];
  if (kind === 'file' || kind === 'relation') return ['empty', 'notEmpty'];
  if (kind === 'number' || kind === 'rating' || kind === 'progress') return ['eq', 'ne', 'gt', 'lt', 'empty', 'notEmpty'];
  return ['contains', 'eq', 'ne', 'empty', 'notEmpty'];
}

/** Conditions can test a property or any of the three fields every object has. */
function conditionFields(props: PropDef[]): PropDef[] {
  return [
    { id: '__title', name: 'Name', kind: 'text' },
    ...props,
    { id: '__created', name: 'Created', kind: 'date' },
    { id: '__updated', name: 'Edited', kind: 'date' },
  ];
}

/** Scheduled rules can be pointed at a type, which is what gives them something to look at. */
const SCOPED = (k: AutoTriggerKind) => k === 'daily' || k === 'weekly' || k === 'appStart';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const TIMED = (k: AutoTriggerKind) =>
  k === 'daily' || k === 'weekly' || k === 'dueToday' || k === 'birthday' || k === 'appStart';
const NEEDS_VALUE = (op: AutoOp) => op !== 'empty' && op !== 'notEmpty';
const IN_DAYS = (op: AutoOp) => op === 'inLast' || op === 'notInLast';

const newAction = (kind: AutoActionKind = 'appendDaily'): AutoAction => ({ id: clientUid(), kind, text: '{{link}}' });

const blank = (): Automation => ({
  id: clientUid(),
  name: '',
  enabled: true,
  trigger: { kind: 'created' },
  match: 'all',
  conditions: [],
  actions: [newAction()],
});

/**
 * Ready-made rules. They're the fastest way to learn what the builder can do —
 * each one is a working rule you can open up and change. `build` returns null
 * when the vault has nothing of the right shape (no task-like type, say).
 */
interface Recipe {
  id: string;
  name: string;
  blurb: string;
  build: (types: ObjType[]) => Automation | null;
}

const taskish = (types: ObjType[]) => types.find((t) => taskProp(t));
const dateProp = (t?: ObjType) => t?.properties.find((p) => p.kind === 'date');
const act = (a: Omit<AutoAction, 'id'>): AutoAction => ({ id: clientUid(), ...a });

const RECIPES: Recipe[] = [
  {
    id: 'stale',
    name: 'Nudge me about stale tasks',
    blurb: 'Every morning, one notification listing the tasks you haven’t touched in a week.',
    build: (types) => {
      const t = taskish(types);
      const done = taskProp(t);
      if (!t || !done) return null;
      return {
        ...blank(),
        name: 'Stale tasks',
        trigger: { kind: 'daily', time: '09:00', typeId: t.id },
        conditions: [
          { propId: done.id, op: 'ne', value: 'Done' },
          { propId: '__updated', op: 'notInLast', value: '7' },
        ],
        actions: [act({ kind: 'notify', text: '{{count}} tasks are going stale', value: '{{list}}' })],
      };
    },
  },
  {
    id: 'agenda',
    name: 'Put today’s work in the daily note',
    blurb: 'Each morning, a linked list of everything due today.',
    build: (types) => {
      const t = taskish(types);
      const done = taskProp(t);
      const due = dateProp(t);
      if (!t || !done || !due) return null;
      return {
        ...blank(),
        name: 'Today’s agenda',
        trigger: { kind: 'daily', time: '07:00', typeId: t.id },
        conditions: [
          { propId: due.id, op: 'eq', value: '{{today}}' },
          { propId: done.id, op: 'ne', value: 'Done' },
        ],
        actions: [act({ kind: 'appendDaily', text: 'Due today ({{count}}):' })],
      };
    },
  },
  {
    id: 'overdue',
    name: 'Message me what’s overdue',
    blurb: 'An evening Telegram with anything past its date and still open.',
    build: (types) => {
      const t = taskish(types);
      const done = taskProp(t);
      const due = dateProp(t);
      if (!t || !done || !due) return null;
      return {
        ...blank(),
        name: 'Overdue check',
        trigger: { kind: 'daily', time: '18:00', typeId: t.id },
        conditions: [
          { propId: due.id, op: 'before', value: '{{today}}' },
          { propId: done.id, op: 'ne', value: 'Done' },
        ],
        actions: [act({ kind: 'telegram', text: '{{count}} overdue', value: '{{list}}' })],
      };
    },
  },
  {
    id: 'review',
    name: 'Weekly review note',
    blurb: 'Sunday evening, a fresh note to look back on the week.',
    build: (types) => {
      const target = types.find((t) => t.id === 'note') ?? types.find((t) => !taskProp(t) && t.id !== 'daily');
      if (!target) return null;
      return {
        ...blank(),
        name: 'Weekly review',
        trigger: { kind: 'weekly', time: '18:00', days: [0] },
        actions: [act({ kind: 'createObject', typeId: target.id, text: 'Week ending {{today}}' })],
      };
    },
  },
  {
    id: 'birthday',
    name: 'Birthday reminder',
    blurb: 'A notification on the morning of someone’s birthday.',
    build: () => ({
      ...blank(),
      name: 'Birthdays',
      trigger: { kind: 'birthday', offset: 0, time: '08:00' },
      actions: [act({ kind: 'notify', text: '{{title}} turns {{turning}} today', value: '' })],
    }),
  },
];

/** A one-line English summary of the rule, shown on the card header. */
function describe(r: Automation, types: ObjType[]): string {
  const typeName = (id?: string) => types.find((t) => t.id === id)?.name ?? 'any object';
  const t = r.trigger;
  const about = t.typeId ? ` over ${typeName(t.typeId).toLowerCase()}s` : '';
  const when =
    t.kind === 'daily'
      ? `every day at ${t.time || '09:00'}${about}`
      : t.kind === 'weekly'
      ? `${(t.days ?? []).map((d) => DAYS[d]).join('') || 'no days'} at ${t.time || '09:00'}${about}`
      : t.kind === 'dueToday'
      ? `a ${typeName(t.typeId)} date is ${!t.offset ? 'today' : t.offset > 0 ? `in ${t.offset}d` : `${-t.offset}d overdue`}`
      : t.kind === 'birthday'
      ? `a birthday is ${!t.offset ? 'today' : `${Math.abs(t.offset)}d away`}`
      : t.kind === 'appStart'
      ? `Habitat opens${about}`
      : t.kind === 'created'
      ? `a ${typeName(t.typeId)} is created`
      : t.kind === 'deleted'
      ? `a ${typeName(t.typeId)} is deleted`
      : t.kind === 'propSet'
      ? `a ${typeName(t.typeId)} property changes`
      : `a ${typeName(t.typeId)} is edited`;
  const n = r.actions.length;
  return `When ${when} → ${n} ${n === 1 ? 'action' : 'actions'}`;
}

/** Which placeholders make sense for a rule: one object's, or the whole set's. */
function tokensFor(r: Automation): [string, string][] {
  const summary = SCOPED(r.trigger.kind) && !!r.trigger.typeId && !r.trigger.each;
  const perObject = !SCOPED(r.trigger.kind) || !!r.trigger.each;
  return [...(summary ? SET_TOKENS : []), ...(perObject ? OBJECT_TOKENS : []), ...DATE_TOKENS];
}

/** Rule builder: trigger, optional conditions, a list of actions. */
export function Automations() {
  const { types } = useApp();
  const [rules, setRules] = useState<Automation[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [ran, setRan] = useState<{ id: string; n: number } | null>(null);
  const [recipes, setRecipes] = useState<{ left: number; top: number } | null>(null);
  const pickable = types.filter((t) => t.id !== 'daily' && t.id !== 'tag');

  useEffect(() => {
    api.automations.list().then(setRules);
  }, []);

  const save = (list: Automation[]) => {
    setRules(list);
    api.automations.save(list);
  };
  const patch = (id: string, fn: (r: Automation) => Automation) => save(rules.map((r) => (r.id === id ? fn(r) : r)));

  const propsOf = (typeId?: string): PropDef[] => types.find((t) => t.id === typeId)?.properties ?? [];
  const typeName = (id?: string) => types.find((t) => t.id === id)?.name ?? 'object';

  const runNow = async (r: Automation) => {
    const res = await api.automations.run(r.id);
    setRan({ id: r.id, n: res?.ran ?? 0 });
    api.automations.list().then(setRules);
    setTimeout(() => setRan(null), 4000);
  };

  return (
    <div className="autos">
      <div className="set-note">
        Rules run inside Habitat as your data changes — nothing leaves the vault.
      </div>

      {rules.map((r) => {
        const expanded = open === r.id;
        const trigProps = propsOf(r.trigger.typeId);
        const condFields = conditionFields(trigProps);
        return (
          <div className={'auto-card' + (r.enabled ? '' : ' off') + (expanded ? ' open' : '')} key={r.id}>
            <div className="auto-head">
              <button className="auto-expand" onClick={() => setOpen(expanded ? null : r.id)} aria-label="Toggle rule">
                <motion.span animate={{ rotate: expanded ? 0 : -90 }} transition={spring} style={{ display: 'flex' }}>
                  <Icon name="chevron-down" size={13} />
                </motion.span>
              </button>
              <div className="auto-titles" onClick={() => setOpen(expanded ? null : r.id)}>
                <input
                  className="auto-name"
                  placeholder="Untitled rule"
                  value={r.name}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => patch(r.id, (x) => ({ ...x, name: e.target.value }))}
                />
                <span className="auto-summary">{describe(r, types)}</span>
              </div>
              {ran?.id === r.id && <span className="auto-ran">ran · {ran.n} touched</span>}
              {r.lastRunAt && ran?.id !== r.id && <span className="auto-when">{ago(r.lastRunAt)}</span>}
              <button
                className={'toggle' + (r.enabled ? ' on' : '')}
                onClick={() => patch(r.id, (x) => ({ ...x, enabled: !x.enabled }))}
                aria-label={r.enabled ? 'Disable rule' : 'Enable rule'}
                title={r.enabled ? 'Enabled' : 'Disabled'}
              >
                <span className="knob" />
              </button>
              <button
                className="icon-btn"
                title="Duplicate"
                aria-label="Duplicate rule"
                onClick={() => save([...rules, { ...structuredClone(r), id: clientUid(), name: `${r.name || 'Rule'} copy` }])}
              >
                <Icon name="doc" size={13} />
              </button>
              <button className="icon-btn" onClick={() => save(rules.filter((x) => x.id !== r.id))} aria-label="Delete rule">
                <Icon name="trash" size={13} />
              </button>
            </div>

            <AnimatePresence initial={false}>
              {expanded && (
                <motion.div
                  className="auto-body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={spring}
                >
                  {/* ---- trigger ---- */}
                  <div className="auto-sect">
                    <span className="auto-step">When</span>
                    <div className="auto-line">
                      <select
                        className="field"
                        value={r.trigger.kind}
                        onChange={(e) =>
                          patch(r.id, (x) => ({ ...x, trigger: { ...x.trigger, kind: e.target.value as AutoTriggerKind } }))
                        }
                      >
                        {['Objects', 'Time'].map((g) => (
                          <optgroup key={g} label={g}>
                            {TRIGGERS.filter((t) => t.group === g).map((t) => (
                              <option key={t.kind} value={t.kind}>
                                {t.label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>

                      {(!TIMED(r.trigger.kind) || r.trigger.kind === 'dueToday') && (
                        <>
                          <span className="auto-word">{r.trigger.kind === 'dueToday' ? 'on' : 'of type'}</span>
                          <select
                            className="field"
                            value={r.trigger.typeId ?? ''}
                            onChange={(e) =>
                              patch(r.id, (x) => ({
                                ...x,
                                trigger: { ...x.trigger, typeId: e.target.value || undefined, propId: undefined },
                              }))
                            }
                          >
                            <option value="">any type</option>
                            {pickable.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        </>
                      )}

                      {r.trigger.kind === 'propSet' && (
                        <>
                          <select
                            className="field"
                            value={r.trigger.propId ?? ''}
                            onChange={(e) => patch(r.id, (x) => ({ ...x, trigger: { ...x.trigger, propId: e.target.value } }))}
                          >
                            <option value="">property…</option>
                            {trigProps.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                          <select
                            className="field"
                            value={r.trigger.op ?? 'eq'}
                            onChange={(e) =>
                              patch(r.id, (x) => ({ ...x, trigger: { ...x.trigger, op: e.target.value as AutoOp } }))
                            }
                          >
                            {opsForKind(trigProps.find((p) => p.id === r.trigger.propId)?.kind).map((op) => (
                              <option key={op} value={op}>
                                {OP_LABELS[op]}
                              </option>
                            ))}
                          </select>
                          {NEEDS_VALUE(r.trigger.op ?? 'eq') && (
                            <ValueField
                              def={trigProps.find((p) => p.id === r.trigger.propId)}
                              value={r.trigger.value ?? ''}
                              onChange={(v) => patch(r.id, (x) => ({ ...x, trigger: { ...x.trigger, value: v } }))}
                            />
                          )}
                        </>
                      )}

                      {r.trigger.kind === 'dueToday' && (
                        <>
                          <select
                            className="field"
                            value={r.trigger.propId ?? ''}
                            onChange={(e) => patch(r.id, (x) => ({ ...x, trigger: { ...x.trigger, propId: e.target.value } }))}
                          >
                            <option value="">date property…</option>
                            {trigProps
                              .filter((p) => p.kind === 'date' || p.kind === 'datetime')
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                          </select>
                          <select
                            className="field"
                            value={String(r.trigger.offset ?? 0)}
                            onChange={(e) =>
                              patch(r.id, (x) => ({ ...x, trigger: { ...x.trigger, offset: Number(e.target.value) } }))
                            }
                          >
                            <option value="0">today</option>
                            <option value="1">tomorrow</option>
                            <option value="7">in a week</option>
                            <option value="-1">a day overdue</option>
                          </select>
                        </>
                      )}

                      {r.trigger.kind === 'birthday' && (
                        <>
                          <span className="auto-word">when it’s</span>
                          <select
                            className="field"
                            value={String(r.trigger.offset ?? 0)}
                            onChange={(e) =>
                              patch(r.id, (x) => ({ ...x, trigger: { ...x.trigger, offset: Number(e.target.value) } }))
                            }
                          >
                            <option value="0">today</option>
                            <option value="1">tomorrow</option>
                            <option value="3">in 3 days</option>
                            <option value="7">in a week</option>
                            <option value="14">in two weeks</option>
                          </select>
                        </>
                      )}

                      {r.trigger.kind === 'weekly' && (
                        <span className="auto-days">
                          {DAYS.map((d, i) => (
                            <button
                              key={i}
                              className={'wd-pill' + ((r.trigger.days ?? []).includes(i) ? ' on' : '')}
                              onClick={() =>
                                patch(r.id, (x) => {
                                  const days = new Set(x.trigger.days ?? []);
                                  days.has(i) ? days.delete(i) : days.add(i);
                                  return { ...x, trigger: { ...x.trigger, days: [...days].sort() } };
                                })
                              }
                            >
                              {d}
                            </button>
                          ))}
                        </span>
                      )}

                      {(r.trigger.kind === 'daily' ||
                        r.trigger.kind === 'weekly' ||
                        r.trigger.kind === 'dueToday' ||
                        r.trigger.kind === 'birthday') && (
                        <input
                          type="time"
                          className="field auto-time"
                          value={r.trigger.time ?? '09:00'}
                          onChange={(e) => patch(r.id, (x) => ({ ...x, trigger: { ...x.trigger, time: e.target.value } }))}
                        />
                      )}
                    </div>
                  </div>

                  {/* ---- what a scheduled rule is about ---- */}
                  {SCOPED(r.trigger.kind) && (
                    <div className="auto-sect">
                      <span className="auto-step">Look at</span>
                      <div className="auto-line">
                        <select
                          className="field"
                          value={r.trigger.typeId ?? ''}
                          onChange={(e) =>
                            patch(r.id, (x) => ({
                              ...x,
                              trigger: { ...x.trigger, typeId: e.target.value || undefined },
                              conditions: e.target.value ? x.conditions : [],
                            }))
                          }
                        >
                          <option value="">nothing — just run the actions</option>
                          {pickable.map((t) => (
                            <option key={t.id} value={t.id}>
                              every {t.name.toLowerCase()}
                            </option>
                          ))}
                        </select>
                        {r.trigger.typeId && (
                          <>
                            <span className="auto-word">and act</span>
                            <select
                              className="field"
                              value={r.trigger.each ? 'each' : 'summary'}
                              onChange={(e) =>
                                patch(r.id, (x) => ({ ...x, trigger: { ...x.trigger, each: e.target.value === 'each' } }))
                              }
                            >
                              <option value="summary">once, on the whole list</option>
                              <option value="each">once for each one</option>
                            </select>
                          </>
                        )}
                      </div>
                      {r.trigger.typeId && !r.trigger.each && (
                        <div className="auto-hint">
                          Use <code>{'{{count}}'}</code> and <code>{'{{list}}'}</code> in the actions below to say what was
                          found. Nothing matching means the rule stays quiet.
                        </div>
                      )}
                    </div>
                  )}

                  {/* ---- conditions ---- */}
                  <div className="auto-sect">
                    <span className="auto-step">
                      Only if
                      <select
                        className="field tiny"
                        value={r.match ?? 'all'}
                        onChange={(e) => patch(r.id, (x) => ({ ...x, match: e.target.value as 'all' | 'any' }))}
                      >
                        <option value="all">all match</option>
                        <option value="any">any match</option>
                      </select>
                    </span>
                    {(r.conditions ?? []).map((c, i) => {
                      const field = condFields.find((f) => f.id === c.propId);
                      const ops = opsForKind(field?.kind);
                      const setCond = (patchIt: Partial<AutoCondition>) =>
                        patch(r.id, (x) => ({
                          ...x,
                          conditions: x.conditions.map((y, j) => (j === i ? { ...y, ...patchIt } : y)),
                        }));
                      return (
                        <div className="auto-line" key={i}>
                          <select
                            className="field"
                            value={c.propId}
                            onChange={(e) => {
                              // The old comparison rarely survives a change of field.
                              const next = condFields.find((f) => f.id === e.target.value);
                              setCond({ propId: e.target.value, op: opsForKind(next?.kind)[0], value: undefined });
                            }}
                          >
                            {condFields.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.name}
                              </option>
                            ))}
                          </select>
                          <select className="field" value={c.op} onChange={(e) => setCond({ op: e.target.value as AutoOp })}>
                            {ops.map((op) => (
                              <option key={op} value={op}>
                                {OP_LABELS[op]}
                              </option>
                            ))}
                          </select>
                          {NEEDS_VALUE(c.op) &&
                            (IN_DAYS(c.op) ? (
                              <span className="auto-days-field">
                                <input
                                  type="number"
                                  min={1}
                                  className="field auto-val"
                                  value={c.value ?? '7'}
                                  onChange={(e) => setCond({ value: e.target.value })}
                                />
                                <span className="auto-word">days</span>
                              </span>
                            ) : (
                              <ValueField def={field} value={c.value ?? ''} onChange={(v) => setCond({ value: v })} />
                            ))}
                          <button
                            className="icon-btn"
                            aria-label="Remove condition"
                            onClick={() => patch(r.id, (x) => ({ ...x, conditions: x.conditions.filter((_, j) => j !== i) }))}
                          >
                            <Icon name="x" size={12} />
                          </button>
                        </div>
                      );
                    })}
                    <button
                      className="auto-add"
                      onClick={() =>
                        patch(r.id, (x) => ({
                          ...x,
                          conditions: [...(x.conditions ?? []), { propId: '__title', op: 'contains' } as AutoCondition],
                        }))
                      }
                    >
                      <Icon name="plus" size={12} /> Add condition
                    </button>
                    {SCOPED(r.trigger.kind) && r.trigger.typeId && (
                      <MatchPreview rule={r} typeName={typeName(r.trigger.typeId)} />
                    )}
                  </div>

                  {/* ---- actions ---- */}
                  <div className="auto-sect">
                    <span className="auto-step">Then</span>
                    {r.actions.map((a, i) => (
                      <div className="auto-line" key={a.id}>
                        <select
                          className="field"
                          value={a.kind}
                          onChange={(e) =>
                            patch(r.id, (x) => ({
                              ...x,
                              actions: x.actions.map((y, j) =>
                                j === i ? { id: y.id, kind: e.target.value as AutoActionKind } : y
                              ),
                            }))
                          }
                        >
                          {ACTIONS.map((o) => (
                            <option key={o.kind} value={o.kind}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        <ActionFields
                          action={a}
                          types={pickable}
                          props={trigProps}
                          propsOf={propsOf}
                          tokens={tokensFor(r)}
                          onChange={(next) =>
                            patch(r.id, (x) => ({ ...x, actions: x.actions.map((y, j) => (j === i ? next : y)) }))
                          }
                        />
                        {r.actions.length > 1 && (
                          <button
                            className="icon-btn"
                            aria-label="Remove action"
                            onClick={() => patch(r.id, (x) => ({ ...x, actions: x.actions.filter((_, j) => j !== i) }))}
                          >
                            <Icon name="x" size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                    <button className="auto-add" onClick={() => patch(r.id, (x) => ({ ...x, actions: [...x.actions, newAction()] }))}>
                      <Icon name="plus" size={12} /> Add action
                    </button>
                  </div>

                  <div className="auto-foot">
                    <button className="btn subtle" onClick={() => runNow(r)}>
                      <Icon name="zap" size={13} /> Run now
                    </button>
                    <span className="auto-when">
                      {r.runs ? `${r.runs} ${r.runs === 1 ? 'run' : 'runs'}` : 'never run'}
                      {r.lastRunAt ? ` · last ${ago(r.lastRunAt)}` : ''}
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}

      <div className="auto-new">
        <button
          className="add-prop"
          onClick={() => {
            const r = blank();
            save([...rules, r]);
            setOpen(r.id);
          }}
        >
          <Icon name="plus" size={13} /> Add rule
        </button>
        <button className="add-prop" onClick={(e) => setRecipes(popPos(e.currentTarget as HTMLElement, 320, 360))}>
          <Icon name="zap" size={13} /> Start from an example
        </button>
      </div>

      {recipes && (
        <>
          <div className="backdrop" onClick={() => setRecipes(null)} />
          <div className="popover recipe-menu" style={recipes}>
            <div className="menu-hint">Working rules you can open up and change.</div>
            {RECIPES.map((rec) => {
              const built = rec.build(types);
              return (
                <button
                  key={rec.id}
                  className="recipe"
                  disabled={!built}
                  title={built ? undefined : 'This vault has no type with the right properties yet.'}
                  onClick={() => {
                    if (!built) return;
                    save([...rules, built]);
                    setRecipes(null);
                    setOpen(built.id);
                  }}
                >
                  <span className="recipe-name">{rec.name}</span>
                  <span className="recipe-blurb">{rec.blurb}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * What the rule would act on right now. Shown live under the conditions, so a
 * scheduled rule can be checked without waiting for its hour to come round.
 */
function MatchPreview({ rule, typeName }: { rule: Automation; typeName: string }) {
  const [res, setRes] = useState<{ count: number; titles: string[] } | null>(null);
  const key = JSON.stringify([rule.trigger, rule.conditions, rule.match]);

  useEffect(() => {
    let alive = true;
    // Debounced: the rule changes on every keystroke in a condition.
    const t = setTimeout(() => {
      api.automations.preview(rule).then((r) => alive && setRes(r));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!res) return null;
  const label = typeName.toLowerCase();
  return (
    <div className="auto-preview">
      <Icon name="filter" size={12} />
      {res.count === 0 ? (
        <span>Nothing matches right now, so the rule would stay quiet.</span>
      ) : (
        <span>
          Matches <strong>{res.count}</strong> {res.count === 1 ? label : label + 's'} right now
          {res.titles.length > 0 && (
            <span className="auto-preview-list">
              {res.titles.join(' · ')}
              {res.count > res.titles.length ? ` · +${res.count - res.titles.length}` : ''}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

function ActionFields({
  action,
  types,
  props,
  propsOf,
  tokens,
  onChange,
}: {
  action: AutoAction;
  types: ObjType[];
  props: PropDef[];
  propsOf: (typeId?: string) => PropDef[];
  tokens: [string, string][];
  onChange: (a: AutoAction) => void;
}) {
  const set = (patch: Partial<AutoAction>) => onChange({ ...action, ...patch });

  if (action.kind === 'setProp')
    return (
      <>
        <select className="field" value={action.propId ?? ''} onChange={(e) => set({ propId: e.target.value })}>
          <option value="">property…</option>
          {props.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="auto-word">to</span>
        <ValueField def={props.find((p) => p.id === action.propId)} value={action.value ?? ''} onChange={(v) => set({ value: v })} />
      </>
    );

  if (action.kind === 'createObject') {
    const targetProps = propsOf(action.typeId);
    return (
      <>
        <select className="field" value={action.typeId ?? ''} onChange={(e) => set({ typeId: e.target.value })}>
          <option value="">type…</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <TokenField
          placeholder="Title — e.g. Follow up on {{title}}"
          value={action.text ?? ''}
          tokens={tokens}
          onChange={(v) => set({ text: v })}
        />
        {(action.props ?? []).map((p, i) => (
          <span className="auto-subline" key={i}>
            <select
              className="field"
              value={p.propId}
              onChange={(e) =>
                set({ props: (action.props ?? []).map((x, j) => (j === i ? { ...x, propId: e.target.value } : x)) })
              }
            >
              <option value="">property…</option>
              {targetProps.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <ValueField
              def={targetProps.find((d) => d.id === p.propId)}
              value={p.value}
              onChange={(v) => set({ props: (action.props ?? []).map((x, j) => (j === i ? { ...x, value: v } : x)) })}
            />
            <button
              className="icon-btn"
              aria-label="Remove value"
              onClick={() => set({ props: (action.props ?? []).filter((_, j) => j !== i) })}
            >
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        <button className="auto-add" onClick={() => set({ props: [...(action.props ?? []), { propId: '', value: '' }] })}>
          <Icon name="plus" size={12} /> with property
        </button>
        <label className="auto-check">
          <input type="checkbox" checked={!!action.mention} onChange={(e) => set({ mention: e.target.checked })} />
          link back to the source
        </label>
      </>
    );
  }

  if (action.kind === 'link')
    return (
      <>
        <select className="field" value={action.propId ?? ''} onChange={(e) => set({ propId: e.target.value })}>
          <option value="">relation property…</option>
          {props
            .filter((p) => p.kind === 'relation')
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        <span className="auto-word">to the one named</span>
        <input className="field auto-text" placeholder="Inbox" value={action.text ?? ''} onChange={(e) => set({ text: e.target.value })} />
      </>
    );

  if (action.kind === 'pin')
    return (
      <select className="field" value={action.value ?? 'true'} onChange={(e) => set({ value: e.target.value })}>
        <option value="true">pin it</option>
        <option value="false">unpin it</option>
      </select>
    );

  if (action.kind === 'notify' || action.kind === 'telegram')
    return (
      <>
        <TokenField
          placeholder={action.kind === 'telegram' ? 'Message — e.g. {{title}} is due' : 'Title'}
          value={action.text ?? ''}
          tokens={tokens}
          onChange={(v) => set({ text: v })}
        />
        <TokenField
          placeholder={action.kind === 'telegram' ? 'Second line (optional)' : 'Body (optional)'}
          value={action.value ?? ''}
          tokens={tokens}
          onChange={(v) => set({ value: v })}
        />
      </>
    );

  // addTag and appendDaily are both a single line of text.
  return (
    <TokenField
      placeholder={action.kind === 'addTag' ? 'tag name' : 'Line to add — e.g. Finished {{link}}'}
      value={action.text ?? ''}
      tokens={tokens}
      onChange={(v) => set({ text: v })}
    />
  );
}

const DATE_TOKENS: [string, string][] = [
  ['{{today}}', 'today’s date'],
  ['{{tomorrow}}', 'tomorrow’s date'],
  ['{{now}}', 'the time right now'],
  ['{{date+7}}', 'a week from today'],
];

const OBJECT_TOKENS: [string, string][] = [
  ['{{title}}', 'the object’s name'],
  ['{{link}}', 'a real link to it, not just its name'],
  ['{{type}}', 'its type'],
  ['{{prop:id}}', 'one of its properties, by id'],
];

const SET_TOKENS: [string, string][] = [
  ['{{count}}', 'how many matched'],
  ['{{list}}', 'all of them, as a list'],
];

/**
 * A text field that can tell you what it accepts. The tokens are the only part
 * of the builder you'd otherwise have to already know about.
 */
function TokenField({
  value,
  onChange,
  placeholder,
  tokens,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  tokens: [string, string][];
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const text = value ?? '';

  const insert = (token: string) => {
    const el = ref.current;
    const at = el && el.selectionStart != null ? el.selectionStart : text.length;
    onChange(text.slice(0, at) + token + text.slice(at));
    setPos(null);
    // Put the caret after what was just inserted, so you can keep typing.
    requestAnimationFrame(() => {
      el?.focus();
      const caret = at + token.length;
      el?.setSelectionRange(caret, caret);
    });
  };

  return (
    <span className="token-field">
      <input
        ref={ref}
        className="field auto-text"
        placeholder={placeholder}
        value={text}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        className="token-btn"
        title="Insert a value"
        aria-label="Insert a value"
        onClick={(e) => setPos(popPos(e.currentTarget as HTMLElement, 260, 300))}
      >
        {'{ }'}
      </button>
      {pos && (
        <>
          <div className="backdrop" onClick={() => setPos(null)} />
          <div className="popover token-menu" style={pos}>
            {tokens.map(([token, desc]) => (
              <button key={token} className="menu-item" onClick={() => insert(token)}>
                <code>{token}</code>
                <span className="token-desc">{desc}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

/** Select properties offer their options; everything else is free text. */
function ValueField({ def, value, onChange }: { def?: PropDef; value: string; onChange: (v: string) => void }) {
  if (def && (def.kind === 'select' || def.kind === 'multiselect'))
    return (
      <select className="field" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">choose…</option>
        {(def.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );

  if (def?.kind === 'checkbox')
    return (
      <select className="field" value={value || 'true'} onChange={(e) => onChange(e.target.value)}>
        <option value="true">checked</option>
        <option value="false">unchecked</option>
      </select>
    );

  return (
    <input
      className="field auto-val"
      placeholder={def?.kind === 'date' ? '{{today}}' : 'value'}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
