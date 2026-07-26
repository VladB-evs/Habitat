import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { Obj } from '../types';
import { typeColor } from '../util';
import { motion } from 'motion/react';
import { dialogIn, snap } from '../motion';
import { Icon, TypeIcon } from './Icons';

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

  const canCreate = q.trim().length > 0 && types.some((t) => t.id === 'note');
  const total = results.length + (canCreate ? 1 : 0);

  const createNote = async () => {
    const o = await api.objects.create({ typeId: 'note', title: q.trim() });
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
          className="palette-input"
          placeholder="Search your Habitat…"
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
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
                {o.match && <span className="result-sub">{highlight(o.match, q)}</span>}
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
              <span className="result-title">Create note “{q.trim()}”</span>
            </button>
          )}
          {!canCreate && results.length === 0 && <div className="empty">Nothing found</div>}
        </div>
        <div className="palette-hint">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </motion.div>
    </motion.div>
  );
}
