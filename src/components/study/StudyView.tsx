import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../../api';
import { dealtIn, spring, stagger } from '../../motion';
import { useApp } from '../../store';
import type { Deck, StudyNote, StudyOverview } from '../../types';
import { addDays, ago, todayKey, typeColor } from '../../util';
import { Icon } from '../Icons';
import { SplitControls } from '../SplitControls';
import { StudySession } from './StudySession';
import { VocabAdd } from './VocabAdd';

/** Fifteen weeks of review counts — a small year-in-review. */
function Heatmap({ history, theme }: { history: { day: string; n: number }[]; theme: string }) {
  const cells = useMemo(() => {
    const by = new Map(history.map((h) => [h.day, h.n]));
    const peak = Math.max(1, ...history.map((h) => h.n));
    const today = todayKey();
    const out: { day: string; n: number; level: number }[] = [];
    for (let i = 15 * 7 - 1; i >= 0; i--) {
      const day = addDays(today, -i);
      const n = by.get(day) ?? 0;
      out.push({ day, n, level: n === 0 ? 0 : Math.min(4, Math.ceil((n / peak) * 4)) });
    }
    return out;
  }, [history]);

  return (
    <div className="sr-heat" style={{ '--heat': typeColor('#1baf7a', theme) } as React.CSSProperties}>
      {cells.map((c) => (
        <span key={c.day} className={'sr-heat-cell l' + c.level} title={`${c.n} review${c.n === 1 ? '' : 's'} on ${c.day}`} />
      ))}
    </div>
  );
}

/**
 * Naming a new deck, inline. Not a `prompt()` — Electron has no window.prompt,
 * so a dialog asked for that way never opens and the button looks broken.
 */
function NewDeckRow({ onCreate, onCancel }: { onCreate: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <motion.div
      className="sr-newdeck"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={spring}
    >
      <div className="sr-newdeck-row">
        <Icon name="deck" size={15} />
        <input
          ref={ref}
          placeholder="Deck name — Spanish, Biology 101, anything"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) onCreate(name.trim());
            if (e.key === 'Escape') onCancel();
          }}
        />
        <button className="btn subtle" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => name.trim() && onCreate(name.trim())} disabled={!name.trim()}>
          Create
        </button>
      </div>
    </motion.div>
  );
}

function DeckTile({
  deck,
  theme,
  onStudy,
  onOpen,
  onDelete,
}: {
  deck: Deck;
  theme: string;
  onStudy: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const c = deck.counts ?? { new: 0, learning: 0, due: 0, total: 0 };
  const waiting = c.new + c.learning + c.due;
  const tint = typeColor(deck.color, theme);
  const [menu, setMenu] = useState(false);

  return (
    <motion.div className="sr-deck" variants={dealtIn} whileHover={{ y: -3 }} transition={spring} layout>
      <button
        className="icon-btn sr-deck-menu"
        aria-label="Deck options"
        onClick={(e) => {
          e.stopPropagation();
          setMenu((v) => !v);
        }}
      >
        <Icon name="more-horizontal" size={15} />
      </button>
      {menu && (
        <>
          <div className="backdrop transparent" onClick={() => setMenu(false)} />
          <div className="popover sr-deck-pop">
            <button
              className="menu-item"
              onClick={() => {
                setMenu(false);
                onOpen();
              }}
            >
              <Icon name="settings" size={14} /> Open &amp; edit
            </button>
            <button
              className="menu-item danger"
              onClick={() => {
                setMenu(false);
                onDelete();
              }}
            >
              <Icon name="trash" size={14} /> Delete deck
            </button>
          </div>
        </>
      )}
      <button className="sr-deck-open" onClick={onOpen}>
        <span className="sr-deck-icon" style={{ background: `color-mix(in srgb, ${tint} 18%, transparent)`, color: tint }}>
          <Icon name={deck.lang ? 'languages' : 'deck'} size={17} />
        </span>
        <span className="sr-deck-name">{deck.name}</span>
        <span className="sr-deck-total">{c.total} cards</span>
        <span className="sr-deck-counts">
          <span className="sr-tally new">{c.new}</span>
          <span className="sr-tally learning">{c.learning}</span>
          <span className="sr-tally due">{c.due}</span>
        </span>
      </button>
      <motion.button
        className={'sr-deck-go' + (waiting ? ' ready' : '')}
        onClick={onStudy}
        disabled={!waiting}
        whileTap={{ scale: 0.95 }}
        transition={spring}
      >
        {waiting ? `Study ${waiting}` : 'Done for now'}
      </motion.button>
    </motion.div>
  );
}

function NoteRow({ note, onOpen, onDelete }: { note: StudyNote; onOpen: () => void; onDelete: () => void }) {
  const subject = note.props?.subject;
  const klass = note.props?.class;

  return (
    <motion.div className="sr-note" variants={dealtIn} whileHover={{ y: -2 }} transition={spring} layout>
      <button className="sr-note-open" onClick={onOpen}>
        <span className="sr-note-head">
          <Icon name="doc" size={14} />
          <span className="sr-note-name">{note.title || 'Untitled note'}</span>
          {!!note.cards && (
            <span className="sr-note-cards">
              <Icon name="cards" size={11} /> {note.cards}
            </span>
          )}
        </span>
        {(subject || klass) && (
          <span className="sr-note-props">
            {subject && <span className="sr-note-prop subject">{subject}</span>}
            {klass && <span className="sr-note-prop">{klass}</span>}
          </span>
        )}
        <span className="sr-note-peek">{note.body.trim() || 'Empty'}</span>
        <span className="sr-note-when">{ago(note.updatedAt)}</span>
      </button>
      <button
        className="icon-btn sr-note-del"
        aria-label="Delete note"
        title="Delete note"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        <Icon name="trash" size={13} />
      </button>
    </motion.div>
  );
}

export function StudyView() {
  const { theme, navigate } = useApp();
  const [data, setData] = useState<StudyOverview | null>(null);
  const [session, setSession] = useState<{ deckId?: string; title: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [naming, setNaming] = useState(false);

  const load = useCallback(() => api.study.overview().then(setData), []);

  useEffect(() => {
    load();
  }, [load]);

  const newNote = async () => {
    const note = await api.study.noteCreate({ title: '' });
    navigate({ kind: 'studyNote', id: note.id });
  };

  if (session) {
    return (
      <StudySession
        deckId={session.deckId}
        title={session.title}
        onClose={() => {
          setSession(null);
          load();
        }}
      />
    );
  }

  const totals = data?.totals ?? { new: 0, learning: 0, due: 0, total: 0 };
  const waiting = totals.new + totals.learning + totals.due;
  const decks = data?.decks ?? [];
  const notes = data?.notes ?? [];
  const bare = data && !decks.length && !notes.length;

  return (
    <div className="page sr-home">
      <div className="page-head">
        <h1>Study</h1>
        <span className="spacer" />
        <button className="btn subtle" onClick={newNote}>
          <Icon name="doc" size={14} /> New note
        </button>
        <button className="btn subtle" onClick={() => setAdding((v) => !v)}>
          <Icon name="languages" size={14} /> Add words
        </button>
        <button className="btn subtle" onClick={() => setNaming(true)}>
          <Icon name="plus" size={14} /> New deck
        </button>
        <SplitControls />
      </div>

      <AnimatePresence initial={false}>
        {naming && (
          <NewDeckRow
            key="new-deck"
            onCancel={() => setNaming(false)}
            onCreate={async (name) => {
              setNaming(false);
              const deck = await api.study.deckCreate({ name });
              navigate({ kind: 'deck', id: deck.id });
            }}
          />
        )}
        {adding && (
          <motion.div
            key="vocab-add"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={spring}
            style={{ overflow: 'hidden' }}
          >
            <VocabAdd decks={decks} onAdded={load} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- the one thing worth doing right now --- */}
      <div className="sr-summary">
        <motion.button
          className={'sr-start' + (waiting ? '' : ' quiet')}
          onClick={() => waiting && setSession({ title: 'All decks' })}
          disabled={!waiting}
          whileHover={waiting ? { y: -2 } : undefined}
          whileTap={waiting ? { scale: 0.98 } : undefined}
          transition={spring}
        >
          <span className="sr-start-mark">
            <Icon name={waiting ? 'play' : 'check'} size={20} />
          </span>
          <span className="sr-start-text">
            <strong>{waiting ? `${waiting} card${waiting === 1 ? '' : 's'} waiting` : 'Nothing due'}</strong>
            <em>
              {waiting
                ? `${totals.new} new · ${totals.learning} learning · ${totals.due} to review`
                : `${totals.total} card${totals.total === 1 ? '' : 's'} in total`}
            </em>
          </span>
        </motion.button>

        <div className="sr-stats">
          <div className="sr-stat">
            <span className="sr-stat-n">
              {data?.streak ?? 0}
              <Icon name="flame" size={15} />
            </span>
            <span className="sr-stat-l">day streak</span>
          </div>
          <div className="sr-stat">
            <span className="sr-stat-n">{data?.reviewedToday ?? 0}</span>
            <span className="sr-stat-l">reviewed today</span>
          </div>
          <div className="sr-stat wide">
            <Heatmap history={data?.history ?? []} theme={theme} />
            <span className="sr-stat-l">last 15 weeks</span>
          </div>
        </div>
      </div>

      {bare && (
        <div className="sr-empty">
          <span className="sr-empty-mark">
            <Icon name="study" size={26} />
          </span>
          <h2>Nothing to study yet</h2>
          <p>
            Take notes as you would in class and turn them into cards when you're done — or add words for a language, or
            start an empty deck and fill it yourself.
          </p>
          <div className="sr-empty-actions">
            <button className="btn primary" onClick={newNote}>
              Start a note
            </button>
            <button className="btn subtle" onClick={() => setAdding(true)}>
              Add words
            </button>
            <button className="btn subtle" onClick={() => setNaming(true)}>
              Empty deck
            </button>
          </div>
        </div>
      )}

      {decks.length > 0 && (
        <>
          <h2 className="sr-section">Decks</h2>
          <motion.div className="sr-decks" variants={stagger} initial="hidden" animate="shown">
            <AnimatePresence initial={false}>
              {decks.map((d) => (
                <DeckTile
                  key={d.id}
                  deck={d}
                  theme={theme}
                  onStudy={() => setSession({ deckId: d.id, title: d.name })}
                  onOpen={() => navigate({ kind: 'deck', id: d.id })}
                  onDelete={async () => {
                    const n = d.counts?.total ?? 0;
                    if (!confirm(`Delete “${d.name}” and its ${n} card${n === 1 ? '' : 's'}? Your notes are kept.`)) return;
                    await api.study.deckDelete(d.id);
                    load();
                  }}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        </>
      )}

      {notes.length > 0 && (
        <>
          <h2 className="sr-section">
            Notes
            <button className="sr-link-btn" onClick={newNote}>
              New note
            </button>
          </h2>
          <motion.div className="sr-notes" variants={stagger} initial="hidden" animate="shown">
            <AnimatePresence initial={false}>
              {notes.map((n) => (
                <NoteRow
                  key={n.id}
                  note={n}
                  onOpen={() => navigate({ kind: 'studyNote', id: n.id })}
                  onDelete={async () => {
                    if (!confirm(`Delete “${n.title || 'Untitled note'}”? Cards made from it are kept.`)) return;
                    await api.study.noteDelete(n.id);
                    load();
                  }}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        </>
      )}
    </div>
  );
}
