import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../../api';
import { dialogIn, spring } from '../../motion';
import { useApp } from '../../store';
import type { Deck, ParsedCard, StudyNote } from '../../types';
import { ago } from '../../util';
import { Icon } from '../Icons';
import { SplitControls } from '../SplitControls';

/**
 * Pick what the note's cards go into — an existing deck, or a new one named
 * after the note. Shown before anything is written, with what was found in the
 * note listed underneath, so the whole thing can be called off on sight.
 */
function MakeDeck({
  note,
  found,
  onClose,
  onDone,
}: {
  note: StudyNote;
  found: ParsedCard[];
  onClose: () => void;
  onDone: (deck: Deck | null, made: number) => void;
}) {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [target, setTarget] = useState<string>(note.deckId ?? 'new');
  const [name, setName] = useState(note.title || 'New deck');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.study.decks().then((list) => {
      setDecks(list);
      if (!note.deckId && list.length === 0) setTarget('new');
    });
  }, [note.deckId]);

  const go = async () => {
    setBusy(true);
    const res = await api.study.noteToCards({
      noteId: note.id,
      deckId: target === 'new' ? undefined : target,
      deckName: name.trim() || note.title || 'New deck',
    });
    setBusy(false);
    onDone(res.deck, res.cards.length);
    onClose();
  };

  return (
    <>
      <div className="backdrop dim" onClick={onClose} />
      <div className="modal-layer">
        <motion.div className="modal sr-makedeck" variants={dialogIn} initial="hidden" animate="shown" exit="gone">
        <h2>Make cards from this note</h2>
        <p className="sr-import-help">
          {found.length
            ? `${found.length} card${found.length === 1 ? '' : 's'} found in what you've written. Lines already turned into cards are skipped.`
            : 'Nothing in this note looks like a card yet. Write pairs — “term — meaning”, “Q:” and “A:” on two lines, or wrap the part to hide in {{braces}}.'}
        </p>

        {found.length > 0 && (
          <>
            <label className="sr-set-row">
              <span>Put them in</span>
              <select className="sr-select" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="new">A new deck…</option>
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>

            {target === 'new' && (
              <label className="sr-set-row">
                <span>Deck name</span>
                <input value={name} autoFocus onChange={(e) => setName(e.target.value)} />
              </label>
            )}

            <div className="sr-import-preview">
              {found.slice(0, 8).map((c, i) => (
                <div key={i} className="sr-import-row">
                  <span>{c.front}</span>
                  <Icon name="chevron-right" size={12} />
                  <span className="dim">{c.back}</span>
                </div>
              ))}
              {found.length > 8 && <div className="sr-import-row dim">and {found.length - 8} more…</div>}
            </div>
          </>
        )}

        <div className="modal-actions">
          <button className="btn subtle" onClick={onClose}>
            {found.length ? 'Cancel' : 'Close'}
          </button>
          {found.length > 0 && (
            <button className="btn primary" onClick={go} disabled={busy}>
              Make {found.length} card{found.length === 1 ? '' : 's'}
            </button>
          )}
          </div>
        </motion.div>
      </div>
    </>
  );
}

/**
 * The labels a note can carry. Both optional, and free text rather than a fixed
 * list — a subject is whatever you call it, and nobody should have to define a
 * property type before writing down what happened in a lecture.
 */
const NOTE_FIELDS = [
  { id: 'subject', name: 'Subject', icon: 'bookmark', placeholder: 'Biology, Spanish, History…' },
  { id: 'class', name: 'Class', icon: 'people', placeholder: 'Period 3, Dr. Reyes…' },
] as const;

/**
 * A page to write on during a class, and a button to turn what you wrote into a
 * deck. Plain text on purpose: it takes dictation at speed, and the same plain
 * lines are what the card reader understands.
 */
export function StudyNotePage({ id }: { id: string }) {
  const { navigate } = useApp();
  const [note, setNote] = useState<StudyNote | null>(null);
  const [body, setBody] = useState('');
  const [title, setTitle] = useState('');
  const [props, setProps] = useState<Record<string, string>>({});
  const [found, setFound] = useState<ParsedCard[]>([]);
  const [making, setMaking] = useState(false);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [toast, setToast] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.study.noteGet(id).then((n) => {
      if (!n) return;
      setNote(n);
      setBody(n.body);
      setTitle(n.title);
      setProps((n.props ?? {}) as Record<string, string>);
    });
  }, [id]);

  /** Saved as you write, not on a button. */
  const queueSave = useCallback(
    (patch: { title?: string; body?: string; props?: Record<string, string> }) => {
      setSaved('saving');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const updated = await api.study.notePatch(id, patch);
        if (updated) setNote(updated);
        setSaved('saved');
      }, 500);
    },
    [id]
  );

  useEffect(() => () => void (saveTimer.current && clearTimeout(saveTimer.current)), []);

  // What the writing would yield, kept current so the button can say how many.
  useEffect(() => {
    if (!body.trim()) return setFound([]);
    let alive = true;
    const t = setTimeout(() => {
      api.study.cardsFromText({ text: body, dry: true }).then((res) => alive && setFound(res as ParsedCard[]));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [body]);

  if (!note) return <div className="page" />;

  return (
    <div className="page sr-note-page">
      <div className="page-head">
        <button className="icon-btn" onClick={() => navigate({ kind: 'study' })} title="Back to Study">
          <Icon name="arrow-left" size={15} />
        </button>
        <input
          className="sr-note-title"
          value={title}
          placeholder="Untitled note"
          onChange={(e) => {
            setTitle(e.target.value);
            queueSave({ title: e.target.value, body });
          }}
        />
        <span className="spacer" />
        <span className="sr-note-saved">{saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved' : ''}</span>
        {note.deckId && (
          <button className="btn subtle" onClick={() => navigate({ kind: 'deck', id: note.deckId! })}>
            <Icon name="deck" size={14} /> Its deck
          </button>
        )}
        <button className="btn primary" onClick={() => setMaking(true)}>
          <Icon name="cards" size={14} /> Make cards{found.length ? ` (${found.length})` : ''}
        </button>
        <SplitControls />
      </div>

      <div className="sr-note-meta">
        <span>
          <Icon name="clock" size={12} /> Edited {ago(note.updatedAt)}
        </span>
        {!!note.cards && (
          <span>
            · {note.cards} card{note.cards === 1 ? '' : 's'} made from this note
          </span>
        )}
      </div>

      {/* Optional throughout: an empty field is simply a label with nothing
          under it, and clearing one removes it rather than leaving a blank. */}
      <div className="sr-note-props">
        {NOTE_FIELDS.map((f) => (
          <label key={f.id} className="sr-note-prop-row">
            <span className="sr-note-prop-label">
              <Icon name={f.icon} size={13} />
              {f.name}
            </span>
            <input
              value={props[f.id] ?? ''}
              placeholder={f.placeholder}
              onChange={(e) => {
                const next = { ...props, [f.id]: e.target.value };
                setProps(next);
                queueSave({ props: next });
              }}
            />
          </label>
        ))}
      </div>

      <textarea
        ref={bodyRef}
        className="sr-note-body"
        value={body}
        autoFocus
        spellCheck
        placeholder={
          'Take notes the way you would in class.\n\n' +
          'Any line that looks like a pair can become a card:\n' +
          '  mitochondria — the powerhouse of the cell\n' +
          '  Q: When did the Berlin Wall fall?\n' +
          '  A: 1989\n' +
          '  The capital of Japan is {{Tokyo}}\n\n' +
          'Everything else stays as notes.'
        }
        onChange={(e) => {
          setBody(e.target.value);
          queueSave({ title, body: e.target.value });
        }}
      />

      <AnimatePresence>
        {toast && (
          <div key="toast" className="sr-toast-layer">
            <motion.div
              className="sr-toast"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={spring}
            >
              <Icon name="check" size={14} /> {toast}
            </motion.div>
          </div>
        )}
        {making && (
          <MakeDeck
            note={note}
            found={found}
            onClose={() => setMaking(false)}
            onDone={(deck, made) => {
              api.study.noteGet(id).then((n) => n && setNote(n));
              if (made) {
                setToast(`${made} card${made === 1 ? '' : 's'} added to ${deck?.name ?? 'the deck'}`);
                setTimeout(() => setToast(''), 2600);
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
