import { useState } from 'react';
import { useApp } from '../store';
import type { ObjType } from '../types';
import { typeColor, TYPE_PALETTE } from '../util';
import { ICON_CHOICES, Icon, TypeIcon } from './Icons';

/** Icon chooser with a filter, since the vocabulary is long. */
export function IconPicker({ value, color, onPick }: { value: string; color: string; onPick: (k: string) => void }) {
  const { theme } = useApp();
  const [q, setQ] = useState('');
  const shown = ICON_CHOICES.filter((k) => k.includes(q.trim().toLowerCase().replace(/\s+/g, '-')));
  return (
    <>
      <input className="field icon-search" placeholder="Search icons…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="icon-grid">
        {shown.map((k) => (
          <button
            key={k}
            className={'icon-choice' + (k === value ? ' sel' : '')}
            onClick={() => onPick(k)}
            aria-label={k}
            title={k.replace(/-/g, ' ')}
          >
            <TypeIcon icon={k} size={15} color={k === value ? typeColor(color, theme) : undefined} />
          </button>
        ))}
        {shown.length === 0 && <div className="empty" style={{ padding: 10, fontSize: 12.5 }}>No icon matches</div>}
      </div>
    </>
  );
}

export function ColorPicker({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  const { theme } = useApp();
  return (
    <div className="swatches">
      {TYPE_PALETTE.map((c) => (
        <button
          key={c}
          className={'swatch' + (c === value ? ' sel' : '')}
          style={{ background: typeColor(c, theme) }}
          onClick={() => onPick(c)}
          aria-label={c}
        />
      ))}
    </div>
  );
}

/** Rename / re-icon / re-colour a type after it has been created. */
export function TypeEditor({
  type,
  pos,
  onSave,
  onClose,
}: {
  type: ObjType;
  pos: { left: number; top: number };
  onSave: (patch: { name: string; icon: string; color: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(type.name);
  const [icon, setIcon] = useState(type.icon || 'box');
  const [color, setColor] = useState(type.color || TYPE_PALETTE[0]);

  const save = () => {
    if (!name.trim()) return;
    onSave({ name: name.trim(), icon, color });
    onClose();
  };

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="popover type-editor" style={pos}>
        <div className="form-row">
          <label>Name</label>
          <input
            className="field"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') onClose();
            }}
          />
        </div>
        <div className="form-row">
          <label>Icon</label>
          <IconPicker value={icon} color={color} onPick={setIcon} />
        </div>
        <div className="form-row">
          <label>Colour</label>
          <ColorPicker value={color} onPick={setColor} />
        </div>
        <div className="popover-actions">
          <button className="btn subtle" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            <Icon name="check" size={13} /> Save
          </button>
        </div>
      </div>
    </>
  );
}
