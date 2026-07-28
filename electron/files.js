// Attachment storage: one folder next to habitat.db, addressed by content.
//
// A file's name on disk is the SHA-256 of its bytes, sharded one level deep so
// no single directory grows unwieldy:
//
//   <vault>/files/a3/a3f9…c1.png
//
// Addressing by content means the same image pasted twenty times is stored once,
// names never collide, and nothing has to be renamed to stay unique. The vault
// stays a folder you can copy: the database beside the blobs it refers to.

const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');

/** Bigger than this and it doesn't belong in a note. */
const MAX_BYTES = 64 * 1024 * 1024;

let filesDir = null;

/** Point storage at the vault the database is currently open on. */
function useVault(dbFile) {
  filesDir = path.join(path.dirname(dbFile), 'files');
}

const dir = () => filesDir;

/** Only ever a short, plain extension — the name a user typed never reaches the filesystem. */
const cleanExt = (ext) => (/^\.[a-z0-9]{1,8}$/.test(String(ext || '').toLowerCase()) ? String(ext).toLowerCase() : '');

const safeExt = (name) => cleanExt(path.extname(String(name || '')));

function pathFor(hash, ext = '') {
  return path.join(filesDir, hash.slice(0, 2), hash + ext);
}

/**
 * Write bytes into the store. Returns the hash and where it landed; an identical
 * file already there is left alone, which is what makes duplicates free.
 */
function store(buffer, name) {
  if (!filesDir) throw new Error('no vault open');
  if (buffer.length > MAX_BYTES) throw new Error(`that file is larger than ${MAX_BYTES / 1024 / 1024}MB`);
  const hash = createHash('sha256').update(buffer).digest('hex');
  const ext = safeExt(name);
  const target = pathFor(hash, ext);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, buffer);
  }
  return { hash, ext, size: buffer.length, path: target };
}

function storeFromPath(file) {
  return { ...store(fs.readFileSync(file), file), name: path.basename(file) };
}

/** Where a stored file lives, or null if the blob has gone missing. */
function resolve(hash, ext = '') {
  if (!filesDir || !/^[a-f0-9]{64}$/.test(String(hash))) return null;
  const target = pathFor(hash, cleanExt(ext));
  return fs.existsSync(target) ? target : null;
}

function remove(hash, ext = '') {
  const target = resolve(hash, ext);
  if (!target) return 0;
  const { size } = fs.statSync(target);
  fs.rmSync(target, { force: true });
  // Tidy the shard when it empties, so the store doesn't leave husks behind.
  const shard = path.dirname(target);
  try {
    if (fs.readdirSync(shard).length === 0) fs.rmdirSync(shard);
  } catch {
    /* another write raced us; harmless */
  }
  return size;
}

/** Everything actually on disk, for reconciling against what the database knows. */
function listStored() {
  if (!filesDir || !fs.existsSync(filesDir)) return [];
  const out = [];
  for (const shard of fs.readdirSync(filesDir)) {
    const shardDir = path.join(filesDir, shard);
    if (!fs.statSync(shardDir).isDirectory()) continue;
    for (const entry of fs.readdirSync(shardDir)) {
      const full = path.join(shardDir, entry);
      out.push({ hash: path.basename(entry, path.extname(entry)), ext: path.extname(entry), path: full, size: fs.statSync(full).size });
    }
  }
  return out;
}

const IMAGE = /^image\//;
const isImage = (mime) => IMAGE.test(String(mime || ''));

module.exports = { useVault, dir, store, storeFromPath, resolve, remove, listStored, isImage, safeExt, MAX_BYTES };
