import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { api } from '../api';
import { dialogIn, snap } from '../motion';
import type { CoverResult, FileRef } from '../types';
import { Icon } from './Icons';

/**
 * Search a cover art source and hand back a stored file reference plus
 * whatever genre that same source knows for the pick — or fall through to a
 * manual upload when nothing online is close enough. The search itself is
 * routed by `kind` on the main process side (Wikipedia for movies, TVmaze for
 * shows, Open Library for books and comics).
 */
export function CoverPicker({
  kind,
  initialQuery,
  onPick,
  onClose,
}: {
  kind: string;
  initialQuery: string;
  onPick: (ref: FileRef, genre: string[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<CoverResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = async (q: string) => {
    const term = q.trim();
    if (!term) return;
    setSearching(true);
    setError('');
    try {
      setResults(await api.media.searchCovers(kind, term));
    } catch {
      setError("Couldn't reach the cover search — check your connection and try again.");
      setResults([]);
    } finally {
      setSearching(false);
      setSearched(true);
    }
  };

  useEffect(() => {
    inputRef.current?.focus();
    if (initialQuery.trim()) search(initialQuery);
    // Only on mount — later searches come from the form submit below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = async (r: CoverResult) => {
    setFetchingId(r.id);
    setError('');
    try {
      const { file, genre } = await api.media.fetchCover(r.image, r.title, kind, r.id);
      onPick(file, genre);
      onClose();
    } catch {
      setError("Couldn't download that cover. Try another, or upload one instead.");
    } finally {
      setFetchingId(null);
    }
  };

  const upload = async () => {
    const picked = await api.files.pick({ images: true });
    if (picked.length) {
      onPick(picked[0], []);
      onClose();
    }
  };

  return (
    <motion.div
      className="palette-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={snap}
    >
      <motion.div className="cover-picker" variants={dialogIn} initial="hidden" animate="shown">
        <div className="cover-picker-head">
          <h3>Choose a cover</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={15} />
          </button>
        </div>

        <form
          className="cover-picker-search"
          onSubmit={(e) => {
            e.preventDefault();
            search(query);
          }}
        >
          <Icon name="search" size={13} />
          <input
            ref={inputRef}
            placeholder={`Search for the ${kind.toLowerCase()}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn subtle" type="submit" disabled={searching || !query.trim()}>
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>

        {error && <div className="cover-picker-error">{error}</div>}

        <div className="cover-picker-grid">
          {results.map((r) => (
            <button
              key={r.id}
              className="cover-result"
              disabled={fetchingId !== null}
              onClick={() => pick(r)}
              title={r.title}
            >
              <span className="cover-result-art">
                <img src={r.image} alt="" loading="lazy" />
                {fetchingId === r.id && (
                  <span className="cover-result-busy">
                    <span className="spinner" />
                  </span>
                )}
              </span>
              <span className="cover-result-title">{r.title}</span>
              {r.subtitle && <span className="cover-result-sub">{r.subtitle}</span>}
            </button>
          ))}
        </div>

        {!searching && searched && results.length === 0 && !error && (
          <div className="cover-picker-empty">Nothing came back for that search.</div>
        )}

        <div className="cover-picker-foot">
          <button className="btn subtle" onClick={upload}>
            <Icon name="paperclip" size={13} /> Upload from your computer instead
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
