import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { spring } from '../motion';
import type { ObjType } from '../types';
import { clientUid } from '../util';
import type { FilterOp, TypeView, ViewField, ViewFilter, ViewMode } from '../viewModel';
import {
  MODE_ICONS,
  MODE_LABELS,
  describeFilter,
  opLabel,
  opsFor,
  valueShape,
} from '../viewModel';
import { popPos } from './cells';
import { Icon } from './Icons';

interface Pos {
  left: number;
  top: number;
}

/** The popover that builds one filter: which field, which comparison, what value. */
function FilterEditor({
  filter,
  fields,
  pos,
  onChange,
  onRemove,
  onClose,
}: {
  filter: ViewFilter;
  fields: ViewField[];
  pos: Pos;
  onChange: (f: ViewFilter) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const field = fields.find((f) => f.key === filter.field) ?? fields[0];
  const shape = valueShape(filter.op, field.kind);
  const options = field.options ?? [];
  const chosen: string[] = Array.isArray(filter.value) ? filter.value : filter.value ? [String(filter.value)] : [];

  /** Changing the field resets the comparison, since the old one rarely still applies. */
  const pickField = (key: string) => {
    const next = fields.find((f) => f.key === key)!;
    const ops = opsFor(next.kind);
    onChange({ ...filter, field: key, op: ops[0], value: undefined });
  };

  const pickOp = (op: FilterOp) => {
    const keep = valueShape(op, field.kind) === valueShape(filter.op, field.kind);
    onChange({ ...filter, op, value: keep ? filter.value : undefined });
  };

  const toggleOption = (o: string) =>
    onChange({ ...filter, value: chosen.includes(o) ? chosen.filter((x) => x !== o) : [...chosen, o] });

  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="popover filter-editor" style={pos}>
        <div className="form-row">
          <label>Field</label>
          <select className="field" value={field.key} onChange={(e) => pickField(e.target.value)}>
            {fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label>Condition</label>
          <select className="field" value={filter.op} onChange={(e) => pickOp(e.target.value as FilterOp)}>
            {opsFor(field.kind).map((op) => (
              <option key={op} value={op}>
                {opLabel(op, field.kind)}
              </option>
            ))}
          </select>
        </div>

        {shape === 'options' && (
          <div className="filter-options">
            {options.length === 0 && <div className="menu-hint">This property has no options yet.</div>}
            {options.map((o) => (
              <button key={o} className={'menu-item' + (chosen.includes(o) ? ' sel' : '')} onClick={() => toggleOption(o)}>
                <span className="check-slot">{chosen.includes(o) ? <Icon name="check" size={13} /> : null}</span>
                {o}
              </button>
            ))}
          </div>
        )}

        {shape === 'days' && (
          <div className="form-row">
            <label>Days</label>
            <input
              type="number"
              className="field"
              min={0}
              value={filter.value ?? 7}
              autoFocus
              onChange={(e) => onChange({ ...filter, value: Number(e.target.value) })}
            />
          </div>
        )}

        {(shape === 'text' || shape === 'number' || shape === 'date') && (
          <div className="form-row">
            <label>Value</label>
            <input
              type={shape === 'date' ? 'date' : shape === 'number' ? 'number' : 'text'}
              className="field"
              value={filter.value ?? ''}
              autoFocus
              placeholder={shape === 'text' ? 'Type a value…' : ''}
              onChange={(e) => onChange({ ...filter, value: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && onClose()}
            />
          </div>
        )}

        <div className="popover-actions">
          <button className="btn subtle danger" onClick={onRemove}>
            Remove
          </button>
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * The toolbar every type list carries: which view it's in, what it's filtered
 * to, and how it's sorted. Filters and sort work the same in every view.
 */
export function ViewBar({
  type,
  view,
  fields,
  modes,
  shown,
  total,
  doneName,
  onChange,
}: {
  type: ObjType;
  view: TypeView;
  fields: ViewField[];
  modes: ViewMode[];
  shown: number;
  total: number;
  /** The name of the property that marks work finished, when the type has one. */
  doneName?: string;
  onChange: (patch: Partial<TypeView>) => void;
}) {
  const [editing, setEditing] = useState<{ id: string; pos: Pos } | null>(null);
  const [sortMenu, setSortMenu] = useState<Pos | null>(null);
  const [groupMenu, setGroupMenu] = useState<Pos | null>(null);
  const [dateMenu, setDateMenu] = useState<Pos | null>(null);

  const byKey = new Map(fields.map((f) => [f.key, f]));
  const selectFields = fields.filter((f) => f.kind === 'select' && !f.builtin);
  const dateFields = fields.filter((f) => f.kind === 'date' || f.kind === 'datetime');
  const sortField = view.sort ? byKey.get(view.sort.key) : null;

  const addFilter = (e: React.MouseEvent<HTMLButtonElement>) => {
    const first = fields[0];
    const filter: ViewFilter = { id: clientUid(), field: first.key, op: opsFor(first.kind)[0], value: undefined };
    onChange({ filters: [...view.filters, filter] });
    setEditing({ id: filter.id, pos: popPos(e.currentTarget, 260, 340) });
  };

  const patchFilter = (f: ViewFilter) => onChange({ filters: view.filters.map((x) => (x.id === f.id ? f : x)) });
  const dropFilter = (id: string) => onChange({ filters: view.filters.filter((x) => x.id !== id) });

  /** Clicking the field that's already sorted flips the direction. */
  const pickSort = (key: string) => {
    const dir: 1 | -1 = view.sort?.key === key && view.sort.dir === 1 ? -1 : 1;
    onChange({ sort: { key, dir } });
    setSortMenu(null);
  };

  const editing_ = editing ? view.filters.find((f) => f.id === editing.id) : null;

  return (
    <div className="view-bar">
      {modes.length > 1 && (
        <div className="seg mini view-modes">
          {modes.map((m) => (
            <button
              key={m}
              className={view.mode === m ? 'on' : ''}
              onClick={() => onChange({ mode: m })}
              title={MODE_LABELS[m]}
            >
              <Icon name={MODE_ICONS[m]} size={13} />
              <span className="view-mode-label">{MODE_LABELS[m]}</span>
            </button>
          ))}
        </div>
      )}

      <div className="view-chips">
        <AnimatePresence initial={false}>
          {view.filters.map((f) => {
            const field = byKey.get(f.field);
            if (!field) return null;
            return (
              <motion.span
                key={f.id}
                className="view-chip"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={spring}
              >
                <button className="view-chip-body" onClick={(e) => setEditing({ id: f.id, pos: popPos(e.currentTarget, 260, 340) })}>
                  {describeFilter(f, field)}
                </button>
                <button className="view-chip-x" onClick={() => dropFilter(f.id)} aria-label="Remove filter">
                  <Icon name="x" size={11} />
                </button>
              </motion.span>
            );
          })}
        </AnimatePresence>

        <button className="view-add" onClick={addFilter}>
          <Icon name="filter" size={13} /> Filter
        </button>

        <button
          className={'view-add' + (view.sort ? ' on' : '')}
          onClick={(e) => setSortMenu(popPos(e.currentTarget, 230, 320))}
        >
          <Icon name="sort" size={13} />
          {sortField ? `${sortField.name} ${view.sort!.dir === 1 ? '↑' : '↓'}` : 'Sort'}
        </button>

        {doneName && (
          <button
            className={'view-add' + (view.hideDone ? ' on' : '')}
            onClick={() => onChange({ hideDone: !view.hideDone })}
            title={view.hideDone ? `Showing only what isn’t done` : `Hide anything marked Done`}
          >
            <Icon name={view.hideDone ? 'circle-check' : 'check'} size={13} />
            {view.hideDone ? 'Done hidden' : 'Hide done'}
          </button>
        )}

        {view.mode === 'board' && selectFields.length > 0 && (
          <button className="view-add" onClick={(e) => setGroupMenu(popPos(e.currentTarget, 220, 280))}>
            <Icon name="columns" size={13} />
            Group: {byKey.get(view.groupBy ?? '')?.name ?? selectFields[0].name}
          </button>
        )}

        {view.mode === 'calendar' && dateFields.length > 1 && (
          <button className="view-add" onClick={(e) => setDateMenu(popPos(e.currentTarget, 220, 280))}>
            <Icon name="calendar" size={13} />
            By: {byKey.get(view.dateField ?? '')?.name ?? dateFields[0].name}
          </button>
        )}

        {(view.filters.length > 0 || view.hideDone) && (
          <span className="view-count">
            {shown} of {total}
          </span>
        )}
      </div>

      {editing && editing_ && (
        <FilterEditor
          filter={editing_}
          fields={fields}
          pos={editing.pos}
          onChange={patchFilter}
          onRemove={() => {
            dropFilter(editing_.id);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {sortMenu && (
        <>
          <div className="backdrop" onClick={() => setSortMenu(null)} />
          <div className="popover" style={sortMenu}>
            <div className="menu-hint">Sort {type.name.toLowerCase()}s by</div>
            <div className="popover-list">
              {fields.map((f) => (
                <button key={f.key} className="menu-item" onClick={() => pickSort(f.key)}>
                  <span className="check-slot">
                    {view.sort?.key === f.key ? <Icon name="check" size={13} /> : null}
                  </span>
                  {f.name}
                  {view.sort?.key === f.key && <span className="sort-ind">{view.sort.dir === 1 ? '▲' : '▼'}</span>}
                </button>
              ))}
            </div>
            {view.sort && (
              <>
                <div className="menu-sep" />
                <button className="menu-item" onClick={() => { onChange({ sort: null }); setSortMenu(null); }}>
                  Clear sort
                </button>
              </>
            )}
          </div>
        </>
      )}

      {groupMenu && (
        <>
          <div className="backdrop" onClick={() => setGroupMenu(null)} />
          <div className="popover" style={groupMenu}>
            <div className="menu-hint">Columns come from</div>
            {selectFields.map((f) => (
              <button
                key={f.key}
                className="menu-item"
                onClick={() => {
                  onChange({ groupBy: f.key });
                  setGroupMenu(null);
                }}
              >
                <span className="check-slot">
                  {(view.groupBy ?? selectFields[0].key) === f.key ? <Icon name="check" size={13} /> : null}
                </span>
                {f.name}
              </button>
            ))}
          </div>
        </>
      )}

      {dateMenu && (
        <>
          <div className="backdrop" onClick={() => setDateMenu(null)} />
          <div className="popover" style={dateMenu}>
            <div className="menu-hint">Place items by</div>
            {dateFields.map((f) => (
              <button
                key={f.key}
                className="menu-item"
                onClick={() => {
                  onChange({ dateField: f.key });
                  setDateMenu(null);
                }}
              >
                <span className="check-slot">
                  {(view.dateField ?? dateFields[0].key) === f.key ? <Icon name="check" size={13} /> : null}
                </span>
                {f.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
