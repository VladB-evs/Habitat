import type {
  CalEntry,
  CanvasDoc,
  CanvasEdge,
  CanvasItem,
  CanvasItemData,
  CanvasMeta,
  CanvasSummary,
  Card,
  CardKind,
  DailyMeta,
  DashLayout,
  Deck,
  DeckConfig,
  DeckCounts,
  FileRef,
  NewCanvasItem,
  ObjectCard,
  ParsedCard,
  Rating,
  Side,
  StudyNote,
  StudyOverview,
  StudyQueue,
  Obj,
  ObjType,
  Person,
  PersonFieldGroup,
  PropDef,
  Agenda,
  SettingsInfo,
  Stats,
  TagObj,
  Template,
  UserVar,
} from './types';
import type { Automation, HttpApiConfig, SyncConfig, SyncStatus, TelegramConfig, UpdateState } from './types';
import type { AiAction, AiAnswer, AiAvailability, AiDelta, AiResult } from './types';

declare global {
  interface Window {
    /** Absent outside Electron — a browser tab goes through the dev bridge below. */
    habitat?: {
      invoke: (channel: string, payload?: any) => Promise<any>;
      onUpdateState?: (fn: (state: UpdateState) => void) => () => void;
      onAiDelta?: (fn: (msg: AiDelta) => void) => () => void;
      onSyncState?: (fn: (state: SyncStatus) => void) => () => void;
    };
  }
}

/**
 * The one seam between the UI and the vault.
 *
 * Inside Electron this is the preload bridge. Opened in a plain browser —
 * which is how the app gets checked at a phone-sized viewport, since a
 * BrowserWindow cannot be resized to 390px usefully — it falls back to the
 * dev bridge in electron/devbridge.js over HTTP.
 *
 * The Capacitor build lands here too: one more branch, pointing at whatever
 * the native shell exposes. Nothing above this line has to know.
 */
const env = (import.meta as any).env ?? {};

/**
 * Where the vault is.
 *
 * Unset — a browser tab on this machine — it is the dev bridge on localhost.
 * Set at build time it is a Habitat running elsewhere, which is how the iOS
 * build works: a webview has no Node and no SQLite, so the phone talks to the
 * Mac over the network and the Mac's bridge wants a token.
 *
 *   VITE_HABITAT_BRIDGE=http://192.168.1.20:37380
 *   VITE_HABITAT_TOKEN=…
 *
 * Both are printed by `npm run bridge`.
 */
const DEV_BRIDGE: string = env.VITE_HABITAT_BRIDGE || 'http://127.0.0.1:37380';
const BRIDGE_TOKEN: string = env.VITE_HABITAT_TOKEN || '';

const viaBridge = async (channel: string, payload?: any) => {
  const res = await fetch(DEV_BRIDGE, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(BRIDGE_TOKEN ? { authorization: `Bearer ${BRIDGE_TOKEN}` } : {}),
    },
    body: JSON.stringify({ channel, payload }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || `dev bridge: ${res.status}`);
  return body?.value ?? null;
};

const inv = (channel: string, payload?: any) =>
  window.habitat ? window.habitat.invoke(channel, payload) : viaBridge(channel, payload);

export const api = {
  types: {
    list: (): Promise<ObjType[]> => inv('types:list'),
    create: (p: { name: string; icon?: string; color?: string }): Promise<ObjType> => inv('types:create', p),
    update: (
      id: string,
      patch: Partial<Pick<ObjType, 'name' | 'icon' | 'color' | 'starred'>> & { properties?: PropDef[] }
    ): Promise<ObjType> => inv('types:update', { id, patch }),
    remove: (id: string): Promise<boolean> => inv('types:delete', id),
  },
  objects: {
    list: (typeId?: string): Promise<Obj[]> => inv('objects:list', { typeId }),
    get: (id: string): Promise<Obj | null> => inv('objects:get', id),
    create: (p: { typeId: string; title?: string; props?: Record<string, any>; content?: any; dateKey?: string }): Promise<Obj> =>
      inv('objects:create', p),
    update: (
      id: string,
      patch: { title?: string; props?: Record<string, any>; content?: any; pinned?: boolean; extraProps?: PropDef[] }
    ): Promise<Obj> => inv('objects:update', { id, patch }),
    /**
     * Move an object to another type. Values the new type also defines carry
     * over; the rest are kept on the object as extra properties.
     */
    setType: (id: string, typeId: string): Promise<Obj | { error: string }> => inv('objects:setType', { id, typeId }),
    remove: (id: string): Promise<boolean> => inv('objects:delete', id),
    /** `content: true` also searches inside every note's text, daily entries included. */
    search: (q: string, opts?: { content?: boolean }): Promise<Obj[]> =>
      inv('objects:search', { q, content: !!opts?.content }),
    createFromTemplate: (templateId: string): Promise<Obj | null> => inv('objects:createFromTemplate', templateId),
    bulkRemove: (ids: string[]): Promise<{ deleted: number }> => inv('objects:bulkDelete', ids),
    bulkSetProp: (ids: string[], propId: string, value: any): Promise<{ changed: number }> =>
      inv('objects:bulkSetProp', { ids, propId, value }),
  },
  templates: {
    list: (typeId: string): Promise<Template[]> => inv('templates:list', { typeId }),
    get: (id: string): Promise<Template | null> => inv('templates:get', id),
    create: (p: { typeId: string; name?: string }): Promise<Template> => inv('templates:create', p),
    update: (
      id: string,
      patch: { name?: string; props?: Record<string, any>; content?: any; extraProps?: PropDef[] }
    ): Promise<Template> => inv('templates:update', { id, patch }),
    remove: (id: string): Promise<boolean> => inv('templates:delete', id),
  },
  tasks: {
    forDay: (dateKey: string): Promise<Obj[]> => inv('tasks:forDay', { dateKey }),
    /**
     * Tick something off. `dayKey` matters for a repeating task: it marks that
     * day done rather than ending the series.
     */
    setDone: (p: { id: string; dayKey?: string | null; done: boolean }): Promise<Obj | null> =>
      inv('tasks:setDone', p),
    /** Days, each with what happens on it, plus what's late and what's unplanned. */
    agenda: (from: string, days = 21): Promise<Agenda> => inv('agenda:range', { from, days }),
  },
  /** Everything happening between two day keys, across every type. */
  calendar: (from: string, to: string): Promise<CalEntry[]> => inv('calendar:range', { from, to }),
  /**
   * Drag on the grid: `startMinute` null parks it in the all-day strip. Dragging
   * one day of a series moves only that day unless `scope` says otherwise, and
   * the object it returns is then the new one that day became.
   */
  reschedule: (p: {
    id: string;
    dayKey: string;
    startMinute?: number | null;
    minutes?: number | null;
    occurrence?: string | null;
    scope?: 'one' | 'all';
  }): Promise<Obj | null> => inv('calendar:reschedule', p),
  scheduleNew: (p: {
    typeId: string;
    title: string;
    dayKey: string;
    startMinute: number;
    minutes?: number;
    repeat?: string | null;
  }): Promise<Obj | null> => inv('calendar:create', p),
  /** Drop one day from a series and leave the rest of it running. */
  skipOccurrence: (p: { id: string; dayKey: string }): Promise<boolean> => inv('calendar:skip', p),
  daily: {
    get: (dateKey: string): Promise<Obj | null> => inv('daily:get', { dateKey }),
    create: (dateKey: string, content: any): Promise<Obj> => inv('daily:create', { dateKey, content }),
    list: (): Promise<DailyMeta[]> => inv('daily:list'),
  },
  backlinks: (id: string): Promise<Obj[]> => inv('backlinks:list', id),
  stats: (): Promise<Stats> => inv('stats:get'),
  /**
   * Boards. Geometry is written through `moveItems` in one batch per drag rather
   * than a call per card, so dragging a selection of forty stays one round trip.
   */
  canvas: {
    list: (): Promise<CanvasSummary[]> => inv('canvas:list'),
    create: (p?: { name?: string; icon?: string; color?: string }): Promise<CanvasMeta> => inv('canvas:create', p ?? {}),
    get: (id: string): Promise<CanvasDoc | null> => inv('canvas:get', id),
    patch: (id: string, patch: Partial<Pick<CanvasMeta, 'name' | 'icon' | 'color' | 'view'>>): Promise<CanvasMeta | null> =>
      inv('canvas:patch', { id, patch }),
    remove: (id: string): Promise<boolean> => inv('canvas:delete', id),
    addItems: (canvasId: string, items: NewCanvasItem[]): Promise<CanvasItem[]> => inv('canvas:addItems', { canvasId, items }),
    moveItems: (canvasId: string, items: { id: string; x: number; y: number; w: number; h: number }[]): Promise<boolean> =>
      inv('canvas:moveItems', { canvasId, items }),
    patchItem: (id: string, patch: Partial<Pick<CanvasItem, 'x' | 'y' | 'w' | 'h'>> & { data?: CanvasItemData }): Promise<CanvasItem | null> =>
      inv('canvas:patchItem', { id, patch }),
    removeItems: (canvasId: string, ids: string[]): Promise<boolean> => inv('canvas:removeItems', { canvasId, ids }),
    /** Ids in the order they should stack, bottom first. */
    order: (canvasId: string, ids: string[]): Promise<boolean> => inv('canvas:order', { canvasId, ids }),
    addEdge: (p: {
      canvasId: string;
      from: string;
      to: string;
      fromSide?: Side;
      toSide?: Side;
      label?: string;
      color?: string | null;
    }): Promise<CanvasEdge | null> => inv('canvas:addEdge', p),
    patchEdge: (id: string, patch: Partial<Omit<CanvasEdge, 'id' | 'from' | 'to'>>): Promise<CanvasEdge | null> =>
      inv('canvas:patchEdge', { id, patch }),
    removeEdge: (id: string): Promise<boolean> => inv('canvas:removeEdge', id),
    /** Undo's one move: put the board back exactly as it was, ids intact. */
    replace: (canvasId: string, items: CanvasItem[], edges: CanvasEdge[]): Promise<boolean> =>
      inv('canvas:replace', { canvasId, items, edges }),
    /** The boards an object appears on, for its page's backlinks area. */
    forObject: (id: string): Promise<{ id: string; name: string; icon: string; color: string }[]> => inv('canvas:forObject', id),
  },
  /**
   * Flashcards and their schedule. The scheduler lives in the main process, so
   * what a button will do is decided in one place — the renderer only ever shows
   * the intervals it is handed back.
   */
  study: {
    overview: (): Promise<StudyOverview> => inv('study:overview'),
    decks: (): Promise<Deck[]> => inv('study:decks'),
    deckCreate: (p: { name?: string; icon?: string; color?: string; lang?: string; config?: DeckConfig }): Promise<Deck> =>
      inv('study:deckCreate', p),
    deckPatch: (id: string, patch: Partial<Pick<Deck, 'name' | 'icon' | 'color' | 'lang'>> & { config?: DeckConfig }): Promise<Deck | null> =>
      inv('study:deckPatch', { id, patch }),
    deckDelete: (id: string): Promise<boolean> => inv('study:deckDelete', id),
    /** What to show next. No `deckId` studies every deck at once. */
    queue: (p?: { deckId?: string; limit?: number }): Promise<StudyQueue> => inv('study:queue', p ?? {}),
    answer: (p: { id: string; rating: Rating; ms?: number }): Promise<{ card: Card; counts: DeckCounts } | null> =>
      inv('study:answer', p),
    /** Take back the most recent answer, wherever it was given. */
    undo: (): Promise<Card | null> => inv('study:undo'),
    cards: (p?: { deckId?: string; q?: string; limit?: number }): Promise<Card[]> => inv('study:cards', p ?? {}),
    cardCreate: (p: { deckId: string; front: string; back: string; hint?: string; kind?: CardKind; objId?: string }): Promise<Card | null> =>
      inv('study:cardCreate', p),
    cardPatch: (
      id: string,
      patch: Partial<Pick<Card, 'front' | 'back' | 'hint' | 'deckId' | 'suspended'>> & { reset?: boolean }
    ): Promise<Card | null> => inv('study:cardPatch', { id, patch }),
    cardDelete: (id: string): Promise<boolean> => inv('study:cardDelete', id),
    /**
     * Text into cards. `dry: true` returns what it found without writing, which
     * is what the import preview is built on.
     */
    cardsFromText: (p: { deckId?: string; text: string; objId?: string; noteId?: string; dry?: boolean }): Promise<ParsedCard[] | Card[]> =>
      inv('study:cardsFromText', p),
    /**
     * A word. One card unless the deck asks both ways — nothing is written to
     * the vault, and no object type is created.
     */
    vocabAdd: (p: {
      term: string;
      meaning: string;
      reading?: string;
      example?: string;
      language?: string;
      deckId?: string;
    }): Promise<{ deck: Deck; cards: Card[] } | null> => inv('study:vocabAdd', p),
    languages: (): Promise<string[]> => inv('study:languages'),
    /** Class notes, kept inside Study rather than as objects in the vault. */
    notes: (): Promise<StudyNote[]> => inv('study:notes'),
    noteGet: (id: string): Promise<StudyNote | null> => inv('study:noteGet', id),
    noteCreate: (p?: { title?: string; body?: string; deckId?: string }): Promise<StudyNote> => inv('study:noteCreate', p ?? {}),
    /** Properties merge; setting one to an empty string removes it. */
    notePatch: (id: string, patch: Partial<Pick<StudyNote, 'title' | 'body' | 'deckId' | 'props'>>): Promise<StudyNote | null> =>
      inv('study:notePatch', { id, patch }),
    noteDelete: (id: string): Promise<boolean> => inv('study:noteDelete', id),
    /**
     * What a note could become, or — without `dry` — what it becomes. A second
     * pass only adds lines the note hasn't already turned into cards.
     */
    noteToCards: (p: {
      noteId: string;
      deckId?: string;
      deckName?: string;
      dry?: boolean;
    }): Promise<{ cards: ParsedCard[] | Card[]; deck: Deck | null }> => inv('study:noteToCards', p),
    history: (days?: number): Promise<{ day: string; n: number; again: number }[]> => inv('study:history', { days }),
  },
  dashboard: {
    /** `null` when the user has never customised it — callers install the default layout. */
    get: (): Promise<DashLayout | null> => inv('dashboard:get'),
    save: (layout: DashLayout): Promise<boolean> => inv('dashboard:save', layout),
    reset: (): Promise<boolean> => inv('dashboard:reset'),
  },
  settings: {
    get: (): Promise<SettingsInfo> => inv('settings:get'),
    chooseVault: (): Promise<{ dbPath: string; changed: boolean; existed: boolean } | null> => inv('settings:chooseVault'),
    reveal: (): Promise<boolean> => inv('settings:reveal'),
  },
  spellcheck: {
    get: (): Promise<boolean> => inv('spellcheck:get'),
    set: (enabled: boolean): Promise<boolean> => inv('spellcheck:set', enabled),
  },
  window: {
    /** macOS only: hide the close/minimise/zoom buttons while the sidebar is collapsed. */
    trafficLights: (visible: boolean): Promise<boolean> => inv('window:trafficLights', visible),
  },
  files: {
    /** Takes bytes into the vault's store and returns the reference to embed. */
    add: (f: { name: string; mime: string; data: Uint8Array; width?: number | null; height?: number | null }): Promise<FileRef> =>
      inv('files:add', f),
    get: (hash: string): Promise<FileRef | null> => inv('files:get', hash),
    /** Native picker; the chosen files are stored and returned as references. */
    pick: (opts?: { images?: boolean }): Promise<FileRef[]> => inv('files:pick', opts ?? {}),
    stats: (): Promise<{ count: number; bytes: number; unusedCount: number; unusedBytes: number; dir: string }> =>
      inv('files:stats'),
    /** Deletes every stored file nothing points at any more. */
    gc: (): Promise<{ removed: number; freed: number }> => inv('files:gc'),
    reveal: (hash: string): Promise<boolean> => inv('files:reveal', hash),
    open: (hash: string): Promise<boolean> => inv('files:open', hash),
    saveAs: (hash: string): Promise<boolean> => inv('files:saveAs', hash),
  },
  kv: {
    get: (key: string): Promise<string | null> => inv('kv:get', key),
    set: (key: string, value: string | null): Promise<boolean> => inv('kv:set', { key, value }),
  },
  automations: {
    list: (): Promise<Automation[]> => inv('automations:list'),
    save: (list: Automation[]): Promise<boolean> => inv('automations:save', list),
    /** Runs a rule immediately, ignoring its schedule; returns how many objects it touched. */
    run: (id: string): Promise<{ ran: number }> => inv('automations:run', id),
    /** What a scheduled rule would act on right now — used for the live preview, changes nothing. */
    preview: (rule: Automation): Promise<{ scoped: boolean; count: number; titles: string[] }> =>
      inv('automations:preview', rule),
  },
  habitat: {
    code: (): Promise<string> => inv('habitat:code'),
  },
  app: {
    info: (): Promise<{ appDir: string; version: string }> => inv('app:info'),
  },
  updates: {
    state: (): Promise<UpdateState> => inv('update:state'),
    check: (): Promise<UpdateState> => inv('update:check'),
    /** Quits and relaunches into the downloaded version. */
    install: (): Promise<boolean> => inv('update:install'),
    onState: (fn: (s: UpdateState) => void) => window.habitat?.onUpdateState?.(fn) ?? (() => {}),
  },
  http: {
    config: (): Promise<HttpApiConfig> => inv('api:config'),
    save: (cfg: Partial<HttpApiConfig>): Promise<HttpApiConfig> => inv('api:save', cfg),
    /** Starts or stops the server to match the saved settings. */
    apply: (): Promise<{ ok: boolean; running: boolean; port?: number; error?: string }> => inv('api:apply'),
    status: (): Promise<{ running: boolean; port: number }> => inv('api:status'),
  },
  /**
   * The vault's copy in the cloud. Every call here is about the arrangement —
   * signing in, forcing a cycle — never about the data itself: syncing is the
   * main process's business and the renderer only ever watches it happen.
   */
  sync: {
    status: (): Promise<SyncStatus> => inv('sync:status'),
    /** Sync right now rather than waiting for the next two-minute tick. */
    now: (): Promise<SyncStatus> => inv('sync:now'),
    signIn: (email: string, password: string): Promise<SyncStatus> => inv('sync:signIn', { email, password }),
    signOut: (): Promise<SyncStatus> => inv('sync:signOut'),
    config: (): Promise<SyncConfig> => inv('sync:config'),
    saveConfig: (patch: Partial<SyncConfig>): Promise<SyncConfig> => inv('sync:saveConfig', patch),
    onState: (fn: (s: SyncStatus) => void): (() => void) => window.habitat?.onSyncState?.(fn) ?? (() => {}),
  },
  telegram: {
    get: (): Promise<TelegramConfig> => inv('telegram:get'),
    save: (cfg: Partial<TelegramConfig>): Promise<TelegramConfig> => inv('telegram:save', cfg),
    /** Verifies the token and sends a hello; also learns the bot's username. */
    test: (): Promise<{ ok: boolean; bot?: string; error?: string }> => inv('telegram:test'),
    poll: (): Promise<void> => inv('telegram:poll'),
    /** Mints a pairing code and clears the current link until that code is sent to the bot. */
    pair: (): Promise<TelegramConfig> => inv('telegram:pair'),
    unpair: (): Promise<TelegramConfig> => inv('telegram:unpair'),
  },
  vars: {
    list: (): Promise<UserVar[]> => inv('vars:list'),
    save: (list: UserVar[]): Promise<boolean> => inv('vars:save', list),
  },
  profile: {
    get: (): Promise<{ name: string } | null> => inv('profile:get'),
  },
  people: {
    list: (): Promise<Person[]> => inv('people:list'),
    get: (id: string): Promise<Person | null> => inv('people:get', id),
    /** `self: true` claims the user's own card, and only when there isn't one yet. */
    create: (p: { title?: string; props?: Record<string, any>; self?: boolean }): Promise<Person> => inv('people:create', p),
    /** The user's own card, or `null` if they haven't made one. */
    self: (): Promise<Person | null> => inv('people:self'),
    birthdays: (within = 60): Promise<Person[]> => inv('people:birthdays', { within }),
    /** The catalogue of optional details a person can be given. */
    fields: (): Promise<PersonFieldGroup[]> => inv('people:fields'),
  },
  importObsidian: (
    mode: 'vault' | 'daily'
  ): Promise<{
    daily: number;
    notes: number;
    skipped: number;
    tags: number;
    links: number;
    scanned: number;
    folders: number;
    dir: string;
    undated: number;
    undatedSample: string[];
  } | null> => inv('import:obsidianVault', { mode }),
  /**
   * Writes the vault out. `markdown` is a readable folder that imports back;
   * `json` is one exact file. Neither includes the API or Telegram tokens.
   */
  exportVault: (
    format: 'markdown' | 'json'
  ): Promise<{ format: string; path: string; objects: number; types: number; files: number } | { error: string } | null> =>
    inv('export:vault', { format }),
  tags: {
    list: (): Promise<TagObj[]> => inv('tags:list'),
    search: (q: string): Promise<Obj[]> => inv('tags:search', q),
    ensure: (name: string): Promise<Obj | null> => inv('tags:ensure', name),
    remove: (id: string): Promise<{ ok: boolean; touched: number }> => inv('tags:delete', id),
  },
  habitats: {
    pickFolder: (): Promise<string | null> => inv('habitats:pickFolder'),
    create: (p: {
      name: string;
      flavor: string;
      dir?: string;
    }): Promise<{ id: string; dbPath: string } | { error: string }> => inv('habitats:create', p),
    switchTo: (id: string): Promise<{ id: string; dbPath: string } | null> => inv('habitats:switch', { id }),
    /** Adopts a habitat that already exists on disk, e.g. one synced from another machine. */
    open: (): Promise<{ id: string; name: string; dbPath: string } | { error: string } | null> => inv('habitats:open'),
    onboard: (p: {
      name: string;
      flavor: string;
      userName?: string;
      people?: { name: string; nickname?: string }[];
      dir?: string;
    }): Promise<boolean> => inv('habitats:onboard', p),
    remove: (id: string): Promise<{ ok: boolean; onboarding?: boolean; activeId?: string } | null> =>
      inv('habitats:delete', { id }),
  },
  /**
   * Apple's on-device model. Everything here runs locally and offline; nothing
   * is sent anywhere. What it can't do is hold much at once, so `run` refuses
   * long selections rather than failing halfway.
   */
  ai: {
    availability: (): Promise<AiAvailability> => inv('ai:availability'),
    actions: (): Promise<AiAction[]> => inv('ai:actions'),
    /** Loads the model ahead of the first click. Fire and forget. */
    prewarm: (): Promise<boolean> => inv('ai:prewarm'),
    run: (p: { id: string; action: string; text: string }): Promise<AiResult> => inv('ai:run', p),
    cancel: (id: string): Promise<boolean> => inv('ai:cancel', id),
    /**
     * A question about the vault, answered from it. Which notes were read is
     * decided here in code — never by the model — and comes back as `sources`
     * so the answer can be checked against what it was built from.
     */
    ask: (p: { id: string; question: string }): Promise<AiAnswer> => inv('ai:ask', p),
    /**
     * Plain English into the search bar's own operator syntax, e.g. "tasks about
     * the calendar due this week" → `type:task due:week calendar`. Returns the
     * query rather than the results, so the palette can show its working.
     */
    search: (text: string): Promise<{ ok: boolean; query?: string; error?: string }> =>
      inv('ai:search', { text }),
    /** Watch a run being written. Returns an unsubscribe. */
    onDelta: (fn: (msg: AiDelta) => void): (() => void) => window.habitat?.onAiDelta?.(fn) ?? (() => {}),
  },
};
