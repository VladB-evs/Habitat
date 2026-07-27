import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { api } from '../api';
import { dealtIn, spring, stagger } from '../motion';
import { onObjectChanged } from '../objects';
import { useApp } from '../store';
import type { NextBirthday, Person } from '../types';
import { avatarColor, birthdayCountdown, fmtBirthday, initials } from '../util';
import { Icon } from './Icons';

/** Initials on a colour that stays the same for a given name, everywhere in the app. */
export function Avatar({ name, size = 40, theme }: { name: string; size?: number; theme: string }) {
  const c = avatarColor(name, theme);
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        background: c.bg,
        color: c.fg,
        borderColor: c.border,
        fontSize: Math.round(size * 0.36),
      }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

/** The one-line "14 March · in 12 days · turns 34" a birthday deserves. */
export function birthdayLine(b: NextBirthday | null): string | null {
  if (!b) return null;
  const parts = [fmtBirthday(b.month, b.day), birthdayCountdown(b.days)];
  if (b.turning != null) parts.push(b.days === 0 ? `turns ${b.turning}` : `turning ${b.turning}`);
  return parts.join(' · ');
}

const workLine = (p: Person): string => [p.props.role, p.props.company].filter(Boolean).join(' · ');

/** One line under a name on a card: what they do, or failing that a way to reach them. */
function contactLine(p: Person): string {
  return workLine(p) || String(p.props.email || p.props.phone || p.props.location || '');
}

function PersonCard({ p, theme, onOpen }: { p: Person; theme: string; onOpen: (e: React.MouseEvent) => void }) {
  const sub = p.props.nickname ? `“${p.props.nickname}”` : '';
  const line = contactLine(p);
  const b = p.nextBirthday;
  return (
    <motion.button className="person-card" variants={dealtIn} whileHover={{ y: -3 }} whileTap={{ scale: 0.99 }} onClick={onOpen}>
      <Avatar name={p.title} theme={theme} size={42} />
      <span className="person-card-main">
        <span className="person-card-name">
          {p.title || 'Unnamed'}
          {sub && <em>{sub}</em>}
        </span>
        {line && <span className="person-card-sub">{line}</span>}
      </span>
      <span className="person-card-side">
        {p.props.relationship && <span className="rel-chip">{p.props.relationship}</span>}
        {b && b.days <= 30 && (
          <span className={'bday-pill' + (b.days === 0 ? ' today' : '')}>
            <Icon name="cake" size={11} /> {birthdayCountdown(b.days)}
          </span>
        )}
      </span>
    </motion.button>
  );
}

function PersonRow({ p, theme, onOpen }: { p: Person; theme: string; onOpen: (e: React.MouseEvent) => void }) {
  const b = p.nextBirthday;
  return (
    <motion.button className="person-row" variants={dealtIn} whileHover={{ x: 3 }} onClick={onOpen}>
      <Avatar name={p.title} theme={theme} size={28} />
      <span className="person-row-name">
        {p.title || 'Unnamed'}
        {p.props.nickname ? <em>“{p.props.nickname}”</em> : null}
      </span>
      {/* Work and contact are separate columns, so neither repeats the other. */}
      <span className="person-row-cell dim">{workLine(p)}</span>
      <span className="person-row-cell">{p.props.phone || p.props.email || p.props.location || ''}</span>
      <span className="person-row-cell">
        {b ? (
          <span className={'bday-pill' + (b.days === 0 ? ' today' : '')}>
            <Icon name="cake" size={11} /> {fmtBirthday(b.month, b.day)}
          </span>
        ) : null}
      </span>
      <span className="person-row-cell">{p.props.relationship ? <span className="rel-chip">{p.props.relationship}</span> : null}</span>
    </motion.button>
  );
}

/** The card for whoever owns this habitat — always first, never in the grid below. */
function SelfCard({ me, theme, onOpen, onCreate }: { me: Person | null; theme: string; onOpen: (e: React.MouseEvent) => void; onCreate: () => void }) {
  if (!me)
    return (
      <button className="self-card empty" onClick={onCreate}>
        <span className="self-avatar-slot">
          <Icon name="user" size={22} />
        </span>
        <span className="self-main">
          <span className="self-name">Add your own card</span>
          <span className="self-sub">Your name, birthday and details — the one card that’s about you.</span>
        </span>
        <Icon name="plus" size={16} />
      </button>
    );

  const b = me.nextBirthday;
  const facts = [
    b && `${fmtBirthday(b.month, b.day)}${b.age != null ? ` · ${b.age}` : ''}`,
    me.props.email,
    me.props.phone,
    me.props.location,
  ].filter(Boolean) as string[];

  return (
    <motion.button className="self-card" onClick={onOpen} whileHover={{ y: -2 }} transition={spring}>
      <Avatar name={me.title} theme={theme} size={56} />
      <span className="self-main">
        <span className="self-name">
          {me.title || 'You'}
          <span className="self-badge">This is you</span>
        </span>
        <span className="self-sub">{facts.length ? facts.join('  ·  ') : 'Nothing filled in yet — open your card to add details.'}</span>
      </span>
      <Icon name="chevron-right" size={16} />
    </motion.button>
  );
}

export function People() {
  const { theme, openFrom, openBeside } = useApp();
  const [people, setPeople] = useState<Person[]>([]);
  const [me, setMe] = useState<Person | null>(null);
  const [q, setQ] = useState('');
  const [rel, setRel] = useState('All');
  const [layout, setLayout] = useState<'cards' | 'list'>(
    () => (localStorage.getItem('habitat:people-layout') as 'cards' | 'list') || 'cards'
  );
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const addRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [list, self] = await Promise.all([api.people.list(), api.people.self()]);
    setPeople(list);
    setMe(self);
  }, []);

  useEffect(() => {
    load();
    // Editing someone on their own page, or from a mention chip, shows up here.
    return onObjectChanged(() => load());
  }, [load]);

  useEffect(() => {
    if (adding) addRef.current?.focus();
  }, [adding]);

  const others = useMemo(() => people.filter((p) => !p.isSelf), [people]);

  const upcoming = useMemo(
    () =>
      people
        .filter((p) => p.nextBirthday && p.nextBirthday.days <= 60)
        .sort((a, b) => a.nextBirthday!.days - b.nextBirthday!.days)
        .slice(0, 10),
    [people]
  );

  const relationships = useMemo(() => {
    const seen = new Map<string, number>();
    for (const p of others) {
      const r = String(p.props.relationship || '').trim();
      if (r) seen.set(r, (seen.get(r) ?? 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
  }, [others]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return others.filter((p) => {
      if (rel !== 'All' && String(p.props.relationship || '') !== rel) return false;
      if (!needle) return true;
      const hay = [p.title, p.props.nickname, p.props.company, p.props.role, p.props.email, p.props.phone, p.snippet]
        .map((v) => String(v || '').toLowerCase())
        .join(' ');
      return hay.includes(needle);
    });
  }, [others, q, rel]);

  const addPerson = async (name: string, self = false) => {
    const title = name.trim();
    if (!title) return;
    const made = await api.people.create({ title, self });
    setDraft('');
    setAdding(false);
    await load();
    if (made) openBeside(made.id);
  };

  const createSelf = async () => {
    const profile = await api.profile.get();
    const made = await api.people.create({ title: profile?.name?.trim() || 'Me', self: true });
    await load();
    if (made) openBeside(made.id);
  };

  const setLayoutMode = (mode: 'cards' | 'list') => {
    setLayout(mode);
    localStorage.setItem('habitat:people-layout', mode);
  };

  return (
    <div className="page people-page">
      <header className="page-head">
        <div className="page-title">
          <span className="type-emoji big">
            <Icon name="people" size={22} />
          </span>
          <h1>People</h1>
          <span className="count-badge">{people.length}</span>
        </div>
        <div className="people-tools">
          <div className="people-search">
            <Icon name="search" size={13} />
            <input placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} />
            {q && (
              <button className="icon-btn" onClick={() => setQ('')} aria-label="Clear search">
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
          <div className="seg mini">
            <button className={layout === 'cards' ? 'on' : ''} onClick={() => setLayoutMode('cards')} title="Cards">
              <Icon name="layout" size={13} />
            </button>
            <button className={layout === 'list' ? 'on' : ''} onClick={() => setLayoutMode('list')} title="List">
              <Icon name="rows3" size={13} />
            </button>
          </div>
          <button className="btn primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} /> Add person
          </button>
        </div>
      </header>

      <div className="people-body">
        <SelfCard me={me} theme={theme} onCreate={createSelf} onOpen={(e) => me && openFrom(e, me.id)} />

        {upcoming.length > 0 && (
          <section className="people-section">
            <h3>
              <Icon name="cake" size={13} /> Birthdays
            </h3>
            <div className="bday-strip">
              {upcoming.map((p) => (
                <button key={p.id} className={'bday-card' + (p.nextBirthday!.days === 0 ? ' today' : '')} onClick={(e) => openFrom(e, p.id)}>
                  <Avatar name={p.title} theme={theme} size={34} />
                  <span className="bday-name">{p.title || 'Unnamed'}</span>
                  <span className="bday-when">{birthdayCountdown(p.nextBirthday!.days)}</span>
                  <span className="bday-date">
                    {fmtBirthday(p.nextBirthday!.month, p.nextBirthday!.day)}
                    {p.nextBirthday!.turning != null ? ` · ${p.nextBirthday!.turning}` : ''}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="people-section">
          <div className="people-filter">
            <button className={'filter-chip' + (rel === 'All' ? ' on' : '')} onClick={() => setRel('All')}>
              Everyone <span className="filter-n">{others.length}</span>
            </button>
            {relationships.map((r) => (
              <button key={r} className={'filter-chip' + (rel === r ? ' on' : '')} onClick={() => setRel(r)}>
                {r}
              </button>
            ))}
          </div>

          {adding && (
            <div className="person-add">
              <span className="self-avatar-slot small">
                <Icon name="user" size={15} />
              </span>
              <input
                ref={addRef}
                className="person-add-input"
                placeholder="Name…"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addPerson(draft);
                  if (e.key === 'Escape') {
                    setDraft('');
                    setAdding(false);
                  }
                }}
                onBlur={() => draft.trim() === '' && setAdding(false)}
              />
              <button className="btn primary" onClick={() => addPerson(draft)}>
                Add
              </button>
            </div>
          )}

          {shown.length === 0 ? (
            <div className="empty">
              {others.length === 0
                ? 'Nobody here yet. Add the people you want to keep track of.'
                : 'Nobody matches that.'}
            </div>
          ) : layout === 'cards' ? (
            <motion.div className="people-grid" variants={stagger} initial="hidden" animate="shown">
              {shown.map((p) => (
                <PersonCard key={p.id} p={p} theme={theme} onOpen={(e) => openFrom(e, p.id)} />
              ))}
            </motion.div>
          ) : (
            <motion.div className="people-list" variants={stagger} initial="hidden" animate="shown">
              {shown.map((p) => (
                <PersonRow key={p.id} p={p} theme={theme} onOpen={(e) => openFrom(e, p.id)} />
              ))}
            </motion.div>
          )}
        </section>
      </div>
    </div>
  );
}
