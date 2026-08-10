import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../../api';
import { spring } from '../../motion';
import { useApp } from '../../store';
import type { Card, DeckCounts, Rating } from '../../types';
import { Icon } from '../Icons';

const RATINGS: { rating: Rating; label: string; key: string; tone: string }[] = [
  { rating: 1, label: 'Again', key: '1', tone: 'again' },
  { rating: 2, label: 'Hard', key: '2', tone: 'hard' },
  { rating: 3, label: 'Good', key: '3', tone: 'good' },
  { rating: 4, label: 'Easy', key: '4', tone: 'easy' },
];

/**
 * One card at a time, front then back.
 *
 * The queue is fetched once and worked through in memory; a card answered
 * "Again" is put back a few places rather than refetched, so the session never
 * pauses on the network between two keystrokes. Whatever is still unanswered
 * when the queue empties is asked for again.
 */
export function StudySession({
  deckId,
  title,
  onClose,
}: {
  deckId?: string;
  title: string;
  onClose: () => void;
}) {
  const { openObject, navigate } = useApp();
  const [queue, setQueue] = useState<Card[]>([]);
  const [counts, setCounts] = useState<DeckCounts | null>(null);
  const [shown, setShown] = useState(false);
  const [done, setDone] = useState(0);
  const [loading, setLoading] = useState(true);
  const [finished, setFinished] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const shownAt = useRef(Date.now());

  const card = queue[0] ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    const q = await api.study.queue({ deckId });
    setQueue(q.cards);
    setCounts(q.counts);
    setLoading(false);
    if (!q.cards.length) setFinished(true);
  }, [deckId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    shownAt.current = Date.now();
    setShown(false);
  }, [card?.id]);

  const answer = useCallback(
    async (rating: Rating) => {
      if (!card) return;
      const ms = Date.now() - shownAt.current;
      const rest = queue.slice(1);
      // "Again" and "Hard" are due in a minute or two — put the card back a few
      // places so it comes round again inside this session, which is the point
      // of learning steps in the first place.
      const requeue = rating <= 2;
      setQueue(requeue ? [...rest.slice(0, 3), card, ...rest.slice(3)] : rest);
      setDone((n) => n + 1);
      setCanUndo(true);

      const res = await api.study.answer({ id: card.id, rating, ms });
      if (res) {
        setCounts(res.counts);
        // Keep the requeued copy's schedule honest, so its buttons show the
        // intervals the scheduler actually assigned.
        if (requeue) setQueue((q) => q.map((c) => (c.id === card.id ? res.card : c)));
      }
      if (!requeue && rest.length === 0) {
        const next = await api.study.queue({ deckId });
        setQueue(next.cards);
        setCounts(next.counts);
        if (!next.cards.length) setFinished(true);
      }
    },
    [card, deckId, queue]
  );

  const undo = useCallback(async () => {
    const restored = await api.study.undo();
    setCanUndo(false);
    if (!restored) return;
    setDone((n) => Math.max(0, n - 1));
    setFinished(false);
    setQueue((q) => [restored, ...q.filter((c) => c.id !== restored.id)]);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        return void undo();
      }
      if (!card) return;
      if (!shown) {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          setShown(true);
        }
        return;
      }
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        return void answer(3);
      }
      const hit = RATINGS.find((r) => r.key === e.key);
      if (hit) {
        e.preventDefault();
        void answer(hit.rating);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answer, card, onClose, shown, undo]);

  const remaining = (counts?.new ?? 0) + (counts?.learning ?? 0) + (counts?.due ?? 0);

  return (
    <div className="sr-session">
      <div className="sr-bar">
        <button className="icon-btn" onClick={onClose} title="Back (Esc)">
          <Icon name="x" size={16} />
        </button>
        <span className="sr-bar-title">{title}</span>
        <span className="spacer" />
        {counts && (
          <span className="sr-tallies">
            <span className="sr-tally new" title="New">
              {counts.new}
            </span>
            <span className="sr-tally learning" title="Learning">
              {counts.learning}
            </span>
            <span className="sr-tally due" title="To review">
              {counts.due}
            </span>
          </span>
        )}
        <button className="icon-btn" onClick={undo} disabled={!canUndo} title="Undo last answer (⌘Z)">
          <Icon name="undo" size={15} />
        </button>
      </div>

      <div className="sr-progress">
        <motion.div
          className="sr-progress-fill"
          animate={{ width: `${remaining + done > 0 ? (done / (remaining + done)) * 100 : 0}%` }}
          transition={spring}
        />
      </div>

      <div className="sr-stage">
        {loading && <div className="sr-loading">Shuffling…</div>}

        {!loading && finished && !card && (
          <motion.div
            className="sr-done"
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={spring}
          >
            <span className="sr-done-mark">
              <Icon name="check" size={28} />
            </span>
            <h2>All caught up</h2>
            <p>
              {done > 0
                ? `${done} card${done === 1 ? '' : 's'} reviewed. Nothing else is due right now.`
                : 'Nothing is due in this deck right now.'}
            </p>
            <button className="btn primary" onClick={onClose}>
              Done
            </button>
          </motion.div>
        )}

        <AnimatePresence mode="wait">
          {card && (
            <motion.div
              key={card.id + String(shown)}
              className="sr-card-wrap"
              initial={{ opacity: 0, y: 14, rotateX: -6 }}
              animate={{ opacity: 1, y: 0, rotateX: 0 }}
              exit={{ opacity: 0, y: -12, scale: 0.98 }}
              transition={spring}
            >
              <div className={'sr-card' + (shown ? ' revealed' : '')}>
                <div className="sr-face front">
                  <span className="sr-face-label">{card.extra?.dir === 'recall' ? 'Meaning' : 'Prompt'}</span>
                  <div className="sr-prompt">{card.front}</div>
                </div>

                <AnimatePresence>
                  {shown && (
                    <motion.div
                      className="sr-face back"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={spring}
                    >
                      <span className="sr-rule" />
                      <div className="sr-answer">{card.back}</div>
                      {card.hint && <div className="sr-hint">{card.hint}</div>}
                      {card.noteId && (
                        <button className="sr-source" onClick={() => navigate({ kind: 'studyNote', id: card.noteId! })}>
                          <Icon name="doc" size={12} /> Open the note this came from
                        </button>
                      )}
                      {card.objId && (
                        <button className="sr-source" onClick={() => openObject(card.objId!)}>
                          <Icon name="arrow-up-right" size={12} /> Open it in your vault
                        </button>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {card.state === 'new' && <span className="sr-badge new">New card</span>}
              {card.lapses > 2 && <span className="sr-badge leech">Tricky — {card.lapses} lapses</span>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {card && (
        <div className="sr-actions">
          {!shown ? (
            <motion.button className="sr-reveal" onClick={() => setShown(true)} whileTap={{ scale: 0.97 }} transition={spring}>
              Show answer <kbd>space</kbd>
            </motion.button>
          ) : (
            <motion.div
              className="sr-grades"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={spring}
            >
              {RATINGS.map((r) => (
                <motion.button
                  key={r.rating}
                  className={'sr-grade ' + r.tone}
                  onClick={() => answer(r.rating)}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.96 }}
                  transition={spring}
                >
                  <span className="sr-grade-label">{r.label}</span>
                  <span className="sr-grade-when">{card.preview?.[r.rating] ?? ''}</span>
                  <kbd>{r.key}</kbd>
                </motion.button>
              ))}
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}
