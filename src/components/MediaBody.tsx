import { useState } from 'react';
import type { ReactNode } from 'react';
import type { FileRef, Obj, PropDef } from '../types';
import { fileUrl } from '../media';
import { Cell } from './cells';
import { CoverPicker } from './CoverPicker';
import { Icon } from './Icons';

const POSTER_ICON: Record<string, string> = {
  Movie: 'film',
  'TV Show': 'film',
  Book: 'book',
  Comic: 'book',
};

/**
 * A media entry's page: the poster up front, the facts that describe it
 * beside that, then whatever's been written about it in the note body below —
 * there's no separate Comments field duplicating that. Kind, Status, Rating,
 * Cover and Started/Finished come from the Media type itself; anything else
 * (Genre, or a detail someone added by hand) falls into the plain list.
 */
export function MediaBody({
  obj,
  typeDefs,
  onTitle,
  onProp,
  onProps,
  children,
}: {
  obj: Obj;
  typeDefs: PropDef[];
  onTitle: (v: string) => void;
  onProp: (propId: string, value: any) => void;
  /** Several properties saved together — picking a cover sets it and Genre in
   *  one go, which two separate `onProp` calls can't do without the second
   *  one clobbering the first (see the comment where this is used). */
  onProps: (patch: Record<string, any>) => void;
  /** The note editor, kept in the page shell so every object type saves it the same way. */
  children: ReactNode;
}) {
  const [picking, setPicking] = useState(false);
  const byId = new Map(typeDefs.map((p) => [p.id, p]));
  const kindDef = byId.get('kind');
  const kind = String(obj.props.kind || 'Movie');
  const cover: FileRef | undefined = (Array.isArray(obj.props.cover) ? obj.props.cover : [])[0];

  // Kind, Status, Rating, Cover, Started and Finished all ride in the hero;
  // everything else — Genre, or something added by hand — falls into the
  // plain property list.
  const heroIds = new Set(['kind', 'status', 'rating', 'cover', 'started', 'finished']);
  const rest = [...typeDefs.filter((p) => !heroIds.has(p.id)), ...obj.extraProps];

  return (
    <div className="media-page">
      <div className="media-hero">
        <div className="media-poster">
          {cover ? (
            <img src={fileUrl(cover)} alt="" />
          ) : (
            <span className="media-poster-empty">
              <Icon name={POSTER_ICON[kind] || 'film'} size={28} />
            </span>
          )}
          <button className="media-cover-btn" onClick={() => setPicking(true)}>
            <Icon name="image" size={12} /> {cover ? 'Change cover' : 'Add cover'}
          </button>
        </div>

        <div className="media-hero-main">
          {kindDef && (
            <div className="media-kind">
              <Cell def={kindDef} value={obj.props.kind} onChange={(v) => onProp('kind', v)} />
            </div>
          )}
          <input
            className="media-title"
            value={obj.title}
            placeholder="Untitled"
            onChange={(e) => onTitle(e.target.value)}
          />
          <div className="media-hero-facts">
            {byId.get('status') && (
              <div className="obj-prop inline">
                <label>Status</label>
                <Cell def={byId.get('status')!} value={obj.props.status} onChange={(v) => onProp('status', v)} />
              </div>
            )}
            {byId.get('rating') && (
              <div className="obj-prop inline">
                <label>Rating</label>
                <Cell def={byId.get('rating')!} value={obj.props.rating} onChange={(v) => onProp('rating', v)} />
              </div>
            )}
            {/* A movie is watched in one sitting — Finished doubles as "watched
                on" and Started has nothing to add. A show or a book has both ends. */}
            {kind !== 'Movie' && byId.get('started') && (
              <div className="obj-prop inline">
                <label>Started</label>
                <Cell def={byId.get('started')!} value={obj.props.started} onChange={(v) => onProp('started', v)} />
              </div>
            )}
            {byId.get('finished') && (
              <div className="obj-prop inline">
                <label>{kind === 'Movie' ? 'Watched' : 'Finished'}</label>
                <Cell def={byId.get('finished')!} value={obj.props.finished} onChange={(v) => onProp('finished', v)} />
              </div>
            )}
          </div>
        </div>
      </div>

      {rest.length > 0 && (
        <div className="obj-props media-props">
          {rest.map((p) => (
            <div className="obj-prop" key={p.id}>
              <label>{p.name}</label>
              <div className="prop-control">
                <Cell def={p} value={obj.props[p.id]} onChange={(v) => onProp(p.id, v)} />
              </div>
            </div>
          ))}
        </div>
      )}

      {picking && (
        <CoverPicker
          kind={kind}
          initialQuery={obj.title}
          onPick={(ref, genre) => {
            // One save, not two — a second `onProp` call right after the first
            // would build its patch from `obj.props` before the cover's own
            // update had landed, and win the race by saving last.
            const existing: string[] = Array.isArray(obj.props.genre) ? obj.props.genre : [];
            onProps({ cover: [ref], ...(genre.length ? { genre: [...new Set([...existing, ...genre])] } : {}) });
          }}
          onClose={() => setPicking(false)}
        />
      )}

      <div className="person-notes">
        <h3>
          <Icon name="doc" size={13} /> Notes
        </h3>
        {children}
      </div>
    </div>
  );
}
