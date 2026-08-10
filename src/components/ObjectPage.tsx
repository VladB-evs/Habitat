import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { objectChanged, onObjectChanged } from '../objects';
import { useApp } from '../store';
import type { Obj, ObjType, PropDef } from '../types';
import { ago, canChangeType, PEOPLE_TYPE, typeColor } from '../util';
import { Editor } from './Editor';
import { Icon, TypeIcon } from './Icons';
import { PersonBody } from './PersonBody';
import { PropsPanel } from './PropsPanel';
import { SplitControls } from './SplitControls';

export function ObjectPage({ id }: { id: string }) {
  const { types, back, canBack, navigate, openFrom, theme } = useApp();
  const [obj, setObj] = useState<Obj | null>(null);
  const [missing, setMissing] = useState(false);
  const [backlinks, setBacklinks] = useState<Obj[]>([]);
  /** The boards this object has been placed on — a link outwards, like a backlink. */
  const [boards, setBoards] = useState<{ id: string; name: string; icon: string; color: string }[]>([]);
  const [title, setTitle] = useState('');
  const [selfId, setSelfId] = useState<string | null>(null);
  /** Anchored under the type crumb when open. */
  const [movePos, setMovePos] = useState<{ left: number; top: number } | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadSelf = useCallback(() => api.people.self().then((me) => setSelfId(me?.id ?? null)), []);

  useEffect(() => {
    let alive = true;
    api.objects.get(id).then((o) => {
      if (!alive) return;
      if (!o) return setMissing(true);
      setObj(o);
      setTitle(o.title);
      if (o.typeId === PEOPLE_TYPE) loadSelf();
    });
    api.backlinks(id).then((b) => alive && setBacklinks(b));
    api.canvas.forObject(id).then((c) => alive && setBoards(c));
    // Someone editing this object elsewhere (the type table, a mention chip) shows up here.
    // The editor and title input own their own text, so only the surrounding data is refreshed.
    const off = onObjectChanged((changed) => {
      if (changed !== id) return;
      api.objects.get(id).then((o) => alive && o && setObj((prev) => (prev ? { ...o, content: prev.content } : o)));
      api.backlinks(id).then((b) => alive && setBacklinks(b));
    });
    return () => {
      alive = false;
      off();
    };
  }, [id, loadSelf]);

  if (missing) return <div className="empty">This object was deleted.</div>;
  if (!obj) return <div className="page" />;

  const type = types.find((t) => t.id === obj.typeId);
  const typeById = new Map(types.map((t) => [t.id, t]));

  const saveTitle = (v: string) => {
    setTitle(v);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => api.objects.update(id, { title: v }).then(() => objectChanged(id)), 400);
  };

  const saveProp = (propId: string, value: any) => {
    const props = { ...obj.props, [propId]: value };
    setObj({ ...obj, props });
    api.objects.update(id, { props }).then(() => objectChanged(id));
  };

  const togglePin = async () => {
    const pinned = !obj.pinned;
    setObj({ ...obj, pinned });
    await api.objects.update(id, { pinned });
    objectChanged(id);
  };

  const isTag = obj.typeId === 'tag';
  const isPerson = obj.typeId === PEOPLE_TYPE;

  const saveExtraProps = (defs: PropDef[]) => {
    setObj({ ...obj, extraProps: defs });
    api.objects.update(id, { extraProps: defs }).then(() => objectChanged(id));
  };

  const saveContent = (json: any) => api.objects.update(id, { content: json }).then(() => objectChanged(id));

  const del = async () => {
    if (isTag) {
      const where = backlinks.length === 1 ? '1 object' : `${backlinks.length} objects`;
      const warning = backlinks.length
        ? `\n\nIt will be removed from ${where}. The objects themselves are kept — only the tag goes away.`
        : '';
      if (!confirm(`Delete the tag “${obj.title}”?${warning}`)) return;
      await api.tags.remove(id);
    } else {
      if (!confirm(`Delete “${obj.title || 'Untitled'}”? This also removes its links.`)) return;
      await api.objects.remove(id);
    }
    objectChanged(id);
    if (canBack) back();
    else navigate({ kind: 'dashboard' });
  };

  const goToType = () => {
    if (!type) return;
    if (type.id === 'daily') return navigate({ kind: 'daily' });
    if (type.id === PEOPLE_TYPE) return navigate({ kind: 'people' });
    navigate({ kind: 'type', typeId: type.id });
  };

  const movable = canChangeType(obj.typeId) ? types.filter((t) => t.id !== obj.typeId && canChangeType(t.id)) : [];

  const moveTo = async (t: ObjType) => {
    setMovePos(null);
    const res = await api.objects.setType(id, t.id);
    if ('error' in res) return void alert(`Could not move this to ${t.name}.`);
    // The editor owns its own text; only the surrounding data is replaced.
    setObj((prev) => (prev ? { ...res, content: prev.content } : res));
    objectChanged(id);
  };

  return (
    <div className="page">
      <div className="obj-topbar">
        <button className="icon-btn" onClick={back} disabled={!canBack} style={{ opacity: canBack ? 1 : 0.35 }} aria-label="Back">
          <Icon name="arrow-left" />
        </button>
        <span className="crumb-group">
          <button className="crumb" onClick={goToType}>
            <TypeIcon icon={type?.icon} color={typeColor(type?.color, theme)} size={14} />
            {type?.name}
          </button>
          {movable.length > 0 && (
            <button
              className="crumb-more"
              aria-label="Change type"
              title="Change type"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setMovePos(movePos ? null : { left: r.left - 8, top: r.bottom + 6 });
              }}
            >
              <Icon name="chevron-down" size={12} />
            </button>
          )}
        </span>
        <div className="spacer" />
        {!isTag && (
          <button className={'icon-btn' + (obj.pinned ? ' active' : '')} onClick={togglePin} aria-label="Pin">
            <Icon name={obj.pinned ? 'star-filled' : 'star'} size={15} />
          </button>
        )}
        <button className="icon-btn" onClick={del} aria-label="Delete">
          <Icon name="trash" size={15} />
        </button>
        <SplitControls />
      </div>

      {movePos && (
        <>
          <div className="backdrop" onClick={() => setMovePos(null)} />
          <div className="popover" style={movePos}>
            <div className="picker-group">Change type to</div>
            <div className="popover-list">
              {movable.map((t) => (
                <button key={t.id} className="menu-item" onClick={() => moveTo(t)}>
                  <TypeIcon icon={t.icon} color={typeColor(t.color, theme)} size={14} />
                  {t.name}
                </button>
              ))}
            </div>
            <div className="menu-sep" />
            <div className="move-note">Properties the new type doesn't have are kept on this object.</div>
          </div>
        </>
      )}

      <div className="obj-body">
        {/* A tag is just a label: no properties, no body — only what it's attached to. */}
        {isTag ? (
          <h1 className="tag-title">
            <span className="tag-title-hash">#</span>
            {obj.title}
          </h1>
        ) : isPerson ? (
          <PersonBody
            obj={obj}
            typeDefs={type?.properties ?? []}
            isSelf={selfId === obj.id}
            onTitle={saveTitle}
            onProp={saveProp}
            onExtraChange={saveExtraProps}
          >
            <Editor key={obj.id} content={obj.content} onSave={saveContent} />
          </PersonBody>
        ) : (
          <>
            <input
              className="obj-title"
              spellCheck
              value={title}
              placeholder="Untitled"
              onChange={(e) => saveTitle(e.target.value)}
              readOnly={obj.typeId === 'daily'}
            />

            <div className="obj-times">
              <span title={new Date(obj.createdAt).toLocaleString()}>
                <Icon name="clock" size={12} /> Created{' '}
                {new Date(obj.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
              <span title={new Date(obj.updatedAt).toLocaleString()}>Edited {ago(obj.updatedAt)}</span>
            </div>

            <PropsPanel
              typeDefs={type?.properties ?? []}
              extraProps={obj.extraProps}
              values={obj.props}
              onValue={saveProp}
              onExtraChange={saveExtraProps}
            />

            <div className="obj-editor">
              <Editor key={obj.id} content={obj.content} onSave={saveContent} objectId={obj.id} />
            </div>
          </>
        )}

        {isTag && backlinks.length === 0 && (
          <div className="empty">Nothing is tagged with #{obj.title} yet.</div>
        )}

        {boards.length > 0 && (
          <div className="obj-boards">
            <h3>
              <Icon name="canvas" size={13} /> On boards
            </h3>
            <div className="obj-board-chips">
              {boards.map((b) => (
                <button key={b.id} className="obj-board-chip" onClick={() => navigate({ kind: 'canvas', id: b.id })}>
                  <Icon name="canvas" size={12} />
                  {b.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {backlinks.length > 0 && (
          <div className={'backlinks' + (isTag ? ' flush' : '')}>
            <h3>
              <Icon name="link" size={13} /> {isTag ? 'Tagged in' : 'Linked from'}
            </h3>
            {backlinks.map((b) => {
              const bt = typeById.get(b.typeId);
              return (
                <button key={b.id} className="backlink-card" onClick={(e) => openFrom(e, b.id)}>
                  <span className="row-emoji">
                    <TypeIcon icon={bt?.icon} color={typeColor(bt?.color, theme)} size={15} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <div className="bl-title">{b.title || 'Untitled'}</div>
                    {b.snippet && <div className="bl-snippet">{b.snippet}</div>}
                  </span>
                  <span className="legend-dot" style={{ background: typeColor(bt?.color, theme), marginTop: 5 }} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
