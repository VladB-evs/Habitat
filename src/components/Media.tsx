import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { api } from '../api';
import { dealtIn, spring, stagger } from '../motion';
import { onObjectChanged } from '../objects';
import { useApp } from '../store';
import type { FileRef, Obj } from '../types';
import { fileUrl } from '../media';
import { MEDIA_TYPE } from '../util';
import type { NewMedia } from './AddMedia';
import { AddMedia } from './AddMedia';
import { Icon } from './Icons';
import { PageActions } from './PageActions';
import { SplitControls } from './SplitControls';

const KINDS = ['Movie', 'TV Show', 'Book', 'Comic'] as const;
const KIND_ICON: Record<string, string> = { Movie: 'film', 'TV Show': 'tv', Book: 'book', Comic: 'book' };
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
    <motion.button
      layout="position"
      transition={spring}
      className="poster-card"
      variants={dealtIn}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      onClick={onOpen}
    >
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
  const { openFrom } = useApp();
  const [items, setItems] = useState<Obj[]>([]);
  const [kind, setKind] = useState<string>('All');
  const [status, setStatus] = useState('All');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);

  const load = () => api.objects.list(MEDIA_TYPE).then(setItems);

  useEffect(() => {
    load();
    return onObjectChanged(() => load());
  }, []);

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

  /** Everything the dialog collected lands in one create — nothing to fill in after. */
  const add = async (m: NewMedia) => {
    setAdding(false);
    const props: Record<string, any> = { kind: m.kind, status: m.status };
    if (m.rating) props.rating = m.rating;
    if (m.cover) props.cover = [m.cover];
    if (m.genre.length) props.genre = m.genre;
    const o = await api.objects.create({ typeId: MEDIA_TYPE, title: m.title, props });
    setItems((list) => [...list, o]);
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
          <SplitControls />
        </PageActions>
      </header>

      <div className="media-body">
        <div className="media-toolbar">
          <select
            className="media-filter-select"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            aria-label="Filter by type"
          >
            <option value="All">All types ({items.length})</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k} ({kindCounts.get(k) ?? 0})
              </option>
            ))}
          </select>

          <select
            className="media-filter-select"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="All">Any status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <div className="media-search">
            <Icon name="search" size={13} />
            <input
              placeholder="Search library…"
              enterKeyHint="search"
              autoCapitalize="off"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q && (
              <button className="icon-btn" onClick={() => setQ('')} aria-label="Clear search">
                <Icon name="x" size={12} />
              </button>
            )}
          </div>

          <button className="btn primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} /> Add
          </button>
        </div>

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

      {adding && <AddMedia initialKind={kind === 'All' ? 'Movie' : kind} onAdd={add} onClose={() => setAdding(false)} />}
    </div>
  );
}
