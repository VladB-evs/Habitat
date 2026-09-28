import { sha256Hex } from './sha256';
import { extname } from './path';

const MAX_BYTES = 64 * 1024 * 1024;
const blobCache = new Map<string, Uint8Array>();

// Simple IndexedDB backing store for attachments in browser/worker
const DB_NAME = 'habitat_files';
const STORE_NAME = 'blobs';

function openBlobDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function persistBlob(hash: string, data: Uint8Array) {
  try {
    const db = await openBlobDb();
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(data, hash);
  } catch (err) {
    console.warn('[files] Failed to persist blob to IDB:', err);
  }
}

async function deleteBlob(hash: string) {
  try {
    const db = await openBlobDb();
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(hash);
  } catch {}
}

export function useVault(_dbFile: string) {
  // Vault path tracking for browser
}

export const dir = () => 'opfs:/files';

export const cleanExt = (ext: string) =>
  /^\.[a-z0-9]{1,8}$/.test(String(ext || '').toLowerCase()) ? String(ext).toLowerCase() : '';

export const safeExt = (name: string) => cleanExt(extname(String(name || '')));

export function store(buffer: Uint8Array | ArrayBuffer | any, name?: string) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length > MAX_BYTES) {
    throw new Error(`that file is larger than ${MAX_BYTES / 1024 / 1024}MB`);
  }
  const hash = sha256Hex(bytes);
  const ext = safeExt(name || '');
  blobCache.set(hash, bytes);
  // Persist asynchronously
  persistBlob(hash, bytes);
  return { hash, ext, size: bytes.length, path: `${hash}${ext}` };
}

export function storeFromPath(_file: string) {
  throw new Error('storeFromPath is not supported in browser environment');
}

export function resolve(hash: string, _ext = '') {
  if (!hash || !/^[a-f0-9]{64}$/.test(String(hash))) return null;
  return blobCache.has(hash) ? hash : hash;
}

export function getBlobBytes(hash: string): Uint8Array | null {
  return blobCache.get(hash) || null;
}

export function remove(hash: string, _ext = '') {
  const existing = blobCache.get(hash);
  const size = existing ? existing.length : 0;
  blobCache.delete(hash);
  deleteBlob(hash);
  return size;
}

export function listStored() {
  const out = [];
  for (const [hash, bytes] of blobCache.entries()) {
    out.push({ hash, ext: '', path: hash, size: bytes.length });
  }
  return out;
}

export const isImage = (mime?: string) => /^image\//.test(String(mime || ''));

export default {
  useVault,
  dir,
  store,
  storeFromPath,
  resolve,
  getBlobBytes,
  remove,
  listStored,
  isImage,
  safeExt,
  MAX_BYTES,
};
