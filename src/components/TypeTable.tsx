import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { api } from '../api';
import { ask } from '../confirm';
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
  bySavedOrder,
  emptyView,
  opsFor,
  reorderIds,
  sortObjs,
  viewFields,
} from '../viewModel';
import { Cell, TextCell, popPos } from './cells';
import { DateField } from './DateField';
import { fmtClock, fromValue } from '../dateParse';
import { Icon, TypeIcon } from './Icons';
import { SplitControls } from './SplitControls';
import { PageActions } from './PageActions';
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
      <input type="checkbox" className="pick-box" checked={picked} onChange={onSelect} aria-label="Select" />
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
 * `embedded` drops the page header and pins the view to a single mode with no
 * mode switcher — the Tasks page shows this as one of its own modes, already
 * has a header (and an agenda and a calendar) of its own, and showing a second
 * set of view buttons underneath was just noise on top of noise.
 */
export function TypeTable({
  typeId,
  embedded = false,
  embeddedMode = 'table',
}: {
  typeId: string;
  embedded?: boolean;
  /** Which single view an embedded table is pinned to — the Tasks page uses
   *  'board' for its own Board tab, everything else still gets a plain table. */
  embeddedMode?: ViewMode;
}) {
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
  /** null means "show them all"; otherwise the property names picked for the inline row. */
  const [inlineFields, setInlineFields] = useState<string[] | null>(null);
  const [newItem, setNewItem] = useState('');
  const [newScheduled, setNewScheduled] = useState('');
  const [calMonth, setCalMonth] = useState(todayKey());
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastPicked = useRef<number | null>(null);
  /** Column widths while one is being dragged; the view only hears about it on release. */
  const [draftWidths, setDraftWidths] = useState<Record<string, number> | null>(null);
  const widthRef = useRef<Record<string, number>>({});
  const [resizing, setResizing] = useState(false);
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);
  const [dragRow, setDragRow] = useState<string | null>(null);
  /** Which row the drag is hovering, and whether the line goes under it or over. */
  const [overRow, setOverRow] = useState<{ id: string; below: boolean } | null>(null);
  const [rowMenu, setRowMenu] = useState<{ o: Obj; pos: { left: number; top: number } } | null>(null);

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
  // A dragged-in order is the fallback ordering, not a competing one: the moment
  // a sort is set it wins, which is why dropping a row clears the sort.
  const visible = open(view.sort ? sorted : bySavedOrder(sorted, view.rowOrder));

  /*
   * Properties an object carries itself rather than the type get a column of
   * their own, just like the type's own. They were being drawn as chips inside
   * the name cell, which crammed them all into one column and left them out of
   * the grid entirely — a value you can't line up, widen or sort by isn't
   * really being treated as a property. In practice every object of a type
   * shares one definition for each of these, so they line up as columns.
   */
  const extraDefs: PropDef[] = [];
  const seenCol = new Set(type.properties.map((p) => p.id));
  for (const o of objs)
    for (const p of o.extraProps ?? [])
      if (!seenCol.has(p.id)) {
        seenCol.add(p.id);
        extraDefs.push(p);
      }

  // Columns follow the order they were dragged into. A property added since then
  // isn't in that list, so it lands at the end rather than at the front.
  const cols = bySavedOrder([...type.properties, ...extraDefs], view.columnOrder);

  /** True for a column that lives on the objects instead of the type's schema. */
  const isExtra = (propId: string) => !type.properties.some((p) => p.id === propId);

  // Embedded is only ever the Tasks page's own "Table" tab — it already has an
  // agenda and a calendar of its own, so the one thing this instance should
  // ever be is a plain table, with no second mode-switcher fighting the one
  // above it for the same job.
  const modes = embedded ? ([embeddedMode] as ViewMode[]) : availableModes(type, fields, doneProp);
  // Until one is picked the type's shape decides: anything task-shaped opens as a
  // checklist. A saved mode can also stop being available, if its property went away.
  const mode: ViewMode = embedded ? embeddedMode : view.mode && modes.includes(view.mode) ? view.mode : doneProp ? 'checklist' : 'table';

  // Board columns can come from an extra property as readily as a schema one —
  // the mode is already offered whenever any select field exists, and without
  // this the Board tab on such a type quietly fell back to the table.
  const selectProps = cols.filter((p) => p.kind === 'select');
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
    const patch: { props: Record<string, any>; extraProps?: PropDef[] } = { props: { ...o.props, [propId]: value } };
    // Filling in an extra-property column on a row that never carried that
    // property hands the row the definition as well — without it the value has
    // nothing to be read back by and simply wouldn't show.
    const def = cols.find((p) => p.id === propId);
    if (def && isExtra(propId) && !(o.extraProps ?? []).some((p) => p.id === propId))
      patch.extraProps = [...(o.extraProps ?? []), def];
    setObjs((list) => list.map((x) => (x.id === o.id ? { ...x, ...patch } : x)));
    api.objects.update(o.id, patch).then(() => objectChanged(o.id));
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
    if (!(await ask(`Delete “${o.title || 'Untitled'}”? This also removes its links.`))) return;
    await api.objects.remove(o.id);
    objectChanged(o.id);
    setObjs((list) => list.filter((x) => x.id !== o.id));
  };

  /** Every object carrying an extra property keeps its own copy of the definition. */
  const ownersOf = (def: PropDef) => objs.filter((o) => (o.extraProps ?? []).some((p) => p.id === def.id));

  const saveProp = async (def: PropDef) => {
    // Editing an extra-property column means editing each of those copies —
    // filtered through the type's schema first, since a property that lives
    // there is the ordinary case.
    if (isExtra(def.id)) {
      const owners = ownersOf(def);
      if (owners.length) {
        await Promise.all(
          owners.map((o) =>
            api.objects.update(o.id, { extraProps: (o.extraProps ?? []).map((p) => (p.id === def.id ? def : p)) })
          )
        );
        setObjs(await api.objects.list(typeId));
        owners.forEach((o) => objectChanged(o.id));
        return;
      }
    }
    const props = [...type.properties];
    const i = props.findIndex((p) => p.id === def.id);
    if (i >= 0) props[i] = def;
    else props.push(def);
    await api.types.update(type.id, { properties: props });
    await reloadTypes();
  };

  const deleteProp = async (def: PropDef) => {
    if (isExtra(def.id)) {
      const owners = ownersOf(def);
      if (owners.length) {
        const n = owners.length;
        if (!(await ask(`Remove property “${def.name}” from ${n} ${type.name.toLowerCase()}${n === 1 ? '' : 's'}?`))) return;
        await Promise.all(
          owners.map((o) => {
            const props = { ...o.props };
            delete props[def.id];
            return api.objects.update(o.id, { props, extraProps: (o.extraProps ?? []).filter((p) => p.id !== def.id) });
          })
        );
        setObjs(await api.objects.list(typeId));
        owners.forEach((o) => objectChanged(o.id));
        return;
      }
    }
    if (!(await ask(`Remove property “${def.name}” from all ${type.name}s?`))) return;
    await api.types.update(type.id, { properties: type.properties.filter((p) => p.id !== def.id) });
    await reloadTypes();
  };

  const deleteType = async () => {
    const n = objs.length;
    if (!(await ask(`Delete the type “${type.name}” and its ${n} object${n === 1 ? '' : 's'}? This cannot be undone.`))) return;
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
    if (!(await ask(`Delete ${ids.length} ${ids.length === 1 ? 'object' : 'objects'}? This also removes their links.`)))
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

  // ---- columns and rows you can drag ----

  const widths = draftWidths ?? view.widths ?? {};
  const widthOf = (key: string) => widths[key] ?? (key === TITLE_FIELD ? 320 : 190);
  /** The gutter, every column, and room at the end for the two buttons that live there. */
  const tableMin = 54 + widthOf(TITLE_FIELD) + cols.reduce((n, p) => n + widthOf(p.id), 0) + 44;

  /** Drag a header's right edge to set that column's width. */
  const startResize = (key: string) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthOf(key);
    widthRef.current = { ...(view.widths ?? {}) };
    setResizing(true);
    const move = (ev: PointerEvent) => {
      widthRef.current = { ...widthRef.current, [key]: Math.max(90, Math.round(startW + ev.clientX - startX)) };
      setDraftWidths(widthRef.current);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setResizing(false);
      setDraftWidths(null);
      changeView({ widths: widthRef.current });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const dropCol = (overId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    setOverCol(null);
    setDragCol(null);
    const id = e.dataTransfer.getData('text/habitat-col');
    if (!id || id === overId) return;
    changeView({ columnOrder: reorderIds(cols.map((p) => p.id), id, overId) });
  };

  /** Above or below the row's midpoint, which is where the drop line is drawn. */
  const dropSide = (e: React.DragEvent) => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientY > box.top + box.height / 2;
  };

  const overRowAt = (id: string) => (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('text/habitat-row')) return;
    e.preventDefault();
    const below = dropSide(e);
    if (overRow?.id !== id || overRow.below !== below) setOverRow({ id, below });
  };

  /**
   * The saved order names every object, not just the ones on screen, so
   * reordering under a filter doesn't shuffle whatever the filter is hiding.
   */
  const dropRow = (overId: string) => (e: React.DragEvent) => {
    e.preventDefault();
    const below = dropSide(e);
    setOverRow(null);
    setDragRow(null);
    const id = e.dataTransfer.getData('text/habitat-row');
    if (!id || id === overId) return;
    const ids = bySavedOrder(objs, view.rowOrder)
      .map((o) => o.id)
      .filter((x) => x !== id);
    const at = ids.indexOf(overId);
    if (at < 0) return;
    ids.splice(at + (below ? 1 : 0), 0, id);
    changeView({ sort: null, rowOrder: ids });
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
        <PageActions>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {mode === 'checklist' && allInlineNames.length > 0 && (
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
        </PageActions>
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
        <table className={'db-table' + (resizing ? ' resizing' : '')} style={{ minWidth: tableMin }}>
          {/* Fixed widths, so a column stays where it was dragged to instead of
              being re-shared out between the others on every render. The last
              column has none: it soaks up whatever space is left over. */}
          <colgroup>
            <col className="col-gutter" />
            <col style={{ width: widthOf(TITLE_FIELD) }} />
            {cols.map((p) => (
              <col key={p.id} style={{ width: widthOf(p.id) }} />
            ))}
            <col />
          </colgroup>
          <thead>
            <tr>
              <th className="td-pick">
                <input
                  type="checkbox"
                  className="pick-box"
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
                <span className="col-resize" onPointerDown={startResize(TITLE_FIELD)} />
              </th>
              {cols.map((p) => (
                <th
                  key={p.id}
                  className={(dragCol === p.id ? 'dragging' : '') + (overCol === p.id ? ' over-col' : '')}
                  // Off while a resize is running, or the browser starts a column
                  // drag the moment the edge handle moves a pixel.
                  draggable={!resizing}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/habitat-col', p.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDragCol(p.id);
                  }}
                  onDragEnd={() => {
                    setDragCol(null);
                    setOverCol(null);
                  }}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes('text/habitat-col')) return;
                    e.preventDefault();
                    if (overCol !== p.id) setOverCol(p.id);
                  }}
                  onDragLeave={() => setOverCol((c) => (c === p.id ? null : c))}
                  onDrop={dropCol(p.id)}
                >
                  <button className="th-btn" onClick={(e) => openHeaderMenu(e, p)}>
                    {p.name}
                    {view.sort?.key === p.id && <span className="sort-ind">{view.sort.dir === 1 ? '▲' : '▼'}</span>}
                  </button>
                  <span className="col-resize" onPointerDown={startResize(p.id)} />
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
                className={
                  (selected.has(o.id) ? 'picked' : '') +
                  (dragRow === o.id ? ' dragging' : '') +
                  (overRow?.id === o.id ? (overRow.below ? ' drop-below' : ' drop-above') : '')
                }
                onDragOver={overRowAt(o.id)}
                onDragLeave={() => setOverRow((c) => (c?.id === o.id ? null : c))}
                onDrop={dropRow(o.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setRowMenu({ o, pos: { left: Math.min(e.clientX, window.innerWidth - 210), top: e.clientY } });
                }}
                onClick={(e) => {
                  // A row's own controls — the title field, cell editors, the grip,
                  // the Open pill — keep their behaviour. The space between them
                  // opens the object, the same way a checklist row does.
                  if ((e.target as HTMLElement).closest('button, input, select, textarea, a, [contenteditable]')) return;
                  openFrom(e, o.id);
                }}
              >
                <td className="td-pick">
                  <span className="row-gutter">
                    <button
                      className="row-grip"
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/habitat-row', o.id);
                        e.dataTransfer.effectAllowed = 'move';
                        setDragRow(o.id);
                      }}
                      onDragEnd={() => {
                        setDragRow(null);
                        setOverRow(null);
                      }}
                      onClick={(e) => setRowMenu({ o, pos: popPos(e.currentTarget as HTMLElement, 200, 180) })}
                      aria-label="Row options"
                      title="Drag to reorder · click for options"
                    >
                      <Icon name="grip" size={13} />
                    </button>
                    <input
                      type="checkbox"
                      className="pick-box"
                      checked={selected.has(o.id)}
                      onChange={() => {}}
                      onClick={(e) => toggleRow(rowIndex, e.shiftKey)}
                      aria-label="Select row"
                    />
                  </span>
                </td>
                <td className="td-name">
                  <div className="cell-name">
                    <TextCell value={o.title} onCommit={(v: any) => updateTitle(o, v)} name />
                    <button className="open-pill" onClick={() => openBeside(o.id)}>
                      <Icon name="arrow-up-right" size={12} />
                      Open
                    </button>
                  </div>
                </td>
                {cols.map((p) => (
                  // The label rides along on the cell so a narrow screen can
                  // print it beside the value: a table turned into cards has no
                  // header row left to read the column names from.
                  <td key={p.id} data-label={p.name}>
                    <Cell
                      def={p}
                      value={o.props[p.id]}
                      onChange={(v) => updateCell(o, p.id, v)}
                      anchor={anchorDate([...type.properties, ...o.extraProps], o.props)}
                    />
                  </td>
                ))}
                <td className="td-end">
                  <button
                    className="row-del"
                    onClick={(e) => setRowMenu({ o, pos: popPos(e.currentTarget as HTMLElement, 200, 180) })}
                    aria-label="Row options"
                  >
                    <Icon name="more-horizontal" size={14} />
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

      {rowMenu && (
        <>
          <div className="backdrop" onClick={() => setRowMenu(null)} />
          <div className="popover" style={rowMenu.pos}>
            <button
              className="menu-item"
              onClick={() => {
                openObject(rowMenu.o.id);
                setRowMenu(null);
              }}
            >
              <span className="check-slot">
                <Icon name="arrow-up-right" size={12} />
              </span>
              Open
            </button>
            <button
              className="menu-item"
              onClick={() => {
                openBeside(rowMenu.o.id);
                setRowMenu(null);
              }}
            >
              <span className="check-slot">
                <Icon name="columns" size={12} />
              </span>
              Open beside
            </button>
            <div className="menu-sep" />
            <button
              className="menu-item danger"
              onClick={() => {
                const o = rowMenu.o;
                setRowMenu(null);
                removeRow(o);
              }}
            >
              <span className="check-slot">
                <Icon name="trash" size={12} />
              </span>
              Delete
            </button>
          </div>
        </>
      )}

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
          className="palette-backdrop date-backdrop"
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
