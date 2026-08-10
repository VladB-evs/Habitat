import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { Template } from '../types';
import { typeColor } from '../util';
import { Editor } from './Editor';
import { Icon, TypeIcon } from './Icons';
import { SplitControls } from './SplitControls';
import { PropsPanel } from './PropsPanel';

export function TemplatePage({ id }: { id: string }) {
  const { types, back, canBack, navigate, theme } = useApp();
  const [tpl, setTpl] = useState<Template | null>(null);
  const [missing, setMissing] = useState(false);
  const [name, setName] = useState('');
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    api.templates.get(id).then((t) => {
      if (!alive) return;
      if (!t) return setMissing(true);
      setTpl(t);
      setName(t.name);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  if (missing) return <div className="empty">This template was deleted.</div>;
  if (!tpl) return <div className="page" />;

  const type = types.find((t) => t.id === tpl.typeId);

  const saveName = (v: string) => {
    setName(v);
    if (nameTimer.current) clearTimeout(nameTimer.current);
    nameTimer.current = setTimeout(() => api.templates.update(id, { name: v }), 400);
  };

  const saveProp = (propId: string, value: any) => {
    const props = { ...tpl.props, [propId]: value };
    setTpl({ ...tpl, props });
    api.templates.update(id, { props });
  };

  const del = async () => {
    if (!confirm(`Delete the template “${tpl.name || 'Untitled'}”?`)) return;
    await api.templates.remove(id);
    if (canBack) back();
    else if (type) navigate({ kind: 'type', typeId: type.id });
  };

  return (
    <div className="page">
      <div className="obj-topbar">
        <button className="icon-btn" onClick={back} disabled={!canBack} style={{ opacity: canBack ? 1 : 0.35 }} aria-label="Back">
          <Icon name="arrow-left" />
        </button>
        <button className="crumb" onClick={() => type && navigate({ kind: 'type', typeId: type.id })}>
          <TypeIcon icon={type?.icon} color={typeColor(type?.color, theme)} size={14} />
          {type?.name}
        </button>
        <span className="tpl-badge">Template</span>
        <div className="spacer" />
        <button className="icon-btn" onClick={del} aria-label="Delete template">
          <Icon name="trash" size={15} />
        </button>
        <SplitControls />
      </div>

      <div className="obj-body">
        <input
          className="obj-title"
          spellCheck
          value={name}
          placeholder="Template name"
          onChange={(e) => saveName(e.target.value)}
        />

        <PropsPanel
          typeDefs={type?.properties ?? []}
          extraProps={tpl.extraProps}
          values={tpl.props}
          onValue={saveProp}
          onExtraChange={(defs) => {
            setTpl({ ...tpl, extraProps: defs });
            api.templates.update(id, { extraProps: defs });
          }}
        />

        <div className="obj-editor">
          <Editor
            key={tpl.id}
            content={tpl.content}
            placeholder="Template content — every object created from this template starts with it…"
            onSave={(json) => api.templates.update(id, { content: json })}
          />
        </div>
      </div>
    </div>
  );
}
