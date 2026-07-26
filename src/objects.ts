import { api } from './api';
import type { Obj } from './types';

/**
 * Mention chips all over the app need the same objects, so fetches are shared and
 * cached. Anything that edits an object calls `objectChanged` — that drops the cache
 * entry and wakes every view showing it, which is how ticking a task inside a note
 * updates the task lists too.
 */
const cache = new Map<string, Promise<Obj | null>>();

type Listener = (id: string) => void;
const listeners = new Set<Listener>();

export function getObject(id: string): Promise<Obj | null> {
  let p = cache.get(id);
  if (!p) {
    p = api.objects.get(id).catch(() => {
      cache.delete(id); // don't let one failure stick around as a permanent null
      return null;
    });
    cache.set(id, p);
  }
  return p;
}

export function objectChanged(id: string) {
  cache.delete(id);
  for (const l of listeners) l(id);
}

export function onObjectChanged(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
