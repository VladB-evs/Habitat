import { useState } from 'react';
import { useApp } from '../store';
import type { PropDef, PropKind } from '../types';
import { clientUid } from '../util';

export const KIND_LABELS: Record<PropKind, string> = {
  text: 'Text',
  longtext: 'Long text',
  number: 'Number',
  select: 'Select',
  multiselect: 'Multi-select',
  date: 'Date',
  datetime: 'Date & time',
  checkbox: 'Checkbox',
  url: 'URL',
  email: 'Email',
  phone: 'Phone',
  rating: 'Rating',
  progress: 'Progress',
  color: 'Color',
  relation: 'Relation',
};

/** Kinds that carry a list of choices. */
const HAS_OPTIONS = (k: PropKind) => k === 'select' || k === 'multiselect';

export function PropEditor({
  initial,
  pos,
  onSave,
  onClose,
  onDelete,
}: {
  initial?: PropDef;
  pos: { left: number; top: number };
  onSave: (def: PropDef) => void;
  onClose: () => void;
  onDelete?: () => void;
}) {
  const { types } = useApp();
  const [name, setName] = useState(initial?.name ?? '');
  const [kind, setKind] = useState<PropKind>(initial?.kind ?? 'text');
  const [options, setOptions] = useState((initial?.options ?? []).join(', '));
  const [target, setTarget] = useState(initial?.targetTypeId ?? types.find((t) => t.id !== 'daily')?.id ?? '');

  const save = () => {
    if (!name.trim()) return;
    const def: PropDef = { id: initial?.id ?? clientUid(), name: name.trim(), kind };
    if (HAS_OPTIONS(kind))
      def.options = options
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    if (kind === 'relation') def.targetTypeId = target;
    onSave(def);
    onClose();
  };

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="popover" style={pos}>
        <div className="form-row">
          <label>Name</label>
          <input
            className="field"
            value={name}
            autoFocus
            placeholder="Property name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') onClose();
            }}
          />
        </div>
        <div className="form-row">
          <label>Type</label>
          <select className="field" value={kind} onChange={(e) => setKind(e.target.value as PropKind)}>
            {(Object.keys(KIND_LABELS) as PropKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        {HAS_OPTIONS(kind) && (
          <div className="form-row">
            <label>Options (comma-separated)</label>
            <input className="field" value={options} placeholder="Todo, Doing, Done" onChange={(e) => setOptions(e.target.value)} />
          </div>
        )}
        {kind === 'relation' && (
          <div className="form-row">
            <label>Links to</label>
            <select className="field" value={target} onChange={(e) => setTarget(e.target.value)}>
              {types
                .filter((t) => t.id !== 'daily')
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </div>
        )}
        <div className="popover-actions">
          {onDelete && (
            <button
              className="btn subtle danger"
              onClick={() => {
                onDelete();
                onClose();
              }}
            >
              Delete
            </button>
          )}
          <button className="btn subtle" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </>
  );
}
