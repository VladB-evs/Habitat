import { useState } from 'react';
import { motion } from 'motion/react';
import { dealtIn, stagger } from '../motion';
import type { Obj, ObjType, PropDef } from '../types';
import { ago, fmtChipDate } from '../util';
import { OptionChip } from './cells';
import { Icon } from './Icons';

/** The two or three values worth showing under a title, skipping the blanks. */
function summaryProps(o: Obj, defs: PropDef[], limit = 3) {
  return defs
    .filter((p) => p.kind !== 'relation' && p.kind !== 'longtext')
    .map((p) => ({ def: p, value: o.props?.[p.id] }))
    .filter((x) => x.value != null && x.value !== '' && !(Array.isArray(x.value) && !x.value.length))
    .slice(0, limit);
}

function PropBits({ o, defs, theme, limit }: { o: Obj; defs: PropDef[]; theme: string; limit?: number }) {
  const bits = summaryProps(o, defs, limit);
  if (!bits.length) return null;
  return (
    <div className="card-props">
      {bits.map(({ def, value }) =>
        def.kind === 'select' || def.kind === 'multiselect' ? (
          (Array.isArray(value) ? value : [value]).slice(0, 3).map((v: string) => <OptionChip key={def.id + v} value={String(v)} theme={theme} />)
        ) : def.kind === 'checkbox' ? (
          <span key={def.id} className="card-prop">
            <Icon name={value ? 'circle-check' : 'minus'} size={11} /> {def.name}
          </span>
        ) : (
          <span key={def.id} className="card-prop" title={def.name}>
            {def.kind === 'date' || def.kind === 'datetime' ? fmtChipDate(String(value)) : String(value)}
          </span>
        )
      )}
    </div>
  );
}

/**
 * Gallery: one card per object. The view for types the table doesn't flatter —
 * notes, books, references — where a title and a line of context is the point.
 */
export function GalleryView({
  objs,
  type,
  theme,
  onOpen,
  onAdd,
}: {
  objs: Obj[];
  type: ObjType;
  theme: string;
  onOpen: (e: React.MouseEvent, id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="gallery-page">
      <motion.div className="gallery-grid" variants={stagger} initial="hidden" animate="shown">
        {objs.map((o) => (
          <motion.button
            key={o.id}
            className="gallery-card"
            variants={dealtIn}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.99 }}
            onClick={(e) => onOpen(e, o.id)}
          >
            <div className="gallery-title">{o.title || 'Untitled'}</div>
            {o.snippet && <div className="gallery-snippet">{o.snippet}</div>}
            <PropBits o={o} defs={type.properties} theme={theme} />
            <div className="gallery-foot">{ago(o.updatedAt)}</div>
          </motion.button>
        ))}
        <button className="gallery-card add" onClick={onAdd}>
          <Icon name="plus" size={16} /> New {type.name.toLowerCase()}
        </button>
      </motion.div>
      {objs.length === 0 && <div className="empty">Nothing matches.</div>}
    </div>
  );
}

/**
 * Board: a column per option of a select property. Dragging a card between
 * columns is what sets the value, so a status board is also how you change it.
 */
export function BoardView({
  objs,
  type,
  prop,
  theme,
  onOpen,
  onSet,
  onAdd,
}: {
  objs: Obj[];
  type: ObjType;
  prop: PropDef;
  theme: string;
  onOpen: (e: React.MouseEvent, id: string) => void;
  onSet: (o: Obj, value: string | null) => void;
  onAdd: (value: string | null) => void;
}) {
  const [over, setOver] = useState<string | null>(null);
  const columns: (string | null)[] = [...(prop.options ?? []), null];
  const inColumn = (value: string | null) =>
    objs.filter((o) => {
      const v = o.props?.[prop.id];
      return value === null ? v == null || v === '' : String(v) === value;
    });

  const drop = (value: string | null) => (e: React.DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData('text/habitat-obj');
    const o = objs.find((x) => x.id === id);
    if (o) onSet(o, value);
  };

  const allow = (key: string) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('text/habitat-obj')) return;
    e.preventDefault();
    if (over !== key) setOver(key);
  };

  const otherProps = type.properties.filter((p) => p.id !== prop.id);

  return (
    <div className="board-page">
      {columns.map((value) => {
        const key = value ?? '__none';
        const rows = inColumn(value);
        return (
          <section
            key={key}
            className={'board-col' + (over === key ? ' drop-hint' : '')}
            onDragOver={allow(key)}
            onDragLeave={() => setOver(null)}
            onDrop={drop(value)}
          >
            <div className="board-head">
              {value ? <OptionChip value={value} theme={theme} /> : <span className="board-none">No {prop.name.toLowerCase()}</span>}
              <span className="col-count">{rows.length}</span>
            </div>
            <div className="board-cards">
              {rows.map((o) => (
                <div
                  key={o.id}
                  className="board-card"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/habitat-obj', o.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onClick={(e) => onOpen(e, o.id)}
                >
                  <div className="board-card-title">{o.title || 'Untitled'}</div>
                  {o.snippet && <div className="board-card-snippet">{o.snippet}</div>}
                  <PropBits o={o} defs={otherProps} theme={theme} limit={2} />
                </div>
              ))}
              {rows.length === 0 && <div className="col-empty">Nothing here.</div>}
            </div>
            <button className="board-add" onClick={() => onAdd(value)}>
              <Icon name="plus" size={13} /> Add
            </button>
          </section>
        );
      })}
    </div>
  );
}
