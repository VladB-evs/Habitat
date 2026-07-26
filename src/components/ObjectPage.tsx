import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { objectChanged, onObjectChanged } from '../objects';
import { useApp } from '../store';
import type { Obj } from '../types';
import { ago, typeColor } from '../util';
import { Editor } from './Editor';
import { Icon, TypeIcon } from './Icons';
import { PropsPanel } from './PropsPanel';

export function ObjectPage({ id }: { id: string }) {
  const { types, back, canBack, navigate, openFrom, theme } = useApp();
  const [obj, setObj] = useState<Obj | null>(null);
  const [missing, setMissing] = useState(false);
  const [backlinks, setBacklinks] = useState<Obj[]>([]);
  const [title, setTitle] = useState('');
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    api.objects.get(id).then((o) => {
      if (!alive) return;
      if (!o) return setMissing(true);
      setObj(o);
      setTitle(o.title);
    });
    api.backlinks(id).then((b) => alive && setBacklinks(b));
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
  }, [id]);

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
    navigate(type.id === 'daily' ? { kind: 'daily' } : { kind: 'type', typeId: type.id });
  };

  return (
    <div className="page">
      <div className="obj-topbar">
        <button className="icon-btn" onClick={back} disabled={!canBack} style={{ opacity: canBack ? 1 : 0.35 }} aria-label="Back">
          <Icon name="arrow-left" />
        </button>
        <button className="crumb" onClick={goToType}>
          <TypeIcon icon={type?.icon} color={typeColor(type?.color, theme)} size={14} />
          {type?.name}
        </button>
        <div className="spacer" />
        {!isTag && (
          <button className={'icon-btn' + (obj.pinned ? ' active' : '')} onClick={togglePin} aria-label="Pin">
            <Icon name={obj.pinned ? 'star-filled' : 'star'} size={15} />
          </button>
        )}
        <button className="icon-btn" onClick={del} aria-label="Delete">
          <Icon name="trash" size={15} />
        </button>
      </div>

      <div className="obj-body">
        {/* A tag is just a label: no properties, no body — only what it's attached to. */}
        {isTag ? (
          <h1 className="tag-title">
            <span className="tag-title-hash">#</span>
            {obj.title}
          </h1>
        ) : (
          <>
            <input
              className="obj-title"
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
              onExtraChange={(defs) => {
                setObj({ ...obj, extraProps: defs });
                api.objects.update(id, { extraProps: defs }).then(() => objectChanged(id));
              }}
            />

            <div className="obj-editor">
              <Editor
                key={obj.id}
                content={obj.content}
                onSave={(json) => api.objects.update(id, { content: json }).then(() => objectChanged(id))}
              />
            </div>
          </>
        )}

        {isTag && backlinks.length === 0 && (
          <div className="empty">Nothing is tagged with #{obj.title} yet.</div>
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
