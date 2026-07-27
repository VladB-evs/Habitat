import { useEffect, useState } from 'react';
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
} from '../types';
import { ago, clientUid } from '../util';
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

const OPS: { op: AutoOp; label: string }[] = [
  { op: 'eq', label: 'is' },
  { op: 'ne', label: 'is not' },
  { op: 'contains', label: 'contains' },
  { op: 'gt', label: 'is more than' },
  { op: 'lt', label: 'is less than' },
  { op: 'empty', label: 'is empty' },
  { op: 'notEmpty', label: 'is not empty' },
];

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const TIMED = (k: AutoTriggerKind) =>
  k === 'daily' || k === 'weekly' || k === 'dueToday' || k === 'birthday' || k === 'appStart';
const NEEDS_VALUE = (op: AutoOp) => op !== 'empty' && op !== 'notEmpty';

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

/** A one-line English summary of the rule, shown on the card header. */
function describe(r: Automation, types: ObjType[]): string {
  const typeName = (id?: string) => types.find((t) => t.id === id)?.name ?? 'any object';
  const t = r.trigger;
  const when =
    t.kind === 'daily'
      ? `every day at ${t.time || '09:00'}`
      : t.kind === 'weekly'
      ? `${(t.days ?? []).map((d) => DAYS[d]).join('') || 'no days'} at ${t.time || '09:00'}`
      : t.kind === 'dueToday'
      ? `a ${typeName(t.typeId)} date is ${!t.offset ? 'today' : t.offset > 0 ? `in ${t.offset}d` : `${-t.offset}d overdue`}`
      : t.kind === 'birthday'
      ? `a birthday is ${!t.offset ? 'today' : `${Math.abs(t.offset)}d away`}`
      : t.kind === 'appStart'
      ? 'Habitat opens'
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

/** Rule builder: trigger, optional conditions, a list of actions. */
export function Automations() {
  const { types } = useApp();
  const [rules, setRules] = useState<Automation[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [ran, setRan] = useState<{ id: string; n: number } | null>(null);
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

  const runNow = async (r: Automation) => {
    const res = await api.automations.run(r.id);
    setRan({ id: r.id, n: res?.ran ?? 0 });
    api.automations.list().then(setRules);
    setTimeout(() => setRan(null), 4000);
  };

  return (
    <div className="autos">
      <div className="s-hint">
        Rules run inside Habitat as your data changes — nothing leaves the vault. Text fields understand{' '}
        <code>{'{{link}}'}</code> (a real link to the object, not just its name), <code>{'{{title}}'}</code>,{' '}
        <code>{'{{type}}'}</code>, <code>{'{{prop:id}}'}</code>, <code>{'{{today}}'}</code>, <code>{'{{tomorrow}}'}</code>,{' '}
        <code>{'{{now}}'}</code> and <code>{'{{date+7}}'}</code>.
      </div>

      {rules.map((r) => {
        const expanded = open === r.id;
        const trigProps = propsOf(r.trigger.typeId);
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
                            {OPS.map((o) => (
                              <option key={o.op} value={o.op}>
                                {o.label}
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
                    {(r.conditions ?? []).map((c, i) => (
                      <div className="auto-line" key={i}>
                        <select
                          className="field"
                          value={c.propId}
                          onChange={(e) =>
                            patch(r.id, (x) => ({
                              ...x,
                              conditions: x.conditions.map((y, j) => (j === i ? { ...y, propId: e.target.value } : y)),
                            }))
                          }
                        >
                          <option value="__title">Name</option>
                          {trigProps.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                        <select
                          className="field"
                          value={c.op}
                          onChange={(e) =>
                            patch(r.id, (x) => ({
                              ...x,
                              conditions: x.conditions.map((y, j) => (j === i ? { ...y, op: e.target.value as AutoOp } : y)),
                            }))
                          }
                        >
                          {OPS.map((o) => (
                            <option key={o.op} value={o.op}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        {NEEDS_VALUE(c.op) && (
                          <ValueField
                            def={trigProps.find((p) => p.id === c.propId)}
                            value={c.value ?? ''}
                            onChange={(v) =>
                              patch(r.id, (x) => ({
                                ...x,
                                conditions: x.conditions.map((y, j) => (j === i ? { ...y, value: v } : y)),
                              }))
                            }
                          />
                        )}
                        <button
                          className="icon-btn"
                          aria-label="Remove condition"
                          onClick={() => patch(r.id, (x) => ({ ...x, conditions: x.conditions.filter((_, j) => j !== i) }))}
                        >
                          <Icon name="x" size={12} />
                        </button>
                      </div>
                    ))}
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
    </div>
  );
}

function ActionFields({
  action,
  types,
  props,
  propsOf,
  onChange,
}: {
  action: AutoAction;
  types: ObjType[];
  props: PropDef[];
  propsOf: (typeId?: string) => PropDef[];
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
        <input
          className="field auto-text"
          placeholder="Title — e.g. Follow up on {{title}}"
          value={action.text ?? ''}
          onChange={(e) => set({ text: e.target.value })}
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
        <input
          className="field auto-text"
          placeholder={action.kind === 'telegram' ? 'Message — e.g. {{title}} is due' : 'Title'}
          value={action.text ?? ''}
          onChange={(e) => set({ text: e.target.value })}
        />
        <input
          className="field auto-text"
          placeholder={action.kind === 'telegram' ? 'Second line (optional)' : 'Body (optional)'}
          value={action.value ?? ''}
          onChange={(e) => set({ value: e.target.value })}
        />
      </>
    );

  // addTag and appendDaily are both a single line of text.
  return (
    <input
      className="field auto-text"
      placeholder={action.kind === 'addTag' ? 'tag name' : 'Line to add — e.g. Finished {{link}}'}
      value={action.text ?? ''}
      onChange={(e) => set({ text: e.target.value })}
    />
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
