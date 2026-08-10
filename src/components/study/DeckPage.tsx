import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../../api';
import { dialogIn, spring } from '../../motion';
import { useApp } from '../../store';
import type { Card, Deck, ParsedCard } from '../../types';
import { srsDefaults } from './defaults';
import { Icon } from '../Icons';
import { SplitControls } from '../SplitControls';
import { StudySession } from './StudySession';

/** When a card comes back, said the way the deck list says it. */
function whenDue(card: Card): string {
  if (card.suspended) return 'Suspended';
  if (card.state === 'new') return 'New';
  const gap = card.due - Date.now();
  if (gap <= 0) return 'Due now';
  const mins = gap / 60000;
  if (mins < 60) return `in ${Math.round(mins)}m`;
  if (mins < 60 * 24) return `in ${Math.round(mins / 60)}h`;
  const days = mins / (60 * 24);
  if (days < 30) return `in ${Math.round(days)}d`;
  return `in ${Math.round(days / 30)}mo`;
}

/** Paste a list, see what it found, then keep it. */
function ImportCards({ deckId, onClose, onDone }: { deckId: string; onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [found, setFound] = useState<ParsedCard[]>([]);

  useEffect(() => {
    if (!text.trim()) return setFound([]);
    let alive = true;
    api.study.cardsFromText({ text, dry: true }).then((res) => alive && setFound(res as ParsedCard[]));
    return () => {
      alive = false;
    };
  }, [text]);

  return (
    <>
      <div className="backdrop dim" onClick={onClose} />
      <div className="modal-layer">
        <motion.div className="modal sr-import" variants={dialogIn} initial="hidden" animate="shown" exit="gone">
        <h2>Add cards from text</h2>
        <p className="sr-import-help">
          One card per line. Habitat reads <code>term — meaning</code>, <code>term: meaning</code>, tab-separated pairs,{' '}
          <code>Q:</code> / <code>A:</code> on two lines, and <code>{'{{braces}}'}</code> around the part to hide.
        </p>
        <textarea
          className="sr-import-box"
          autoFocus
          placeholder={'la casa — the house\nel perro — the dog\nQ: Capital of Japan\nA: Tokyo'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="sr-import-found">
          {found.length ? `${found.length} card${found.length === 1 ? '' : 's'} found` : 'Nothing recognised yet'}
        </div>
        <div className="sr-import-preview">
          {found.slice(0, 6).map((c, i) => (
            <div key={i} className="sr-import-row">
              <span>{c.front}</span>
              <Icon name="chevron-right" size={12} />
              <span className="dim">{c.back}</span>
            </div>
          ))}
          {found.length > 6 && <div className="sr-import-row dim">and {found.length - 6} more…</div>}
        </div>
        <div className="modal-actions">
          <button className="btn subtle" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!found.length}
            onClick={async () => {
              await api.study.cardsFromText({ deckId, text });
              onDone();
              onClose();
            }}
          >
            Add {found.length || ''} card{found.length === 1 ? '' : 's'}
          </button>
          </div>
        </motion.div>
      </div>
    </>
  );
}

function DeckSettings({
  deck,
  onSave,
  onClose,
  onDeleted,
}: {
  deck: Deck;
  onSave: (d: Deck) => void;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const cfg = { ...srsDefaults, ...deck.config };
  const [newPerDay, setNewPerDay] = useState(String(cfg.newPerDay));
  const [reviewsPerDay, setReviewsPerDay] = useState(String(cfg.reviewsPerDay));
  const [reverse, setReverse] = useState(cfg.reverse === true);
  const [name, setName] = useState(deck.name);

  return (
    <>
      <div className="backdrop dim" onClick={onClose} />
      <div className="modal-layer">
        <motion.div className="modal sr-settings" variants={dialogIn} initial="hidden" animate="shown" exit="gone">
        <h2>Deck settings</h2>

        <label className="sr-set-row">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <label className="sr-set-row">
          <span>New cards a day</span>
          <input type="number" min={0} max={999} value={newPerDay} onChange={(e) => setNewPerDay(e.target.value)} />
        </label>

        <label className="sr-set-row">
          <span>Reviews a day</span>
          <input type="number" min={0} max={9999} value={reviewsPerDay} onChange={(e) => setReviewsPerDay(e.target.value)} />
        </label>

        {/* The app's own switch, not a bare checkbox — and note the row is not
            given the class `toggle`, which already belongs to that switch. */}
        <div className="sr-set-row">
          <span>
            Ask both ways
            <em>New words also get a reverse card: the meaning shown, the word asked for.</em>
          </span>
          <button
            className={'toggle' + (reverse ? ' on' : '')}
            onClick={() => setReverse((v) => !v)}
            role="switch"
            aria-checked={reverse}
            aria-label="Ask both ways"
          >
            <span className="knob" />
          </button>
        </div>

        <div className="modal-actions spread">
          <button
            className="btn danger"
            onClick={async () => {
              if (!confirm(`Delete “${deck.name}” and its ${deck.counts?.total ?? 0} cards? Your notes are kept.`)) return;
              await api.study.deckDelete(deck.id);
              onDeleted();
            }}
          >
            <Icon name="trash" size={14} /> Delete deck
          </button>
          <span className="spacer" />
          <button className="btn subtle" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={async () => {
              const saved = await api.study.deckPatch(deck.id, {
                name: name.trim() || deck.name,
                config: {
                  newPerDay: Math.max(0, Number(newPerDay) || 0),
                  reviewsPerDay: Math.max(0, Number(reviewsPerDay) || 0),
                  reverse,
                },
              });
              if (saved) onSave(saved);
              onClose();
            }}
          >
            Save
          </button>
          </div>
        </motion.div>
      </div>
    </>
  );
}

export function DeckPage({ id }: { id: string }) {
  const { navigate, openObject } = useApp();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [q, setQ] = useState('');
  const [studying, setStudying] = useState(false);
  const [importing, setImporting] = useState(false);
  const [settings, setSettings] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const decks = await api.study.decks();
    setDeck(decks.find((d) => d.id === id) ?? null);
    setCards(await api.study.cards({ deckId: id }));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return cards;
    return cards.filter((c) => c.front.toLowerCase().includes(needle) || c.back.toLowerCase().includes(needle));
  }, [cards, q]);

  if (studying && deck) {
    return (
      <StudySession
        deckId={deck.id}
        title={deck.name}
        onClose={() => {
          setStudying(false);
          load();
        }}
      />
    );
  }

  if (!deck) return <div className="page" />;

  const c = deck.counts ?? { new: 0, learning: 0, due: 0, total: 0 };
  const waiting = c.new + c.learning + c.due;

  return (
    <div className="page sr-deck-page">
      <div className="page-head">
        <button className="icon-btn" onClick={() => navigate({ kind: 'study' })} title="All decks">
          <Icon name="arrow-left" size={15} />
        </button>
        <h1>{deck.name}</h1>
        <span className="spacer" />
        <button className="btn subtle" onClick={() => setImporting(true)}>
          <Icon name="plus" size={14} /> Add cards
        </button>
        <button className="btn subtle" onClick={() => setSettings(true)}>
          <Icon name="settings" size={14} />
        </button>
        <button className="btn primary" onClick={() => setStudying(true)} disabled={!waiting}>
          {waiting ? `Study ${waiting}` : 'Nothing due'}
        </button>
        <SplitControls />
      </div>

      <div className="sr-deck-bar">
        <div className="sr-search">
          <Icon name="search" size={13} />
          <input placeholder="Search cards…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="sr-deck-summary">
          <span className="sr-tally new">{c.new}</span> new
          <span className="sr-tally learning">{c.learning}</span> learning
          <span className="sr-tally due">{c.due}</span> due
        </span>
      </div>

      <div className="sr-cards">
        <AnimatePresence initial={false}>
          {shown.map((card) => (
            <motion.div
              key={card.id}
              className={'sr-row' + (card.suspended ? ' suspended' : '')}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, height: 0 }}
              transition={spring}
              layout
            >
              {editing === card.id ? (
                <>
                  <input
                    className="sr-row-edit"
                    defaultValue={card.front}
                    autoFocus
                    onBlur={(e) => api.study.cardPatch(card.id, { front: e.target.value }).then(load)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                  <input
                    className="sr-row-edit"
                    defaultValue={card.back}
                    onBlur={(e) => {
                      api.study.cardPatch(card.id, { back: e.target.value }).then(load);
                      setEditing(null);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                </>
              ) : (
                <>
                  <span className="sr-row-front">{card.front}</span>
                  <span className="sr-row-back">{card.back}</span>
                </>
              )}
              <span className={'sr-row-due s-' + card.state}>{whenDue(card)}</span>
              <span className="sr-row-tools">
                {card.noteId && (
                  <button
                    className="icon-btn"
                    title="Open the note it came from"
                    onClick={() => navigate({ kind: 'studyNote', id: card.noteId! })}
                  >
                    <Icon name="doc" size={13} />
                  </button>
                )}
                {card.objId && (
                  <button className="icon-btn" title="Open the note in your vault" onClick={() => openObject(card.objId!)}>
                    <Icon name="arrow-up-right" size={13} />
                  </button>
                )}
                {/* Every card is editable now that none of them mirror an object. */}
                <button className="icon-btn" title="Edit" onClick={() => setEditing(editing === card.id ? null : card.id)}>
                  <Icon name="pencil" size={13} />
                </button>
                <button
                  className="icon-btn"
                  title={card.suspended ? 'Bring back' : 'Suspend'}
                  onClick={() => api.study.cardPatch(card.id, { suspended: !card.suspended }).then(load)}
                >
                  <Icon name={card.suspended ? 'play' : 'pause'} size={13} />
                </button>
                <button
                  className="icon-btn danger"
                  title="Delete card"
                  onClick={() => api.study.cardDelete(card.id).then(load)}
                >
                  <Icon name="trash" size={13} />
                </button>
              </span>
            </motion.div>
          ))}
        </AnimatePresence>

        {!shown.length && (
          <div className="sr-cards-empty">
            {cards.length ? `No card matches “${q}”` : 'This deck is empty — add some cards to get going.'}
          </div>
        )}
      </div>

      <AnimatePresence>
        {importing && <ImportCards deckId={deck.id} onClose={() => setImporting(false)} onDone={load} />}
        {settings && (
          <DeckSettings
            deck={deck}
            onSave={(d) => {
              setDeck(d);
              load();
            }}
            onClose={() => setSettings(false)}
            onDeleted={() => navigate({ kind: 'study' })}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
