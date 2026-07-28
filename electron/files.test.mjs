// Attachments are content-addressed on disk and swept by walking what actually
// refers to them. These cover the two ways that goes wrong: the same bytes being
// stored twice, and a sweep deleting something still in use. Run with `npm test`.

import { createRequire } from 'node:module';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dbmod = require('./db.js');
const files = require('./files.js');

const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'habitat-files-'));
const file = path.join(vault, 'test.db');
const api = dbmod.api;

const bytes = (s) => new TextEncoder().encode(s);
const add = (name, mime, body) => api['files:add']({ name, mime, data: bytes(body) });
const mediaDoc = (ref) => ({
  type: 'doc',
  content: [{ type: 'media', attrs: { hash: ref.hash, name: ref.name, mime: ref.mime, ext: ref.ext } }],
});

before(() => {
  dbmod.initDb(file);
  dbmod.seedFlavor('personal');
});

after(() => {
  dbmod.closeDb();
  fs.rmSync(vault, { recursive: true, force: true });
});

test('files land in one sharded folder beside the database', () => {
  const ref = add('shot.png', 'image/png', 'pretend-png');
  assert.match(ref.hash, /^[a-f0-9]{64}$/);
  assert.equal(ref.ext, '.png');
  const onDisk = files.resolve(ref.hash, ref.ext);
  assert.ok(onDisk, 'stored');
  assert.equal(path.dirname(path.dirname(onDisk)), path.join(vault, 'files'));
  assert.equal(path.basename(path.dirname(onDisk)), ref.hash.slice(0, 2), 'sharded by the first two characters');
});

test('the same bytes are stored once, whatever they are called', () => {
  const a = add('one.png', 'image/png', 'identical');
  const b = add('two.png', 'image/png', 'identical');
  assert.equal(a.hash, b.hash);
  assert.equal(files.listStored().filter((f) => f.hash === a.hash).length, 1);
});

test('a name cannot smuggle a path into the store', () => {
  const ref = api['files:add']({ name: '../../escape.sh', mime: 'text/plain', data: bytes('x') });
  const onDisk = files.resolve(ref.hash, ref.ext);
  assert.ok(onDisk.startsWith(path.join(vault, 'files')), 'stays inside the store');
  assert.equal(ref.ext, '.sh');
});

test('the sweep keeps what is referenced and drops what is not', () => {
  const used = add('kept.png', 'image/png', 'referenced-by-a-note');
  const loose = add('loose.png', 'image/png', 'referenced-by-nothing');
  api['objects:create']({ typeId: 'note', title: 'Has an image', content: mediaDoc(used) });

  const before = api['files:stats']();
  assert.equal(before.unusedCount >= 1, true);

  const { removed } = api['files:gc']();
  assert.equal(removed >= 1, true);
  assert.ok(files.resolve(used.hash, used.ext), 'the referenced file survives');
  assert.equal(files.resolve(loose.hash, loose.ext), null, 'the loose one is gone');
  assert.equal(api['files:get'](loose.hash), null, 'and so is its row');
});

test('a file held by a property counts as referenced', () => {
  const ref = add('receipt.pdf', 'application/pdf', 'invoice-bytes');
  api['objects:create']({ typeId: 'note', title: 'Expense', props: { attachment: [ref] } });
  api['files:gc']();
  assert.ok(files.resolve(ref.hash, ref.ext), 'still there');
});

test('deleting the last thing pointing at a file makes it collectable', () => {
  const ref = add('temp.png', 'image/png', 'only-in-one-note');
  const note = api['objects:create']({ typeId: 'note', title: 'Temporary', content: mediaDoc(ref) });
  api['files:gc']();
  assert.ok(files.resolve(ref.hash, ref.ext), 'kept while the note exists');

  api['objects:delete'](note.id);
  api['files:gc']();
  assert.equal(files.resolve(ref.hash, ref.ext), null, 'collected once nothing refers to it');
});

test('attachment names are searchable', () => {
  const ref = add('quarterly-forecast.pdf', 'application/pdf', 'numbers');
  api['objects:create']({ typeId: 'note', title: 'Planning', content: mediaDoc(ref) });
  const hits = api['objects:search']({ q: 'quarterly-forecast', content: true });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].title, 'Planning');
});
