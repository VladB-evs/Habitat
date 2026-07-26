import { useState } from 'react';
import type { PropDef } from '../types';
import { Cell, popPos } from './cells';
import { Icon } from './Icons';
import { PropEditor } from './PropEditor';

/**
 * Property list for an object or template: the type's schema properties plus
 * the item's own extra properties (addable, editable, deletable).
 */
export function PropsPanel({
  typeDefs,
  extraProps,
  values,
  onValue,
  onExtraChange,
}: {
  typeDefs: PropDef[];
  extraProps: PropDef[];
  values: Record<string, any>;
  onValue: (propId: string, value: any) => void;
  onExtraChange: (defs: PropDef[]) => void;
}) {
  const [editor, setEditor] = useState<{ initial?: PropDef; pos: { left: number; top: number } } | null>(null);

  const saveExtra = (def: PropDef) => {
    const i = extraProps.findIndex((p) => p.id === def.id);
    const next = [...extraProps];
    if (i >= 0) next[i] = def;
    else next.push(def);
    onExtraChange(next);
  };

  return (
    <div className="obj-props">
      {typeDefs.map((p) => (
        <div className="obj-prop" key={p.id}>
          <label>{p.name}</label>
          <div className="prop-control">
            <Cell def={p} value={values[p.id]} onChange={(v) => onValue(p.id, v)} />
          </div>
        </div>
      ))}
      {extraProps.map((p) => (
        <div className="obj-prop" key={p.id}>
          <label>
            {p.name}
            <button
              className="prop-edit"
              aria-label="Edit property"
              onClick={(e) => setEditor({ initial: p, pos: popPos(e.currentTarget as HTMLElement, 260, 320) })}
            >
              <Icon name="pencil" size={11} />
            </button>
          </label>
          <div className="prop-control">
            <Cell def={p} value={values[p.id]} onChange={(v) => onValue(p.id, v)} />
          </div>
        </div>
      ))}
      <button className="add-prop" onClick={(e) => setEditor({ pos: popPos(e.currentTarget as HTMLElement, 260, 320) })}>
        <Icon name="plus" size={13} /> Add property
      </button>
      {editor && (
        <PropEditor
          initial={editor.initial}
          pos={editor.pos}
          onSave={saveExtra}
          onClose={() => setEditor(null)}
          onDelete={
            editor.initial ? () => onExtraChange(extraProps.filter((p) => p.id !== editor.initial!.id)) : undefined
          }
        />
      )}
    </div>
  );
}
