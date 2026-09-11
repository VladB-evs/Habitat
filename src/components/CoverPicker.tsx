import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { api } from '../api';
import { dialogIn, snap } from '../motion';
import type { CoverResult, FileRef } from '../types';
import { Icon } from './Icons';

/**
 * The main process throws a code rather than a sentence, because the same
 * failure used to be reported as "check your connection" whichever of these it
 * actually was — and it was almost never the connection.
 */
export function reason(e: unknown): string {
  const m = String((e as any)?.message ?? e);
  if (m.includes('media:busy')) return 'The cover source is rate-limiting us. Wait a few seconds and try again.';
  if (m.includes('media:timeout')) return 'The cover source took too long to answer.';
  if (m.includes('media:down')) return 'The cover source is having trouble right now.';
  if (m.includes('media:offline')) return "Couldn't reach the cover source — check your connection.";
  return 'Something went wrong looking that up.';
}

/**
 * Search a cover art source and hand back a stored file reference plus
 * whatever genre that same source knows for the pick. The search is routed by
 * `kind` on the main process side (Wikipedia for movies, TVmaze for shows,
 * Open Library for books and comics).
 *
 * The chrome around it is deliberately not here: the same step is a dialog of
 * its own when changing an existing cover, and the first of two steps when
 * adding something new.
 */
export function CoverSearch({
  kind,
  initialQuery,
  autoFocus = true,
  onPick,
}: {
  kind: string;
  initialQuery: string;
  autoFocus?: boolean;
  onPick: (file: FileRef, genre: string[], result: CoverResult | null) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<CoverResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [tmdbStatus, setTmdbStatus] = useState<{ hasKey: boolean; maskedKey: string | null }>({ hasKey: false, maskedKey: null });
  const [showTmdbConfig, setShowTmdbConfig] = useState(false);
  const [tmdbKeyInput, setTmdbKeyInput] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastTerm = useRef('');

  useEffect(() => {
    api.media.tmdbStatus().then(setTmdbStatus).catch(() => {});
  }, []);

  const saveTmdbKey = async () => {
    if (!tmdbKeyInput.trim()) return;
    setSavingKey(true);
    try {
      const status = await api.media.setTmdbKey(tmdbKeyInput.trim());
      setTmdbStatus(status);
      setTmdbKeyInput('');
      setShowTmdbConfig(false);
      if (lastTerm.current) search(lastTerm.current);
    } finally {
      setSavingKey(false);
    }
  };

  const clearTmdbKey = async () => {
    setSavingKey(true);
    try {
      const status = await api.media.setTmdbKey('');
      setTmdbStatus(status);
      setTmdbKeyInput('');
      setShowTmdbConfig(false);
      if (lastTerm.current) search(lastTerm.current);
    } finally {
      setSavingKey(false);
    }
  };

  const search = async (q: string) => {
    const term = q.trim();
    if (!term) return;
    lastTerm.current = term;
    setSearching(true);
    setError('');
    try {
      setResults(await api.media.searchCovers(kind, term));
    } catch (e) {
      setError(reason(e));
      setResults([]);
    } finally {
      setSearching(false);
      setSearched(true);
    }
  };

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
    if (initialQuery.trim()) search(initialQuery);
    // Only on mount — later searches come from the form submit below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching kind mid-search points at a different source entirely, so what is
  // on screen is answering the wrong question until it is run again.
  useEffect(() => {
    if (searched && lastTerm.current) search(lastTerm.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const pick = async (r: CoverResult) => {
    setFetchingId(r.id);
    setError('');
    try {
      const { file, genre } = await api.media.fetchCover(r.image, r.title, kind, r.id);
      onPick(file, genre, r);
    } catch (e) {
      setError(reason(e) + ' Try another, or upload one instead.');
    } finally {
      setFetchingId(null);
    }
  };

  const upload = async () => {
    const picked = await api.files.pick({ images: true });
    if (picked.length) onPick(picked[0], [], null);
  };

  return (
    <>
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

      {(kind === 'Movie' || kind === 'TV Show') && (
        <div className="cover-picker-source">
          <span className="source-label">Source</span>
          {tmdbStatus.hasKey ? (
            <span className="source-tag on" title={`TMDb active (${tmdbStatus.maskedKey})`}>
              <span className="source-dot on" />
              TMDb ({tmdbStatus.maskedKey})
              <button type="button" className="source-action" onClick={() => setShowTmdbConfig((s) => !s)}>
                {showTmdbConfig ? 'Close' : 'Change'}
              </button>
            </span>
          ) : (
            <span className="source-tag">
              <span className="source-dot" />
              Wikipedia
              <button type="button" className="source-action" onClick={() => setShowTmdbConfig((s) => !s)}>
                {showTmdbConfig ? 'Close' : 'Connect TMDb'}
              </button>
            </span>
          )}
        </div>
      )}

      {showTmdbConfig && (
        <div className="cover-picker-tmdb-config">
          <div className="tmdb-config-header">
            <span>The Movie Database (TMDb) API Key</span>
            <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">
              Get free key ↗
            </a>
          </div>
          <div className="tmdb-config-row">
            <input
              type="password"
              className="field mono"
              placeholder={tmdbStatus.hasKey ? '••••••••' : 'Paste API Key or Read Access Token…'}
              value={tmdbKeyInput}
              onChange={(e) => setTmdbKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveTmdbKey()}
            />
            <button className="btn primary" type="button" onClick={saveTmdbKey} disabled={savingKey || !tmdbKeyInput.trim()}>
              Save
            </button>
            {tmdbStatus.hasKey && (
              <button className="btn subtle" type="button" onClick={clearTmdbKey} disabled={savingKey}>
                Remove
              </button>
            )}
          </div>
          <div className="tmdb-config-tip">
            No website? When TMDb asks for an <em>Application URL</em>, simply enter <code>http://localhost</code>.
          </div>
        </div>
      )}

      {error && (
        <div className="cover-picker-error">
          <span>{error}</span>
          {lastTerm.current && (
            <button className="btn subtle" onClick={() => search(lastTerm.current)} disabled={searching}>
              Try again
            </button>
          )}
        </div>
      )}

      <div className="cover-picker-grid">
        {searching &&
          results.length === 0 &&
          // Placeholders rather than a spinner: the grid keeps the height it is
          // about to have, so results don't shove the dialog around as they land.
          Array.from({ length: 8 }).map((_, i) => <span key={i} className="cover-result skeleton" />)}
        {results.map((r) => (
          <button key={r.id} className="cover-result" disabled={fetchingId !== null} onClick={() => pick(r)} title={r.title}>
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
        <div className="cover-picker-empty">
          <div>Nothing came back for that search.</div>
          {!tmdbStatus.hasKey && (kind === 'Movie' || kind === 'TV Show') && (
            <button className="btn subtle" type="button" onClick={() => setShowTmdbConfig(true)} style={{ marginTop: 8 }}>
              Connect free TMDb key for more results
            </button>
          )}
        </div>
      )}

      <div className="cover-picker-foot">
        <button className="btn subtle" onClick={upload}>
          <Icon name="paperclip" size={13} /> Upload from your computer instead
        </button>
      </div>
    </>
  );
}

/** The standalone dialog: changing the cover on something already in the library. */
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
        <CoverSearch
          kind={kind}
          initialQuery={initialQuery}
          onPick={(file, genre) => {
            onPick(file, genre);
            onClose();
          }}
        />
      </motion.div>
    </motion.div>
  );
}
