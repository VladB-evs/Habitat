export type PropKind =
  | 'text'
  | 'longtext'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'date'
  | 'datetime'
  | 'checkbox'
  | 'url'
  | 'email'
  | 'phone'
  | 'rating'
  | 'progress'
  | 'color'
  | 'file'
  | 'relation'
  | 'repeat';

/** A task as the agenda sees it: something to work on, and where it sits. */
export interface AgendaTask {
  id: string;
  typeId: string;
  typeName: string;
  title: string;
  /** The day it sits on — its next occurrence when it repeats — or null. */
  when: string | null;
  startMinute: number | null;
  minutes: number | null;
  done: boolean;
  repeats: boolean;
  overdue: boolean;
  rolled: boolean;
  /** The event it belongs to, if any. */
  partOf: string | null;
  /** That event's name, filled in wherever the task is shown away from it. */
  eventName?: string | null;
}

/**
 * A thing that happens — a meeting, a flight, a week away — and the tasks it
 * carries. Not something you tick off: its type has no "Done" to give.
 */
export interface AgendaEvent {
  id: string;
  typeId: string;
  typeName: string;
  title: string;
  dayKey: string;
  /** Null on an all-day event, and on every day of a run after the first. */
  startMinute: number | null;
  minutes: number | null;
  endMinute: number | null;
  allDay: boolean;
  /** "Day 2 of 8" for something that runs across days; null when it doesn't. */
  spanDay: number | null;
  spanOf: number | null;
  location: string;
  people: string[];
  repeats: boolean;
  tasks: AgendaTask[];
}

export interface AgendaDay {
  dayKey: string;
  events: AgendaEvent[];
  tasks: AgendaTask[];
}

export interface Agenda {
  days: AgendaDay[];
  /** Late and undone, however far back — never buried on a day you've scrolled past. */
  overdue: AgendaTask[];
  /** Never given a day: the pile you plan from. */
  backlog: AgendaTask[];
}

/**
 * One thing on the calendar. Times are resolved in the main process so the app,
 * the HTTP API and MCP all agree on where something sits.
 */
export interface CalEntry {
  id: string;
  typeId: string;
  typeName: string;
  title: string;
  /** The local day it belongs to, `YYYY-MM-DD`. */
  dayKey: string;
  /** True when it has a date but no time — shown in the strip above the grid. */
  allDay: boolean;
  /** Minutes past local midnight, or null when all-day. */
  startMinute: number | null;
  /** How long it runs, or null when all-day. */
  minutes: number | null;
  done: boolean;
  /** One day of a series rather than a one-off — `dayKey` says which. */
  repeats: boolean;
}

/** A stored attachment, as embedded in a note or held by a file property. */
export interface FileRef {
  hash: string;
  name: string;
  mime: string;
  ext: string;
  size: number;
  width?: number | null;
  height?: number | null;
}

export interface PropDef {
  id: string;
  name: string;
  kind: PropKind;
  options?: string[];
  targetTypeId?: string;
}

export interface ObjType {
  id: string;
  name: string;
  icon: string;
  color: string;
  builtin: boolean;
  starred: boolean;
  properties: PropDef[];
}

export interface HabitatInfo {
  id: string;
  name: string;
  dbPath: string;
  flavor: string;
}

export interface SettingsInfo {
  dbPath: string;
  habitats: HabitatInfo[];
  activeId: string;
  onboarded: boolean;
}

export interface Obj {
  id: string;
  typeId: string;
  title: string;
  props: Record<string, any>;
  extraProps: PropDef[];
  dateKey: string | null;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  snippet: string;
  /** Text around the search hit, present only on content searches. */
  match?: string;
  content?: any;
  /** The day of a repeating object's series this copy stands for, when it is one. */
  occurrence?: string;
}

export interface Template {
  id: string;
  typeId: string;
  name: string;
  props: Record<string, any>;
  extraProps: PropDef[];
  createdAt: number;
  content?: any;
}

// ---------- Canvas ----------

/** What a card on a board can be. `object` points into the vault; the rest stand alone. */
export type CanvasKind = 'object' | 'note' | 'text' | 'image' | 'file' | 'link' | 'frame';

/** Which edge of a card a connector leaves from or arrives at. */
export type Side = 'top' | 'right' | 'bottom' | 'left';

/** One filled property, flattened to text for display on a card. */
export interface CardProp {
  id: string;
  name: string;
  kind: PropKind;
  value: string;
}

/**
 * An object as a board card draws it. How much of this is shown depends on how
 * big the card has been made — see `detailFor` in the canvas.
 */
export interface ObjectCard {
  id: string;
  title: string;
  typeId: string;
  typeName: string;
  icon: string;
  color: string;
  snippet: string;
  /** The note's own text, clipped — only large cards show it. */
  body: string;
  /** Filled properties in the type's own order; empty ones are already dropped. */
  props: CardProp[];
  dateKey: string | null;
  done: boolean;
  updatedAt: number;
}

/** Kind-specific extras. All optional: a card only carries what its kind uses. */
export interface CanvasItemData {
  /** note / text */
  text?: string;
  /** frame's label, and a link's headline when it has one. */
  title?: string;
  /** link */
  url?: string;
  /**
   * A tint from the palette. `null` clears it back to the plain surface — and it
   * has to be null rather than absent, because an undefined value does not
   * survive the trip to the main process and the tint would never come off.
   */
  color?: string | null;
  /** text: display size in px. */
  size?: number;
  /** Held still, so a stray drag can't nudge it. */
  locked?: boolean;
}

export interface CanvasItem {
  id: string;
  kind: CanvasKind;
  refId: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  data: CanvasItemData;
  /** Resolved for `object` cards — null when the object has been deleted. */
  object?: ObjectCard | null;
  /** Resolved for `image` and `file` cards. */
  file?: FileRef | null;
}

/** A card as it is dropped: the board assigns id and layer, so neither is given. */
export interface NewCanvasItem {
  kind: CanvasKind;
  refId?: string | null;
  x: number;
  y: number;
  w?: number;
  h?: number;
  data?: CanvasItemData;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  fromSide: Side;
  toSide: Side;
  label: string;
  color: string | null;
  data: {
    dashed?: boolean;
    arrow?: 'none' | 'end' | 'both';
    /**
     * Hold the connector to the sides it was drawn from instead of re-routing it
     * as the cards move. Off by default, because auto-routing is right almost
     * always — this is the escape hatch for the diagram where it isn't.
     */
    pin?: boolean;
  };
}

export interface CanvasMeta {
  id: string;
  name: string;
  icon: string;
  color: string;
  view: { x: number; y: number; k: number };
  createdAt: number;
  updatedAt: number;
}

/** A gallery tile: the board plus enough geometry to draw a minimap of it. */
export interface CanvasSummary extends CanvasMeta {
  count: number;
  preview: { kind: CanvasKind; x: number; y: number; w: number; h: number; color: string | null }[];
}

export interface CanvasDoc {
  canvas: CanvasMeta;
  items: CanvasItem[];
  edges: CanvasEdge[];
}

// ---------- Study ----------

/** 1 Again, 2 Hard, 3 Good, 4 Easy — the four answers a card can get. */
export type Rating = 1 | 2 | 3 | 4;

export type CardState = 'new' | 'learning' | 'review' | 'relearning';

export type CardKind = 'basic' | 'cloze' | 'vocab';

/** Per-deck scheduling. Anything left out falls back to the defaults in srs.js. */
export interface DeckConfig {
  /** Minutes between the steps a new card walks before it joins the review pile. */
  learningSteps?: number[];
  relearnSteps?: number[];
  graduatingInterval?: number;
  easyInterval?: number;
  startingEase?: number;
  easyBonus?: number;
  hardFactor?: number;
  maxInterval?: number;
  newPerDay?: number;
  reviewsPerDay?: number;
  /** Vocabulary decks: also ask meaning → term, not just term → meaning. */
  reverse?: boolean;
}

export interface DeckCounts {
  new: number;
  learning: number;
  due: number;
  total: number;
}

export interface Deck {
  id: string;
  name: string;
  icon: string;
  color: string;
  /** Set on a language deck; empty on a general one. */
  lang: string;
  config: DeckConfig;
  createdAt: number;
  counts?: DeckCounts;
}

/** A page of writing inside Study. Not a vault object — Study owns its own. */
export interface StudyNote {
  id: string;
  title: string;
  body: string;
  /** Optional labels — subject, class. All free text, none required. */
  props: { subject?: string; class?: string; [k: string]: string | undefined };
  /** The deck its cards went into, once it has made any. */
  deckId: string | null;
  createdAt: number;
  updatedAt: number;
  /** How many cards came out of this note. Present on lists and on get. */
  cards?: number;
}

export interface Card {
  id: string;
  deckId: string;
  /** A vault object this card was cut from, when there is one. */
  objId: string | null;
  /** The study note this card was made from, when there is one. */
  noteId: string | null;
  kind: CardKind;
  front: string;
  back: string;
  hint: string;
  extra: { dir?: 'recognition' | 'recall'; reading?: string; example?: string; source?: string };
  state: CardState;
  due: number;
  interval: number;
  ease: number;
  step: number;
  reps: number;
  lapses: number;
  suspended: boolean;
  lastAt: number | null;
  createdAt: number;
  /** What each button would schedule, e.g. `{ 1: '1m', 3: '4d' }`. */
  preview?: Record<Rating, string>;
}

export interface StudyOverview {
  decks: Deck[];
  /** The most recent pages of writing, bodies clipped for the list. */
  notes: StudyNote[];
  totals: DeckCounts;
  history: { day: string; n: number }[];
  /** Consecutive days ending today (or yesterday, if today isn't done yet). */
  streak: number;
  reviewedToday: number;
}

export interface StudyQueue {
  cards: Card[];
  counts: DeckCounts | null;
}

/** A front/back pair pulled out of text, before it becomes a card. */
export interface ParsedCard {
  kind: CardKind;
  front: string;
  back: string;
  extra?: Record<string, unknown>;
}

export interface Stats {
  counts: Record<string, number>;
  recent: Obj[];
  pinned: Obj[];
}

export interface DailyMeta {
  id: string;
  dateKey: string;
  snippet: string;
  updatedAt: number;
}

export interface TagObj extends Obj {
  uses: number;
}

/** A suggestion row: an object plus the line that tells same-named ones apart. */
export interface MentionEntry extends Obj {
  subtitle?: string;
}

/** How far off someone's next birthday is, and what age it makes them. */
export interface NextBirthday {
  date: string;
  month: number;
  day: number;
  /** Days from today — 0 means it's today. */
  days: number;
  /** The date of that next birthday, as a YYYY-MM-DD key. */
  key: string;
  /** Null when the stored year is a placeholder rather than a real birth year. */
  turning: number | null;
  age: number | null;
}

/** A People object with the bits the directory views derive. */
export interface Person extends Obj {
  isSelf: boolean;
  nextBirthday: NextBirthday | null;
}

/** One group of optional person details, as offered by the "add detail" picker. */
export interface PersonFieldGroup {
  group: string;
  fields: PropDef[];
}

export type AutoTriggerKind =
  | 'created'
  | 'updated'
  | 'propSet'
  | 'deleted'
  | 'daily'
  | 'weekly'
  | 'dueToday'
  | 'birthday'
  | 'appStart';
export type AutoActionKind =
  | 'setProp'
  | 'createObject'
  | 'appendDaily'
  | 'addTag'
  | 'link'
  | 'pin'
  | 'notify'
  | 'telegram';

export interface UpdateState {
  status: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'staged' | 'installing' | 'error' | 'dev';
  version: string;
  next?: string | null;
  notes?: string;
  url?: string;
  error?: string | null;
}

export interface HttpApiConfig {
  enabled: boolean;
  port: number;
  token: string;
  /** Whether the /mcp endpoint may change and delete things, not just read and add. */
  mcpEdit: boolean;
}

export interface TelegramConfig {
  enabled: boolean;
  token: string;
  /** The one private chat this vault talks to. Empty until a pairing code is used. */
  chatId: string;
  /** The one Telegram account allowed to write here — checked on every message. */
  userId?: string;
  userName?: string;
  /** Type that captured messages become. */
  typeId: string;
  botName?: string;
  offset?: number;
  /** Live only while pairing: the code to send, and when it stops being accepted. */
  pairCode?: string;
  pairExpires?: number;
}
export type AutoOp =
  | 'eq'
  | 'ne'
  | 'contains'
  | 'empty'
  | 'notEmpty'
  | 'gt'
  | 'lt'
  | 'before'
  | 'after'
  /** Relative to today, in days — `notInLast` is how "untouched for a week" is said. */
  | 'inLast'
  | 'notInLast';

export interface AutoCondition {
  /** A property id, or `__title` / `__created` / `__updated` for the fields every object has. */
  propId: string;
  op: AutoOp;
  value?: string;
}

export interface AutoAction {
  id: string;
  kind: AutoActionKind;
  typeId?: string;
  propId?: string;
  value?: string;
  text?: string;
  /** Extra property values for `createObject`. */
  props?: { propId: string; value: string }[];
  /** `createObject`: also mention the source object in the new object's body. */
  mention?: boolean;
}

/** One "when this happens, if that holds, do these" rule. Stored as a list in kv. */
export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  trigger: {
    kind: AutoTriggerKind;
    typeId?: string;
    propId?: string;
    op?: AutoOp;
    value?: string;
    time?: string;
    /** Weekly: 0–6, Sunday first. */
    days?: number[];
    /** dueToday: days from today, so -1 is "the day before". */
    offset?: number;
    /**
     * Scheduled rules pointed at a type: run the actions once per matching object
     * instead of once for the whole set. Summary is the default.
     */
    each?: boolean;
  };
  /** All conditions must hold, or any of them when `match` is 'any'. */
  match?: 'all' | 'any';
  conditions: AutoCondition[];
  actions: AutoAction[];
  lastRun?: string;
  lastRunAt?: number;
  runs?: number;
}

export interface UserVar {
  id: string;
  name: string;
  code: string;
}

/**
 * One placed widget. `kind` points at a definition in the widget registry;
 * `w` is columns of the 6-wide grid and `h` is row units, both freely draggable.
 */
export interface DashWidget {
  id: string;
  kind: string;
  w: number;
  h: number;
  config: Record<string, any>;
  /** Pre-grid layouts stored a 'small' | 'medium' | 'large' width — migrated on load. */
  size?: string;
}

export interface DashLayout {
  widgets: DashWidget[];
}

/**
 * Apple's on-device model, if this Mac has it. `reason` is written for the user
 * — "Turn on Apple Intelligence in System Settings" and the like — so it can be
 * shown as-is rather than translated again in the UI.
 */
export interface AiAvailability {
  available: boolean;
  reason?: string;
}

/** One entry in the selection toolbar. The prompt behind it lives in the main process. */
export interface AiAction {
  id: string;
  label: string;
  icon: string;
  /** True when the reply extends the selection instead of replacing it. */
  appends: boolean;
}

/** A run in progress: `delta` is what was just added, `text` the reply so far. */
export interface AiDelta {
  id: string;
  delta: string | null;
  text: string;
}

export interface AiResult {
  ok: boolean;
  text?: string;
  cancelled?: boolean;
  error?: string;
  code?: string;
}

/** One note the answer was built from — enough to name it and open it. */
export interface AiSource {
  id: string;
  title: string;
  typeId: string;
  dateKey: string | null;
}

/** The day or span a question turned out to be about, as the answer names it back. */
export interface AiDates {
  from: string;
  to: string;
  label: string;
}

export interface AiAnswer {
  ok: boolean;
  text?: string;
  cancelled?: boolean;
  sources?: AiSource[];
  dates?: AiDates | null;
  error?: string;
  code?: string;
}
