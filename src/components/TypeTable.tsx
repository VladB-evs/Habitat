import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../api';
import { dialogIn, snap, spring } from '../motion';
import { objectChanged, onObjectChanged } from '../objects';
import { useApp } from '../store';
import type { Obj, PropDef, Template } from '../types';
import { anchorDate, clientUid, fmtMonthYear, keyOf, monthCells, monthStartKey, openStatusOf, taskProp, todayKey, typeColor } from '../util';
import type { TypeView, ViewMode } from '../viewModel';
import {
  CREATED_FIELD,
  TITLE_FIELD,
  UPDATED_FIELD,
  applyFilters,
  availableModes,
  emptyView,
  opsFor,
  sortObjs,
  viewFields,
} from '../viewModel';
import { Cell, TextCell, popPos } from './cells';
import { DateField } from './DateField';
import { fmtClock, fromValue } from '../dateParse';
import { Icon, TypeIcon } from './Icons';
import { SplitControls } from './SplitControls';
import { PropEditor } from './PropEditor';
import { BoardView, GalleryView } from './typeViews';
import { TypeEditor } from './TypeEditor';
import { ViewBar } from './ViewBar';

/**
 * The date on a checklist row, which may be a plain day or a start time — the
 * badge shows the hour only when there is one.
 */
function fmtWhenBadge(value: string): string {
  const key = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return value;
  const day = new Date(key + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const when = fromValue(value);
  return when && when.minutes !== null ? `${day} · ${fmtClock(when.minutes)}` : day;
}

/**
 * Defined at module scope on purpose: nesting these inside TypeTable made React
 * see a brand-new component type on every render, remounting the input and
 * dropping focus after each keystroke.
 */
function ChecklistRow({
  o,
  done,
  due,
  picked,
  onSelect,
  onToggle,
  onOpen,
  onDelete,
  onProp,
  onTitle,
  fields,
  selectMode,
}: {
  o: Obj;
  done: boolean;
  due: string | null;
  picked: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onOpen: (e: React.MouseEvent) => void;
  onDelete: () => void;
  onProp: (propId: string, v: any) => void;
  onTitle: (v: string) => void;
  fields: string[] | null;
  selectMode: boolean;
}) {
  return (
    <div
      className={'day-task has-ip clickable' + (done ? ' done' : '') + (picked ? ' picked' : '')}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/habitat-obj', o.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={(e) => {
        // The row itself opens the object; its own controls (tick, title field,
        // delete, inline property editors) keep their own behaviour.
        if (!(e.target as HTMLElement).closest('button, input, select, textarea, a, [contenteditable]')) onOpen(e);
      }}
    >
      {selectMode && (
        <input type="checkbox" className="pick-box" checked={picked} onChange={onSelect} aria-label="Select" />
      )}
      <button className={'tick' + (done ? ' on' : '')} onClick={onToggle} aria-label="Toggle done">
        {done && <Icon name="check" size={11} />}
      </button>
      <span className="day-task-edit">
        <TextCell value={o.title} onCommit={(v: any) => onTitle(v)} placeholder="Untitled" />
      </span>
      <button className="row-open" onClick={onOpen} aria-label="Open" title="Open (⌘-click opens beside)">
        <Icon name="arrow-up-right" size={13} />
      </button>
      {due && !done && <span className="checklist-due">{fmtWhenBadge(due)}</span>}
      <button className="row-del" onClick={onDelete} aria-label="Delete">
        <Icon name="trash" size={14} />
      </button>
      <InlineProps o={o} fields={fields} onChange={onProp} />
    </div>
  );
}

/**
 * Properties that live on one object rather than the whole type get shown inline,
 * as editable chips, since they'd make a mostly-empty column in the table.
 */
function InlineProps({ o, fields, onChange }: { o: Obj; fields: string[] | null; onChange: (propId: string, v: any) => void }) {
  const defs = (o.extraProps ?? []).filter((p) => p.kind !== 'relation' && (!fields || fields.includes(p.name)));
  if (!defs.length) return null;
  return (
    <div className="inline-props">
      {defs.map((p) => (
        <span className="ip" key={p.id} title={p.name}>
          <Cell def={p} value={o.props[p.id]} onChange={(v) => onChange(p.id, v)} />
        </span>
      ))}
    </div>
  );
}

function QuickAdd({
  value,
  onChange,
  placeholder,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  onSubmit: () => void;
}) {
  return (
    <div className="day-task add">
      <span className="tick ghost">
        <Icon name="plus" size={11} />
      </span>
      <input
        className="day-task-input"
        spellCheck
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
      />
    </div>
  );
}

/**
 * A type's own page: its objects in whichever view is set, with the filters,
 * sorting and templates that belong to the type.
 *
 * `embedded` drops the page header — the Tasks page shows this as one of its
 * modes and already has a header of its own, but the view bar underneath still
 * belongs to the table.
 */
export function TypeTable({ typeId, embedded = false }: { typeId: string; embedded?: boolean }) {
  const { types, reloadTypes, openObject, openFrom, openBeside, navigate, theme } = useApp();
  const type = types.find((t) => t.id === typeId);
  const [objs, setObjs] = useState<Obj[]>([]);
  const [view, setView] = useState<TypeView>(emptyView);
  const [menu, setMenu] = useState<{ prop: PropDef | null; pos: { left: number; top: number } } | null>(null);
  const [editor, setEditor] = useState<{ initial?: PropDef; pos: { left: number; top: number } } | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [defaultTpl, setDefaultTpl] = useState<string | null>(null);
  const [tplMenu, setTplMenu] = useState<{ left: number; top: number } | null>(null);
  const [fieldMenu, setFieldMenu] = useState<{ left: number; top: number } | null>(null);
  const [typeEdit, setTypeEdit] = useState<{ left: number; top: number } | null>(null);
  const [bulkProp, setBulkProp] = useState<{ left: number; top: number } | null>(null);
  const [datePrompt, setDatePrompt] = useState<{ id: string; value: string } | null>(null);
  const [dropZone, setDropZone] = useState<'scheduled' | 'unscheduled' | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  /** null means "show them all"; otherwise the property names picked for the inline row. */
  const [inlineFields, setInlineFields] = useState<string[] | null>(null);
  const [newItem, setNewItem] = useState('');
  const [newScheduled, setNewScheduled] = useState('');
  const [calMonth, setCalMonth] = useState(todayKey());
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastPicked = useRef<number | null>(null);

  useEffect(() => {
    const load = () => api.objects.list(typeId).then(setObjs);
    load();
    api.templates.list(typeId).then(setTemplates);
    api.kv.get('default-template:' + typeId).then(setDefaultTpl);
    api.kv.get('inline-fields:' + typeId).then((v) => setInlineFields(v ? JSON.parse(v) : null));
    // The view config lives with the vault; older builds kept only the mode in
    // localStorage, so fall back to that the first time.
    api.kv.get('view:' + typeId).then((v) => {
      const legacy = localStorage.getItem('habitat:view:' + typeId) as ViewMode | null;
      let saved: Partial<TypeView> = {};
      if (v) {
        try {
          saved = JSON.parse(v);
        } catch {
          saved = {};
        }
      }
      setView({ ...emptyView(), ...(legacy ? { mode: legacy } : {}), ...saved, filters: saved.filters ?? [] });
    });
    setSelectMode(false);
    setSelected(new Set());
    lastPicked.current = null;
    // Keeps the table honest when a task is ticked from a mention chip elsewhere.
    return onObjectChanged(load);
  }, [typeId]);

  const changeView = (patch: Partial<TypeView>) => {
    setView((cur) => {
      const next = { ...cur, ...patch };
      api.kv.set('view:' + typeId, JSON.stringify(next));
      return next;
    });
  };

  const fields = useMemo(() => viewFields(type, objs), [type, objs]);

  /** Filters apply to every view; sorting orders the ones that show a flat list. */
  const filtered = useMemo(() => applyFilters(objs, view.filters, fields), [objs, view.filters, fields]);
  const sorted = useMemo(() => sortObjs(filtered, view.sort, fields), [filtered, view.sort, fields]);

  if (!type) return <div className="empty">This type no longer exists.</div>;

  // Anything with a "Done" status can be worked as a checklist, not just a table —
  // that covers Task, School's Assignment, and any custom type built the same way.
  const doneProp = taskProp(type);
  const openStatus = openStatusOf(doneProp);
  const dueProp = type.properties.find((p) => p.kind === 'date');
  const startProp = type.properties.find((p) => p.kind === 'datetime');
  const allInlineNames = [
    ...new Set(objs.flatMap((o) => (o.extraProps ?? []).filter((p) => p.kind !== 'relation').map((p) => p.name))),
  ];
  const isDone = (o: Obj) => doneProp && o.props[doneProp.id] === 'Done';

  // "Hide done" sits outside the filter list because it's the one people flick on
  // and off constantly — it applies to every view, including the checklist.
  const hidingDone = !!view.hideDone && !!doneProp;
  const open = (list: Obj[]) => (hidingDone ? list.filter((o) => !isDone(o)) : list);
  const visible = open(sorted);

  const modes = availableModes(type, fields, doneProp);
  // Until one is picked the type's shape decides: anything task-shaped opens as a
  // checklist. A saved mode can also stop being available, if its property went away.
  const mode: ViewMode = view.mode && modes.includes(view.mode) ? view.mode : doneProp ? 'checklist' : 'table';

  const selectProps = type.properties.filter((p) => p.kind === 'select');
  const groupProp = selectProps.find((p) => p.id === view.groupBy) ?? selectProps[0];

  const dateFields = fields.filter((f) => f.kind === 'date' || f.kind === 'datetime');
  const calField = dateFields.find((f) => f.key === view.dateField) ?? dateFields[0];
  /** The day an object sits on in the calendar, from whichever date field drives it. */
  const dayKey = (o: Obj): string => {
    if (!calField) return '';
    if (calField.key === CREATED_FIELD) return keyOf(new Date(o.createdAt));
    if (calField.key === UPDATED_FIELD) return keyOf(new Date(o.updatedAt));
    return String(o.props[calField.key] ?? '').slice(0, 10);
  };

  /**
   * When a task sits in time — a due date, a start time, or both. Either one is
   * enough: something starting at 09:30 is scheduled whether or not it also has a
   * day it's due by.
   */
  const dueOf = (o: Obj) => (dueProp ? String(o.props[dueProp.id] ?? '') : '');
  const startOf = (o: Obj) => (startProp ? String(o.props[startProp.id] ?? '') : '');
  /** The earliest of the two, for sorting and for the badge on the row. */
  const whenOf = (o: Obj) => [dueOf(o), startOf(o)].filter(Boolean).sort()[0] ?? '';
  const isScheduled = (o: Obj) => !!whenOf(o);
  /**
   * The row's badge: the nearest date it carries, but the hour instead when a start
   * time falls on that same day — otherwise "due today, starts at 2" reads as a bare
   * "Aug 8" and the time it's actually happening is nowhere on the row.
   */
  const badgeOf = (o: Obj): string | null => {
    const when = whenOf(o);
    if (!when) return null;
    const start = startOf(o);
    return start.length > 10 && start.slice(0, 10) === when.slice(0, 10) ? start : when;
  };
  /** The checklist splits in two as long as there's some way to date a row. */
  const canSchedule = !!dueProp || !!startProp;

  const byDoneThenDate = (a: Obj, b: Obj) =>
    Number(!!isDone(a)) - Number(!!isDone(b)) || whenOf(a).localeCompare(whenOf(b)) || a.createdAt - b.createdAt;

  // The checklist keeps its own order (done last, then by date) unless a sort is set.
  const checklist = doneProp ? (view.sort ? visible : open([...filtered].sort(byDoneThenDate))) : [];
  const scheduled = checklist.filter(isScheduled);
  const unscheduled = checklist.filter((o) => !isScheduled(o));

  const toggleDone = (o: Obj) => {
    if (!doneProp) return;
    updateCell(o, doneProp.id, isDone(o) ? openStatus : 'Done');
  };

  const addItem = async (title: string, due?: string) => {
    const name = title.trim();
    if (!name) return;
    const props: Record<string, any> = {};
    if (doneProp) props[doneProp.id] = openStatus;
    if (due && dueProp) props[dueProp.id] = due;
    const o = await api.objects.create({ typeId, title: name, props });
    setObjs((list) => [...list, o]);
  };

  const updateCell = (o: Obj, propId: string, value: any) => {
    const props = { ...o.props, [propId]: value };
    setObjs((list) => list.map((x) => (x.id === o.id ? { ...x, props } : x)));
    api.objects.update(o.id, { props }).then(() => objectChanged(o.id));
  };

  const updateTitle = (o: Obj, title: string) => {
    setObjs((list) => list.map((x) => (x.id === o.id ? { ...x, title } : x)));
    api.objects.update(o.id, { title }).then(() => objectChanged(o.id));
  };

  /**
   * "New" uses the type's default template when one is set, and opens it beside
   * the list. `preset` is how the board adds straight into a column.
   */
  const addRow = async (preset?: Record<string, any>) => {
    const def = defaultTpl;
    if (def && templates.some((t) => t.id === def)) {
      const o = await api.objects.createFromTemplate(def);
      if (o) {
        if (preset) await api.objects.update(o.id, { props: { ...o.props, ...preset } });
        setObjs(await api.objects.list(typeId));
        openBeside(o.id);
        return;
      }
    }
    const o = await api.objects.create({ typeId, props: preset ?? {} });
    setObjs((list) => [...list, o]);
    if (preset) openBeside(o.id);
  };

  /**
   * Dragging between the two checklist columns is how a task gets (un)scheduled:
   * dropping on "Unscheduled" takes it out of time, dropping on "Scheduled" asks
   * for a day. Unscheduling clears the start time as well as the due date —
   * leaving one behind would bounce the row straight back to the other column.
   */
  const dropOn = (zone: 'scheduled' | 'unscheduled') => (e: React.DragEvent) => {
    e.preventDefault();
    setDropZone(null);
    const id = e.dataTransfer.getData('text/habitat-obj');
    const o = objs.find((x) => x.id === id);
    if (!o || !canSchedule) return;
    if (zone === 'unscheduled') {
      if (!isScheduled(o)) return;
      const props = { ...o.props };
      if (dueProp) props[dueProp.id] = null;
      if (startProp) props[startProp.id] = null;
      setObjs((list) => list.map((x) => (x.id === o.id ? { ...x, props } : x)));
      api.objects.update(o.id, { props }).then(() => objectChanged(o.id));
    } else if (dueProp) {
      setDatePrompt({ id, value: dueOf(o) || todayKey() });
    } else {
      // Only a start time to give it, so put it at the top of today rather than
      // asking for a day the type has nowhere to keep.
      updateCell(o, startProp!.id, `${todayKey()}T09:00`);
    }
  };

  const allowDrop = (zone: 'scheduled' | 'unscheduled') => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('text/habitat-obj')) return;
    e.preventDefault();
    if (dropZone !== zone) setDropZone(zone);
  };

  const removeRow = async (o: Obj) => {
    if (!confirm(`Delete “${o.title || 'Untitled'}”? This also removes its links.`)) return;
    await api.objects.remove(o.id);
    objectChanged(o.id);
    setObjs((list) => list.filter((x) => x.id !== o.id));
  };

  const saveProp = async (def: PropDef) => {
    const props = [...type.properties];
    const i = props.findIndex((p) => p.id === def.id);
    if (i >= 0) props[i] = def;
    else props.push(def);
    await api.types.update(type.id, { properties: props });
    await reloadTypes();
  };

  const deleteProp = async (def: PropDef) => {
    if (!confirm(`Remove property “${def.name}” from all ${type.name}s?`)) return;
    await api.types.update(type.id, { properties: type.properties.filter((p) => p.id !== def.id) });
    await reloadTypes();
  };

  const deleteType = async () => {
    const n = objs.length;
    if (!confirm(`Delete the type “${type.name}” and its ${n} object${n === 1 ? '' : 's'}? This cannot be undone.`)) return;
    await api.types.remove(type.id);
    await reloadTypes();
    navigate({ kind: 'dashboard' });
  };

  // ---- bulk selection ----

  const allSelected = visible.length > 0 && visible.every((o) => selected.has(o.id));

  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visible.map((o) => o.id)));

  /** Shift-click extends from the last row picked, like a file list. */
  const toggleRow = (index: number, shift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const from = shift && lastPicked.current !== null ? lastPicked.current : index;
      const [lo, hi] = from <= index ? [from, index] : [index, from];
      const turningOn = !prev.has(visible[index].id);
      for (let i = lo; i <= hi; i++) {
        const id = visible[i].id;
        if (turningOn) next.add(id);
        else next.delete(id);
      }
      return next;
    });
    lastPicked.current = index;
  };

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulkDelete = async () => {
    const ids = [...selected];
    if (!confirm(`Delete ${ids.length} ${ids.length === 1 ? 'object' : 'objects'}? This also removes their links.`))
      return;
    await api.objects.bulkRemove(ids);
    ids.forEach(objectChanged);
    setObjs((list) => list.filter((o) => !selected.has(o.id)));
    setSelected(new Set());
  };

  /** Give every selected object the same extra property (one shared id, so it acts like a column). */
  const bulkAddProp = async (def: PropDef) => {
    const ids = [...selected];
    await Promise.all(
      ids.map((id) => {
        const o = objs.find((x) => x.id === id);
        if (!o) return Promise.resolve();
        const extraProps = [...(o.extraProps ?? []).filter((p) => p.id !== def.id && p.name !== def.name), def];
        return api.objects.update(id, { extraProps });
      })
    );
    setObjs(await api.objects.list(typeId));
    ids.forEach(objectChanged);
  };

  const bulkSet = async (propId: string, value: any) => {
    const ids = [...selected];
    await api.objects.bulkSetProp(ids, propId, value);
    setObjs(await api.objects.list(typeId));
  };

  const openHeaderMenu = (e: React.MouseEvent<HTMLButtonElement>, prop: PropDef | null) => {
    setMenu({ prop, pos: popPos(e.currentTarget, 230, 260) });
  };

  const sortKey = (prop: PropDef | null) => (prop ? prop.id : TITLE_FIELD);

  const saveType = async (patch: { name: string; icon: string; color: string }) => {
    await api.types.update(type.id, patch);
    await reloadTypes();
  };

  return (
    <div className={'page' + (embedded ? ' embedded' : '')}>
      {!embedded && (
      <header className="page-head">
        <div className="page-title">
          <span className="type-emoji big">
            <TypeIcon icon={type.icon} color={typeColor(type.color, theme)} size={24} />
          </span>
          <h1>{type.name}</h1>
          <span className="count-badge">{objs.length}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            className={'icon-btn' + (selectMode ? ' active' : '')}
            title="Select items"
            aria-label="Select items"
            onClick={() => {
              setSelectMode((v) => !v);
              setSelected(new Set());
            }}
          >
            <Icon name="check" size={15} />
          </button>
          {allInlineNames.length > 0 && (
            <button
              className="icon-btn"
              title="Choose inline fields"
              aria-label="Choose inline fields"
              onClick={(e) => setFieldMenu(popPos(e.currentTarget as HTMLElement, 240, 300))}
            >
              <Icon name="list" size={15} />
            </button>
          )}
          <button
            className={'icon-btn' + (type.starred ? ' active' : '')}
            title={type.starred ? 'Shown on the dashboard' : 'Show on the dashboard'}
            onClick={async () => {
              await api.types.update(type.id, { starred: !type.starred });
              await reloadTypes();
            }}
            aria-label="Star type"
          >
            <Icon name={type.starred ? 'star-filled' : 'star'} size={15} />
          </button>
          <button
            className="icon-btn"
            title="Edit type"
            aria-label="Edit type"
            onClick={(e) => setTypeEdit(popPos(e.currentTarget as HTMLElement, 300, 420))}
          >
            <Icon name="pencil" size={15} />
          </button>
          {type.id !== 'daily' && (
            <button className="icon-btn" onClick={deleteType} aria-label="Delete type">
              <Icon name="trash" size={15} />
            </button>
          )}
          <div className="split-btn">
            <button className="btn primary" onClick={() => addRow()}>
              <Icon name="plus" size={14} /> New
            </button>
            <button
              className="btn primary chev"
              aria-label="Templates"
              onClick={(e) => setTplMenu(popPos(e.currentTarget as HTMLElement, 250, 280))}
            >
              <Icon name="chevron-down" size={14} />
            </button>
          </div>
          <SplitControls />
        </div>
      </header>
      )}

      <ViewBar
        type={type}
        view={{ ...view, mode }}
        fields={fields}
        modes={modes}
        shown={mode === 'checklist' ? checklist.length : visible.length}
        total={objs.length}
        doneName={doneProp?.name}
        onChange={changeView}
      />

      {mode === 'checklist' && doneProp ? (
        <div className={'checklist-page' + (canSchedule ? ' split' : '')}>
          {canSchedule ? (
            <>
              <section
                className={'checklist-col' + (dropZone === 'scheduled' ? ' drop-hint' : '')}
                onDragOver={allowDrop('scheduled')}
                onDragLeave={() => setDropZone(null)}
                onDrop={dropOn('scheduled')}
              >
                <div className="sect">Scheduled<span className="col-count">{scheduled.length}</span></div>
                {scheduled.map((o) => (
                  <ChecklistRow
                    key={o.id}
                    o={o}
                    done={!!isDone(o)}
                    due={badgeOf(o)}
                    picked={selected.has(o.id)}
                    onSelect={() => toggleOne(o.id)}
                    onToggle={() => toggleDone(o)}
                    onProp={(pid, v) => updateCell(o, pid, v)}
                    onTitle={(v) => updateTitle(o, v)}
                    fields={inlineFields}
                    selectMode={selectMode}
                    onOpen={(e) => openFrom(e, o.id)}
                    onDelete={() => removeRow(o)}
                  />
                ))}
                {scheduled.length === 0 && <div className="col-empty">Nothing scheduled.</div>}
                <QuickAdd
                  value={newScheduled}
                  onChange={setNewScheduled}
                  placeholder="Add for today…"
                  onSubmit={() => {
                    addItem(newScheduled, todayKey());
                    setNewScheduled('');
                  }}
                />
              </section>
              <section
                className={'checklist-col' + (dropZone === 'unscheduled' ? ' drop-hint' : '')}
                onDragOver={allowDrop('unscheduled')}
                onDragLeave={() => setDropZone(null)}
                onDrop={dropOn('unscheduled')}
              >
                <div className="sect">Unscheduled<span className="col-count">{unscheduled.length}</span></div>
                {unscheduled.map((o) => (
                  <ChecklistRow
                    key={o.id}
                    o={o}
                    done={!!isDone(o)}
                    due={badgeOf(o)}
                    picked={selected.has(o.id)}
                    onSelect={() => toggleOne(o.id)}
                    onToggle={() => toggleDone(o)}
                    onProp={(pid, v) => updateCell(o, pid, v)}
                    onTitle={(v) => updateTitle(o, v)}
                    fields={inlineFields}
                    selectMode={selectMode}
                    onOpen={(e) => openFrom(e, o.id)}
                    onDelete={() => removeRow(o)}
                  />
                ))}
                {unscheduled.length === 0 && <div className="col-empty">Nothing here — everything sits in time.</div>}
                <QuickAdd
                  value={newItem}
                  onChange={setNewItem}
                  placeholder={`Add ${type.name.toLowerCase()}…`}
                  onSubmit={() => {
                    addItem(newItem);
                    setNewItem('');
                  }}
                />
              </section>
            </>
          ) : (
            <section className="checklist-col">
              {checklist.map((o) => (
                <ChecklistRow
                    key={o.id}
                    o={o}
                    done={!!isDone(o)}
                    due={null}
                    picked={selected.has(o.id)}
                    onSelect={() => toggleOne(o.id)}
                    onToggle={() => toggleDone(o)}
                    onProp={(pid, v) => updateCell(o, pid, v)}
                    onTitle={(v) => updateTitle(o, v)}
                    fields={inlineFields}
                    selectMode={selectMode}
                    onOpen={(e) => openFrom(e, o.id)}
                    onDelete={() => removeRow(o)}
                  />
              ))}
              <QuickAdd
                value={newItem}
                onChange={setNewItem}
                placeholder={`Add ${type.name.toLowerCase()}…`}
                onSubmit={() => {
                  addItem(newItem);
                  setNewItem('');
                }}
              />
            </section>
          )}
        </div>
      ) : mode === 'gallery' ? (
        <GalleryView objs={visible} type={type} theme={theme} onOpen={(e, id) => openFrom(e, id)} onAdd={() => addRow()} />
      ) : mode === 'board' && groupProp ? (
        <BoardView
          objs={visible}
          type={type}
          prop={groupProp}
          theme={theme}
          onOpen={(e, id) => openFrom(e, id)}
          onSet={(o, value) => updateCell(o, groupProp.id, value)}
          onAdd={(value) => addRow(value ? { [groupProp.id]: value } : {})}
        />
      ) : mode === 'calendar' && calField ? (
        <div className="checklist-page">
          <div className="daily-head">
            <span className="month-label">{fmtMonthYear(calMonth)}</span>
            <div className="daily-nav">
              <button className="icon-btn" onClick={() => setCalMonth(monthStartKey(calMonth, -1))} aria-label="Previous month">
                <Icon name="chevron-left" />
              </button>
              <button className="today-btn" onClick={() => setCalMonth(todayKey())}>
                Today
              </button>
              <button className="icon-btn" onClick={() => setCalMonth(monthStartKey(calMonth, 1))} aria-label="Next month">
                <Icon name="chevron-right" />
              </button>
            </div>
          </div>
          <div className="cal-grid">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="cal-dow">
                {d}
              </div>
            ))}
            {monthCells(calMonth).map((c) => {
              const onDay = visible.filter((o) => dayKey(o) === c.key);
              // Up to 3 fit; beyond that show two and roll the rest into a counter,
              // so a busy day can't stretch the row.
              const expanded = expandedDay === c.key;
              const shown = expanded || onDay.length <= 3 ? onDay : onDay.slice(0, 2);
              const hidden = onDay.length - shown.length;
              return (
                <div
                  key={c.key}
                  className={'cal-cell' + (c.inMonth ? '' : ' out') + (c.key === todayKey() ? ' today' : '')}
                >
                  <span className="cal-num">{c.day}</span>
                  {shown.map((o) => (
                    <button
                      key={o.id}
                      className={'cal-task' + (isDone(o) ? ' done' : '')}
                      title={o.title || 'Untitled'}
                      onClick={(e) => openFrom(e, o.id)}
                    >
                      {o.title || 'Untitled'}
                    </button>
                  ))}
                  {hidden > 0 && (
                    <button className="cal-more" onClick={() => setExpandedDay(c.key)}>
                      +{hidden} more
                    </button>
                  )}
                  {expanded && onDay.length > 3 && (
                    <button className="cal-more" onClick={() => setExpandedDay(null)}>
                      Show less
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
      <div className="table-scroll">
        <table className="db-table">
          <thead>
            <tr>
              <th className={'td-pick' + (selectMode ? '' : ' off')}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label={allSelected ? 'Deselect all' : 'Select all'}
                />
              </th>
              <th className="td-name">
                <button className="th-btn" onClick={(e) => openHeaderMenu(e, null)}>
                  Name
                  {view.sort?.key === TITLE_FIELD && <span className="sort-ind">{view.sort.dir === 1 ? '▲' : '▼'}</span>}
                </button>
              </th>
              {type.properties.map((p) => (
                <th key={p.id}>
                  <button className="th-btn" onClick={(e) => openHeaderMenu(e, p)}>
                    {p.name}
                    {view.sort?.key === p.id && <span className="sort-ind">{view.sort.dir === 1 ? '▲' : '▼'}</span>}
                  </button>
                </th>
              ))}
              <th className="th-add">
                <button
                  className="icon-btn"
                  aria-label="Add property"
                  onClick={(e) => setEditor({ pos: popPos(e.currentTarget as HTMLElement, 260, 300) })}
                >
                  <Icon name="plus" size={14} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((o, rowIndex) => (
              <tr
                key={o.id}
                className={selected.has(o.id) ? 'picked' : ''}
                onClick={(e) => {
                  // A row's own controls — the title field, cell editors, delete,
                  // the Open pill — keep their behaviour. The space between them
                  // opens the object, the same way a checklist row does.
                  if ((e.target as HTMLElement).closest('button, input, select, textarea, a, [contenteditable]')) return;
                  if (selectMode) return toggleRow(rowIndex, e.shiftKey);
                  openFrom(e, o.id);
                }}
              >
                <td className={'td-pick' + (selectMode ? '' : ' off')}>
                  <input
                    type="checkbox"
                    checked={selected.has(o.id)}
                    onChange={() => {}}
                    onClick={(e) => toggleRow(rowIndex, e.shiftKey)}
                    aria-label="Select row"
                  />
                </td>
                <td className="td-name">
                  <div className="cell-name">
                    <TextCell value={o.title} onCommit={(v: any) => updateTitle(o, v)} name />
                    <button className="open-pill" onClick={() => openBeside(o.id)}>
                      <Icon name="arrow-up-right" size={12} />
                      Open
                    </button>
                    <InlineProps o={o} fields={inlineFields} onChange={(pid, v) => updateCell(o, pid, v)} />
                  </div>
                </td>
                {type.properties.map((p) => (
                  <td key={p.id}>
                    <Cell
                      def={p}
                      value={o.props[p.id]}
                      onChange={(v) => updateCell(o, p.id, v)}
                      anchor={anchorDate([...type.properties, ...o.extraProps], o.props)}
                    />
                  </td>
                ))}
                <td className="td-end">
                  <button className="row-del" onClick={() => removeRow(o)} aria-label="Delete">
                    <Icon name="trash" size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* Wrapped, not passed straight through: as a handler it would be
            called with the click event, which then arrives as `preset`. */}
        <button className="add-row" onClick={() => addRow()}>
          <Icon name="plus" size={14} /> New {type.name.toLowerCase()}
        </button>
      </div>
      )}

      <AnimatePresence>
      {selected.size > 0 && (
        <motion.div
          className="bulk-bar"
          initial={{ opacity: 0, y: 26, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 26, scale: 0.96 }}
          transition={spring}
        >
          <span className="bulk-count">{selected.size} selected</span>
          {type.properties
            .filter((p) => p.kind === 'select' || p.kind === 'date' || p.kind === 'checkbox')
            .map((p) =>
              p.kind === 'select' ? (
                <select
                  key={p.id}
                  className="bulk-field"
                  value=""
                  onChange={(e) => e.target.value && bulkSet(p.id, e.target.value === '__clear' ? null : e.target.value)}
                >
                  <option value="">{p.name}…</option>
                  {(p.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                  <option value="__clear">Clear</option>
                </select>
              ) : p.kind === 'date' ? (
                <span key={p.id} className="bulk-field" title={`Set ${p.name}`}>
                  <DateField value={null} placeholder={`${p.name}…`} onChange={(v) => bulkSet(p.id, v)} />
                </span>
              ) : (
                <select
                  key={p.id}
                  className="bulk-field"
                  value=""
                  onChange={(e) => e.target.value && bulkSet(p.id, e.target.value === 'yes')}
                >
                  <option value="">{p.name}…</option>
                  <option value="yes">Checked</option>
                  <option value="no">Unchecked</option>
                </select>
              )
            )}
          <button className="btn subtle" onClick={(e) => setBulkProp(popPos(e.currentTarget as HTMLElement, 260, 320))}>
            <Icon name="plus" size={13} /> Add property
          </button>
          <button className="btn danger" onClick={bulkDelete}>
            <Icon name="trash" size={13} /> Delete
          </button>
          <button className="icon-btn" onClick={() => setSelected(new Set())} aria-label="Clear selection">
            <Icon name="x" size={14} />
          </button>
        </motion.div>
      )}
      </AnimatePresence>

      {menu && (
        <>
          <div className="backdrop" onClick={() => setMenu(null)} />
          <div className="popover" style={menu.pos}>
            <button
              className="menu-item"
              onClick={() => {
                changeView({ sort: { key: sortKey(menu.prop), dir: 1 } });
                setMenu(null);
              }}
            >
              <span className="check-slot">▲</span> Sort ascending
            </button>
            <button
              className="menu-item"
              onClick={() => {
                changeView({ sort: { key: sortKey(menu.prop), dir: -1 } });
                setMenu(null);
              }}
            >
              <span className="check-slot">▼</span> Sort descending
            </button>
            <button
              className="menu-item"
              onClick={() => {
                changeView({ sort: null });
                setMenu(null);
              }}
            >
              <span className="check-slot" /> Clear sort
            </button>
            <div className="menu-sep" />
            <button
              className="menu-item"
              onClick={() => {
                const key = sortKey(menu.prop);
                const kind = fields.find((f) => f.key === key)?.kind ?? 'text';
                changeView({
                  filters: [...view.filters, { id: clientUid(), field: key, op: opsFor(kind)[0] }],
                });
                setMenu(null);
              }}
            >
              <span className="check-slot">
                <Icon name="filter" size={12} />
              </span>
              Filter by this
            </button>
            {menu.prop && (
              <>
                <div className="menu-sep" />
                <button
                  className="menu-item"
                  onClick={() => {
                    setEditor({ initial: menu.prop!, pos: menu.pos });
                    setMenu(null);
                  }}
                >
                  Edit property
                </button>
                <button
                  className="menu-item danger"
                  onClick={() => {
                    deleteProp(menu.prop!);
                    setMenu(null);
                  }}
                >
                  Delete property
                </button>
              </>
            )}
          </div>
        </>
      )}

      {fieldMenu && (
        <>
          <div className="backdrop" onClick={() => setFieldMenu(null)} />
          <div className="popover" style={fieldMenu}>
            <div className="menu-hint">Shown next to each name.</div>
            {allInlineNames.map((name) => {
              const on = !inlineFields || inlineFields.includes(name);
              return (
                <button
                  key={name}
                  className="menu-item"
                  onClick={() => {
                    const base = inlineFields ?? allInlineNames;
                    const next = on ? base.filter((n) => n !== name) : [...base, name];
                    setInlineFields(next);
                    api.kv.set('inline-fields:' + typeId, JSON.stringify(next));
                  }}
                >
                  <Icon name={on ? 'check' : 'minus'} size={14} />
                  {name}
                </button>
              );
            })}
            <div className="menu-sep" />
            <button
              className="menu-item"
              onClick={() => {
                setInlineFields(null);
                api.kv.set('inline-fields:' + typeId, null);
              }}
            >
              Show all
            </button>
          </div>
        </>
      )}

      {tplMenu && (
        <>
          <div className="backdrop" onClick={() => setTplMenu(null)} />
          <div className="popover" style={tplMenu}>
            {templates.length === 0 && <div className="menu-hint">Templates let new {type.name.toLowerCase()}s start pre-filled.</div>}
            {templates.map((tpl) => (
              <div className="tpl-row" key={tpl.id}>
                <button
                  className="menu-item"
                  onClick={async () => {
                    setTplMenu(null);
                    const o = await api.objects.createFromTemplate(tpl.id);
                    if (o) openObject(o.id);
                  }}
                >
                  <Icon name="doc" size={14} />
                  {tpl.name || 'Untitled template'}
                </button>
                <button
                  className={'icon-btn' + (defaultTpl === tpl.id ? ' active' : '')}
                  aria-label="Use as default"
                  title={defaultTpl === tpl.id ? 'Default for new items' : 'Make default for new items'}
                  onClick={() => {
                    const next = defaultTpl === tpl.id ? null : tpl.id;
                    setDefaultTpl(next);
                    api.kv.set('default-template:' + typeId, next);
                  }}
                >
                  <Icon name={defaultTpl === tpl.id ? 'star-filled' : 'star'} size={13} />
                </button>
                <button
                  className="icon-btn"
                  aria-label="Edit template"
                  onClick={() => {
                    setTplMenu(null);
                    navigate({ kind: 'template', id: tpl.id });
                  }}
                >
                  <Icon name="pencil" size={13} />
                </button>
              </div>
            ))}
            <div className="menu-sep" />
            <button
              className="menu-item"
              onClick={async () => {
                setTplMenu(null);
                const tpl = await api.templates.create({ typeId });
                navigate({ kind: 'template', id: tpl.id });
              }}
            >
              <Icon name="plus" size={14} /> New template
            </button>
          </div>
        </>
      )}

      {datePrompt && (
        <motion.div
          className="palette-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && setDatePrompt(null)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={snap}
        >
          <motion.div className="date-prompt" variants={dialogIn} initial="hidden" animate="shown">
            <h3>Schedule for</h3>
            <DateField
              value={datePrompt.value}
              placeholder="Pick a day…"
              onChange={(v) => setDatePrompt({ ...datePrompt, value: v ?? '' })}
            />
            <div className="popover-actions">
              <button className="btn subtle" onClick={() => setDatePrompt(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                disabled={!datePrompt.value}
                onClick={() => {
                  const o = objs.find((x) => x.id === datePrompt.id);
                  if (o && dueProp) updateCell(o, dueProp.id, datePrompt.value);
                  setDatePrompt(null);
                }}
              >
                Schedule
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}

      {bulkProp && (
        <PropEditor pos={bulkProp} onSave={bulkAddProp} onClose={() => setBulkProp(null)} />
      )}

      {typeEdit && <TypeEditor type={type} pos={typeEdit} onSave={saveType} onClose={() => setTypeEdit(null)} />}

      {editor && <PropEditor initial={editor.initial} pos={editor.pos} onSave={saveProp} onClose={() => setEditor(null)} />}
    </div>
  );
}
