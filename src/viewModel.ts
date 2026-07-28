// How a type's list is shown: which view, what it's filtered and sorted by.
//
// Fields are the type's own properties plus three that every object has —
// its name and the two timestamps — so a type with no properties at all can
// still be filtered and sorted by when things were created or last edited.

import type { Obj, ObjType, PropDef, PropKind } from './types';
import { addDays, keyOf, todayKey } from './util';

export type ViewMode = 'table' | 'board' | 'gallery' | 'calendar' | 'checklist';

export const TITLE_FIELD = '__title';
export const CREATED_FIELD = '__created';
export const UPDATED_FIELD = '__updated';

export type FilterOp =
  | 'is'
  | 'isNot'
  | 'contains'
  | 'notContains'
  | 'gt'
  | 'lt'
  | 'onOrBefore'
  | 'onOrAfter'
  | 'inLast'
  | 'inNext'
  | 'anyOf'
  | 'allOf'
  | 'noneOf'
  | 'isTrue'
  | 'isFalse'
  | 'empty'
  | 'notEmpty';

export interface ViewFilter {
  id: string;
  /** A property id, or one of the built-in `__` fields. */
  field: string;
  op: FilterOp;
  value?: any;
}

export interface SortState {
  key: string;
  dir: 1 | -1;
}

/** Everything the list view remembers, saved per type in the vault's kv table. */
export interface TypeView {
  /** Unset until the user picks one, so the type's shape can choose the default. */
  mode?: ViewMode;
  sort: SortState | null;
  filters: ViewFilter[];
  /** Board: the select property whose values become columns. */
  groupBy?: string;
  /** Calendar: which date property places an object on the grid. */
  dateField?: string;
  /** Task-shaped types only: keep finished work out of every view. */
  hideDone?: boolean;
}

export const emptyView = (): TypeView => ({ sort: null, filters: [] });

export interface ViewField {
  key: string;
  name: string;
  kind: PropKind;
  options?: string[];
  /** True for the built-in name/created/edited fields, which have no property to edit. */
  builtin?: boolean;
}

/**
 * The fields a view can filter or sort by: the type's schema, then anything
 * objects carry as their own extra properties, then name and timestamps.
 */
export function viewFields(type: ObjType | undefined, objs: Obj[]): ViewField[] {
  const out: ViewField[] = [{ key: TITLE_FIELD, name: 'Name', kind: 'text', builtin: true }];
  const seen = new Set([TITLE_FIELD]);
  const add = (p: PropDef) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    out.push({ key: p.id, name: p.name, kind: p.kind, options: p.options });
  };
  for (const p of type?.properties ?? []) add(p);
  for (const o of objs) for (const p of o.extraProps ?? []) add(p);
  out.push({ key: CREATED_FIELD, name: 'Created', kind: 'date', builtin: true });
  out.push({ key: UPDATED_FIELD, name: 'Edited', kind: 'date', builtin: true });
  return out;
}

export function fieldValue(o: Obj, key: string): any {
  if (key === TITLE_FIELD) return o.title;
  if (key === CREATED_FIELD) return o.createdAt;
  if (key === UPDATED_FIELD) return o.updatedAt;
  return o.props?.[key];
}

/** Dates arrive as 'YYYY-MM-DD' strings from properties and as epoch millis from timestamps. */
function dateKeyOf(v: any): string {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return keyOf(new Date(v));
  return String(v).slice(0, 10);
}

const isEmpty = (v: any) => v == null || v === '' || (Array.isArray(v) && v.length === 0);

const asList = (v: any): string[] => (Array.isArray(v) ? v.map(String) : isEmpty(v) ? [] : [String(v)]);

const DATE_KINDS: PropKind[] = ['date', 'datetime'];
const NUMBER_KINDS: PropKind[] = ['number', 'rating', 'progress'];

const OP_LABELS: Record<FilterOp, string> = {
  is: 'is',
  isNot: 'is not',
  contains: 'contains',
  notContains: 'does not contain',
  gt: 'is more than',
  lt: 'is less than',
  onOrBefore: 'is on or before',
  onOrAfter: 'is on or after',
  inLast: 'is in the last',
  inNext: 'is in the next',
  anyOf: 'is any of',
  allOf: 'has all of',
  noneOf: 'is none of',
  isTrue: 'is checked',
  isFalse: 'is unchecked',
  empty: 'is empty',
  notEmpty: 'is not empty',
};

export const opLabel = (op: FilterOp, kind: PropKind): string =>
  kind === 'multiselect' && op === 'anyOf' ? 'has any of' : kind === 'multiselect' && op === 'noneOf' ? 'has none of' : OP_LABELS[op];

/** Which comparisons make sense for a field, in the order they should be offered. */
export function opsFor(kind: PropKind): FilterOp[] {
  if (kind === 'checkbox') return ['isTrue', 'isFalse'];
  if (kind === 'select') return ['anyOf', 'noneOf', 'empty', 'notEmpty'];
  if (kind === 'multiselect') return ['anyOf', 'allOf', 'noneOf', 'empty', 'notEmpty'];
  if (kind === 'relation' || kind === 'file') return ['empty', 'notEmpty'];
  if (DATE_KINDS.includes(kind)) return ['is', 'onOrBefore', 'onOrAfter', 'inLast', 'inNext', 'empty', 'notEmpty'];
  if (NUMBER_KINDS.includes(kind)) return ['is', 'isNot', 'gt', 'lt', 'empty', 'notEmpty'];
  return ['contains', 'is', 'isNot', 'notContains', 'empty', 'notEmpty'];
}

/** What the editor has to ask for once an operator is picked. */
export function valueShape(op: FilterOp, kind: PropKind): 'none' | 'text' | 'number' | 'date' | 'days' | 'options' {
  if (op === 'empty' || op === 'notEmpty' || op === 'isTrue' || op === 'isFalse') return 'none';
  if (op === 'inLast' || op === 'inNext') return 'days';
  if (op === 'anyOf' || op === 'allOf' || op === 'noneOf') return 'options';
  if (DATE_KINDS.includes(kind)) return 'date';
  if (NUMBER_KINDS.includes(kind)) return 'number';
  return 'text';
}

export function matches(o: Obj, f: ViewFilter, field: ViewField): boolean {
  const raw = fieldValue(o, f.field);
  const kind = field.kind;

  if (f.op === 'empty') return isEmpty(raw);
  if (f.op === 'notEmpty') return !isEmpty(raw);
  if (f.op === 'isTrue') return !!raw;
  if (f.op === 'isFalse') return !raw;

  if (f.op === 'anyOf' || f.op === 'allOf' || f.op === 'noneOf') {
    const want = asList(f.value);
    if (!want.length) return true; // nothing chosen yet — don't hide everything
    const have = asList(raw);
    if (f.op === 'allOf') return want.every((w) => have.includes(w));
    const hit = want.some((w) => have.includes(w));
    return f.op === 'anyOf' ? hit : !hit;
  }

  if (DATE_KINDS.includes(kind)) {
    const key = dateKeyOf(raw);
    if (!key) return false;
    if (f.op === 'inLast') return key >= addDays(todayKey(), -Math.abs(Number(f.value) || 0)) && key <= todayKey();
    if (f.op === 'inNext') return key >= todayKey() && key <= addDays(todayKey(), Math.abs(Number(f.value) || 0));
    const want = dateKeyOf(f.value);
    if (!want) return true;
    if (f.op === 'is') return key === want;
    if (f.op === 'onOrBefore') return key <= want;
    if (f.op === 'onOrAfter') return key >= want;
    return true;
  }

  if (NUMBER_KINDS.includes(kind)) {
    const a = Number(raw);
    const b = Number(f.value);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    if (f.op === 'is') return a === b;
    if (f.op === 'isNot') return a !== b;
    if (f.op === 'gt') return a > b;
    if (f.op === 'lt') return a < b;
    return true;
  }

  const text = (Array.isArray(raw) ? raw.join(', ') : String(raw ?? '')).toLowerCase();
  const want = String(f.value ?? '').toLowerCase();
  if (!want) return true;
  if (f.op === 'is') return text === want;
  if (f.op === 'isNot') return text !== want;
  if (f.op === 'contains') return text.includes(want);
  if (f.op === 'notContains') return !text.includes(want);
  return true;
}

/** Every filter has to pass — chips read as one sentence joined by "and". */
export function applyFilters(objs: Obj[], filters: ViewFilter[], fields: ViewField[]): Obj[] {
  const active = filters.filter((f) => fields.some((x) => x.key === f.field));
  if (!active.length) return objs;
  const byKey = new Map(fields.map((f) => [f.key, f]));
  return objs.filter((o) => active.every((f) => matches(o, f, byKey.get(f.field)!)));
}

export function sortObjs(objs: Obj[], sort: SortState | null, fields: ViewField[]): Obj[] {
  if (!sort) return objs;
  const kind = fields.find((f) => f.key === sort.key)?.kind ?? 'text';
  const dated = DATE_KINDS.includes(kind);
  return [...objs].sort((a, b) => {
    const av = fieldValue(a, sort.key);
    const bv = fieldValue(b, sort.key);
    // Blanks sink to the bottom whichever way the sort runs.
    if (isEmpty(av) && isEmpty(bv)) return 0;
    if (isEmpty(av)) return 1;
    if (isEmpty(bv)) return -1;
    if (dated) return dateKeyOf(av).localeCompare(dateKeyOf(bv)) * sort.dir;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sort.dir;
    return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base', numeric: true }) * sort.dir;
  });
}

/** A chip's text: "Due is on or before 2026-08-01". */
export function describeFilter(f: ViewFilter, field: ViewField): string {
  const shape = valueShape(f.op, field.kind);
  const label = `${field.name} ${opLabel(f.op, field.kind)}`;
  if (shape === 'none') return label;
  if (shape === 'options') {
    const list = asList(f.value);
    return `${label} ${list.length ? list.join(', ') : '…'}`;
  }
  if (shape === 'days') return `${label} ${Number(f.value) || 0} days`;
  return `${label} ${f.value === undefined || f.value === '' ? '…' : f.value}`;
}

/** Views only make sense when the type has the shape they need. */
export function availableModes(type: ObjType | undefined, fields: ViewField[], doneProp?: PropDef): ViewMode[] {
  const modes: ViewMode[] = ['table', 'gallery'];
  if (fields.some((f) => f.kind === 'select' && !f.builtin)) modes.push('board');
  // Created and Edited always exist, so every type can be put on a calendar.
  if (fields.some((f) => f.kind === 'date' || f.kind === 'datetime')) modes.push('calendar');
  if (doneProp) modes.push('checklist');
  return modes;
}

export const MODE_LABELS: Record<ViewMode, string> = {
  table: 'Table',
  board: 'Board',
  gallery: 'Gallery',
  calendar: 'Calendar',
  checklist: 'Checklist',
};

export const MODE_ICONS: Record<ViewMode, string> = {
  table: 'rows3',
  board: 'columns',
  gallery: 'layout',
  calendar: 'calendar',
  checklist: 'list-todo',
};
