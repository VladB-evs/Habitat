import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { DayTasks } from '../components/DayTasks';
import { Icon, TypeIcon } from '../components/Icons';
import { Avatar } from '../components/People';
import { MOODS, moodMeta } from '../components/MoodPicker';
import { motion } from 'motion/react';
import { dealtIn, stagger } from '../motion';
import { objectChanged, onObjectChanged } from '../objects';
import { useApp } from '../store';
import type { Agenda, AgendaDay, AgendaEvent, AgendaTask, DailyMeta, Person, StudyOverview } from '../types';
import { addDays, ago, birthdayCountdown, fmtBirthday, greeting, PEOPLE_TYPE, todayKey, typeColor } from '../util';
import type { WidgetDef, WidgetProps, WidgetSettingsProps } from './kit';
import { useAutoHide, useDash } from './kit';

/* ---------- greeting ---------- */

function GreetingBody({ config }: WidgetProps) {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    api.profile.get().then((p) => setName(p?.name || null));
  }, []);

  const now = new Date();
  const hr = now.getHours();
  const timeIcon = hr < 12 ? 'sunrise' : hr < 18 ? 'sun' : 'moon';
  const line = config.text || greeting();
  const dateLine = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="dash-greet">
      <div className="dash-greet-head">
        <span className="dash-greet-icon">
          <Icon name={timeIcon} size={22} />
        </span>
        <h1>
          {line}
          {config.useName !== false && name ? `, ${name}` : ''}
        </h1>
      </div>
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
        <span className="q-text">
          <div className="q-label">Today's note</div>
          <div className="q-sub">{snippet || 'Nothing written yet — open your journal'}</div>
        </span>
      </button>
      {hasNote && config.newNote !== false && (
        <button className="quick-card" onClick={newNote}>
          <span className="q-icon">
            <Icon name="plus" size={17} />
          </span>
          <span className="q-text">
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
  if (!pinned.length) return <div className="w-empty">Nothing pinned yet. Pin any note or card to see it here.</div>;

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

function TasksBody({ h = 3 }: WidgetProps) {
  // Height math: h=2 -> ~200px, h=3 -> ~308px. Title takes 28px, padding 14px*2 = 28px.
  // Each task item is ~33px. Reserve 1 slot for 'Add task' or 'More'.
  const availableH = Math.max(60, h * 108 - 16 - 32);
  const maxTasks = Math.max(1, Math.floor((availableH - 36) / 33));
  return <DayTasks dateKey={todayKey()} maxTasks={maxTasks} />;
}

/* ---------- recently edited ---------- */

function RecentBody({ config, h = 3 }: WidgetProps) {
  const { types, openFrom, theme } = useApp();
  const { stats } = useDash();
  const byId = new Map(types.map((t) => [t.id, t]));
  const availableH = Math.max(40, h * 108 - 16 - 32);
  const maxFit = Math.max(1, Math.floor(availableH / 32));
  const limit = Math.min(config.limit || 8, maxFit);
  const rows = (stats?.recent ?? []).slice(0, limit);

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
        {[3, 5, 8, 12].map((n) => (
          <option key={n} value={n}>
            {n} rows
          </option>
        ))}
      </select>
    </label>
  );
}

/* ---------- upcoming birthdays ---------- */

function BirthdaysBody({ config, h = 3 }: WidgetProps) {
  const { openFrom, theme } = useApp();
  const [people, setPeople] = useState<Person[]>([]);
  const within = Number(config.within) || 60;

  useEffect(() => {
    api.people.birthdays(within).then(setPeople);
    return onObjectChanged(() => api.people.birthdays(within).then(setPeople));
  }, [within]);

  const maxFit = Math.max(1, Math.floor((h * 108 - 16 - 32) / 36));
  const rows = people.slice(0, maxFit);
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

/* ---------- upcoming events + agenda ---------- */

function AgendaBody({ config, h = 3 }: WidgetProps) {
  const { openFrom, types, theme } = useApp();
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const days = Number(config.days) || 3;
  const today = todayKey();

  const load = () => api.tasks.agenda(today, days).then(setAgenda);

  useEffect(() => {
    load();
    return onObjectChanged(load);
  }, [days, today]);

  const typeMap = new Map(types.map((t) => [t.id, t]));

  const toggleTask = (t: AgendaTask, dayKey: string) => {
    api.tasks.setDone({ id: t.id, dayKey, done: !t.done }).then(() => {
      objectChanged(t.id);
      load();
    });
  };

  const hasEvents = (agenda?.days ?? []).some((d) => (d.events?.length ?? 0) > 0 || (d.tasks?.length ?? 0) > 0);

  if (!hasEvents) {
    return (
      <div className="ag-empty">
        <span className="ag-empty-icon">
          <Icon name="calendar" size={22} />
        </span>
        <div className="ag-empty-text">Nothing scheduled for the next {days} {days === 1 ? 'day' : 'days'}.</div>
      </div>
    );
  }

  // Calculate available capacity based on widget height:
  // Each day section has a header (~28px), and each item is ~34px.
  const maxTotalItems = Math.max(2, Math.floor((h * 108 - 16 - 36) / 36));
  let renderedItems = 0;

  return (
    <div className="w-agenda">
      {agenda?.days.map((day: AgendaDay) => {
        if (renderedItems >= maxTotalItems) return null;
        const availableSlots = maxTotalItems - renderedItems;
        const events = (day.events ?? []).slice(0, availableSlots);
        const tasksSlots = availableSlots - events.length;
        const tasks = (day.tasks ?? []).slice(0, tasksSlots);
        const count = events.length + tasks.length;
        if (!count) return null;
        renderedItems += count;

        const isToday = day.dayKey === today;
        const d = new Date(day.dayKey + 'T12:00:00');
        const heading = isToday
          ? 'Today'
          : day.dayKey === addDays(today, 1)
          ? 'Tomorrow'
          : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

        return (
          <div key={day.dayKey} className="ag-day-section">
            <div className="ag-day-header">
              <span className={'ag-day-pill' + (isToday ? ' today' : '')}>{heading}</span>
              <span className="ag-day-sub">{d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            </div>
            <div className="ag-items-list">
              {events.map((e: AgendaEvent) => {
                const t = typeMap.get(e.typeId);
                const color = t ? typeColor(t.color, theme) : 'var(--accent)';
                const timeStr =
                  e.startMinute !== null
                    ? new Date(2000, 0, 1, Math.floor(e.startMinute / 60), e.startMinute % 60).toLocaleTimeString(
                        undefined,
                        { hour: 'numeric', minute: '2-digit' }
                      )
                    : 'All day';

                return (
                  <button
                    key={e.id + (e.repeats ? e.dayKey : '')}
                    className="ag-item event"
                    onClick={(ev) => openFrom(ev, e.id, e.repeats ? e.dayKey : undefined)}
                  >
                    <span className="ag-time" style={{ color }}>{timeStr}</span>
                    <span className="ag-dot" style={{ background: color }} />
                    <span className="ag-title">{e.title || 'Untitled event'}</span>
                  </button>
                );
              })}
              {tasks.map((t: AgendaTask) => (
                <div key={t.id} className={'ag-item task' + (t.done ? ' done' : '')}>
                  <button className={'tick' + (t.done ? ' on' : '')} onClick={() => toggleTask(t, day.dayKey)}>
                    {t.done && <Icon name="check" size={11} />}
                  </button>
                  <button className="ag-title" onClick={(ev) => openFrom(ev, t.id)}>
                    {t.title || 'Untitled'}
                  </button>
                  {t.overdue && <span className="rolled-badge">Overdue</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AgendaSettings({ config, set }: WidgetSettingsProps) {
  return (
    <label className="w-field">
      <span>Look ahead</span>
      <select className="field" value={config.days || 3} onChange={(e) => set({ days: Number(e.target.value) })}>
        <option value={1}>Today only</option>
        <option value={3}>Next 3 days</option>
        <option value={7}>Next 7 days</option>
        <option value={14}>Next 2 weeks</option>
      </select>
    </label>
  );
}

/* ---------- quick scratchpad / memo ---------- */

function ScratchpadBody({ config, set }: WidgetProps) {
  const { openObject } = useApp();
  const [text, setText] = useState(config.text ?? '');
  const [copied, setCopied] = useState(false);
  const color = config.color || 'yellow';
  const isTypingRef = useRef(false);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    if (!isTypingRef.current) {
      setText(config.text ?? '');
    }
  }, [config.text]);

  const handleChange = (val: string) => {
    setText(val);
    isTypingRef.current = true;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      isTypingRef.current = false;
      set?.({ text: val });
    }, 350);
  };

  const copy = () => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const saveAsNote = async () => {
    if (!text.trim()) return;
    const lines = text.trim().split('\n');
    const title = lines[0].slice(0, 60);
    const body = lines.slice(1).join('\n');
    const note = await api.objects.create({
      typeId: 'note',
      title,
      content: body ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: body }] }] } : null,
    });
    openObject(note.id);
  };

  const clear = () => {
    setText('');
    set?.({ text: '' });
  };

  return (
    <div className={'w-scratchpad ' + color}>
      <textarea
        className="scratch-textarea"
        placeholder="Type a quick thought, paste a link, or scratchpad notes…"
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck
      />
      <div className="scratch-footer">
        <span className="scratch-hint">{text.length ? `${text.length} chars` : 'Auto-saves instantly'}</span>
        <div className="scratch-actions">
          {text.trim() && (
            <>
              <button className="scratch-action-btn" onClick={saveAsNote} title="Convert to Note object">
                <Icon name="doc" size={12} /> Convert
              </button>
              <button className="scratch-action-btn" onClick={copy} title="Copy text">
                <Icon name={copied ? 'check' : 'copy'} size={12} /> {copied ? 'Copied' : 'Copy'}
              </button>
              <button className="scratch-action-btn danger" onClick={clear} title="Clear">
                <Icon name="trash" size={12} />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ScratchpadSettings({ config, set }: WidgetSettingsProps) {
  return (
    <label className="w-field">
      <span>Color theme</span>
      <select className="field" value={config.color || 'yellow'} onChange={(e) => set({ color: e.target.value })}>
        <option value="yellow">Amber Yellow</option>
        <option value="sage">Sage Green</option>
        <option value="lavender">Lavender Purple</option>
        <option value="sky">Sky Blue</option>
        <option value="slate">Classic Slate</option>
      </select>
    </label>
  );
}

/* ---------- daily habit & mood check-in ---------- */

function HabitsBody({ w = 3, h = 2 }: WidgetProps) {
  const { navigate } = useApp();
  const [metas, setMetas] = useState<DailyMeta[]>([]);
  const [todayNote, setTodayNote] = useState<any>(null);
  const today = todayKey();

  useEffect(() => {
    api.daily.list().then(setMetas);
    api.daily.get(today).then(setTodayNote);
    return onObjectChanged(() => {
      api.daily.list().then(setMetas);
      api.daily.get(today).then(setTodayNote);
    });
  }, [today]);

  // Calculate journal streak
  const sortedDays = [...metas].map((m) => m.dateKey).filter(Boolean).sort().reverse();
  const daySet = new Set(sortedDays);
  let streak = 0;
  let check = today;
  if (daySet.has(check) || daySet.has(addDays(check, -1))) {
    if (!daySet.has(check)) check = addDays(check, -1);
    while (daySet.has(check)) {
      streak++;
      check = addDays(check, -1);
    }
  }

  // Last 7 days dot history
  const last7 = Array.from({ length: 7 }, (_, i) => addDays(today, -(6 - i)));

  const onSelectMood = async (score: number | null) => {
    let target = todayNote;
    if (!target) {
      if (score === null) return;
      target = await api.daily.create(today, null);
    }
    const props = { ...target.props };
    if (score === null) delete props.mood;
    else props.mood = score;
    target = { ...target, props };
    setTodayNote(target);
    await api.objects.update(target.id, { props });
    api.daily.list().then(setMetas);
  };

  const metaByDate = new Map(metas.map((m) => [m.dateKey, m]));
  const currentMood = todayNote?.props?.mood;

  // Dedicated compact 1-row view when h === 1
  if (h === 1) {
    return (
      <div className="w-habits h-1">
        <div className="habits-header compact">
          <div
            className="habits-streak"
            onClick={() => navigate({ kind: 'daily' })}
            style={{ cursor: 'pointer' }}
            title="Open Daily Journal"
          >
            <span className="habits-flame">
              <Icon name="flame" size={16} />
            </span>
            <span className="habits-count">{streak}</span>
            <span className="habits-streak-label">{streak === 1 ? 'day' : 'days'}</span>
          </div>
          <div className="habits-dots">
            {last7.map((d) => {
              const m = metaByDate.get(d);
              const hasNote = !!m;
              const mood = m?.mood;
              const moodInfo = mood ? moodMeta(mood) : null;
              const isToday = d === today;
              return (
                <div
                  key={d}
                  className={'habit-dot' + (hasNote ? ' active' : '') + (isToday ? ' today' : '')}
                  style={moodInfo ? { background: moodInfo.color, borderColor: moodInfo.color } : undefined}
                  title={`${new Date(d + 'T12:00:00').toLocaleDateString(undefined, {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                  })}: ${hasNote ? 'Entry logged' : 'No entry'}`}
                />
              );
            })}
          </div>
        </div>

        <div className="habits-mood-buttons compact">
          {MOODS.map((m) => {
            const on = currentMood === m.score;
            return (
              <button
                key={m.score}
                type="button"
                className={'h-mood-btn icon-only' + (on ? ' on' : '')}
                style={{ '--mood-c': m.color } as any}
                onClick={() => onSelectMood(on ? null : m.score)}
                title={m.label}
              >
                <Icon name={m.icon} size={15} />
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Full rich view when h >= 2 (fills space beautifully, no empty void)
  const isNarrow = w != null && w <= 2;

  return (
    <div className="w-habits">
      <div className="habits-header">
        <div className="habits-streak">
          <span className="habits-flame">
            <Icon name="flame" size={18} />
          </span>
          <span className="habits-count">{streak}</span>
          <span className="habits-streak-label">{streak === 1 ? 'day streak' : 'days streak'}</span>
        </div>
        <div className="habits-dots">
          {last7.map((d) => {
            const m = metaByDate.get(d);
            const hasNote = !!m;
            const mood = m?.mood;
            const moodInfo = mood ? moodMeta(mood) : null;
            const isToday = d === today;
            return (
              <div
                key={d}
                className={'habit-dot' + (hasNote ? ' active' : '') + (isToday ? ' today' : '')}
                style={moodInfo ? { background: moodInfo.color, borderColor: moodInfo.color } : undefined}
                title={`${new Date(d + 'T12:00:00').toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}: ${hasNote ? 'Entry logged' : 'No entry'}`}
              />
            );
          })}
        </div>
      </div>

      <div className="habits-mood-section">
        <div className="habits-mood-label">How are you feeling today?</div>
        <div className="habits-mood-buttons">
          {MOODS.map((m) => {
            const on = currentMood === m.score;
            return (
              <button
                key={m.score}
                type="button"
                className={'h-mood-btn' + (on ? ' on' : '') + (isNarrow ? ' icon-only' : '')}
                style={{ '--mood-c': m.color } as any}
                onClick={() => onSelectMood(on ? null : m.score)}
                title={m.label}
              >
                <Icon name={m.icon} size={16} />
                {!isNarrow && <span>{m.label}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <button className="habits-journal-btn" onClick={() => navigate({ kind: 'daily' })}>
        <Icon name="calendar" size={13} />
        <span>{todayNote?.snippet ? `Today: “${todayNote.snippet.slice(0, 52)}…”` : "Open today's journal note"}</span>
      </button>
    </div>
  );
}

/* ---------- study & flashcards due ---------- */

function StudyBody() {
  const { navigate } = useApp();
  const [data, setData] = useState<StudyOverview | null>(null);

  useEffect(() => {
    api.study.overview().then(setData);
    return onObjectChanged(() => api.study.overview().then(setData));
  }, []);

  useAutoHide(data !== null && (data.decks?.length ?? 0) === 0);

  if (!data) return <div className="w-empty">Loading study queue…</div>;
  if (!data.decks?.length) return <div className="w-empty">No flashcard decks yet. Create one in the Study tab.</div>;

  const due = data.totals?.due ?? 0;
  const newCards = data.totals?.new ?? 0;
  const reviewed = data.reviewedToday ?? 0;

  return (
    <div className="w-study">
      <div className="study-head">
        <div className="study-stat">
          <span className="w-big">{due}</span>
          <span className="w-sub">cards due for review</span>
        </div>
        <button className="btn primary study-act-btn" onClick={() => navigate({ kind: 'study' })}>
          <Icon name="study" size={14} /> {due > 0 ? 'Study now' : 'Open Study'}
        </button>
      </div>
      <div className="study-meta-row">
        <span className="study-chip">
          <Icon name="sparkles" size={12} /> {newCards} new
        </span>
        <span className="study-chip">
          <Icon name="circle-check" size={12} /> {reviewed} reviewed today
        </span>
        <span className="study-chip">
          <Icon name="book" size={12} /> {data.decks.length} {data.decks.length === 1 ? 'deck' : 'decks'}
        </span>
      </div>
    </div>
  );
}

/* ---------- daily inspiration quote ---------- */

interface QuoteItem {
  text: string;
  author: string;
  category: 'Philosophy' | 'Productivity' | 'Mindfulness' | 'Creativity' | 'Wisdom';
}

const QUOTES: QuoteItem[] = [
  { text: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', author: 'Will Durant', category: 'Productivity' },
  { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain', category: 'Productivity' },
  { text: 'Knowledge is having the right answer. Intelligence is asking the right question.', author: 'Anonymous', category: 'Wisdom' },
  { text: 'Simplicity is the ultimate sophistication.', author: 'Leonardo da Vinci', category: 'Creativity' },
  { text: 'Focus is a muscle. The more you practice saying no, the stronger your yes becomes.', author: 'Anonymous', category: 'Productivity' },
  { text: 'A journey of a thousand miles begins with a single step.', author: 'Lao Tzu', category: 'Philosophy' },
  { text: 'What we know is a drop, what we do not know is an ocean.', author: 'Isaac Newton', category: 'Wisdom' },
  { text: 'The impediment to action advances action. What stands in the way becomes the way.', author: 'Marcus Aurelius', category: 'Philosophy' },
  { text: 'Small deeds done are better than great deeds planned.', author: 'Peter Marshall', category: 'Productivity' },
  { text: 'The mind is not a vessel to be filled, but a fire to be kindled.', author: 'Plutarch', category: 'Wisdom' },
  { text: 'Do what you can, with what you have, where you are.', author: 'Theodore Roosevelt', category: 'Productivity' },
  { text: 'It always seems impossible until it is done.', author: 'Nelson Mandela', category: 'Wisdom' },
  { text: 'Creativity is intelligence having fun.', author: 'Albert Einstein', category: 'Creativity' },
  { text: 'You do not rise to the level of your goals. You fall to the level of your systems.', author: 'James Clear', category: 'Productivity' },
  { text: 'Everything you want is on the other side of fear.', author: 'George Addair', category: 'Mindfulness' },
  { text: 'In the middle of difficulty lies opportunity.', author: 'Albert Einstein', category: 'Wisdom' },
  { text: 'Waste no more time arguing what a good person should be. Be one.', author: 'Marcus Aurelius', category: 'Philosophy' },
  { text: 'The best way to predict the future is to create it.', author: 'Peter Drucker', category: 'Productivity' },
  { text: 'Act as if what you do makes a difference. It does.', author: 'William James', category: 'Philosophy' },
  { text: 'Nature does not hurry, yet everything is accomplished.', author: 'Lao Tzu', category: 'Mindfulness' },
  { text: 'Perfection is achieved not when there is nothing more to add, but when there is nothing left to take away.', author: 'Antoine de Saint-Exupéry', category: 'Creativity' },
  { text: 'Peace comes from within. Do not seek it without.', author: 'Buddha', category: 'Mindfulness' },
  { text: 'Almost everything will work again if you unplug it for a few minutes, including you.', author: 'Anne Lamott', category: 'Mindfulness' },
  { text: 'An unexamined life is not worth living.', author: 'Socrates', category: 'Philosophy' },
  { text: 'The journey of creation begins in silence and takes shape with conviction.', author: 'Anonymous', category: 'Creativity' },
];

function QuoteBody({ config, w = 3, h = 2 }: WidgetProps) {
  const selectedCategory = config.category || '';
  const filteredQuotes = useMemo(() => {
    if (!selectedCategory || selectedCategory === 'all') return QUOTES;
    const filtered = QUOTES.filter((q) => q.category === selectedCategory);
    return filtered.length > 0 ? filtered : QUOTES;
  }, [selectedCategory]);

  const today = todayKey();
  const defaultIdx = Math.abs(today.split('-').reduce((acc, part) => acc * 31 + Number(part), 0)) % filteredQuotes.length;
  const [index, setIndex] = useState(defaultIdx);

  const customText = config.text?.trim();
  const customAuthor = config.author?.trim();

  const current = customText
    ? { text: customText, author: customAuthor || 'Personal motto', category: 'Custom' }
    : filteredQuotes[index % filteredQuotes.length];

  const nextQuote = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIndex((i) => i + 1);
  };

  const isCompact = h === 1;
  const isWide = w >= 4;
  const isTall = h >= 3;

  // Dynamically calculate font size and line clamp based on available space and text length
  const charCount = current.text.length;
  let fontSize = 14;
  let lineClamp = 4;
  let lineHeight = 1.45;

  if (isCompact) {
    if (isWide) {
      fontSize = charCount > 90 ? 12 : 13;
      lineClamp = 1;
      lineHeight = 1.35;
    } else {
      fontSize = charCount > 75 ? 11.5 : 12.5;
      lineClamp = 2;
      lineHeight = 1.3;
    }
  } else if (h === 2) {
    if (charCount > 115 || w <= 2) {
      fontSize = 12.5;
      lineClamp = 5;
      lineHeight = 1.4;
    } else if (charCount < 60 && w >= 3) {
      fontSize = 15.5;
      lineClamp = 3;
      lineHeight = 1.5;
    } else {
      fontSize = 14;
      lineClamp = 4;
      lineHeight = 1.45;
    }
  } else {
    // h >= 3 (tall)
    if (charCount < 70) {
      fontSize = 18;
      lineClamp = 6;
      lineHeight = 1.6;
    } else if (charCount < 130) {
      fontSize = 16;
      lineClamp = 7;
      lineHeight = 1.55;
    } else {
      fontSize = 14.5;
      lineClamp = 9;
      lineHeight = 1.5;
    }
  }

  // 1-row wide banner layout (e.g. w=4..6, h=1)
  if (isCompact && isWide) {
    return (
      <div className="w-quote compact wide">
        <div className="quote-mark" title="Daily Quote">
          <Icon name="quote" size={17} />
        </div>
        <div className="quote-body" key={current.text}>
          <span
            className="quote-text"
            style={{ fontSize, lineHeight, WebkitLineClamp: lineClamp }}
            title={current.text}
          >
            “{current.text}”
          </span>
          <span className="quote-author-inline">— {current.author}</span>
        </div>
        {!customText && (
          <button className="quote-next-btn" onClick={nextQuote} title="Next quote">
            <Icon name="redo" size={10} /> Next
          </button>
        )}
      </div>
    );
  }

  // 1-row compact standard layout (e.g. w=2..3, h=1)
  if (isCompact) {
    return (
      <div className="w-quote compact">
        <div className="quote-content-fade" key={current.text}>
          <div className="quote-body">
            <div
              className="quote-text"
              style={{ fontSize, lineHeight, WebkitLineClamp: lineClamp }}
              title={current.text}
            >
              “{current.text}”
            </div>
          </div>
          <div className="quote-footer">
            <span className="quote-author" title={current.author}>— {current.author}</span>
            {!customText && (
              <button className="quote-next-btn" onClick={nextQuote} title="Next quote">
                <Icon name="redo" size={10} /> Next
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Standard (h = 2) and Tall (h >= 3) layout:
  // - Top header with quote mark & category badge
  // - Middle body with vertically centered quote text
  // - Bottom footer with author & Next button fixed to the bottom edge
  return (
    <div className={'w-quote' + (isTall ? ' tall' : '')}>
      <div className="quote-header">
        <div className="quote-mark">
          <Icon name="quote" size={isTall ? 24 : 19} />
        </div>
        {current.category && (
          <span className="quote-category-badge">{current.category}</span>
        )}
      </div>

      <div className="quote-body">
        <div className="quote-content-fade" key={current.text}>
          <div
            className="quote-text"
            style={{ fontSize, lineHeight, WebkitLineClamp: lineClamp }}
            title={current.text}
          >
            “{current.text}”
          </div>
        </div>
      </div>

      <div className="quote-footer">
        <span className="quote-author" title={current.author}>— {current.author}</span>
        {!customText && (
          <button className="quote-next-btn" onClick={nextQuote} title="Next quote">
            <Icon name="redo" size={11} /> Next
          </button>
        )}
      </div>
    </div>
  );
}

function QuoteSettings({ config, set }: WidgetSettingsProps) {
  const categories = ['all', 'Wisdom', 'Productivity', 'Mindfulness', 'Creativity', 'Philosophy'];
  const activeCategory = config.category || 'all';

  return (
    <>
      <div className="w-layout-row">
        <label className="w-field">
          <span>Theme</span>
          <div className="w-col-picker">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                className={'col-pill' + (activeCategory === cat ? ' on' : '')}
                onClick={() => set({ category: cat === 'all' ? '' : cat })}
              >
                {cat === 'all' ? 'All' : cat}
              </button>
            ))}
          </div>
        </label>
      </div>

      <label className="w-field col">
        <span>Custom quote</span>
        <textarea
          className="field"
          rows={3}
          placeholder="Leave blank for rotating daily quotes"
          value={config.text || ''}
          onChange={(e) => set({ text: e.target.value })}
        />
      </label>
      <label className="w-field">
        <span>Author</span>
        <input
          className="field"
          placeholder="Author name"
          value={config.author || ''}
          onChange={(e) => set({ author: e.target.value })}
        />
      </label>
    </>
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
    defaultW: 6,
    defaultH: 1,
    minW: 2,
    minH: 1,
    maxH: 4,
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
    minW: 2,
    minH: 1,
    maxH: 4,
    defaultConfig: { newNote: true },
    Body: QuickBody,
  },
  {
    kind: 'agenda',
    name: 'Schedule & Agenda',
    desc: 'Upcoming events, calendar timeline, and scheduled tasks.',
    icon: 'calendar',
    group: 'Productivity',
    defaultW: 3,
    defaultH: 3,
    minW: 2,
    minH: 2,
    maxH: 14,
    title: () => 'Upcoming schedule',
    defaultConfig: { days: 3 },
    Body: AgendaBody,
    Settings: AgendaSettings,
  },
  {
    kind: 'tasks',
    name: "Today's tasks",
    desc: 'Tick off what’s due today, and add more.',
    icon: 'list-todo',
    group: 'Productivity',
    singleton: true,
    defaultW: 3,
    defaultH: 3,
    minW: 2,
    minH: 2,
    maxH: 14,
    title: () => "Today's tasks",
    requires: (types) => types.some((t) => t.id === 'task'),
    Body: TasksBody,
  },
  {
    kind: 'scratchpad',
    name: 'Quick scratchpad',
    desc: 'Instant sticky note for quick ideas that auto-saves.',
    icon: 'notebook',
    group: 'Productivity',
    card: true,
    defaultW: 3,
    defaultH: 2,
    minW: 2,
    minH: 1,
    maxH: 10,
    defaultConfig: { text: '', color: 'yellow' },
    Body: ScratchpadBody,
    Settings: ScratchpadSettings,
  },
  {
    kind: 'habits',
    name: 'Habit & Mood Check-In',
    desc: 'Track daily journaling streaks, 7-day history, and log your mood.',
    icon: 'flame',
    group: 'Productivity',
    card: true,
    singleton: true,
    defaultW: 3,
    defaultH: 2,
    minW: 2,
    minH: 1,
    maxH: 6,
    Body: HabitsBody,
  },
  {
    kind: 'study',
    name: 'Flashcards due',
    desc: 'Review queue for your flashcards and spaced repetition decks.',
    icon: 'study',
    group: 'Productivity',
    card: true,
    singleton: true,
    defaultW: 3,
    defaultH: 2,
    minW: 2,
    minH: 1,
    maxH: 6,
    title: () => 'Study review',
    Body: StudyBody,
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
    minW: 3,
    minH: 1,
    maxH: 8,
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
    minW: 3,
    minH: 1,
    maxH: 8,
    title: () => 'Pinned',
    Body: PinnedBody,
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
    minH: 2,
    maxH: 14,
    title: () => 'Recently edited',
    defaultConfig: { limit: 8 },
    Body: RecentBody,
    Settings: RecentSettings,
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
    minH: 2,
    maxH: 10,
    title: () => 'Birthdays',
    defaultConfig: { within: 60 },
    requires: (types) => types.some((t) => t.id === PEOPLE_TYPE),
    Body: BirthdaysBody,
    Settings: BirthdaysSettings,
  },
  {
    kind: 'quote',
    name: 'Daily quote',
    desc: 'Inspiring quotes to spark curiosity and reflection.',
    icon: 'quote',
    group: 'Custom',
    card: true,
    center: false,
    defaultW: 3,
    defaultH: 2,
    minW: 2,
    minH: 1,
    maxH: 6,
    defaultConfig: { text: '', author: '', category: '' },
    Body: QuoteBody,
    Settings: QuoteSettings,
  },
];
