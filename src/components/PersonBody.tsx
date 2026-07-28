import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { NextBirthday, Obj, PersonFieldGroup, PropDef } from '../types';
import { personProps } from '../util';
import { Avatar, birthdayLine, RelChips } from './People';
import { Cell, popPos } from './cells';
import { Icon } from './Icons';
import { PropEditor } from './PropEditor';

/**
 * Picks one of the predefined extra details, or opens the full property editor
 * for something the catalogue doesn't cover. Fields already on this person are
 * left out, so the list only ever offers something new.
 */
function FieldPicker({
  taken,
  pos,
  onPick,
  onCustom,
  onClose,
}: {
  taken: Set<string>;
  pos: { left: number; top: number };
  onPick: (def: PropDef) => void;
  onCustom: () => void;
  onClose: () => void;
}) {
  const [groups, setGroups] = useState<PersonFieldGroup[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    api.people.fields().then(setGroups);
  }, []);

  const needle = q.trim().toLowerCase();
  const filtered = groups
    .map((g) => ({ ...g, fields: g.fields.filter((f) => !taken.has(f.id) && f.name.toLowerCase().includes(needle)) }))
    .filter((g) => g.fields.length);

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="popover field-picker" style={pos}>
        <input
          className="popover-search"
          placeholder="Search details…"
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
        />
        <div className="popover-list">
          {filtered.map((g) => (
            <div key={g.group}>
              <div className="picker-group">{g.group}</div>
              {g.fields.map((f) => (
                <button key={f.id} className="menu-item" onClick={() => onPick(f)}>
                  {f.name}
                </button>
              ))}
            </div>
          ))}
          {!filtered.length && <div className="empty" style={{ padding: 16 }}>Nothing left to add here.</div>}
        </div>
        <div className="menu-sep" />
        <button className="menu-item" onClick={onCustom}>
          <Icon name="plus" size={13} /> Something else…
        </button>
      </div>
    </>
  );
}

/**
 * A person's page: a header that reads like a contact card, then their details,
 * then anything written about them. Core details come from the People type;
 * the rest are this person's own, added from the catalogue. The user's own card
 * is the same page minus what can only be true of someone else.
 */
export function PersonBody({
  obj,
  typeDefs,
  isSelf,
  onTitle,
  onProp,
  onExtraChange,
  children,
}: {
  obj: Obj;
  typeDefs: PropDef[];
  isSelf: boolean;
  onTitle: (v: string) => void;
  onProp: (propId: string, value: any) => void;
  onExtraChange: (defs: PropDef[]) => void;
  /** The note editor, kept in the page shell so every object type saves it the same way. */
  children: ReactNode;
}) {
  const { theme } = useApp();
  const [title, setTitle] = useState(obj.title);
  const [picker, setPicker] = useState<{ left: number; top: number } | null>(null);
  const [editor, setEditor] = useState<{ initial?: PropDef; pos: { left: number; top: number } } | null>(null);

  useEffect(() => setTitle(obj.title), [obj.id]);

  // Shown: what this card actually has. Taken: every id that is spoken for,
  // hidden ones included, so the picker can't offer one back.
  const shown = useMemo(() => personProps(typeDefs, isSelf), [typeDefs, isSelf]);
  const taken = useMemo(
    () => new Set([...typeDefs.map((p) => p.id), ...obj.extraProps.map((p) => p.id)]),
    [typeDefs, obj.extraProps]
  );

  const saveExtra = (def: PropDef) => {
    const i = obj.extraProps.findIndex((p) => p.id === def.id);
    const next = [...obj.extraProps];
    if (i >= 0) next[i] = def;
    else next.push(def);
    onExtraChange(next);
  };

  const bday = birthdayLine(localBirthday(String(obj.props.birthday ?? '')));

  const quick: { icon: string; label: string; href: string }[] = [];
  if (obj.props.phone) quick.push({ icon: 'phone', label: 'Call', href: 'tel:' + String(obj.props.phone).replace(/\s+/g, '') });
  if (obj.props.email) quick.push({ icon: 'mail', label: 'Email', href: 'mailto:' + obj.props.email });
  if (obj.props.website) quick.push({ icon: 'globe', label: 'Website', href: withScheme(String(obj.props.website)) });

  return (
    <div className="person-page">
      <div className="person-hero">
        <Avatar name={title || '?'} theme={theme} size={72} />
        <div className="person-hero-main">
          <input
            className="person-name"
            value={title}
            placeholder="Name"
            onChange={(e) => {
              setTitle(e.target.value);
              onTitle(e.target.value);
            }}
          />
          <div className="person-hero-meta">
            {obj.props.nickname ? <span className="person-nick">“{obj.props.nickname}”</span> : null}
            {/* Their whole list here — this is the page about them. */}
            {!isSelf && <RelChips value={obj.props.relationship} max={Infinity} />}
            {[obj.props.role, obj.props.company].filter(Boolean).length > 0 && (
              <span className="person-work">
                <Icon name="briefcase" size={12} /> {[obj.props.role, obj.props.company].filter(Boolean).join(' · ')}
              </span>
            )}
            {bday && (
              <span className="person-work">
                <Icon name="cake" size={12} /> {bday}
              </span>
            )}
          </div>
        </div>
        {/* Whose card this is isn't a setting: the self card is made once, as its own thing. */}
        {isSelf && (
          <span className="self-mark" title="Your own card">
            <Icon name="user" size={13} /> This is you
          </span>
        )}
      </div>

      {quick.length > 0 && (
        <div className="person-quick">
          {quick.map((a) => (
            <button key={a.label} className="quick-action" onClick={() => window.open(a.href)}>
              <Icon name={a.icon} size={14} /> {a.label}
            </button>
          ))}
        </div>
      )}

      <div className="obj-props person-props">
        {shown.map((p) => (
          <div className="obj-prop" key={p.id}>
            <label>{p.name}</label>
            <div className="prop-control">
              <Cell def={p} value={obj.props[p.id]} onChange={(v) => onProp(p.id, v)} />
            </div>
          </div>
        ))}
        {obj.extraProps.map((p) => (
          <div className="obj-prop" key={p.id}>
            <label>
              {p.name}
              <button
                className="prop-edit"
                aria-label="Edit detail"
                onClick={(e) => setEditor({ initial: p, pos: popPos(e.currentTarget as HTMLElement, 260, 320) })}
              >
                <Icon name="pencil" size={11} />
              </button>
            </label>
            <div className="prop-control">
              <Cell def={p} value={obj.props[p.id]} onChange={(v) => onProp(p.id, v)} />
            </div>
          </div>
        ))}
        <button className="add-prop" onClick={(e) => setPicker(popPos(e.currentTarget as HTMLElement, 260, 340))}>
          <Icon name="plus" size={13} /> Add detail
        </button>
      </div>

      {picker && (
        <FieldPicker
          taken={taken}
          pos={picker}
          onClose={() => setPicker(null)}
          onPick={(def) => {
            saveExtra(def);
            setPicker(null);
          }}
          onCustom={() => {
            const pos = picker;
            setPicker(null);
            setEditor({ pos });
          }}
        />
      )}

      {editor && (
        <PropEditor
          initial={editor.initial}
          pos={editor.pos}
          onSave={saveExtra}
          onClose={() => setEditor(null)}
          onDelete={editor.initial ? () => onExtraChange(obj.extraProps.filter((p) => p.id !== editor.initial!.id)) : undefined}
        />
      )}

      <div className="person-notes">
        <h3>
          <Icon name="doc" size={13} /> Notes
        </h3>
        {children}
      </div>
    </div>
  );
}

const withScheme = (v: string) => (/^https?:\/\//i.test(v) ? v : 'https://' + v);

/** The same maths the main process does, so the header updates as soon as a date is typed. */
function localBirthday(value: string): NextBirthday | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(today.getFullYear(), month - 1, day);
  if (next < today) next = new Date(today.getFullYear() + 1, month - 1, day);
  const days = Math.round((next.getTime() - today.getTime()) / 86400000);
  const turning = year >= 1900 ? next.getFullYear() - year : null;
  return {
    date: value,
    month,
    day,
    days,
    key: '',
    turning,
    age: turning == null ? null : days === 0 ? turning : turning - 1,
  };
}
