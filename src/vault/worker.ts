import { initSqlite } from './sqlite';
// @ts-ignore
import dbModule from '../../electron/db.js';
// @ts-ignore
import { createSync, createLanTransport } from '../../electron/sync.js';

let initialized = false;
let initError: Error | null = null;
let lanSyncInstance: any = null;

const db = dbModule.default || dbModule;

// Extra handlers matching what main.js handles on desktop
const extraHandlers: Record<string, (p?: any) => any> = {
  'app:info': () => ({ appDir: 'opfs', version: '0.1.21-mobile' }),
  'settings:get': () => {
    const isDone = db.api['kv:get']('mobile:onboarded') === 'true';
    const aura = db.api['kv:get']('habitat:aura') || undefined;
    const name = db.api['kv:get']('habitat:name') || 'Mobile Vault';
    return {
      dbPath: 'habitat.db',
      activeId: 'default',
      onboarded: isDone,
      habitats: [{ id: 'default', name, aura, active: true }],
    };
  },
  'window:trafficLights': () => true,
  'spellcheck:get': () => false,
  'spellcheck:set': () => false,
  'ai:availability': () => ({ available: false }),
  'ai:actions': () => [],
  'ai:prewarm': () => false,
  'ai:run': () => ({ ok: false, error: 'Local AI model not available on mobile yet' }),
  'ai:ask': () => ({ ok: false, answer: 'Local AI model not available on mobile yet', sources: [] }),
  'ai:search': ({ text }: { text: string }) => ({ ok: true, query: text }),
  'automations:startup': () => ({ ok: true }),
  'habitats:create': (p?: any) => {
    db.api['kv:set']({ key: 'mobile:onboarded', value: 'true' });
    if (p?.name) db.api['kv:set']({ key: 'habitat:name', value: p.name });
    if (p?.aura) db.api['kv:set']({ key: 'habitat:aura', value: p.aura });
    return { id: 'default', dbPath: 'habitat.db' };
  },
  'habitats:update': () => ({ ok: true }),
  'habitats:switch': () => ({ id: 'default', dbPath: 'habitat.db' }),
  'habitats:onboard': (p?: any) => {
    db.api['kv:set']({ key: 'mobile:onboarded', value: 'true' });
    if (p?.name) db.api['kv:set']({ key: 'habitat:name', value: p.name });
    if (p?.aura) db.api['kv:set']({ key: 'habitat:aura', value: p.aura });
    if (p?.userName) db.api['kv:set']({ key: 'userName', value: p.userName });
    return true;
  },
  'habitats:delete': () => ({ ok: true }),
};

async function ensureBooted() {
  if (initialized) return;
  if (initError) throw initError;

  try {
    console.log('[worker] Initializing SQLite WASM...');
    await initSqlite();
    console.log('[worker] Opening vault habitat.db...');
    db.openVault('habitat.db');
    console.log('[worker] Vault opened successfully!');

    // Restore saved LAN transport if configured
    try {
      const savedUrl = db.api['kv:get']('lanSync:baseUrl');
      const savedToken = db.api['kv:get']('lanSync:token') || '';
      if (savedUrl) {
        const transport = createLanTransport({ baseUrl: savedUrl, token: savedToken });
        lanSyncInstance = initLanSync(transport);
        console.log('[worker] Restored LAN sync transport to', savedUrl);
      }
    } catch (e) {
      console.warn('[worker] Could not restore saved LAN transport:', e);
    }

    initialized = true;
  } catch (err: any) {
    console.error('[worker] Boot failure:', err);
    initError = err;
    throw err;
  }
}

let autoSyncTimer: any = null;

function startAutoSync() {
  if (autoSyncTimer) return;
  autoSyncTimer = setInterval(async () => {
    if (lanSyncInstance && lanSyncInstance.state().status === 'idle') {
      try {
        await lanSyncInstance.run();
        self.postMessage({ type: 'sync:state', state: lanSyncInstance.state() });
      } catch {
        // Silent background retry if offline / away from Wi-Fi
      }
    }
  }, 25000);
}

function initLanSync(transport: any) {
  const sync = createSync({
    store: db.sync,
    transport,
    onState: (state: any) => {
      self.postMessage({ type: 'sync:state', state });
    },
  });
  startAutoSync();
  setTimeout(() => {
    sync.run().catch(() => {});
  }, 1200);
  return sync;
}

// Handler for incoming postMessage from the main thread
self.onmessage = async (e: MessageEvent) => {
  const { id, channel, payload } = e.data || {};
  if (!id && !channel) return;

  try {
    await ensureBooted();

    if (channel === 'vault:init') {
      self.postMessage({ id, ok: true, value: { ready: true } });
      return;
    }

    if (channel === 'sync:cloneFromMac') {
      const { baseUrl, token } = payload || {};
      if (!baseUrl) throw new Error('Mac address is required');
      const transport = createLanTransport({ baseUrl, token });
      console.log('[worker] Cloning vault snapshot from', baseUrl);
      const snap = await transport.snapshot();
      db.sync.applySnapshot(snap);
      lanSyncInstance = initLanSync(transport);
      db.api['kv:set']({ key: 'lanSync:baseUrl', value: baseUrl });
      db.api['kv:set']({ key: 'lanSync:token', value: token || '' });
      db.api['kv:set']({ key: 'mobile:onboarded', value: 'true' });
      self.postMessage({ id, ok: true, value: { cloned: true, snapshotSeq: snap.snapshotSeq } });
      return;
    }

    if (channel === 'sync:lanConfig') {
      // Configure and optionally trigger LAN sync
      const { baseUrl, token, autoSync } = payload || {};
      if (baseUrl) {
        const transport = createLanTransport({ baseUrl, token });
        lanSyncInstance = initLanSync(transport);
        db.api['kv:set']({ key: 'lanSync:baseUrl', value: baseUrl });
        db.api['kv:set']({ key: 'lanSync:token', value: token || '' });
        if (autoSync) {
          try {
            await lanSyncInstance.run();
            self.postMessage({ type: 'sync:state', state: lanSyncInstance.state() });
          } catch (err: any) {
            console.warn('[worker] LAN auto-sync error:', err);
          }
        }
      }
      self.postMessage({ id, ok: true, value: { configured: !!baseUrl } });
      return;
    }

    if (channel === 'sync:getLanConfig') {
      const baseUrl = db.api['kv:get']('lanSync:baseUrl');
      const token = db.api['kv:get']('lanSync:token');
      self.postMessage({ id, ok: true, value: { baseUrl: baseUrl || '', token: token || '' } });
      return;
    }

    if (channel === 'sync:now') {
      if (lanSyncInstance) {
        await lanSyncInstance.run();
        const status = lanSyncInstance.state();
        self.postMessage({ type: 'sync:state', state: status });
        self.postMessage({ id, ok: true, value: status });
        return;
      }
      // If no LAN transport configured yet:
      const status = {
        status: 'idle',
        lastCycle: null,
        error: 'No sync target configured. Connect to Mac in settings.',
        uploaded: 0,
        downloaded: 0,
        pending: db.sync?.pendingCount ? db.sync.pendingCount() : 0,
      };
      self.postMessage({ id, ok: true, value: status });
      return;
    }

    if (channel === 'sync:status') {
      if (lanSyncInstance) {
        self.postMessage({ id, ok: true, value: lanSyncInstance.state() });
        return;
      }
      self.postMessage({
        id,
        ok: true,
        value: {
          status: 'idle',
          lastCycle: null,
          error: null,
          uploaded: 0,
          downloaded: 0,
          pending: db.sync?.pendingCount ? db.sync.pendingCount() : 0,
        },
      });
      return;
    }

    const handler = db.api[channel] || extraHandlers[channel];
    if (typeof handler !== 'function') {
      self.postMessage({ id, ok: false, error: `worker: unknown channel ${channel}` });
      return;
    }

    const result = await handler(payload);
    self.postMessage({ id, ok: true, value: result === undefined ? null : result });
  } catch (err: any) {
    console.error(`[worker] Error on channel ${channel}:`, err);
    self.postMessage({ id, ok: false, error: err?.message || String(err) });
  }
};
