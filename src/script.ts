import { api } from './api';
import { todayKey } from './util';

const slim = (o: any) => ({ id: o.id, title: o.title, typeId: o.typeId, props: o.props, updatedAt: o.updatedAt });

/**
 * The `habitat` object handed to user scripts — slash variables and custom dashboard widgets.
 * Everything that touches data is async; `today()` is not.
 */
export function scriptApi() {
  return {
    count: async (typeId?: string) => (await api.objects.list(typeId)).length,
    objects: async (typeId?: string) => (await api.objects.list(typeId)).map(slim),
    search: async (q: string) => (await api.objects.search(q)).map(slim),
    types: async () => (await api.types.list()).map((t) => ({ id: t.id, name: t.name })),
    tags: async () => (await api.tags.list()).map((t) => ({ id: t.id, name: t.title, uses: t.uses })),
    tasks: async (dateKey?: string) => (await api.tasks.forDay(dateKey || todayKey())).map(slim),
    recent: async () => (await api.stats()).recent.map(slim),
    pinned: async () => (await api.stats()).pinned.map(slim),
    counts: async () => (await api.stats()).counts,
    daily: async (dateKey?: string) => {
      const d = await api.daily.get(dateKey || todayKey());
      return d ? slim(d) : null;
    },
    me: async () => (await api.profile.get())?.name ?? '',
    today: () => todayKey(),
  };
}

export type ScriptApi = ReturnType<typeof scriptApi>;

export const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/** Run a user variable: a JS expression, or a full body if it contains `return`. */
export async function evalCode(code: string): Promise<string> {
  try {
    const fn = /\breturn\b/.test(code)
      ? new AsyncFunction('habitat', code)
      : new AsyncFunction('habitat', 'return (' + code + ')');
    const v = await fn(scriptApi());
    return String(await Promise.resolve(v));
  } catch (e: any) {
    return '⚠ ' + (e?.message || 'error in variable');
  }
}
