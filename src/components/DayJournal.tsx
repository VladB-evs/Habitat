import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../api';
import { ask } from '../confirm';
import type { Obj } from '../types';
import { snap } from '../motion';
import { todayKey } from '../util';
import { Editor } from './Editor';
import { Icon } from './Icons';
import { MoodPicker, moodMeta } from './MoodPicker';

const clockOf = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

const atOf = (e: Obj) => Number(e.props?.at) || e.createdAt;

const minuteOfDay = (ms: number) => {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
};

/**
 * The part of the day a moment falls in. The gutter tints with it, so a scroll
 * back through the journal shows *when* you write before you read a word of it.
 */
function band(ms: number): string {
  const h = new Date(ms).getHours();
  if (h < 5) return 'night';
  if (h < 9) return 'dawn';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

function gapLabel(minutes: number): string {
  if (minutes >= 120) {
    const h = Math.round(minutes / 60);
    return `${h} hours earlier`;
  }
  return `${minutes} minutes earlier`;
}

/**
 * The silence between two moments, drawn to scale.
 *
 * This is what gives a day its shape: a long morning is a long empty rail, and
 * an evening written in bursts is a tight stack. Proportional, but capped —
 * eight hours of sleep must read as a gap, not as an empty screen.
 */
function Gap({ minutes }: { minutes: number }) {
  if (minutes < 20) return null;
  return (
    <div className="moment-gap" style={{ height: Math.min(76, 12 + minutes * 0.32) }}>
      {minutes >= 75 && <span className="moment-gap-label">{gapLabel(minutes)}</span>}
    </div>
  );
}

/** "8:04", "20:37", "8:04 pm" — whatever gets typed into the gutter. */
function parseClock(text: string): { hour: number; minute: number } | null {
  const m = text.trim().match(/^(\d{1,2})\s*[:.]?\s*(\d{2})?\s*(am|pm)?$/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  if (!Number.isInteger(hour) || hour > 23 || minute > 59) return null;
  if (m[3]) {
    const pm = /^p/i.test(m[3]);
    if (hour === 12) hour = pm ? 12 : 0;
    else if (hour < 12) hour = pm ? hour + 12 : hour;
  }
  return { hour, minute };
}

function Moment({
  entry,
  onChanged,
  onRemove,
}: {
  entry: Obj;
  onChanged: () => void;
  onRemove: () => void;
}) {
  const at = atOf(entry);
  const untimed = !!entry.props?.untimed;
  const mood = typeof entry.props?.mood === 'number' ? (entry.props.mood as number) : undefined;
  const tint = moodMeta(mood)?.color;
  const [editingTime, setEditingTime] = useState(false);
  const [draftTime, setDraftTime] = useState('');

  const commitTime = async () => {
    const parsed = parseClock(draftTime);
    setEditingTime(false);
    if (!parsed) return;
    await api.entries.setTime(entry.id, parsed.hour, parsed.minute);
    onChanged();
  };

  return (
    // Deliberately not animated and deliberately not `layout`. The editors in a
    // column of moments settle to their real heights a frame or two after they
    // mount, and a layout animation started on those first measurements slides
    // moments over each other on the way down. A day that is already written is
    // a document: it should simply be there when the day opens.
    <div className={'moment band-' + band(at)}>
      <div className="moment-rail">
        {editingTime ? (
          <input
            className="moment-time-input"
            autoFocus
            value={draftTime}
            onChange={(e) => setDraftTime(e.target.value)}
            onBlur={commitTime}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTime();
              if (e.key === 'Escape') setEditingTime(false);
            }}
            aria-label="Time this was written"
          />
        ) : (
          <button
            className={'moment-time' + (untimed ? ' untimed' : '')}
            onClick={() => {
              setDraftTime(untimed ? '' : clockOf(at));
              setEditingTime(true);
            }}
            title="Change the time"
          >
            {untimed ? 'sometime' : clockOf(at)}
          </button>
        )}
        <span className="moment-stem" style={tint ? { background: tint } : undefined} />
      </div>

      <div className="moment-body">
        <Editor
          content={entry.content ?? null}
          objectId={entry.id}
          handle={false}
          placeholder="…"
          onSave={(json) => api.objects.update(entry.id, { content: json })}
        />
        <div className={'moment-foot' + (mood !== undefined ? ' has-mood' : '')}>
          <MoodPicker
            compact
            value={mood}
            onPick={async (score) => {
              await api.entries.setMood(entry.id, score);
              onChanged();
            }}
          />
          <button className="moment-del" onClick={onRemove} aria-label="Delete this moment">
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * One day of the journal, as the moments it is actually made of.
 *
 * The day is no longer a document. Each moment is its own object with the time
 * the clock read when it was written and a mood of its own, so nobody has to
 * type "8:04" ever again, and a day that took nine moments cannot look like a
 * day that took two.
 */
export function DayJournal({ dateKey, onChanged }: { dateKey: string; onChanged?: () => void }) {
  const [entries, setEntries] = useState<Obj[] | null>(null);
  const [draft, setDraft] = useState<any>(null);
  const [composerKey, setComposerKey] = useState(0);
  // The editor writes its last unsaved text out when it unmounts. Resetting the
  // composer unmounts it, so that final write has to be recognised as stale and
  // dropped — or it puts the text straight back and the button never leaves.
  const composerKeyRef = useRef(0);
  const resetComposer = () => {
    composerKeyRef.current += 1;
    setComposerKey(composerKeyRef.current);
    setDraft(null);
    draftRef.current = null;
  };
  const [now, setNow] = useState(() => Date.now());
  const draftRef = useRef<any>(null);
  draftRef.current = draft;

  const isToday = dateKey === todayKey();

  const load = () => {
    api.entries.day(dateKey).then(setEntries);
  };

  useEffect(() => {
    setEntries(null);
    resetComposer();
    load();
  }, [dateKey]);

  // The composer shows the time the moment is about to be stamped with, so the
  // clock in the gutter is never a surprise.
  useEffect(() => {
    if (!isToday) return;
    const t = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(t);
  }, [isToday]);

  const changed = () => {
    load();
    onChanged?.();
  };

  const hasText = (json: any): boolean => {
    const walk = (n: any): string => {
      let s = typeof n?.text === 'string' ? n.text : '';
      if (n?.type === 'mention' || n?.type === 'tagMention') s += n.attrs?.label ?? '';
      if (Array.isArray(n?.content)) for (const c of n.content) s += walk(c);
      return s;
    };
    return walk(json).trim().length > 0;
  };

  /**
   * A past day has no clock to read, so a moment added to one lands just after
   * whatever was written last — close enough to be in the right order, and the
   * gutter is editable for the rest.
   */
  const stampFor = (): number => {
    if (isToday) return Date.now();
    const last = entries?.length ? atOf(entries[entries.length - 1]) : null;
    const [y, m, d] = dateKey.split('-').map(Number);
    if (last === null) return new Date(y, m - 1, d, 12, 0, 0, 0).getTime();
    return last + 60_000;
  };

  const commit = async () => {
    const json = draftRef.current;
    if (!json || !hasText(json)) return;
    await api.entries.create({ dateKey, at: stampFor(), content: json });
    resetComposer();
    changed();
  };

  const remove = async (e: Obj) => {
    if (!(await ask('Delete this moment? This also removes its links.'))) return;
    await api.objects.remove(e.id);
    changed();
  };

  if (!entries) return <div className="journal" />;

  const ready = draft !== null && hasText(draft);

  // Newest at the top, oldest at the bottom, and the composer above both: the
  // thing you are about to write is the newest thing there is.
  const newestFirst = [...entries].reverse();

  return (
    <div className="journal">
      <div className={'composer' + (ready ? ' ready' : '')}>
        {/* The rail stays empty until there is something to stamp. A time here
            on an empty composer reads as a moment that has already been written
            — every day looked like it had gained a blank entry just by being
            opened. The clock appears with the first word instead. */}
        <div className="composer-rail">
          {ready && <span className="composer-time">{isToday ? clockOf(now) : clockOf(stampFor())}</span>}
        </div>
        <div
          className="composer-body"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
        >
          <Editor
            key={composerKey}
            content={null}
            handle={false}
            placeholder={entries.length ? 'And now?' : 'What is happening?'}
            onSave={(json) => {
              if (composerKeyRef.current === composerKey) setDraft(json);
            }}
          />
          <AnimatePresence>
            {ready && (
              <motion.button
                className="composer-commit"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={snap}
                onClick={commit}
              >
                Keep this moment
                <span className="composer-kbd">⌘↵</span>
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="moments">
        {newestFirst.map((e, i) => {
          // `above` is the later one: the column reads down into the past.
          const above = i > 0 ? newestFirst[i - 1] : null;
          const gap = above ? minuteOfDay(atOf(above)) - minuteOfDay(atOf(e)) : 0;
          return (
            <div key={e.id}>
              {above && !e.props?.untimed && !above.props?.untimed && <Gap minutes={gap} />}
              <Moment entry={e} onChanged={changed} onRemove={() => remove(e)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
