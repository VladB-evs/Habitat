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
  | 'relation';

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

export interface GraphData {
  nodes: { id: string; title: string; typeId: string }[];
  edges: { from: string; to: string }[];
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
}

export interface TelegramConfig {
  enabled: boolean;
  token: string;
  chatId: string;
  /** Type that captured messages become. */
  typeId: string;
  botName?: string;
  offset?: number;
}
export type AutoOp = 'eq' | 'ne' | 'contains' | 'empty' | 'notEmpty' | 'gt' | 'lt';

export interface AutoCondition {
  /** A property id, or `__title` for the object's name. */
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
