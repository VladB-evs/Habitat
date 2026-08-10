import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../../api';
import { spring } from '../../motion';
import type { Deck } from '../../types';
import { Icon } from '../Icons';

/**
 * Adding words, at the speed you can type them.
 *
 * Enter saves and clears without moving the caret out of the term box, so a page
 * of vocabulary goes in as one run of typing. Each word is one card — the deck's
 * "ask both ways" setting is what adds the reverse, and it is off by default,
 * because two rows appearing for something typed once reads as a mistake.
 *
 * Nothing here touches the vault: no object, no type, no sidebar entry.
 */
export function VocabAdd({ decks, onAdded }: { decks: Deck[]; onAdded?: () => void }) {
  const [term, setTerm] = useState('');
  const [meaning, setMeaning] = useState('');
  const [reading, setReading] = useState('');
  const [language, setLanguage] = useState(() => localStorage.getItem('habitat:lastLang') ?? '');
  const [deckId, setDeckId] = useState(() => localStorage.getItem('habitat:lastVocabDeck') ?? '');
  const [languages, setLanguages] = useState<string[]>([]);
  const [recent, setRecent] = useState<{ term: string; meaning: string; deck: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const termRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.study.languages().then(setLanguages);
    termRef.current?.focus();
  }, []);

  // A deck that has since been deleted must not stay selected invisibly.
  useEffect(() => {
    if (deckId && !decks.some((d) => d.id === deckId)) setDeckId('');
  }, [decks, deckId]);

  const save = async () => {
    if (!term.trim() || !meaning.trim() || saving) return;
    setSaving(true);
    const made = await api.study.vocabAdd({
      term: term.trim(),
      meaning: meaning.trim(),
      reading: reading.trim(),
      language: language.trim(),
      deckId: deckId || undefined,
    });
    setSaving(false);
    if (!made) return;

    setRecent((was) => [{ term: term.trim(), meaning: meaning.trim(), deck: made.deck.name }, ...was].slice(0, 6));
    setTerm('');
    setMeaning('');
    setReading('');
    localStorage.setItem('habitat:lastLang', language.trim());
    // The deck it landed in becomes the default, so a run of words all go to the
    // same place even when the language box was what chose it the first time.
    setDeckId(made.deck.id);
    localStorage.setItem('habitat:lastVocabDeck', made.deck.id);
    api.study.languages().then(setLanguages);
    onAdded?.();
    termRef.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  };

  return (
    <div className="vocab-add">
      <div className="vocab-add-row">
        <input
          ref={termRef}
          className="vocab-field term"
          placeholder="Word or phrase"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={onKey}
        />
        <span className="vocab-arrow">
          <Icon name="chevron-right" size={14} />
        </span>
        <input
          className="vocab-field meaning"
          placeholder="What it means"
          value={meaning}
          onChange={(e) => setMeaning(e.target.value)}
          onKeyDown={onKey}
        />
        <input
          className="vocab-field reading"
          placeholder="Reading"
          title="Pronunciation, romaji, pinyin — whatever helps"
          value={reading}
          onChange={(e) => setReading(e.target.value)}
          onKeyDown={onKey}
        />
        <motion.button
          className="btn primary"
          onClick={save}
          disabled={!term.trim() || !meaning.trim()}
          whileTap={{ scale: 0.96 }}
          transition={spring}
        >
          Add
        </motion.button>
      </div>

      <div className="vocab-add-row second">
        <label className="vocab-target">
          <span>Into</span>
          <select className="sr-select" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
            <option value="">A deck named after the language</option>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        {!deckId && (
          <input
            className="vocab-field lang"
            placeholder="Language"
            list="habitat-languages"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            onKeyDown={onKey}
          />
        )}
        <datalist id="habitat-languages">
          {languages.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
        <span className="vocab-hint">
          <kbd>Enter</kbd> saves and keeps going. Turn on “ask both ways” in a deck's settings to also be asked meaning → word.
        </span>
      </div>

      <AnimatePresence initial={false}>
        {recent.length > 0 && (
          <motion.div className="vocab-recent" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {recent.map((r, i) => (
              <motion.span
                key={r.term + i}
                className="vocab-chip"
                initial={{ opacity: 0, y: -6, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={spring}
              >
                <strong>{r.term}</strong> {r.meaning}
                <em>{r.deck}</em>
              </motion.span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
