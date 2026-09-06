import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { api } from '../api';
import { dealtIn, stagger } from '../motion';
import { onObjectChanged } from '../objects';
import { useApp } from '../store';
import type { FileRef, Obj } from '../types';
import { fileUrl } from '../media';
import { MEDIA_TYPE } from '../util';
import { Icon } from './Icons';
import { PageActions } from './PageActions';
import { SplitControls } from './SplitControls';

const KINDS = ['Movie', 'TV Show', 'Book', 'Comic'] as const;
const KIND_ICON: Record<string, string> = { Movie: 'film', 'TV Show': 'film', Book: 'book', Comic: 'book' };
const STATUSES = ['Want to', 'In progress', 'Finished', 'Dropped'];

function Stars({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="media-stars">
      {Array.from({ length: n }).map((_, i) => (
        <Icon key={i} name="star" size={10} />
      ))}
    </span>
  );
}

function PosterCard({ o, onOpen }: { o: Obj; onOpen: (e: React.MouseEvent) => void }) {
  const cover: FileRef | undefined = (Array.isArray(o.props.cover) ? o.props.cover : [])[0];
  const rating = Number(o.props.rating) || 0;
  const status = o.props.status as string | undefined;
  const genres: string[] = Array.isArray(o.props.genre) ? o.props.genre : [];

  return (
    <motion.button className="poster-card" variants={dealtIn} whileHover={{ y: -4 }} whileTap={{ scale: 0.98 }} onClick={onOpen}>
      <span className="poster-art">
        {cover ? (
          <img src={fileUrl(cover)} alt="" loading="lazy" />
        ) : (
          <span className="poster-empty">
            <Icon name={KIND_ICON[o.props.kind] || 'film'} size={22} />
          </span>
        )}
        {status && <span className={'poster-status ' + status.replace(/\s+/g, '-').toLowerCase()}>{status}</span>}
      </span>
      <span className="poster-title">{o.title || 'Untitled'}</span>
      <span className="poster-sub">
        {genres.slice(0, 2).join(', ')}
        <Stars n={rating} />
      </span>
    </motion.button>
  );
}

/**
 * The Media module's landing page: a poster wall for movies, TV shows, books
 * and comics. Storage is the same generic object type every other type gets —
 * the poster grid, the kind/status filters and the cover picker (on each
 * item's own page) are the only bespoke parts.
 */
export function Media() {
  const { openFrom, openBeside } = useApp();
  const [items, setItems] = useState<Obj[]>([]);
  const [kind, setKind] = useState<string>('All');
  const [status, setStatus] = useState('All');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [newKind, setNewKind] = useState<string>('Movie');
  const addRef = useRef<HTMLInputElement>(null);

  const load = () => api.objects.list(MEDIA_TYPE).then(setItems);

  useEffect(() => {
    load();
    return onObjectChanged(() => load());
  }, []);

  useEffect(() => {
    if (adding) addRef.current?.focus();
  }, [adding]);

  const kindCounts = useMemo(() => {
    const by = new Map<string, number>();
    for (const o of items) by.set(String(o.props.kind || 'Movie'), (by.get(String(o.props.kind || 'Movie')) ?? 0) + 1);
    return by;
  }, [items]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return items.filter((o) => {
      if (kind !== 'All' && o.props.kind !== kind) return false;
      if (status !== 'All' && (o.props.status || 'Want to') !== status) return false;
      if (!needle) return true;
      const hay = [o.title, ...(Array.isArray(o.props.genre) ? o.props.genre : [])];
      return hay.some((v) => String(v || '').toLowerCase().includes(needle));
    });
  }, [items, kind, status, q]);

  const add = async (title: string) => {
    const name = title.trim();
    if (!name) return;
    setDraft('');
    setAdding(false);
    const o = await api.objects.create({
      typeId: MEDIA_TYPE,
      title: name,
      props: { kind: newKind, status: 'Want to' },
    });
    // Appended locally rather than re-fetched: opening the side pane and
    // reflowing the whole grid at the same moment is what read as a glitch.
    setItems((list) => [...list, o]);
    openBeside(o.id);
  };

  return (
    <div className="page media-home">
      <header className="page-head">
        <div className="page-title">
          <span className="type-emoji big">
            <Icon name="film" size={22} />
          </span>
          <h1>Media</h1>
          <span className="count-badge">{items.length}</span>
        </div>
        <PageActions>
          <div className="people-tools">
            <div className="people-search">
              <Icon name="search" size={13} />
              <input placeholder="Search your library…" enterKeyHint="search" autoCapitalize="off" value={q} onChange={(e) => setQ(e.target.value)} />
              {q && (
                <button className="icon-btn" onClick={() => setQ('')} aria-label="Clear search">
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
            <select className="bulk-field" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              <option value="All">Any status</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              className="btn primary"
              onClick={() => {
                setNewKind(kind === 'All' ? 'Movie' : kind);
                setAdding(true);
              }}
            >
              <Icon name="plus" size={14} /> Add
            </button>
            <SplitControls />
          </div>
        </PageActions>
      </header>

      <div className="media-body">
      <div className="people-filter">
        <button className={'filter-chip' + (kind === 'All' ? ' on' : '')} onClick={() => setKind('All')}>
          Everything <span className="filter-n">{items.length}</span>
        </button>
        {KINDS.map((k) => (
          <button key={k} className={'filter-chip' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>
            <Icon name={KIND_ICON[k]} size={12} /> {k} <span className="filter-n">{kindCounts.get(k) ?? 0}</span>
          </button>
        ))}
      </div>

      {adding && (
        <div
          className="person-add media-add"
          onBlur={(e) => {
            // Only close once focus has actually left the whole row — otherwise
            // clicking a Kind button blurs the title field and the row vanishes
            // before the click on it even lands.
            if (!e.currentTarget.contains(e.relatedTarget as Node | null) && draft.trim() === '') setAdding(false);
          }}
        >
          <div className="seg mini media-add-kind">
            {KINDS.map((k) => (
              <button key={k} className={newKind === k ? 'on' : ''} onClick={() => setNewKind(k)} type="button">
                <Icon name={KIND_ICON[k]} size={12} /> {k}
              </button>
            ))}
          </div>
          <input
            ref={addRef}
            className="person-add-input"
            placeholder={`Title of the ${newKind.toLowerCase()}…`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add(draft);
              if (e.key === 'Escape') {
                setDraft('');
                setAdding(false);
              }
            }}
          />
          <button className="btn primary" onClick={() => add(draft)}>
            Add
          </button>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="empty">
          {items.length === 0
            ? 'Nothing here yet. Add a movie, show, book or comic to start tracking it.'
            : 'Nothing matches that.'}
        </div>
      ) : (
        <motion.div className="poster-grid" variants={stagger} initial="hidden" animate="shown">
          {shown.map((o) => (
            <PosterCard key={o.id} o={o} onOpen={(e) => openFrom(e, o.id)} />
          ))}
        </motion.div>
      )}
      </div>
    </div>
  );
}
