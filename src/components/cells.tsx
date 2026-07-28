import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useApp } from '../store';
import type { FileRef, Obj, PropDef } from '../types';
import { fileUrl, isImage } from '../media';
import { optionColor } from '../util';
import { Icon } from './Icons';

/** Clamp a popover position near an anchor element to the viewport. */
export function popPos(anchor: HTMLElement, w = 260, h = 320) {
  const r = anchor.getBoundingClientRect();
  const left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12));
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - 12) top = Math.max(12, r.top - h - 6);
  return { left, top };
}

function TextCell({
  value,
  onCommit,
  number,
  name,
  placeholder,
}: {
  value: any;
  onCommit: (v: any) => void;
  number?: boolean;
  name?: boolean;
  placeholder?: string;
}) {
  const [v, setV] = useState(value == null ? '' : String(value));
  useEffect(() => setV(value == null ? '' : String(value)), [value]);
  const commit = () => {
    const prev = value == null ? '' : String(value);
    if (v === prev) return;
    onCommit(number ? (v.trim() === '' ? null : Number(v)) : v);
  };
  return (
    <input
      className={'cell-input' + (name ? ' name' : '')}
      value={v}
      placeholder={placeholder ?? (name ? 'Untitled' : '')}
      inputMode={number ? 'decimal' : undefined}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function UrlCell({ value, onCommit }: { value: any; onCommit: (v: any) => void }) {
  const open = () => {
    if (!value) return;
    const url = /^https?:\/\//i.test(value) ? value : 'https://' + value;
    window.open(url);
  };
  return (
    <div className="url-cell">
      <TextCell value={value} onCommit={onCommit} placeholder="" />
      {value ? (
        <button className="url-go" onClick={open} aria-label="Open link">
          <Icon name="arrow-up-right" size={13} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Select / multi-select picker. Long option lists get a search box so a property
 * with dozens of choices stays usable.
 */
function SelectCell({
  def,
  value,
  onChange,
  multi,
}: {
  def: PropDef;
  value: any;
  onChange: (v: any) => void;
  multi?: boolean;
}) {
  const { theme } = useApp();
  const opts = def.options ?? [];
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const sel: string[] = multi
    ? Array.isArray(value)
      ? value
      : value
      ? [String(value)]
      : []
    : value
    ? [String(value)]
    : [];
  const filtered = opts.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase()));

  const pick = (o: string) => {
    if (multi) {
      onChange(sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o]);
      // Straight back to an empty search box: type, Enter, type the next one.
      setQ('');
      setCursor(0);
      searchRef.current?.focus();
    } else {
      onChange(sel[0] === o ? null : o);
      setPos(null);
    }
  };

  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return setPos(null);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!filtered.length) return;
      const next = (cursor + (e.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length;
      setCursor(next);
      rowsRef.current[next]?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter' && filtered.length) {
      e.preventDefault();
      pick(filtered[Math.min(cursor, filtered.length - 1)]);
    }
  };

  return (
    <div className="select-cell">
      <button
        ref={btnRef}
        className={'select-btn' + (sel.length ? '' : ' empty')}
        onClick={() => {
          setQ('');
          setCursor(0);
          setPos(popPos(btnRef.current!, 230, 320));
        }}
      >
        <span className="select-val">
          {sel.length ? sel.map((o) => <OptionChip key={o} value={o} theme={theme} />) : '—'}
        </span>
        <Icon name="chevron-down" size={12} />
      </button>
      {pos && (
        <>
          <div className="backdrop" onClick={() => setPos(null)} />
          <div className="popover" style={pos}>
            {opts.length > 6 && (
              <input
                ref={searchRef}
                className="popover-search"
                placeholder="Search options…"
                value={q}
                autoFocus
                onChange={(e) => {
                  setQ(e.target.value);
                  setCursor(0);
                }}
                onKeyDown={onSearchKey}
              />
            )}
            <div className="popover-list">
              {!multi && (
                <button
                  className="menu-item"
                  onClick={() => {
                    onChange(null);
                    setPos(null);
                  }}
                >
                  <span className="check-slot">{sel.length ? null : <Icon name="check" size={13} />}</span>
                  <span className="dim">None</span>
                </button>
              )}
              {filtered.map((o, i) => (
                <button
                  key={o}
                  ref={(el) => {
                    rowsRef.current[i] = el;
                  }}
                  className={'menu-item' + (i === cursor ? ' sel' : '')}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => pick(o)}
                >
                  <span className="check-slot">{sel.includes(o) ? <Icon name="check" size={13} /> : null}</span>
                  <OptionChip value={o} theme={theme} />
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="empty" style={{ padding: 16 }}>
                  {opts.length ? 'No matching option' : 'No options yet'}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RatingCell({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const n = Number(value) || 0;
  return (
    <div className="rating-cell">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          className={'star' + (i <= n ? ' on' : '')}
          aria-label={`${i} of 5`}
          onClick={() => onChange(n === i ? null : i)}
        >
          <Icon name="star" size={14} />
        </button>
      ))}
    </div>
  );
}

function ProgressCell({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const n = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="progress-cell">
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={n}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Progress"
      />
      <span className="progress-num">{n}%</span>
    </div>
  );
}

function ColorCell({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  return (
    <div className="color-cell">
      <input type="color" value={value || '#7aa2f7'} onChange={(e) => onChange(e.target.value)} aria-label="Color" />
      <span className="color-hex">{value || '—'}</span>
    </div>
  );
}

/** Text field with a shortcut that hands the value to the OS (mail, dialler, browser). */
function LinkCell({
  value,
  onCommit,
  href,
  label,
}: {
  value: any;
  onCommit: (v: any) => void;
  href: (v: string) => string;
  label: string;
}) {
  return (
    <div className="url-cell">
      <TextCell value={value} onCommit={onCommit} placeholder="" />
      {value ? (
        <button className="url-go" onClick={() => window.open(href(String(value)))} aria-label={label}>
          <Icon name="arrow-up-right" size={13} />
        </button>
      ) : null}
    </div>
  );
}

/** One coloured pill for a select value. */
export function OptionChip({ value, theme }: { value: string; theme: string }) {
  const c = optionColor(value, theme);
  return (
    <span className="opt-chip" style={{ background: c.bg, color: c.fg, borderColor: c.border }}>
      {value}
    </span>
  );
}

export function RelationCell({ def, value, onChange }: { def: PropDef; value: string[]; onChange: (v: string[]) => void }) {
  const { openObject } = useApp();
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [choices, setChoices] = useState<Obj[]>([]);
  const [q, setQ] = useState('');
  const addRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    api.objects.list(def.targetTypeId).then(setChoices);
  }, [def.targetTypeId]);

  const byId = new Map(choices.map((o) => [o.id, o]));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const openPicker = () => {
    api.objects.list(def.targetTypeId).then(setChoices);
    setQ('');
    setPos(popPos(addRef.current!, 250, 300));
  };
  const filtered = choices.filter((c) => (c.title || 'Untitled').toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="relation-cell">
      {value.map((id) => (
        <span key={id} className="chip" onClick={() => openObject(id)} title={byId.get(id)?.title}>
          {byId.get(id)?.title || 'Untitled'}
        </span>
      ))}
      <button ref={addRef} className="chip-add" onClick={openPicker} aria-label="Link object">
        <Icon name="plus" size={13} />
      </button>
      {pos && (
        <>
          <div className="backdrop" onClick={() => setPos(null)} />
          <div className="popover" style={pos}>
            <input
              className="popover-search"
              placeholder="Search…"
              value={q}
              autoFocus
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setPos(null)}
            />
            <div className="popover-list">
              {filtered.length === 0 && <div className="empty" style={{ padding: 16 }}>Nothing here yet</div>}
              {filtered.map((c) => (
                <button key={c.id} className="menu-item" onClick={() => toggle(c.id)}>
                  <span className="check-slot">{value.includes(c.id) ? <Icon name="check" size={13} /> : null}</span>
                  {c.title || 'Untitled'}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Attachments on a property: thumbnails for images, a chip for anything else.
 * The same store as the editor, so a file attached here and pasted into a note
 * is one copy on disk.
 */
function FileCell({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const refs: FileRef[] = Array.isArray(value) ? value : value ? [value] : [];

  const attach = async () => {
    const picked = await api.files.pick();
    if (picked.length) onChange([...refs, ...picked]);
  };

  return (
    <div className="file-cell">
      {refs.map((f) => (
        <span key={f.hash} className="file-chip" title={f.name}>
          {isImage(f.mime) ? (
            <img className="file-thumb" src={fileUrl(f)} alt="" onClick={() => api.files.open(f.hash)} />
          ) : (
            <button className="file-chip-open" onClick={() => api.files.open(f.hash)}>
              <Icon name="paperclip" size={11} />
              <span className="file-chip-name">{f.name}</span>
            </button>
          )}
          <button
            className="file-chip-x"
            aria-label={`Remove ${f.name}`}
            onClick={() => onChange(refs.filter((x) => x.hash !== f.hash))}
          >
            <Icon name="x" size={10} />
          </button>
        </span>
      ))}
      <button className="chip-add" onClick={attach} aria-label="Attach a file">
        <Icon name="plus" size={13} />
      </button>
    </div>
  );
}

export function Cell({ def, value, onChange }: { def: PropDef; value: any; onChange: (v: any) => void }) {
  switch (def.kind) {
    case 'text':
      return <TextCell value={value} onCommit={onChange} />;
    case 'longtext':
      return (
        <textarea
          className="cell-input area"
          rows={2}
          defaultValue={value ?? ''}
          onBlur={(e) => e.target.value !== (value ?? '') && onChange(e.target.value)}
        />
      );
    case 'number':
      return <TextCell value={value} onCommit={onChange} number />;
    case 'url':
      return <UrlCell value={value} onCommit={onChange} />;
    case 'email':
      return <LinkCell value={value} onCommit={onChange} href={(v) => 'mailto:' + v} label="Send mail" />;
    case 'phone':
      return <LinkCell value={value} onCommit={onChange} href={(v) => 'tel:' + v.replace(/\s+/g, '')} label="Call" />;
    case 'select':
      return <SelectCell def={def} value={value} onChange={onChange} />;
    case 'multiselect':
      return <SelectCell def={def} value={value} onChange={onChange} multi />;
    case 'date':
      return <input type="date" className="cell-input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />;
    case 'datetime':
      return (
        <input
          type="datetime-local"
          className="cell-input"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case 'rating':
      return <RatingCell value={value} onChange={onChange} />;
    case 'progress':
      return <ProgressCell value={value} onChange={onChange} />;
    case 'color':
      return <ColorCell value={value} onChange={onChange} />;
    case 'checkbox':
      return (
        <div className="cell-check">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
        </div>
      );
    case 'file':
      return <FileCell value={value} onChange={onChange} />;
    case 'relation':
      return <RelationCell def={def} value={Array.isArray(value) ? value : []} onChange={onChange} />;
    default:
      return null;
  }
}

export { TextCell };
