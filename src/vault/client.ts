let worker: Worker | null = null;
let reqId = 1;
const pending = new Map<number, { resolve: (val: any) => void; reject: (err: any) => void }>();
const syncListeners: Array<(state: any) => void> = [];

export function isStandalone(): boolean {
  // 1. If running inside Electron, window.habitat exists -> desktop Electron
  if (typeof window !== 'undefined' && (window as any).habitat) return false;

  // 2. Capacitor native shell (iOS/Android) -> standalone mobile vault
  if (typeof window !== 'undefined' && ((window as any).Capacitor || (window as any).webkit?.messageHandlers)) {
    return true;
  }

  // 3. User toggle or fallback
  if (typeof localStorage !== 'undefined' && localStorage.getItem('habitat_standalone') === 'true') {
    return true;
  }

  // 4. Default: If no dev bridge configured and not in Electron, use local standalone worker
  const bridge = (import.meta as any).env?.VITE_HABITAT_BRIDGE;
  return !bridge;
}

export function getVaultWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent) => {
      const data = e.data;
      if (!data) return;

      if (data.type === 'sync:state') {
        for (const fn of syncListeners) {
          try {
            fn(data.state);
          } catch (err) {
            console.error('[worker] syncListener error:', err);
          }
        }
        return;
      }

      const { id, ok, value, error } = data;
      const p = pending.get(id);
      if (p) {
        pending.delete(id);
        if (ok) p.resolve(value);
        else p.reject(new Error(error || 'Worker request failed'));
      }
    };

    worker.onerror = (err) => {
      console.error('[worker error]', err);
    };
  }
  return worker;
}

export function invokeWorker(channel: string, payload?: any): Promise<any> {
  const w = getVaultWorker();
  const id = reqId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, channel, payload });
  });
}

export function onWorkerSyncState(fn: (state: any) => void): () => void {
  syncListeners.push(fn);
  return () => {
    const idx = syncListeners.indexOf(fn);
    if (idx >= 0) syncListeners.splice(idx, 1);
  };
}
