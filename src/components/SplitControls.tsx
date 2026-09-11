import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useApp } from '../store';
import { api } from '../api';
import { Icon } from './Icons';
import type { Obj } from '../types';
import type { View } from '../store';

export function SplitControls() {
  const { panes, split, openPageBeside, openBeside, linkTarget, setLinkTarget } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Obj[]>([]);
  const containerRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQ('');
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    let alive = true;
    api.objects.search(q.trim(), { content: true }).then((r) => {
      if (alive) setResults(r.slice(0, 5));
    });
    return () => {
      alive = false;
    };
  }, [q]);

  // Close on Escape or click outside
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const handleOpenPage = (view: View) => {
    setOpen(false);
    openPageBeside(view);
  };

  const handleCreateNote = async () => {
    setOpen(false);
    const made = await api.objects.create({ typeId: 'note', title: q.trim() || 'Untitled note' });
    openBeside(made.id);
  };

  const handleOpenResult = (id: string) => {
    setOpen(false);
    openBeside(id);
  };

  const handleDuplicate = () => {
    setOpen(false);
    split('row');
  };

  if (panes.length > 1) return null;

  return (
    <span className="split-controls" ref={containerRef}>
      <motion.button
        className={'icon-btn split-trigger-btn' + (open ? ' active' : '')}
        onClick={() => setOpen((v) => !v)}
        aria-label="Split view"
        title="Open in split view"
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.92 }}
      >
        <Icon name="columns" size={15} />
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="split-popover"
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.96 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            <div className="split-popover-head">
              <div className="split-popover-title">
                <Icon name="columns" size={14} />
                <span>Open in Split View</span>
              </div>
              <button className="icon-btn mini" onClick={() => setOpen(false)} aria-label="Close">
                <Icon name="x" size={13} />
              </button>
            </div>

            <div className="split-popover-mode">
              <span className="split-popover-mode-label">Clicking links:</span>
              <div className="seg mini">
                <button
                  className={linkTarget === 'current' ? 'on' : ''}
                  onClick={() => setLinkTarget('current')}
                  title="Clicking opens in current pane"
                >
                  Here
                </button>
                <button
                  className={linkTarget === 'side' ? 'on' : ''}
                  onClick={() => setLinkTarget('side')}
                  title="Clicking opens in side pane (Side Peek)"
                >
                  Beside
                </button>
              </div>
            </div>

            <div className="split-popover-search">
              <Icon name="search" size={13} />
              <input
                ref={inputRef}
                placeholder="Search note, person, task…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {q && (
                <button className="icon-btn mini" onClick={() => setQ('')}>
                  <Icon name="x" size={11} />
                </button>
              )}
            </div>

            {results.length > 0 && (
              <div className="split-popover-results">
                {results.map((r) => (
                  <button key={r.id} className="split-popover-row" onClick={() => handleOpenResult(r.id)}>
                    <Icon name="doc" size={13} />
                    <span className="split-popover-name">{r.title || 'Untitled'}</span>
                  </button>
                ))}
              </div>
            )}

            {q.trim() && results.length === 0 && (
              <div className="split-popover-results">
                <button className="split-popover-row" onClick={handleCreateNote}>
                  <Icon name="plus" size={13} />
                  <span>Create note <strong>"{q.trim()}"</strong> beside</span>
                </button>
              </div>
            )}

            <div className="split-popover-section-label">Quick Pages</div>
            <div className="split-popover-grid">
              <button className="split-popover-item" onClick={() => handleOpenPage({ kind: 'daily' })}>
                <Icon name="calendar" size={14} />
                <span>Daily Notes</span>
              </button>
              <button className="split-popover-item" onClick={() => handleOpenPage({ kind: 'tasks' })}>
                <Icon name="circle-check" size={14} />
                <span>Tasks</span>
              </button>
              <button className="split-popover-item" onClick={() => handleOpenPage({ kind: 'people' })}>
                <Icon name="people" size={14} />
                <span>People</span>
              </button>
              <button className="split-popover-item" onClick={() => handleOpenPage({ kind: 'media' })}>
                <Icon name="film" size={14} />
                <span>Media</span>
              </button>
              <button className="split-popover-item" onClick={() => handleOpenPage({ kind: 'canvas' })}>
                <Icon name="canvas" size={14} />
                <span>Canvas</span>
              </button>
              <button className="split-popover-item" onClick={() => handleOpenPage({ kind: 'study' })}>
                <Icon name="study" size={14} />
                <span>Study</span>
              </button>
            </div>

            <div className="split-popover-footer">
              <button className="split-popover-subtle-btn" onClick={handleDuplicate}>
                <Icon name="copy" size={12} />
                <span>Duplicate current view beside</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}
