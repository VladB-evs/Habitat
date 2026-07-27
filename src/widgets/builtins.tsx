import { useEffect, useState } from 'react';
import { api } from '../api';
import { DayTasks } from '../components/DayTasks';
import { Icon, TypeIcon } from '../components/Icons';
import { Avatar } from '../components/People';
import { motion } from 'motion/react';
import { dealtIn, stagger } from '../motion';
import { onObjectChanged } from '../objects';
import { useApp } from '../store';
import type { Person } from '../types';
import { ago, birthdayCountdown, fmtBirthday, greeting, PEOPLE_TYPE, todayKey, typeColor } from '../util';
import type { WidgetDef, WidgetProps, WidgetSettingsProps } from './kit';
import { useAutoHide, useDash } from './kit';

/* ---------- greeting ---------- */

function GreetingBody({ config }: WidgetProps) {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    api.profile.get().then((p) => setName(p?.name || null));
  }, []);

  const line = config.text || greeting();
  const dateLine = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="dash-greet">
      <h1>
        {line}
        {config.useName !== false && name ? `, ${name}` : ''}
      </h1>
      {config.showDate !== false && <div className="dash-date">{dateLine}</div>}
    </div>
  );
}

function GreetingSettings({ config, set }: WidgetSettingsProps) {
  return (
    <>
      <label className="w-field">
        <span>Greeting</span>
        <input
          className="field"
          placeholder="Time of day (Good morning…)"
          value={config.text || ''}
          onChange={(e) => set({ text: e.target.value })}
        />
      </label>
      <label className="w-check">
        <input type="checkbox" checked={config.useName !== false} onChange={(e) => set({ useName: e.target.checked })} />
        Include my name
      </label>
      <label className="w-check">
        <input
          type="checkbox"
          checked={config.showDate !== false}
          onChange={(e) => set({ showDate: e.target.checked })}
        />
        Show today's date
      </label>
    </>
  );
}

/* ---------- quick actions ---------- */

function QuickBody({ config }: WidgetProps) {
  const { types, navigate, openObject } = useApp();
  const [snippet, setSnippet] = useState('');
  const hasNote = types.some((t) => t.id === 'note');

  useEffect(() => {
    api.daily.list().then((l) => setSnippet(l.find((m) => m.dateKey === todayKey())?.snippet || ''));
  }, []);

  const newNote = async () => {
    const o = await api.objects.create({ typeId: 'note', title: '' });
    openObject(o.id);
  };

  return (
    <div className="quick-row">
      <button className="quick-card" onClick={() => navigate({ kind: 'daily' })}>
        <span className="q-icon">
          <Icon name="calendar" size={17} />
        </span>
        <span>
          <div className="q-label">Today's note</div>
          <div className="q-sub">{snippet || 'Nothing written yet — open your journal'}</div>
        </span>
      </button>
      {hasNote && config.newNote !== false && (
        <button className="quick-card" onClick={newNote}>
          <span className="q-icon">
            <Icon name="plus" size={17} />
          </span>
          <span>
            <div className="q-label">New note</div>
            <div className="q-sub">Capture something before it escapes</div>
          </span>
        </button>
      )}
    </div>
  );
}

/* ---------- type tiles ---------- */

function TilesBody() {
  const { types, navigate, theme } = useApp();
  const { stats } = useDash();
  const tiles = types.filter((t) => t.id !== 'daily' && t.starred);

  useAutoHide(tiles.length === 0);
  if (!tiles.length) return <div className="w-empty">No starred types — star one from its table header.</div>;

  return (
    <div className="tiles">
      {tiles.map((t) => (
        <button key={t.id} className="tile" onClick={() => navigate({ kind: 'type', typeId: t.id })}>
          <span className="tile-bar" style={{ background: typeColor(t.color, theme) }} />
          <div className="tile-emoji">
            <TypeIcon icon={t.icon} color={typeColor(t.color, theme)} size={20} />
          </div>
          <div className="tile-count">{stats?.counts[t.id] ?? 0}</div>
          <div className="tile-name">{t.name}s</div>
        </button>
      ))}
    </div>
  );
}

/* ---------- pinned ---------- */

function PinnedBody() {
  const { types, openFrom, theme } = useApp();
  const { stats } = useDash();
  const byId = new Map(types.map((t) => [t.id, t]));
  const pinned = stats?.pinned ?? [];

  useAutoHide(!!stats && pinned.length === 0);
  if (!pinned.length) return <div className="w-empty">Nothing pinned yet.</div>;

  return (
    <motion.div className="pinned-grid" variants={stagger} initial="hidden" animate="shown">
      {pinned.map((o) => {
        const t = byId.get(o.typeId);
        return (
          <motion.button
            key={o.id}
            className="card"
            variants={dealtIn}
            whileHover={{ y: -3, scale: 1.015 }}
            whileTap={{ scale: 0.985 }}
            onClick={(e) => openFrom(e, o.id)}
          >
            <div className="card-title">
              <TypeIcon icon={t?.icon} color={typeColor(t?.color, theme)} size={15} />
              {o.title || 'Untitled'}
            </div>
            {o.snippet && <div className="card-snippet">{o.snippet}</div>}
            <div className="card-type">
              <span className="legend-dot" style={{ background: typeColor(t?.color, theme) }} />
              {t?.name}
            </div>
          </motion.button>
        );
      })}
    </motion.div>
  );
}

/* ---------- today's tasks ---------- */

function TasksBody() {
  return <DayTasks dateKey={todayKey()} />;
}

/* ---------- recently edited ---------- */

function RecentBody({ config }: WidgetProps) {
  const { types, openFrom, theme } = useApp();
  const { stats } = useDash();
  const byId = new Map(types.map((t) => [t.id, t]));
  const rows = (stats?.recent ?? []).slice(0, config.limit || 8);

  useAutoHide(!!stats && rows.length === 0);
  if (!rows.length) return <div className="w-empty">Nothing here yet.</div>;

  return (
    <motion.div className="recent-list" variants={stagger} initial="hidden" animate="shown">
      {rows.map((o) => {
        const t = byId.get(o.typeId);
        return (
          <motion.button key={o.id} className="row" variants={dealtIn} whileHover={{ x: 3 }} onClick={(e) => openFrom(e, o.id)}>
            <span className="row-emoji">
              <TypeIcon icon={t?.icon} color={typeColor(t?.color, theme)} size={15} />
            </span>
            <span className="row-title">{o.title || 'Untitled'}</span>
            <span className="row-meta">{t?.name}</span>
            <span className="row-meta">{ago(o.updatedAt)}</span>
          </motion.button>
        );
      })}
    </motion.div>
  );
}

function RecentSettings({ config, set }: WidgetSettingsProps) {
  return (
    <label className="w-field">
      <span>Rows</span>
      <select className="field" value={config.limit || 8} onChange={(e) => set({ limit: Number(e.target.value) })}>
        {[3, 5, 8].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ---------- birthdays ---------- */

function BirthdaysBody({ config }: WidgetProps) {
  const { openFrom, theme } = useApp();
  const [people, setPeople] = useState<Person[]>([]);
  const within = Number(config.within) || 60;

  useEffect(() => {
    api.people.birthdays(within).then(setPeople);
    return onObjectChanged(() => api.people.birthdays(within).then(setPeople));
  }, [within]);

  const rows = people.slice(0, 6);
  useAutoHide(rows.length === 0);
  if (!rows.length) return <div className="w-empty">No birthdays coming up.</div>;

  return (
    <motion.div className="bday-widget" variants={stagger} initial="hidden" animate="shown">
      {rows.map((p) => (
        <motion.button
          key={p.id}
          className={'bday-widget-row' + (p.nextBirthday!.days === 0 ? ' today' : '')}
          variants={dealtIn}
          whileHover={{ x: 3 }}
          onClick={(e) => openFrom(e, p.id)}
        >
          <Avatar name={p.title} theme={theme} size={26} />
          <span className="row-title">{p.title || 'Unnamed'}</span>
          <span className="row-meta">{fmtBirthday(p.nextBirthday!.month, p.nextBirthday!.day)}</span>
          <span className={'bday-pill' + (p.nextBirthday!.days === 0 ? ' today' : '')}>
            <Icon name="cake" size={11} /> {birthdayCountdown(p.nextBirthday!.days)}
          </span>
        </motion.button>
      ))}
    </motion.div>
  );
}

function BirthdaysSettings({ config, set }: WidgetSettingsProps) {
  return (
    <label className="w-field">
      <span>Look ahead</span>
      <select className="field" value={config.within || 60} onChange={(e) => set({ within: Number(e.target.value) })}>
        {[14, 30, 60, 90, 365].map((n) => (
          <option key={n} value={n}>
            {n === 365 ? 'A year' : `${n} days`}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ---------- definitions ---------- */

export const BUILTIN_WIDGETS: WidgetDef[] = [
  {
    kind: 'greeting',
    name: 'Greeting',
    desc: 'Time-of-day hello with your name and today’s date.',
    icon: 'sun',
    group: 'Habitat',
    singleton: true,
    center: true,
    defaultW: 3,
    defaultH: 1,
    defaultConfig: { useName: true, showDate: true },
    Body: GreetingBody,
    Settings: GreetingSettings,
  },
  {
    kind: 'quick',
    name: 'Quick actions',
    desc: 'Jump into today’s note or start a new one.',
    icon: 'zap',
    group: 'Habitat',
    singleton: true,
    center: true,
    defaultW: 3,
    defaultH: 1,
    defaultConfig: { newNote: true },
    Body: QuickBody,
  },
  {
    kind: 'tiles',
    name: 'Object tiles',
    desc: 'One counted tile per starred type.',
    icon: 'grid',
    group: 'Habitat',
    singleton: true,
    defaultW: 6,
    defaultH: 2,
    title: () => 'Your objects',
    Body: TilesBody,
  },
  {
    kind: 'pinned',
    name: 'Pinned',
    desc: 'Everything you’ve pinned, as cards.',
    icon: 'star',
    group: 'Habitat',
    singleton: true,
    defaultW: 6,
    defaultH: 2,
    title: () => 'Pinned',
    Body: PinnedBody,
  },
  {
    kind: 'tasks',
    name: "Today's tasks",
    desc: 'Tick off what’s due today, and add more.',
    icon: 'list-todo',
    group: 'Habitat',
    singleton: true,
    defaultW: 3,
    defaultH: 3,
    minW: 2,
    title: () => "Today's tasks",
    requires: (types) => types.some((t) => t.id === 'task'),
    Body: TasksBody,
  },
  {
    kind: 'birthdays',
    name: 'Birthdays',
    desc: 'Who’s got one coming up, and how soon.',
    icon: 'cake',
    group: 'Habitat',
    singleton: true,
    defaultW: 3,
    defaultH: 3,
    minW: 2,
    title: () => 'Birthdays',
    defaultConfig: { within: 60 },
    requires: (types) => types.some((t) => t.id === PEOPLE_TYPE),
    Body: BirthdaysBody,
    Settings: BirthdaysSettings,
  },
  {
    kind: 'recent',
    name: 'Recently edited',
    desc: 'The objects you touched last.',
    icon: 'clock',
    group: 'Habitat',
    singleton: true,
    defaultW: 3,
    defaultH: 3,
    minW: 2,
    title: () => 'Recently edited',
    defaultConfig: { limit: 8 },
    Body: RecentBody,
    Settings: RecentSettings,
  },
];
