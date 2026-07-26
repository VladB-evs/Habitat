import type {
  DailyMeta,
  DashLayout,
  GraphData,
  Obj,
  ObjType,
  PropDef,
  SettingsInfo,
  Stats,
  TagObj,
  Template,
  UserVar,
} from './types';
import type { Automation, HttpApiConfig, TelegramConfig, UpdateState } from './types';

declare global {
  interface Window {
    habitat: {
      invoke: (channel: string, payload?: any) => Promise<any>;
      onUpdateState?: (fn: (state: UpdateState) => void) => () => void;
    };
  }
}

const inv = (channel: string, payload?: any) => window.habitat.invoke(channel, payload);

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
  },
  daily: {
    get: (dateKey: string): Promise<Obj | null> => inv('daily:get', { dateKey }),
    create: (dateKey: string, content: any): Promise<Obj> => inv('daily:create', { dateKey, content }),
    list: (): Promise<DailyMeta[]> => inv('daily:list'),
  },
  backlinks: (id: string): Promise<Obj[]> => inv('backlinks:list', id),
  graph: (): Promise<GraphData> => inv('graph:data'),
  stats: (): Promise<Stats> => inv('stats:get'),
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
  window: {
    /** macOS only: hide the close/minimise/zoom buttons while the sidebar is collapsed. */
    trafficLights: (visible: boolean): Promise<boolean> => inv('window:trafficLights', visible),
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
    onState: (fn: (s: UpdateState) => void) => window.habitat.onUpdateState?.(fn) ?? (() => {}),
  },
  http: {
    config: (): Promise<HttpApiConfig> => inv('api:config'),
    save: (cfg: Partial<HttpApiConfig>): Promise<HttpApiConfig> => inv('api:save', cfg),
    /** Starts or stops the server to match the saved settings. */
    apply: (): Promise<{ ok: boolean; running: boolean; port?: number; error?: string }> => inv('api:apply'),
    status: (): Promise<{ running: boolean; port: number }> => inv('api:status'),
  },
  telegram: {
    get: (): Promise<TelegramConfig> => inv('telegram:get'),
    save: (cfg: Partial<TelegramConfig>): Promise<TelegramConfig> => inv('telegram:save', cfg),
    /** Verifies the token and sends a hello; also learns the bot's username. */
    test: (): Promise<{ ok: boolean; bot?: string; error?: string }> => inv('telegram:test'),
    poll: (): Promise<void> => inv('telegram:poll'),
  },
  vars: {
    list: (): Promise<UserVar[]> => inv('vars:list'),
    save: (list: UserVar[]): Promise<boolean> => inv('vars:save', list),
  },
  profile: {
    get: (): Promise<{ name: string } | null> => inv('profile:get'),
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
};
