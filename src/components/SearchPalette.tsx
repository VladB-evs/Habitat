import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { Obj } from '../types';
import { typeColor } from '../util';
import { motion } from 'motion/react';
import { dialogIn, snap } from '../motion';
import { Icon, TypeIcon } from './Icons';

/** The operators the search understands, offered as one-click starting points. */
const OPERATORS: [string, string][] = [
  ['type:', 'one kind of object'],
  ['tag:', 'carrying a tag'],
  ['is:pinned', 'pinned only'],
  ['due:week', 'dated in the next 7 days'],
  ['edited:today', 'touched today'],
];

const OPERATOR_RE = /^(type|tag|is|due|created|edited):/i;

/** The words left once the operators are taken out — what actually got matched. */
const plainWords = (q: string) =>
  q
    .split(/\s+/)
    .filter((w) => w && !OPERATOR_RE.test(w))
    .join(' ')
    .trim();

/** Wrap each occurrence of the query so you can see what matched. */
function highlight(text: string, query: string) {
  const q = query.trim();
  if (!q) return text;
  const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'));
  return parts.map((p, i) =>
    p.toLowerCase() === q.toLowerCase() ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>
  );
}

export function SearchPalette({ onClose }: { onClose: () => void }) {
  const { types, openObject, theme } = useApp();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Obj[]>([]);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  /** Offered only where Apple Intelligence actually exists. */
  const [aiReady, setAiReady] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState('');
  /** What was typed before the model rewrote it, so the change can be undone. */
  const [asked, setAsked] = useState('');

  useEffect(() => {
    let alive = true;
    api.ai
      .availability()
      .then((state) => alive && setAiReady(state.available))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Hands the query to the model and puts its operators in the box — rather than
   * running a hidden search of its own. The user sees exactly what was
   * understood, can fix a wrong guess by editing one word, and learns the syntax
   * by watching it get written.
   */
  const interpret = async () => {
    const text = q.trim();
    if (!text || aiBusy) return;
    setAiBusy(true);
    setAiError('');
    const res = await api.ai.search(text);
    setAiBusy(false);
    if (res.ok && res.query) {
      setAsked(text);
      setQ(res.query);
      inputRef.current?.focus();
    } else {
      setAiError(res.error || "Couldn't turn that into a search.");
    }
  };

  const undoInterpret = () => {
    setQ(asked);
    setAsked('');
    inputRef.current?.focus();
  };

  useEffect(() => {
    let alive = true;
    api.objects.search(q, { content: true }).then((r) => {
      if (alive) {
        setResults(r);
        setIndex(0);
      }
    });
    return () => {
      alive = false;
    };
  }, [q]);

  const words = plainWords(q);
  // Operators alone aren't a note title, so "create" follows the words, not the query.
  const canCreate = words.length > 0 && types.some((t) => t.id === 'note');
  const total = results.length + (canCreate ? 1 : 0);

  const createNote = async () => {
    const o = await api.objects.create({ typeId: 'note', title: words });
    onClose();
    openObject(o.id);
  };

  const choose = (i: number) => {
    if (i < results.length) {
      onClose();
      openObject(results[i].id);
    } else if (canCreate) {
      createNote();
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    // ⌘↵ rather than ↵: the plain key opens what's highlighted, and that has to
    // keep working while you type.
    if (e.key === 'Enter' && e.metaKey) {
      e.preventDefault();
      interpret();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => (total ? (i + 1) % total : 0));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => (total ? (i - 1 + total) % total : 0));
    }
    if (e.key === 'Enter') choose(index);
  };

  const typeOf = (o: Obj) => types.find((t) => t.id === o.typeId);

  return (
    <motion.div
      className="palette-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={snap}
    >
      <motion.div className="palette" variants={dialogIn} initial="hidden" animate="shown">
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Search your Habitat…"
          value={q}
          autoFocus
          onChange={(e) => {
            setQ(e.target.value);
            // Editing by hand makes the model's version yours, so there is
            // nothing left to undo.
            setAsked('');
            setAiError('');
          }}
          onKeyDown={onKey}
        />

        {(aiBusy || asked || aiError) && (
          <div className={'palette-ai' + (aiError ? ' bad' : '')}>
            <Icon name="sparkles" size={12} />
            {aiBusy && <span>Reading your request…</span>}
            {!aiBusy && aiError && <span>{aiError}</span>}
            {!aiBusy && !aiError && asked && (
              <>
                <span className="palette-ai-from">from “{asked}”</span>
                <button className="palette-ai-undo" onClick={undoInterpret}>
                  undo
                </button>
              </>
            )}
          </div>
        )}
        <div className="palette-results">
          {results.map((o, i) => (
            <button
              key={o.id}
              className={'result-row' + (i === index ? ' sel' : '')}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(i)}
            >
              <span className="result-emoji">
                <TypeIcon icon={typeOf(o)?.icon} color={typeColor(typeOf(o)?.color, theme)} size={15} />
              </span>
              <span className="result-main">
                <span className="result-title">{o.title || 'Untitled'}</span>
                {o.match && <span className="result-sub">{highlight(o.match, words)}</span>}
              </span>
              <span className="result-type">{typeOf(o)?.name}</span>
            </button>
          ))}
          {canCreate && (
            <button
              className={'result-row' + (index === results.length ? ' sel' : '')}
              onMouseEnter={() => setIndex(results.length)}
              onClick={createNote}
            >
              <span className="result-emoji">
                <Icon name="plus" size={14} />
              </span>
              <span className="result-title">Create note “{words}”</span>
            </button>
          )}
          {!canCreate && results.length === 0 && <div className="empty">Nothing found</div>}
        </div>
        <div className="palette-ops">
          {OPERATORS.map(([op, what]) => (
            <button
              key={op}
              className="palette-op"
              title={what}
              onClick={() => {
                setQ((cur) => (cur.trim() ? `${cur.trim()} ${op}` : op));
                inputRef.current?.focus();
              }}
            >
              {op}
            </button>
          ))}
        </div>
        <div className="palette-hint">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          {aiReady && <span>⌘↵ ask for filters</span>}
          <span>esc close</span>
        </div>
      </motion.div>
    </motion.div>
  );
}
