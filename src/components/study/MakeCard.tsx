import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { Deck, ParsedCard } from '../../types';
import { Icon } from '../Icons';

/**
 * Turn selected text into flashcards, without leaving the note.
 *
 * If the selection is a list Habitat can read — pairs on their own lines, or a
 * sentence with {{braces}} around what to hide — it offers those as they are.
 * Otherwise the selection becomes the front and the answer is typed here. The
 * card keeps a link back to the note it was cut from.
 */
export function MakeCard({
  text,
  objId,
  onClose,
}: {
  text: string;
  objId?: string;
  onClose: () => void;
}) {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [deckId, setDeckId] = useState('');
  const [parsed, setParsed] = useState<ParsedCard[]>([]);
  const [back, setBack] = useState('');
  const [saved, setSaved] = useState(0);

  useEffect(() => {
    api.study.decks().then((list) => {
      setDecks(list);
      // Last deck used wins, so cutting a run of cards from one note doesn't
      // mean picking the same deck over and over.
      const last = localStorage.getItem('habitat:lastDeck');
      setDeckId(list.find((d) => d.id === last)?.id ?? list[0]?.id ?? '');
    });
  }, []);

  useEffect(() => {
    api.study.cardsFromText({ text, dry: true }).then((res) => setParsed(res as ParsedCard[]));
  }, [text]);

  const front = text.trim();
  const manual = parsed.length === 0;

  const save = async () => {
    let target = deckId;
    if (!target) {
      const made = await api.study.deckCreate({ name: 'From my notes' });
      target = made.id;
      setDeckId(made.id);
    }
    localStorage.setItem('habitat:lastDeck', target);

    if (manual) {
      if (!front || !back.trim()) return;
      await api.study.cardCreate({ deckId: target, front, back: back.trim(), objId });
      setSaved(1);
    } else {
      await api.study.cardsFromText({ deckId: target, text, objId });
      setSaved(parsed.length);
    }
    setTimeout(onClose, 900);
  };

  if (saved) {
    return (
      <div className="sel-card-panel done">
        <Icon name="check" size={14} />
        <span>
          {saved} card{saved === 1 ? '' : 's'} added
        </span>
      </div>
    );
  }

  return (
    <div className="sel-card-panel" onMouseDown={(e) => e.stopPropagation()}>
      <div className="sel-card-head">
        <Icon name="cards" size={13} />
        <span>{manual ? 'New flashcard' : `${parsed.length} card${parsed.length === 1 ? '' : 's'} found`}</span>
        <select className="sel-card-deck" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
          {!decks.length && <option value="">New deck</option>}
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      {manual ? (
        <>
          <div className="sel-card-front">{front || 'Select some text first'}</div>
          <input
            className="sel-card-input"
            placeholder="The answer…"
            autoFocus
            value={back}
            onChange={(e) => setBack(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') onClose();
            }}
          />
        </>
      ) : (
        <div className="sel-card-list">
          {parsed.slice(0, 4).map((c, i) => (
            <div key={i} className="sel-card-row">
              <span>{c.front}</span>
              <Icon name="chevron-right" size={11} />
              <span className="dim">{c.back}</span>
            </div>
          ))}
          {parsed.length > 4 && <div className="sel-card-row dim">and {parsed.length - 4} more…</div>}
        </div>
      )}

      <div className="sel-card-actions">
        <button className="sel-card-btn" onClick={onClose}>
          Cancel
        </button>
        <button className="sel-card-btn primary" onClick={save} disabled={manual && !back.trim()}>
          Add {manual ? 'card' : `${parsed.length} cards`}
        </button>
      </div>
    </div>
  );
}
