import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../../api';
import { popIn } from '../../motion';
import { useApp } from '../../store';
import type { Obj } from '../../types';
import { typeColor } from '../../util';
import { Icon, TypeIcon } from '../Icons';

/**
 * The picker for putting things already in the vault onto a board. It searches
 * titles as you type and falls back to what you touched last when the box is
 * empty, which is nearly always what you want a second after making something.
 *
 * Enter drops the highlighted result and keeps the picker open, so a handful of
 * objects goes on the board in one pass rather than one trip each.
 */
export function AddFromVault({ onPick, onClose }: { onPick: (obj: Obj) => void; onClose: () => void }) {
  const { types, theme } = useApp();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Obj[]>([]);
  const [at, setAt] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const typeById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    let alive = true;
    const needle = q.trim();
    const run = needle ? api.objects.search(needle) : api.objects.list();
    run.then((list) => {
      if (!alive) return;
      setResults(list.slice(0, 40));
      setAt(0);
    });
    return () => {
      alive = false;
    };
  }, [q]);

  const take = (obj: Obj | undefined) => {
    if (!obj) return;
    onPick(obj);
  };

  return (
    <>
      <div className="backdrop transparent" onClick={onClose} />
      <div className="cv-picker-layer">
        <motion.div className="cv-picker" variants={popIn} initial="hidden" animate="shown" exit="gone">
        <div className="cv-picker-search">
          <Icon name="search" size={14} />
          <input
            ref={inputRef}
            value={q}
            placeholder="Add from your vault…"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setAt((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setAt((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                take(results[at]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
          />
          <kbd>esc</kbd>
        </div>

        <div className="cv-picker-list">
          <AnimatePresence initial={false}>
            {results.map((o, i) => {
              const t = typeById.get(o.typeId);
              return (
                <motion.button
                  key={o.id}
                  className={'cv-picker-row' + (i === at ? ' at' : '')}
                  onMouseEnter={() => setAt(i)}
                  onClick={() => take(o)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <TypeIcon icon={t?.icon} color={typeColor(t?.color, theme)} size={14} />
                  <span className="cv-picker-title">{o.title || 'Untitled'}</span>
                  <span className="cv-picker-type">{t?.name}</span>
                </motion.button>
              );
            })}
          </AnimatePresence>
          {!results.length && <div className="cv-picker-empty">Nothing matches “{q}”</div>}
        </div>
        </motion.div>
      </div>
    </>
  );
}
