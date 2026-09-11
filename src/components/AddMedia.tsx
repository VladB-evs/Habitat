import { useState } from 'react';
import { motion } from 'motion/react';
import { dialogIn, snap } from '../motion';
import type { CoverResult, FileRef } from '../types';
import { fileUrl } from '../media';
import { CoverSearch } from './CoverPicker';
import { Icon } from './Icons';

const KINDS = ['Movie', 'TV Show', 'Book', 'Comic'] as const;
const KIND_ICON: Record<string, string> = { Movie: 'film', 'TV Show': 'tv', Book: 'book', Comic: 'book' };
const STATUSES = ['Want to', 'In progress', 'Finished', 'Dropped'];

export interface NewMedia {
  title: string;
  kind: string;
  status: string;
  rating: number;
  cover: FileRef | null;
  genre: string[];
}

/** Five stars you set by clicking one; clicking the one already set clears it. */
function StarPick({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [hover, setHover] = useState(0);
  const lit = hover || value;
  return (
    <div className="star-pick" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          className={'star-pick-btn' + (n <= lit ? ' on' : '')}
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(value === n ? 0 : n)}
          aria-label={`${n} star${n === 1 ? '' : 's'}`}
        >
          <Icon name="star" size={19} />
        </button>
      ))}
      <span className="star-pick-note">{value ? `${value}/5` : 'Not rated'}</span>
    </div>
  );
}

/**
 * Adding something to the library, in the order you actually know things: find
 * the thing and its cover first, then say where you are with it.
 *
 * It used to be a title field that made an object immediately and dropped you
 * on its page with everything still to fill in — the cover picker was a
 * separate trip, and status and rating were two more.
 */
export function AddMedia({ initialKind, onAdd, onClose }: { initialKind: string; onAdd: (m: NewMedia) => void; onClose: () => void }) {
  const [kind, setKind] = useState(initialKind);
  const [step, setStep] = useState<'find' | 'details'>('find');
  const [title, setTitle] = useState('');
  const [cover, setCover] = useState<FileRef | null>(null);
  const [genre, setGenre] = useState<string[]>([]);
  const [status, setStatus] = useState('Want to');
  const [rating, setRating] = useState(0);

  const chose = (file: FileRef | null, g: string[], r: CoverResult | null) => {
    setCover(file);
    setGenre(g);
    if (r?.title) setTitle(r.title);
    setStep('details');
  };

  const submit = () => {
    const name = title.trim();
    if (!name) return;
    onAdd({ title: name, kind, status, rating, cover, genre });
  };

  return (
    <motion.div
      className="palette-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={snap}
    >
      <motion.div className="cover-picker add-media" variants={dialogIn} initial="hidden" animate="shown">
        <div className="cover-picker-head">
          <h3>{step === 'find' ? 'Add to your library' : 'Where are you with it?'}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={15} />
          </button>
        </div>

        {step === 'find' ? (
          <>
            <div className="seg mini add-media-kind">
              {KINDS.map((k) => (
                <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)} type="button">
                  <Icon name={KIND_ICON[k]} size={12} /> {k}
                </button>
              ))}
            </div>
            <CoverSearch kind={kind} initialQuery="" onPick={chose} />
            <button
              className="btn subtle add-media-skip"
              onClick={() => {
                setCover(null);
                setStep('details');
              }}
            >
              Add without a cover
            </button>
          </>
        ) : (
          <div className="add-media-details">
            <div className="add-media-chosen">
              <span className="add-media-poster">
                {cover ? (
                  <img src={fileUrl(cover)} alt="" />
                ) : (
                  <span className="media-poster-empty">
                    <Icon name={KIND_ICON[kind] || 'film'} size={22} />
                  </span>
                )}
              </span>
              <div className="add-media-naming">
                <label>Title</label>
                <input
                  className="field"
                  value={title}
                  autoFocus={!title}
                  placeholder={`Name of the ${kind.toLowerCase()}…`}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                />
                {genre.length > 0 && <div className="add-media-genre">{genre.join(' · ')}</div>}
              </div>
            </div>

            <div className="add-media-field">
              <label>Status</label>
              <div className="add-media-statuses">
                {STATUSES.map((s) => (
                  <button key={s} className={'filter-chip' + (status === s ? ' on' : '')} onClick={() => setStatus(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="add-media-field">
              <label>Rating</label>
              <StarPick value={rating} onChange={setRating} />
            </div>

            <div className="popover-actions add-media-actions">
              <button className="btn subtle" onClick={() => setStep('find')}>
                <Icon name="chevron-left" size={13} /> Back
              </button>
              <button className="btn primary" onClick={submit} disabled={!title.trim()}>
                <Icon name="plus" size={13} /> Add {kind.toLowerCase()}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
